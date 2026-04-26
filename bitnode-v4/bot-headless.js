import axios from 'axios';
import crypto from 'crypto';
import fs from 'fs';
import PDFDocument from 'pdfkit';
import dotenv from 'dotenv';

dotenv.config();

/**
 * =========================================================================
 *  BITNODE HFT PRO ENGINE v5.0 (BINANCE FUTURES)
 *  STRATEGY: SMC (FVG, Order Blocks) + EMA/RSI + Random Walk
 *  LEVERAGE: 50x (HFT Mode)
 *  MODES: paper | binance-testnet | binance-live
 * =========================================================================
 */

const CONFIG = {
  executionMode: (process.env.EXECUTION_MODE || 'paper').toLowerCase(),
  apiKey: process.env.BINANCE_API_KEY || '',
  apiSecret: process.env.BINANCE_API_SECRET || '',
  
  // Risk Settings
  leverage: 50,
  marginPerTradeUsd: 10,
  dailyProfitTargetUsd: 5,
  dailyLossLimitUsd: -2,
  tpPct: 0.001, // 0.1% move = $0.5 profit at 50x $10
  slPct: 0.001, // 0.1% move = $0.5 loss at 50x $10
  
  // Scanner Settings
  scanIntervalMs: 1000, // 1 second HFT speed
  maxPairs: 30,
  minConfidence: 85,
  
  // URLs
  marketBaseUrl: process.env.MARKET_BASE_URL || 'https://fapi.binance.com',
  testnetBaseUrl: 'https://testnet.binancefuture.com',
  
  // Files
  reportJsonPath: 'daily_report.json',
  reportPdfPath: 'daily_report.pdf',
};

let CURRENT_BASE_URL = CONFIG.executionMode === 'binance-testnet' ? CONFIG.testnetBaseUrl : CONFIG.marketBaseUrl;

let dailyPnL = 0;
let totalPnL = 0;
let trades = [];
let activeTrade = null;
let dynamicPairs = [];
let livePrices = {};
let symbolMeta = {};

// --- UTILS ---
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function calculateEMA(values, period) {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < values.length; i++) {
    ema = (values[i] * k) + (ema * (1 - k));
  }
  return ema;
}

function calculateRSI(closes, period = 14) {
  if (closes.length <= period) return 50;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gains += d; else losses -= d;
  }
  let avgG = gains / period, avgL = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgG = (avgG * (period - 1) + Math.max(d, 0)) / period;
    avgL = (avgL * (period - 1) + Math.max(-d, 0)) / period;
  }
  return avgL === 0 ? 100 : 100 - (100 / (1 + (avgG / avgL)));
}

// --- BINANCE API ---
function signedQuery(params, secret) {
  const query = new URLSearchParams(params).toString();
  const signature = crypto.createHmac('sha256', secret).update(query).digest('hex');
  return `${query}&signature=${signature}`;
}

async function binancePublic(path, params = {}) {
  try {
    const res = await axios.get(`${CURRENT_BASE_URL}${path}`, { params, timeout: 10000 });
    return res.data;
  } catch (err) {
    if (err.response?.status === 451 && CURRENT_BASE_URL !== CONFIG.testnetBaseUrl) {
      console.warn(`[REGION BLOCKED] Primary API blocked. Permanently switching to Testnet URL for this session.`);
      CURRENT_BASE_URL = CONFIG.testnetBaseUrl;
      const res = await axios.get(`${CURRENT_BASE_URL}${path}`, { params, timeout: 10000 });
      return res.data;
    }
    throw err;
  }
}

async function getRealPrice(symbol) {
  try {
    // Fetch REAL market data from Bybit (Unblocked in most regions)
    const res = await axios.get(`https://api.bybit.com/v5/market/tickers?category=linear&symbol=${symbol}`);
    return parseFloat(res.data.result.list[0].lastPrice);
  } catch (e) {
    // Fallback to current Binance session URL
    const res = await axios.get(`${CURRENT_BASE_URL}/fapi/v1/ticker/price?symbol=${symbol}`);
    return parseFloat(res.data.price);
  }
}

async function getCandles(symbol, limit = 50) {
  try {
    // Fetch REAL market candles from Bybit
    const res = await axios.get(`https://api.bybit.com/v5/market/kline?category=linear&symbol=${symbol}&interval=1&limit=${limit}`);
    return res.data.result.list.map(k => ({
      open: parseFloat(k[1]), high: parseFloat(k[2]), low: parseFloat(k[3]), close: parseFloat(k[4]), vol: parseFloat(k[5])
    })).reverse();
  } catch (e) {
    // Fallback to Binance
    const klines = await binancePublic('/fapi/v1/klines', { symbol, interval: '1m', limit });
    return klines.map(k => ({
      open: parseFloat(k[1]), high: parseFloat(k[2]), low: parseFloat(k[3]), close: parseFloat(k[4]), vol: parseFloat(k[5])
    }));
  }
}

async function binanceSigned(method, path, params = {}) {
  if (!CONFIG.apiKey || !CONFIG.apiSecret) throw new Error('Missing API Keys');
  const payload = { ...params, timestamp: Date.now(), recvWindow: 5000 };
  const query = signedQuery(payload, CONFIG.apiSecret);
  const url = `${CURRENT_BASE_URL}${path}?${query}`;
  const res = await axios({
    method, url, headers: { 'X-MBX-APIKEY': CONFIG.apiKey }, timeout: 10000
  });
  return res.data;
}

// --- CORE LOGIC ---
async function hydrateExchangeInfo() {
  const data = await binancePublic('/fapi/v1/exchangeInfo');
  data.symbols.forEach(s => {
    if (s.quoteAsset === 'USDT' && s.status === 'TRADING') {
      const priceFilter = s.filters.find(f => f.filterType === 'PRICE_FILTER');
      const lotFilter = s.filters.find(f => f.filterType === 'LOT_SIZE');
      symbolMeta[s.symbol] = {
        tickSize: parseFloat(priceFilter.tickSize),
        stepSize: parseFloat(lotFilter.stepSize),
        precision: s.quantityPrecision,
        pricePrecision: s.pricePrecision
      };
    }
  });
}

async function refreshTopPairs() {
  const tickers = await binancePublic('/fapi/v1/ticker/24hr');
  const filtered = tickers
    .filter(t => t.symbol.endsWith('USDT'))
    .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
    .slice(0, CONFIG.maxPairs);
  
  dynamicPairs = filtered.map(t => t.symbol);
  filtered.forEach(t => livePrices[t.symbol] = parseFloat(t.lastPrice));
  console.log(`[MARKET] Synced ${dynamicPairs.length} high-volume pairs.`);
}

function buildSMC_Signal(candles, price) {
  if (candles.length < 30) return null;
  const closes = candles.map(c => c.close);
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const prev2 = candles[candles.length - 3];

  let score = 0;
  
  // 1. EMA Trend
  const emaFast = calculateEMA(closes, 9);
  const emaSlow = calculateEMA(closes, 21);
  const rsi = calculateRSI(closes, 14);
  
  if (emaFast > emaSlow) score += 20;
  else score -= 20;

  if (rsi > 50 && rsi < 70) score += 10;
  if (rsi < 50 && rsi > 30) score -= 10;

  // 2. FVG (Fair Value Gap)
  const isBullishFVG = prev2.high < last.low;
  const isBearishFVG = prev2.low > last.high;
  if (isBullishFVG) score += 15;
  if (isBearishFVG) score -= 15;

  // 3. Order Block (OB)
  const isBullishOB = prev.close < prev.open && last.close > last.open && last.close > prev.high;
  const isBearishOB = prev.close > prev.open && last.close < last.open && last.close < prev.low;
  if (isBullishOB) score += 20;
  if (isBearishOB) score -= 20;

  // 4. Momentum / Random Walk Sync
  const momentum = last.close > prev.close ? 1 : -1;
  score += momentum * 15;

  // Confidence calculation
  const confidence = Math.abs(score);
  const direction = score > 0 ? 'LONG' : 'SHORT';
  
  return { direction, confidence, rsi, emaFast, emaSlow };
}

async function executeTrade(symbol, direction, price) {
  const meta = symbolMeta[symbol];
  const notional = CONFIG.marginPerTradeUsd * CONFIG.leverage;
  let qty = notional / price;
  
  // Round qty to stepSize
  qty = Math.floor(qty / meta.stepSize) * meta.stepSize;
  qty = parseFloat(qty.toFixed(meta.precision));

  if (qty <= 0) return null;

  const tpPrice = direction === 'LONG' ? price * (1 + CONFIG.tpPct) : price * (1 - CONFIG.tpPct);
  const slPrice = direction === 'LONG' ? price * (1 - CONFIG.slPct) : price * (1 + CONFIG.slPct);

  const tradeData = {
    id: Date.now(),
    symbol, direction, entry: price, qty,
    tp: parseFloat(tpPrice.toFixed(meta.pricePrecision)),
    sl: parseFloat(slPrice.toFixed(meta.pricePrecision)),
    startTime: new Date().toISOString(),
    status: 'ACTIVE'
  };

  if (CONFIG.executionMode === 'paper') {
    console.log(`[ENTRY][PAPER] ${symbol} ${direction} @ ${price} | TP: ${tradeData.tp} | SL: ${tradeData.sl}`);
    return tradeData;
  }

  try {
    // 1. Set Leverage
    await binanceSigned('POST', '/fapi/v1/leverage', { symbol, leverage: CONFIG.leverage });
    
    // 2. Place Market Order
    const side = direction === 'LONG' ? 'BUY' : 'SELL';
    const order = await binanceSigned('POST', '/fapi/v1/order', {
      symbol, side, type: 'MARKET', quantity: qty
    });
    
    console.log(`[ENTRY][${CONFIG.executionMode}] ${symbol} ${direction} orderId=${order.orderId}`);
    return { ...tradeData, orderId: order.orderId };
  } catch (err) {
    console.error(`[EXECUTION ERROR] ${err.response?.data?.msg || err.message}`);
    return null;
  }
}

async function closeTrade(trade, currentPrice, reason) {
  const pnlRaw = trade.direction === 'LONG' 
    ? (currentPrice - trade.entry) * trade.qty 
    : (trade.entry - currentPrice) * trade.qty;
  
  // Binance Futures Fee ~0.04%
  const fees = (trade.entry * trade.qty * 0.0004) + (currentPrice * trade.qty * 0.0004);
  const profit = pnlRaw - fees;

  if (CONFIG.executionMode !== 'paper') {
    try {
      const side = trade.direction === 'LONG' ? 'SELL' : 'BUY';
      await binanceSigned('POST', '/fapi/v1/order', {
        symbol: trade.symbol, side, type: 'MARKET', quantity: trade.qty, reduceOnly: 'true'
      });
    } catch (e) {
      console.error(`[CLOSE ERROR] ${e.message}`);
    }
  }

  dailyPnL += profit;
  totalPnL += profit;
  
  const finalized = { 
    ...trade, 
    exit: currentPrice, 
    profit, 
    status: profit > 0 ? 'WON' : 'LOST', 
    reason,
    endTime: new Date().toISOString()
  };
  trades.push(finalized);
  
  console.log(`[EXIT] ${trade.symbol} ${reason} | PnL: $${profit.toFixed(2)} | Daily: $${dailyPnL.toFixed(2)}`);
  generateReports();
}

function generateReports() {
  const dateStr = new Date().toISOString().split('T')[0];
  const reportDir = `reports/${dateStr}`;
  
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }

  const jsonPath = `${reportDir}/daily_report.json`;
  const pdfPath = `${reportDir}/daily_report.pdf`;

  const report = { timestamp: new Date().toISOString(), mode: CONFIG.executionMode, dailyPnL, totalPnL, tradeCount: trades.length, trades };
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

  try {
    const doc = new PDFDocument({ margin: 50 });
    doc.pipe(fs.createWriteStream(pdfPath));
    doc.fillColor('#000000').fontSize(22).text('Bitnode HFT Audit Report', { align: 'center' });
    doc.fontSize(10).text(`Mode: ${CONFIG.executionMode} | Date: ${new Date().toLocaleString()}`, { align: 'center' });
    doc.moveDown(2);
    doc.fontSize(14).text(`Daily PnL: $${dailyPnL.toFixed(4)}`);
    doc.text(`Total Trades: ${trades.length}`);
    doc.moveDown();
    trades.slice(-20).forEach(t => {
      doc.fontSize(10).fillColor(t.profit > 0 ? '#008000' : '#FF0000').text(`${t.endTime} | ${t.symbol} | ${t.direction} | PnL: $${t.profit.toFixed(2)} (${t.reason})`);
    });
    doc.end();
    gitSync(pdfPath);
  } catch (e) {
    console.error(`[REPORT ERROR] PDF generation failed: ${e.message}`);
  }
}

async function gitSync(filePath) {
  const { exec } = await import('child_process');
  const dateStr = new Date().toISOString().split('T')[0];
  exec(`git add "${filePath}" && git commit -m "Audit Report: ${dateStr}" && git push`, (err) => {
    if (err) {
      // Silent fail if git is not configured
      return;
    }
    console.log(`[GIT] Report synced to repository: ${dateStr}`);
  });
}

async function mainLoop() {
  if (dailyPnL >= CONFIG.dailyProfitTargetUsd || dailyPnL <= CONFIG.dailyLossLimitUsd) {
    console.log(`[RISK] Daily limit reached ($${dailyPnL.toFixed(2)}). Stopping.`);
    process.exit(0);
  }

  if (activeTrade) {
    const currentPrice = await getRealPrice(activeTrade.symbol);
    
    let shouldClose = false;
    let reason = '';
    
    if (activeTrade.direction === 'LONG') {
      if (currentPrice >= activeTrade.tp) { shouldClose = true; reason = 'TP'; }
      else if (currentPrice <= activeTrade.sl) { shouldClose = true; reason = 'SL'; }
    } else {
      if (currentPrice <= activeTrade.tp) { shouldClose = true; reason = 'TP'; }
      else if (currentPrice >= activeTrade.sl) { shouldClose = true; reason = 'SL'; }
    }

    if (shouldClose) {
      await closeTrade(activeTrade, currentPrice, reason);
      activeTrade = null;
    } else {
      const pnl = activeTrade.direction === 'LONG' ? (currentPrice - activeTrade.entry) * activeTrade.qty : (activeTrade.entry - currentPrice) * activeTrade.qty;
      console.log(`[LIVE] ${activeTrade.symbol} | PnL: $${pnl.toFixed(2)} | Real Price: ${currentPrice}`);
    }
    return;
  }

  // Scan for new opportunity
  const symbol = dynamicPairs[Math.floor(Math.random() * dynamicPairs.length)];
  const candles = await getCandles(symbol);
  const price = await getRealPrice(symbol);
  
  const signal = buildSMC_Signal(candles, price);
  if (signal && signal.confidence >= CONFIG.minConfidence) {
    activeTrade = await executeTrade(symbol, signal.direction, price);
  }
}

async function boot() {
  console.log(">>> BITNODE HFT ENGINE BOOTING...");
  console.log(`>>> MODE: ${CONFIG.executionMode}`);
  
  try {
    await hydrateExchangeInfo();
    await refreshTopPairs();
  } catch (err) {
    console.error(`[BOOT ERROR] Initial sync failed: ${err.message}`);
    console.log("Retrying in 5 seconds...");
    await sleep(5000);
    return boot();
  }
  
  setInterval(async () => {
    try { await mainLoop(); } catch (e) { console.error(`[LOOP ERROR] ${e.message}`); }
  }, CONFIG.scanIntervalMs);

  setInterval(refreshTopPairs, 600000); // 10 min refresh
}

boot();
