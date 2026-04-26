import axios from 'axios';
import crypto from 'crypto';
import fs from 'fs';
import PDFDocument from 'pdfkit';

const CONFIG = {
  scanIntervalMs: Number(process.env.SCAN_INTERVAL_MS || 2500),
  pairRefreshMs: Number(process.env.PAIR_REFRESH_MS || 180000),
  reportEveryMs: Number(process.env.REPORT_EVERY_MS || 1800000),
  dailyProfitTargetUsd: Number(process.env.DAILY_PROFIT_TARGET_USD || 20),
  dailyLossLimitUsd: Number(process.env.DAILY_LOSS_LIMIT_USD || -8),
  riskPerTradeUsd: Number(process.env.RISK_PER_TRADE_USD || 15),
  tpPct: Number(process.env.TP_PCT || 0.003),
  slPct: Number(process.env.SL_PCT || 0.002),
  maxHoldSeconds: Number(process.env.MAX_HOLD_SECONDS || 180),
  minQuoteVolumeUsd: Number(process.env.MIN_QUOTE_VOLUME_USD || 20000000),
  maxPairs: Number(process.env.MAX_PAIRS || 30),
  minSignalScore: Number(process.env.MIN_SIGNAL_SCORE || 5),
  executionMode: (process.env.EXECUTION_MODE || 'paper').toLowerCase(),
  apiKey: process.env.BINANCE_API_KEY || '',
  apiSecret: process.env.BINANCE_API_SECRET || '',
  marketBaseUrl: 'https://api.binance.com',
  reportJsonPath: process.env.REPORT_JSON_PATH || 'daily_report.json',
  reportPdfPath: process.env.REPORT_PDF_PATH || 'daily_report.pdf',
};

const TRADE_BASE_URL = CONFIG.executionMode === 'binance-testnet'
  ? 'https://testnet.binance.vision'
  : 'https://api.binance.com';

let dailyPnL = 0;
let totalPnL = 0;
let trades = [];

let dynamicPairs = [];
let livePrices = {};
let activeTrade = null;
let symbolMeta = {};
let lastPairRefresh = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function calculateEMA(values, period) {
  if (!Array.isArray(values) || values.length < period) return null;
  const k = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((sum, v) => sum + v, 0) / period;
  for (let i = period; i < values.length; i++) {
    ema = (values[i] * k) + (ema * (1 - k));
  }
  return ema;
}

function calculateRSI(closes, period = 14) {
  if (!Array.isArray(closes) || closes.length <= period) return 50;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change >= 0) gains += change;
    else losses -= change;
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    avgGain = ((avgGain * (period - 1)) + Math.max(change, 0)) / period;
    avgLoss = ((avgLoss * (period - 1)) + Math.max(-change, 0)) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function signedQuery(params, secret) {
  const query = new URLSearchParams(params).toString();
  const signature = crypto.createHmac('sha256', secret).update(query).digest('hex');
  return `${query}&signature=${signature}`;
}

async function binancePublic(path, params = {}) {
  const res = await axios.get(`${CONFIG.marketBaseUrl}${path}`, { params, timeout: 10000 });
  return res.data;
}

async function binanceSigned(method, path, params = {}) {
  if (!CONFIG.apiKey || !CONFIG.apiSecret) {
    throw new Error('Missing BINANCE_API_KEY or BINANCE_API_SECRET');
  }

  const payload = {
    ...params,
    timestamp: Date.now(),
    recvWindow: 5000,
  };
  const queryWithSig = signedQuery(payload, CONFIG.apiSecret);
  const url = `${TRADE_BASE_URL}${path}?${queryWithSig}`;

  const res = await axios({
    method,
    url,
    headers: { 'X-MBX-APIKEY': CONFIG.apiKey },
    timeout: 10000,
  });

  return res.data;
}

async function hydrateExchangeInfo() {
  const data = await binancePublic('/api/v3/exchangeInfo');
  const map = {};

  for (const s of data.symbols || []) {
    if (!s.symbol.endsWith('USDT')) continue;
    const lot = (s.filters || []).find((f) => f.filterType === 'LOT_SIZE');
    const price = (s.filters || []).find((f) => f.filterType === 'PRICE_FILTER');
    if (!lot || !price) continue;

    map[s.symbol] = {
      stepSize: Number(lot.stepSize),
      minQty: Number(lot.minQty),
      tickSize: Number(price.tickSize),
    };
  }

  symbolMeta = map;
}

function quantizeQty(symbol, rawQty) {
  const meta = symbolMeta[symbol];
  if (!meta) return Number(rawQty.toFixed(6));
  const steps = Math.floor(rawQty / meta.stepSize);
  const q = steps * meta.stepSize;
  return Number(q.toFixed(8));
}

async function refreshTopPairs(force = false) {
  const now = Date.now();
  if (!force && now - lastPairRefresh < CONFIG.pairRefreshMs) return;

  const data = await binancePublic('/api/v3/ticker/24hr');
  const bannedWords = ['UPUSDT', 'DOWNUSDT', 'BULLUSDT', 'BEARUSDT'];

  const ranked = data
    .filter((t) => t.symbol.endsWith('USDT'))
    .filter((t) => !bannedWords.some((w) => t.symbol.includes(w)))
    .filter((t) => Number(t.quoteVolume) >= CONFIG.minQuoteVolumeUsd)
    .sort((a, b) => {
      const aScore = Math.abs(Number(a.priceChangePercent || 0)) * Number(a.quoteVolume || 0);
      const bScore = Math.abs(Number(b.priceChangePercent || 0)) * Number(b.quoteVolume || 0);
      return bScore - aScore;
    })
    .slice(0, CONFIG.maxPairs);

  dynamicPairs = ranked.map((t) => t.symbol);
  for (const t of ranked) {
    livePrices[t.symbol] = Number(t.lastPrice);
  }

  lastPairRefresh = now;
  console.log(`[MARKET] Synced ${dynamicPairs.length} high-activity Binance pairs.`);
}

async function getLastPrice(symbol) {
  const d = await binancePublic('/api/v3/ticker/price', { symbol });
  const p = Number(d.price);
  livePrices[symbol] = p;
  return p;
}

async function getCandles(symbol, limit = 120) {
  const klines = await binancePublic('/api/v3/klines', {
    symbol,
    interval: '1m',
    limit,
  });

  return klines.map((k) => ({
    openTime: Number(k[0]),
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5]),
  }));
}

function buildSignal(candles, livePrice) {
  if (!candles || candles.length < 40) return null;

  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const prev2 = candles[candles.length - 3];

  const emaFast = calculateEMA(closes, 9);
  const emaSlow = calculateEMA(closes, 21);
  const rsi = calculateRSI(closes, 14);

  if (emaFast === null || emaSlow === null) return null;

  const avgVol20 = volumes.slice(-21, -1).reduce((s, v) => s + v, 0) / 20;
  const volSurge = last.volume > avgVol20 * 1.2;

  const momentumUp = last.close > prev.close && prev.close > prev2.close;
  const momentumDown = last.close < prev.close && prev.close < prev2.close;

  const bullishBody = last.close > last.open && (last.close - last.open) / Math.max(last.high - last.low, 1e-9) > 0.5;
  const bearishBody = last.close < last.open && (last.open - last.close) / Math.max(last.high - last.low, 1e-9) > 0.5;

  const swingLow = Math.min(...candles.slice(-20, -1).map((c) => c.low));
  const swingHigh = Math.max(...candles.slice(-20, -1).map((c) => c.high));
  const nearSupport = (livePrice - swingLow) / livePrice < 0.0018;
  const nearResistance = (swingHigh - livePrice) / livePrice < 0.0018;

  let longScore = 0;
  let shortScore = 0;

  if (emaFast > emaSlow) longScore += 2;
  if (emaFast < emaSlow) shortScore += 2;

  if (rsi > 52 && rsi < 72) longScore += 1;
  if (rsi < 48 && rsi > 28) shortScore += 1;

  if (momentumUp) longScore += 1;
  if (momentumDown) shortScore += 1;

  if (bullishBody) longScore += 1;
  if (bearishBody) shortScore += 1;

  if (volSurge) {
    longScore += 1;
    shortScore += 1;
  }

  if (nearSupport) longScore += 1;
  if (nearResistance) shortScore += 1;

  const direction = longScore > shortScore ? 'LONG' : 'SHORT';
  const maxScore = Math.max(longScore, shortScore);

  return {
    direction,
    longScore,
    shortScore,
    score: maxScore,
    rsi,
    emaFast,
    emaSlow,
    volSurge,
    nearSupport,
    nearResistance,
  };
}

function makeTradePlan(symbol, direction, price) {
  const qtyRaw = CONFIG.riskPerTradeUsd / price;
  const qty = quantizeQty(symbol, qtyRaw);

  const tp = direction === 'LONG'
    ? price * (1 + CONFIG.tpPct)
    : price * (1 - CONFIG.tpPct);

  const sl = direction === 'LONG'
    ? price * (1 - CONFIG.slPct)
    : price * (1 + CONFIG.slPct);

  return {
    symbol,
    direction,
    entry: price,
    qty,
    tp,
    sl,
    openedAt: Date.now(),
    openedIso: new Date().toISOString(),
    mode: CONFIG.executionMode,
  };
}

async function openTrade(plan) {
  if (plan.qty <= 0) return null;

  if (CONFIG.executionMode === 'paper') {
    console.log(`[ENTRY][PAPER] ${plan.symbol} ${plan.direction} qty=${plan.qty} entry=${plan.entry.toFixed(6)} tp=${plan.tp.toFixed(6)} sl=${plan.sl.toFixed(6)}`);
    return { ...plan, venueOrderId: null };
  }

  const side = plan.direction === 'LONG' ? 'BUY' : 'SELL';
  const order = await binanceSigned('post', '/api/v3/order', {
    symbol: plan.symbol,
    side,
    type: 'MARKET',
    quantity: plan.qty,
  });

  const fillPrice = Number(order.cummulativeQuoteQty || 0) > 0
    ? Number(order.cummulativeQuoteQty) / Number(order.executedQty)
    : plan.entry;

  console.log(`[ENTRY][${CONFIG.executionMode.toUpperCase()}] ${plan.symbol} ${plan.direction} orderId=${order.orderId}`);

  return {
    ...plan,
    entry: fillPrice,
    venueOrderId: order.orderId,
    venueOpen: order,
  };
}

function shouldCloseTrade(trade, priceNow) {
  const ageSec = (Date.now() - trade.openedAt) / 1000;

  if (trade.direction === 'LONG') {
    if (priceNow >= trade.tp) return { reason: 'TP_HIT' };
    if (priceNow <= trade.sl) return { reason: 'SL_HIT' };
  } else {
    if (priceNow <= trade.tp) return { reason: 'TP_HIT' };
    if (priceNow >= trade.sl) return { reason: 'SL_HIT' };
  }

  if (ageSec >= CONFIG.maxHoldSeconds) {
    return { reason: 'TIME_EXIT' };
  }

  return null;
}

async function closeTrade(trade, closePrice, reason) {
  let venueClose = null;

  if (CONFIG.executionMode !== 'paper') {
    const side = trade.direction === 'LONG' ? 'SELL' : 'BUY';
    venueClose = await binanceSigned('post', '/api/v3/order', {
      symbol: trade.symbol,
      side,
      type: 'MARKET',
      quantity: trade.qty,
    });

    if (Number(venueClose.cummulativeQuoteQty || 0) > 0 && Number(venueClose.executedQty || 0) > 0) {
      closePrice = Number(venueClose.cummulativeQuoteQty) / Number(venueClose.executedQty);
    }
  }

  const pnlRaw = trade.direction === 'LONG'
    ? (closePrice - trade.entry) * trade.qty
    : (trade.entry - closePrice) * trade.qty;

  const fees = CONFIG.executionMode === 'paper' ? 0 : Math.abs(trade.entry * trade.qty) * 0.001 + Math.abs(closePrice * trade.qty) * 0.001;
  const pnl = pnlRaw - fees;

  dailyPnL += pnl;
  totalPnL += pnl;

  const row = {
    time: new Date().toISOString(),
    symbol: trade.symbol,
    direction: trade.direction,
    qty: trade.qty,
    entry: trade.entry,
    exit: closePrice,
    tp: trade.tp,
    sl: trade.sl,
    reason,
    status: pnl >= 0 ? 'WON' : 'LOST',
    profit: pnl,
    holdSeconds: Math.round((Date.now() - trade.openedAt) / 1000),
    mode: CONFIG.executionMode,
  };

  if (venueClose) row.venueCloseOrderId = venueClose.orderId;
  trades.push(row);

  console.log(`[EXIT] ${row.symbol} ${row.reason} pnl=${row.profit.toFixed(4)} daily=${dailyPnL.toFixed(4)} total=${totalPnL.toFixed(4)}`);
  generateReports();
}

function generateReports() {
  const report = {
    timestamp: new Date().toISOString(),
    config: {
      executionMode: CONFIG.executionMode,
      tpPct: CONFIG.tpPct,
      slPct: CONFIG.slPct,
      maxHoldSeconds: CONFIG.maxHoldSeconds,
      minSignalScore: CONFIG.minSignalScore,
    },
    dailyPnL,
    totalPnL,
    tradeCount: trades.length,
    activeTrade,
    trades,
  };

  fs.writeFileSync(CONFIG.reportJsonPath, JSON.stringify(report, null, 2));

  try {
    const doc = new PDFDocument({ margin: 50 });
    doc.pipe(fs.createWriteStream(CONFIG.reportPdfPath));

    doc.fillColor('#000000').fontSize(20).text('Bitnode Crypto Scalper Audit', { align: 'center' });
    doc.fillColor('#555555').fontSize(11).text(`Mode: ${CONFIG.executionMode}`, { align: 'center' });
    doc.moveDown(1.5);

    doc.fillColor('#000000').fontSize(12).text(`Timestamp: ${new Date().toISOString()}`);
    doc.text(`Trades: ${trades.length}`);
    doc.fillColor(dailyPnL >= 0 ? '#0f766e' : '#b91c1c').text(`Daily PnL: $${dailyPnL.toFixed(4)}`);
    doc.fillColor(totalPnL >= 0 ? '#0f766e' : '#b91c1c').text(`Total PnL: $${totalPnL.toFixed(4)}`);
    doc.moveDown();

    doc.fillColor('#000000').fontSize(14).text('Recent Trades', { underline: true });
    doc.moveDown(0.5);

    const recent = trades.slice(-15);
    for (const t of recent) {
      doc.fillColor('#000000').fontSize(10).text(`${t.time} | ${t.symbol} | ${t.direction} | ${t.reason}`);
      doc.text(`Entry ${Number(t.entry).toFixed(6)} -> Exit ${Number(t.exit).toFixed(6)} | Qty ${t.qty}`);
      doc.fillColor(Number(t.profit) >= 0 ? '#0f766e' : '#b91c1c').text(`PnL: $${Number(t.profit).toFixed(4)} | Hold: ${t.holdSeconds}s`);
      doc.moveDown(0.4);
    }

    doc.end();
  } catch (err) {
    console.log('[REPORT] PDF generation failed:', err.message);
  }
}

async function maybeOpenNewTrade() {
  if (activeTrade) return;
  if (dynamicPairs.length === 0) return;

  const symbol = dynamicPairs[Math.floor(Math.random() * dynamicPairs.length)];
  const [price, candles] = await Promise.all([getLastPrice(symbol), getCandles(symbol)]);

  const signal = buildSignal(candles, price);
  if (!signal) return;

  if (signal.score < CONFIG.minSignalScore) {
    return;
  }

  const plan = makeTradePlan(symbol, signal.direction, price);
  if (plan.qty <= 0) return;

  activeTrade = await openTrade(plan);

  console.log(
    `[SIGNAL] ${symbol} score=${signal.score} long=${signal.longScore} short=${signal.shortScore} rsi=${signal.rsi.toFixed(2)}`,
  );
}

async function maybeManageOpenTrade() {
  if (!activeTrade) return;

  const priceNow = await getLastPrice(activeTrade.symbol);
  const closeDecision = shouldCloseTrade(activeTrade, priceNow);

  if (!closeDecision) {
    const age = Math.round((Date.now() - activeTrade.openedAt) / 1000);
    console.log(`[TRACK] ${activeTrade.symbol} ${activeTrade.direction} now=${priceNow.toFixed(6)} tp=${activeTrade.tp.toFixed(6)} sl=${activeTrade.sl.toFixed(6)} age=${age}s`);
    return;
  }

  await closeTrade(activeTrade, priceNow, closeDecision.reason);
  activeTrade = null;
}

function reachedDailyStop() {
  return dailyPnL >= CONFIG.dailyProfitTargetUsd || dailyPnL <= CONFIG.dailyLossLimitUsd;
}

async function scanLoop() {
  if (reachedDailyStop()) {
    console.log('[RISK] Daily stop reached. Writing final report and exiting.');
    generateReports();
    process.exit(0);
  }

  await refreshTopPairs(false);
  await maybeManageOpenTrade();
  await maybeOpenNewTrade();
}

async function boot() {
  console.log('--- BITNODE CRYPTO HFT ENGINE (BINANCE DATA) ---');
  console.log(`Time: ${new Date().toISOString()}`);
  console.log(`Execution mode: ${CONFIG.executionMode}`);

  if (!['paper', 'binance-testnet', 'binance-live'].includes(CONFIG.executionMode)) {
    throw new Error("EXECUTION_MODE must be one of: paper | binance-testnet | binance-live");
  }

  if (CONFIG.executionMode !== 'paper' && (!CONFIG.apiKey || !CONFIG.apiSecret)) {
    throw new Error('Set BINANCE_API_KEY and BINANCE_API_SECRET for non-paper execution modes.');
  }

  await hydrateExchangeInfo();
  await refreshTopPairs(true);

  setInterval(() => {
    scanLoop().catch((err) => {
      console.log('[SCAN] Error:', err.message);
    });
  }, CONFIG.scanIntervalMs);

  setInterval(() => {
    generateReports();
  }, CONFIG.reportEveryMs);
}

process.on('SIGINT', () => {
  console.log('\n[SHUTDOWN] Caught SIGINT. Generating report...');
  generateReports();
  setTimeout(() => process.exit(0), 800);
});

boot().catch(async (err) => {
  console.log('[BOOT] Fatal:', err.message);
  generateReports();
  await sleep(300);
  process.exit(1);
});
