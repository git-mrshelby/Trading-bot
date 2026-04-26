import axios from 'axios';
import crypto from 'crypto';
import fs from 'fs';
import PDFDocument from 'pdfkit';

const MARKET_DATA_BASE = process.env.BINANCE_MARKET_BASE || 'https://fapi.binance.com';
const TESTNET_BASE = process.env.BINANCE_TESTNET_BASE || 'https://testnet.binancefuture.com';
const EXECUTION_MODE = (process.env.EXECUTION_MODE || 'paper').toLowerCase();
const API_KEY = process.env.BINANCE_API_KEY || '';
const API_SECRET = process.env.BINANCE_API_SECRET || '';

const SCAN_INTERVAL_MS = Number(process.env.SCAN_INTERVAL_MS || 1500);
const MAX_SYMBOLS = Number(process.env.MAX_SYMBOLS || 30);
const LEVERAGE = Number(process.env.LEVERAGE || 5);
const NOTIONAL_USDT = Number(process.env.NOTIONAL_USDT || 40);
const TAKE_PROFIT_PCT = Number(process.env.TAKE_PROFIT_PCT || 0.0018);
const STOP_LOSS_PCT = Number(process.env.STOP_LOSS_PCT || 0.0012);
const CONFIDENCE_THRESHOLD = Number(process.env.CONFIDENCE_THRESHOLD || 78);
const DAILY_TARGET_USDT = Number(process.env.DAILY_TARGET_USDT || 10);
const DAILY_STOP_USDT = Number(process.env.DAILY_STOP_USDT || -3);

let dailyPnL = 0;
let totalPnL = 0;
let trades = [];
let dynamicPairs = [];
let livePrices = {};
let symbolMeta = {};
let activeTrade = null;
let scanIndex = 0;

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function calculateRSI(closes, period = 14) {
    if (!Array.isArray(closes) || closes.length <= period) return 50;

    let gains = 0;
    let losses = 0;

    for (let i = 1; i <= period; i += 1) {
        const delta = closes[i] - closes[i - 1];
        if (delta >= 0) gains += delta;
        else losses -= delta;
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    for (let i = period + 1; i < closes.length; i += 1) {
        const delta = closes[i] - closes[i - 1];
        avgGain = ((avgGain * (period - 1)) + Math.max(delta, 0)) / period;
        avgLoss = ((avgLoss * (period - 1)) + Math.max(-delta, 0)) / period;
    }

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

function calculateEMA(values, period) {
    if (!values.length) return 0;
    const multiplier = 2 / (period + 1);
    let ema = values[0];
    for (let i = 1; i < values.length; i += 1) {
        ema = ((values[i] - ema) * multiplier) + ema;
    }
    return ema;
}

function hmacSha256(secret, payload) {
    return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function formatQuantity(symbol, rawQty) {
    const meta = symbolMeta[symbol] || { stepSize: 0.001, minQty: 0.001, quantityPrecision: 3 };
    const step = Number(meta.stepSize || 0.001);
    const minQty = Number(meta.minQty || step);
    const precision = Number(meta.quantityPrecision ?? 3);

    const stepped = Math.floor(rawQty / step) * step;
    const bounded = Math.max(stepped, minQty);
    return Number(bounded.toFixed(precision));
}

async function sendSignedOrder(baseUrl, params) {
    if (!API_KEY || !API_SECRET) {
        throw new Error('Missing BINANCE_API_KEY or BINANCE_API_SECRET for testnet mode.');
    }

    const payload = new URLSearchParams({ ...params, timestamp: Date.now().toString() }).toString();
    const signature = hmacSha256(API_SECRET, payload);
    const url = `${baseUrl}/fapi/v1/order?${payload}&signature=${signature}`;

    const response = await axios.post(url, null, {
        headers: {
            'X-MBX-APIKEY': API_KEY
        },
        timeout: 15000
    });

    return response.data;
}

async function setLeverage(symbol) {
    if (!API_KEY || !API_SECRET) return;

    const payload = new URLSearchParams({
        symbol,
        leverage: String(LEVERAGE),
        timestamp: Date.now().toString()
    }).toString();

    const signature = hmacSha256(API_SECRET, payload);
    const url = `${TESTNET_BASE}/fapi/v1/leverage?${payload}&signature=${signature}`;

    await axios.post(url, null, {
        headers: {
            'X-MBX-APIKEY': API_KEY
        },
        timeout: 15000
    });
}

function generateReports() {
    const report = {
        timestamp: new Date().toISOString(),
        executionMode: EXECUTION_MODE,
        dailyPnL,
        totalPnL,
        tradeCount: trades.length,
        trades
    };

    fs.writeFileSync('daily_report.json', JSON.stringify(report, null, 2));

    try {
        const doc = new PDFDocument({ margin: 50 });
        doc.pipe(fs.createWriteStream('daily_report.pdf'));

        doc.fillColor('#000000').fontSize(22).text('Godzilla Crypto HFT Session Report', { align: 'center' });
        doc.fillColor('#444444').fontSize(12).text(`Mode: ${EXECUTION_MODE.toUpperCase()}`, { align: 'center' });
        doc.moveDown(2);

        doc.fillColor('#000000').fontSize(13).text(`Timestamp: ${new Date().toISOString()}`);
        doc.text(`Trades: ${trades.length}`);
        doc.text(`Daily PnL: ${dailyPnL.toFixed(2)} USDT`);
        doc.text(`Total PnL: ${totalPnL.toFixed(2)} USDT`);
        doc.moveDown();

        trades.slice(-25).forEach((trade, index) => {
            const color = trade.profit >= 0 ? '#16a34a' : '#dc2626';
            doc.fillColor('#111111').fontSize(11).text(`#${index + 1} ${trade.time} ${trade.asset} ${trade.dir}`);
            doc.text(`Entry: ${trade.entry.toFixed(4)} Exit: ${trade.closingPrice.toFixed(4)} Qty: ${trade.qty}`);
            doc.fillColor(color).text(`Result: ${trade.status} PnL: ${trade.profit.toFixed(2)} USDT`);
            doc.moveDown(0.5);
        });

        doc.end();
    } catch (error) {
        console.log('[REPORT] PDF generation failed:', error.message);
    }
}

async function initSymbols() {
    console.log('[BOOT] Fetching top crypto futures symbols from Binance...');

    const [ticker24h, exchangeInfo] = await Promise.all([
        axios.get(`${MARKET_DATA_BASE}/fapi/v1/ticker/24hr`, { timeout: 15000 }),
        axios.get(`${MARKET_DATA_BASE}/fapi/v1/exchangeInfo`, { timeout: 15000 })
    ]);

    const symbols = ticker24h.data
        .filter((row) => row.symbol.endsWith('USDT'))
        .map((row) => ({
            symbol: row.symbol,
            score: Math.abs(Number(row.priceChangePercent || 0)) * Number(row.quoteVolume || 0),
            price: Number(row.lastPrice)
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_SYMBOLS);

    dynamicPairs = symbols.map((s) => s.symbol);
    symbols.forEach((s) => {
        livePrices[s.symbol] = s.price;
    });

    exchangeInfo.data.symbols
        .filter((s) => dynamicPairs.includes(s.symbol))
        .forEach((s) => {
            const lot = s.filters.find((f) => f.filterType === 'LOT_SIZE');
            symbolMeta[s.symbol] = {
                stepSize: Number(lot?.stepSize || 0.001),
                minQty: Number(lot?.minQty || 0.001),
                quantityPrecision: Number(s.quantityPrecision || 3)
            };
        });

    console.log(`[BOOT] Loaded ${dynamicPairs.length} active symbols.`);
}

async function refreshPrices() {
    const response = await axios.get(`${MARKET_DATA_BASE}/fapi/v1/ticker/price`, { timeout: 15000 });
    for (const row of response.data) {
        if (livePrices[row.symbol] !== undefined || row.symbol === activeTrade?.asset) {
            livePrices[row.symbol] = Number(row.price);
        }
    }
}

async function getCandles(symbol, interval = '1m', limit = 80) {
    const response = await axios.get(`${MARKET_DATA_BASE}/fapi/v1/klines`, {
        params: { symbol, interval, limit },
        timeout: 15000
    });

    return response.data.map((k) => ({
        openTime: Number(k[0]),
        open: Number(k[1]),
        high: Number(k[2]),
        low: Number(k[3]),
        close: Number(k[4]),
        volume: Number(k[5])
    }));
}

async function scoreSignal(symbol) {
    const candles = await getCandles(symbol);
    if (candles.length < 50) return null;

    const last = candles[candles.length - 2];
    const prev = candles[candles.length - 3];
    const prev2 = candles[candles.length - 4];
    const closes = candles.map((c) => c.close);
    const volumes = candles.map((c) => c.volume);

    const ema9 = calculateEMA(closes.slice(-25), 9);
    const ema21 = calculateEMA(closes.slice(-35), 21);
    const rsi = calculateRSI(closes.slice(-30), 14);

    const localHigh = Math.max(...candles.slice(-18, -2).map((c) => c.high));
    const localLow = Math.min(...candles.slice(-18, -2).map((c) => c.low));
    const avgVolume = volumes.slice(-22, -2).reduce((sum, v) => sum + v, 0) / 20;
    const volumeSpike = last.volume > avgVolume * 1.2;

    const momentumUp = last.close > prev.close && prev.close > prev2.close;
    const momentumDown = last.close < prev.close && prev.close < prev2.close;
    const breakoutUp = last.close > localHigh;
    const breakoutDown = last.close < localLow;
    const bullishCandle = last.close > last.open;
    const bearishCandle = last.close < last.open;

    const longVotes = [
        ema9 > ema21,
        momentumUp,
        breakoutUp,
        volumeSpike,
        rsi > 52 && rsi < 70,
        bullishCandle
    ].filter(Boolean).length;

    const shortVotes = [
        ema9 < ema21,
        momentumDown,
        breakoutDown,
        volumeSpike,
        rsi < 48 && rsi > 30,
        bearishCandle
    ].filter(Boolean).length;

    const side = longVotes >= shortVotes ? 'LONG' : 'SHORT';
    const votes = Math.max(longVotes, shortVotes);
    const confidence = 45 + (votes * 9) + (volumeSpike ? 6 : 0);

    if (votes < 4 || confidence < CONFIDENCE_THRESHOLD) {
        return null;
    }

    return {
        symbol,
        side,
        confidence,
        rsi,
        entry: last.close
    };
}

async function placeEntry(signal) {
    const marketPrice = livePrices[signal.symbol] || signal.entry;
    const rawQty = (NOTIONAL_USDT * LEVERAGE) / marketPrice;
    const qty = formatQuantity(signal.symbol, rawQty);

    const tp = signal.side === 'LONG'
        ? marketPrice * (1 + TAKE_PROFIT_PCT)
        : marketPrice * (1 - TAKE_PROFIT_PCT);

    const sl = signal.side === 'LONG'
        ? marketPrice * (1 - STOP_LOSS_PCT)
        : marketPrice * (1 + STOP_LOSS_PCT);

    if (EXECUTION_MODE === 'testnet') {
        await setLeverage(signal.symbol);
        await sendSignedOrder(TESTNET_BASE, {
            symbol: signal.symbol,
            side: signal.side === 'LONG' ? 'BUY' : 'SELL',
            type: 'MARKET',
            quantity: String(qty)
        });
    }

    activeTrade = {
        time: new Date().toISOString(),
        mode: EXECUTION_MODE,
        asset: signal.symbol,
        dir: signal.side,
        conf: signal.confidence,
        rsi: signal.rsi,
        entry: marketPrice,
        qty,
        tp,
        sl,
        status: 'OPEN',
        openedAt: Date.now(),
        exchangeOrder: EXECUTION_MODE === 'testnet' ? 'LIVE_TESTNET' : 'PAPER'
    };

    console.log(`\n[ENTRY] ${signal.symbol} ${signal.side} @ ${marketPrice.toFixed(4)} qty=${qty} conf=${signal.confidence}`);
    console.log(`[ENTRY] TP=${tp.toFixed(4)} SL=${sl.toFixed(4)} mode=${EXECUTION_MODE}`);
}

async function closeActiveTrade(exitPrice, reason) {
    if (!activeTrade) return;

    const isLong = activeTrade.dir === 'LONG';
    const pnl = isLong
        ? (exitPrice - activeTrade.entry) * activeTrade.qty
        : (activeTrade.entry - exitPrice) * activeTrade.qty;

    if (EXECUTION_MODE === 'testnet') {
        await sendSignedOrder(TESTNET_BASE, {
            symbol: activeTrade.asset,
            side: isLong ? 'SELL' : 'BUY',
            type: 'MARKET',
            reduceOnly: 'true',
            quantity: String(activeTrade.qty)
        });
    }

    dailyPnL += pnl;
    totalPnL += pnl;

    activeTrade.status = pnl >= 0 ? 'WON' : 'LOST';
    activeTrade.profit = pnl;
    activeTrade.reason = reason;
    activeTrade.closingPrice = exitPrice;
    activeTrade.closedAt = new Date().toISOString();
    trades.push(activeTrade);

    console.log(`[EXIT] ${activeTrade.asset} ${activeTrade.status} reason=${reason} pnl=${pnl.toFixed(2)} daily=${dailyPnL.toFixed(2)}`);

    activeTrade = null;
    generateReports();
}

async function monitorActiveTrade() {
    if (!activeTrade) return;

    const currentPrice = livePrices[activeTrade.asset];
    if (!currentPrice) return;

    if (activeTrade.dir === 'LONG') {
        if (currentPrice >= activeTrade.tp) {
            await closeActiveTrade(currentPrice, 'TP');
            return;
        }
        if (currentPrice <= activeTrade.sl) {
            await closeActiveTrade(currentPrice, 'SL');
            return;
        }
    } else {
        if (currentPrice <= activeTrade.tp) {
            await closeActiveTrade(currentPrice, 'TP');
            return;
        }
        if (currentPrice >= activeTrade.sl) {
            await closeActiveTrade(currentPrice, 'SL');
            return;
        }
    }

    const ageSec = Math.floor((Date.now() - activeTrade.openedAt) / 1000);
    if (ageSec >= 120) {
        await closeActiveTrade(currentPrice, 'TIME_EXIT');
        return;
    }

    if (ageSec % 10 === 0) {
        console.log(`[TRACK] ${activeTrade.asset} ${activeTrade.dir} entry=${activeTrade.entry.toFixed(4)} live=${currentPrice.toFixed(4)} age=${ageSec}s`);
    }
}

async function scan() {
    if (!dynamicPairs.length) return;

    if (dailyPnL >= DAILY_TARGET_USDT || dailyPnL <= DAILY_STOP_USDT) {
        console.log('[RISK] Daily limit reached. Stopping bot.');
        generateReports();
        process.exit(0);
    }

    await refreshPrices();

    if (activeTrade) {
        await monitorActiveTrade();
        return;
    }

    const symbol = dynamicPairs[scanIndex % dynamicPairs.length];
    scanIndex += 1;

    const signal = await scoreSignal(symbol);
    if (!signal) return;

    await placeEntry(signal);
}

async function run() {
    console.log('--- GODZILLA CRYPTO HFT ENGINE (BINANCE DATA) ---');
    console.log(`Mode=${EXECUTION_MODE.toUpperCase()} MarketData=${MARKET_DATA_BASE}`);

    if (EXECUTION_MODE === 'testnet' && (!API_KEY || !API_SECRET)) {
        throw new Error('Testnet mode requires BINANCE_API_KEY and BINANCE_API_SECRET.');
    }

    await initSymbols();

    while (true) {
        try {
            await scan();
        } catch (error) {
            console.log('[LOOP] Error:', error.message);
        }
        await wait(SCAN_INTERVAL_MS);
    }
}

setInterval(generateReports, 30 * 60 * 1000);

process.on('SIGINT', () => {
    generateReports();
    process.exit(0);
});

run().catch((error) => {
    console.error('[FATAL]', error.message);
    process.exit(1);
});

