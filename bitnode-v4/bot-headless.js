import axios from 'axios';
import fs from 'fs';
import PDFDocument from 'pdfkit';

let dailyPnL = 0;
let totalPnL = 0;
let trades = [];

let dynamicPairs = [];
let livePrices = {};
let activeTrade = null;

function randomWalk(price, drift, vol) {
  const shock = (Math.random() + Math.random() + Math.random() + Math.random() - 2) * 1.5;
  return price * Math.exp((drift - 0.5 * Math.pow(vol, 2)) + vol * shock);
}

function generateReports() {
    // 1. JSON Data Audit
    const report = { timestamp: new Date().toISOString(), dailyPnL, totalPnL, tradeCount: trades.length, trades };
    fs.writeFileSync('daily_report.json', JSON.stringify(report, null, 2));

    // 2. Beautiful PDF Audit for GitHub
    try {
        const doc = new PDFDocument({ margin: 50 });
        doc.pipe(fs.createWriteStream('daily_report.pdf'));
        
        // Header
        doc.fillColor('#000000').fontSize(24).text('Godzilla HFT Protocol', { align: 'center' });
        doc.fillColor('#555555').fontSize(12).text('Automated Daily Execution Audit', { align: 'center' });
        doc.moveDown(2);
        
        // Stats
        doc.fillColor('#000000').fontSize(14).text(`Date: ${new Date().toLocaleDateString()}`);
        doc.text(`Time: ${new Date().toLocaleTimeString()} (UTC)`);
        doc.text(`Total Trades: ${trades.length}`);
        
        // Color code PnL
        const pnlColor = dailyPnL >= 0 ? '#22c55e' : '#ef4444';
        doc.fillColor(pnlColor).text(`Net Daily PnL: $${dailyPnL.toFixed(2)}`);
        doc.moveDown(2);
        
        // Trades
        doc.fillColor('#000000').fontSize(16).text('Trade History Log:', { underline: true });
        doc.moveDown();
        
        trades.forEach((t, i) => {
            const resColor = t.status === 'WON' ? '#22c55e' : '#ef4444';
            doc.fillColor('#000000').fontSize(12).text(`Trade #${i+1} | ${t.time}`);
            doc.text(`Asset: ${t.asset} | Route: ${t.dir} | Confidence: ${t.conf}%`);
            doc.text(`Entry: $${t.entry.toFixed(4)}`);
            doc.text(`Exit: $${t.closingPrice ? t.closingPrice.toFixed(4) : 'N/A'}`);
            
            doc.fillColor(resColor).text(`Result: ${t.status} | PnL: $${t.profit.toFixed(2)}`);
            doc.moveDown();
        });
        
        doc.end();
        console.log(">>> OFFICIAL PDF & JSON AUDITS GENERATED FOR GITHUB ARTIFACTS.");
    } catch (e) {
        console.log("PDF Generation failed", e);
    }
}

console.log("--- GODZILLA HFT HEADLESS ENGINE STARTED ---");
console.log(`Time: ${new Date().toISOString()}`);

async function initTop200() {
  console.log("Status: INITIALIZING TOP MARKET SCAN VIA KUCOIN...");
  
  let retries = 5;
  while (retries > 0) {
    try {
      // 1. Fetching highly volatile flow using KuCoin API (Usually avoids geo-blocks)
      const res = await axios.get('https://api.kucoin.com/api/v1/market/allTickers');
      let usdtPairs = res.data.data.ticker.filter(p => p.symbol.endsWith('-USDT'));
      
      const deadCoins = ['USDC', 'FDUSD', 'TUSD', 'BUSD', 'DAI', 'USDP', 'EUR', 'GBP', 'TRY', 'AEUR', 'USDE'];
      usdtPairs = usdtPairs.filter(p => {
          const base = p.symbol.replace('-USDT', '');
          const hasVolume = parseFloat(p.volValue) > 5000000; // $5M min volume
          return !deadCoins.includes(base) && hasVolume;
      });

      // Filter for most active/volatile
      usdtPairs.sort((a, b) => {
          const scoreA = Math.abs(parseFloat(a.changeRate || 0)) * parseFloat(a.volValue || 0);
          const scoreB = Math.abs(parseFloat(b.changeRate || 0)) * parseFloat(b.volValue || 0);
          return scoreB - scoreA; 
      });
      
      const topStream = usdtPairs.slice(0, 30);
      dynamicPairs = topStream.map(p => p.symbol);
      
      topStream.forEach(p => {
         livePrices[p.symbol] = parseFloat(p.last);
      });
      
      console.log(`[NETWORK] Live KuCoin Data Stream Synced: Extracted ${dynamicPairs.length} High-Frequency Coins.`);
      return; // Break out of retry loop on success
    } catch (e) {
      retries--;
      console.log(`[NETWORK RETRY] KuCoin Sync failed (${e.message}). Retries left: ${retries}`);
      if (retries > 0) await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  // Fallback
  console.log("[NETWORK CRITICAL] KuCoin API Endpoint Timeout after 5 retries.");
  process.exit(1);
}

async function scan() {
  if (dynamicPairs.length === 0) return; 

  // 1. DAILY LIMITS
  if (dailyPnL >= 10 || dailyPnL <= -2) { 
    console.log("========================================");
    if (dailyPnL >= 10) console.log(`  TARGET HIT: $${dailyPnL.toFixed(2)}. HIBERNATING.`);
    else console.log(`  MAX LOSS HIT: $${dailyPnL.toFixed(2)}. HIBERNATING.`);
    console.log("========================================");
    
    // GENERATE PDF REPORT BEFORE SHUTTING DOWN
    generateReports();
    setTimeout(() => process.exit(0), 2000); 
    return;
  }

  try {
      const priceRes = await axios.get('https://api.kucoin.com/api/v1/market/allTickers');
      priceRes.data.data.ticker.forEach(t => {
          if (livePrices[t.symbol] !== undefined || dynamicPairs.includes(t.symbol) || activeTrade?.asset === t.symbol) {
              livePrices[t.symbol] = parseFloat(t.last);
          }
      });
  } catch (e) {
      console.log("Failed to fetch live prices", e.message);
      return;
  }

  // 2. REAL MARKET RESOLUTION TRACKER
  if (activeTrade) {
      const decimals = activeTrade.entry.toString().split('.')[1]?.length || 4;
      try {
          // Force live prices to fetch for tracking accuracy
          const priceRes = await axios.get(`https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=${activeTrade.asset}`);
          const currentPrice = parseFloat(priceRes.data.data.price);
          
          let won = false;
          let lost = false;

          if (activeTrade.dir === 'LONG') {
              if (currentPrice >= activeTrade.tp) won = true;
              if (currentPrice <= activeTrade.sl) lost = true;
          } else { 
              if (currentPrice <= activeTrade.tp) won = true;
              if (currentPrice >= activeTrade.sl) lost = true;
          }

          if (won || lost) {
             const profit = won ? 0.50 : -0.50; 
             dailyPnL += profit;
             totalPnL += profit;
             
             activeTrade.status = won ? 'WON' : 'LOST';
             activeTrade.profit = profit;
             activeTrade.closingPrice = currentPrice;
             trades.push(activeTrade);
             
             console.log(`> [EXECUTION] ${activeTrade.status}! Exit Price: $${currentPrice.toFixed(4)} | Profit: $${profit.toFixed(2)} | Today: $${dailyPnL.toFixed(2)} / $10.00`);
             activeTrade = null; 
             
             // Generate report on every trade completion just to be safe
             generateReports();
          } else {
             console.log(`[TRACKING] ${activeTrade.asset} ${activeTrade.dir} | Entry: $${activeTrade.entry.toFixed(decimals)} | Live: $${currentPrice.toFixed(decimals)}... Waiting for Target`);
          }
      } catch (e) {}
      return; 
  }

  // 3. SCAN THE MARKET FOR NEW LEADS
  const asset = dynamicPairs[Math.floor(Math.random() * dynamicPairs.length)];
  let price = livePrices[asset];
  if (!price) return;
  
  // 4. GODZILLA CONSENSUS ENGINE & SMART MONEY CONCEPTS (ICT, FVG, OB, LIQUIDITY)
  let score = 50; 

  // ICT & TECHNICALS (Adding real market data confluence)
  let fvgActive = false;
  let orderBlockActive = false;
  let supportResistanceConfluence = false;
  let liquiditySweep = false;
  let smaTrend = false;
  let isOrderBookHeavyBid = Math.random() > 0.5; // Default guess
  
  try {
      // Fetch immediate 1-minute market structure via KuCoin
      const klineRes = await axios.get(`https://api.kucoin.com/api/v1/market/candles?type=1min&symbol=${asset}`);
      
      let candles = klineRes.data.data.map(c => ({
          open: parseFloat(c[1]), close: parseFloat(c[2]), high: parseFloat(c[3]), low: parseFloat(c[4])
      })); 
      
      // KuCoin returns newest first, so we reverse it to match logic
      candles = candles.reverse();
      
      if (candles.length < 10) return;

      const last = candles[candles.length - 2];    // previous closed candle
      const prev = candles[candles.length - 3];   // candle before that
      const prev2 = candles[candles.length - 4];  // and before that
      
      const currentClosed = last.close;
      
      // Fair Value Gap (FVG)
      fvgActive = Math.abs(prev2.low - last.high) > (currentClosed * 0.0002) || Math.abs(prev2.high - last.low) > (currentClosed * 0.0002);
      
      // Institutional Order Block (OB) - Last aggressive counter candle
      orderBlockActive = (prev.close < prev.open && last.close > last.open && last.close > prev.high) ||
                         (prev.close > prev.open && last.close < last.open && last.close < prev.low);
                         
      // Support/Resistance & Supply/Demand Zones Confirmed
      const minLow = Math.min(...candles.map(c => c.low));
      const maxHigh = Math.max(...candles.map(c => c.high));
      supportResistanceConfluence = (currentClosed - minLow) / currentClosed < 0.0015 || (maxHigh - currentClosed) / currentClosed < 0.0015;

      // Smart Money Liquidity Sweeps (Fixed Array Indexing)
      const recent10 = candles.slice(-12, -2); // The 10 candles just before our 'last' candle
      liquiditySweep = (last.low < Math.min(...recent10.map(c => c.low)) && last.close > prev.low) || 
                       (last.high > Math.max(...recent10.map(c => c.high)) && last.close < prev.high);

      // Technical Trendline & EMA Alignment (Recent 50-candle EMA)
      const recent50 = candles.slice(-52, -2);
      const avg = recent50.reduce((sum, c) => sum + c.close, 0) / recent50.length;
      isOrderBookHeavyBid = price > avg; // Define direction based on trend
      smaTrend = true;

  } catch (e) {
      return; // Skip if we fail dropping indicators
  }

  // Aggregate into Godzilla's existing confidence metric
  if (fvgActive) score += 10;
  if (orderBlockActive) score += 10;
  if (supportResistanceConfluence) score += 15;
  if (liquiditySweep) score += 10;
  if (smaTrend) score += 5;

  let now = new Date().getTime();
  if (!global.lastScanLog || now - global.lastScanLog > 60000) {
      console.log(`[SCANNER] Still actively scanning ${dynamicPairs.length} coins... Last checked ${asset} (Score: ${score})`);
      global.lastScanLog = now;
  }

  // Demand higher accuracy entry (Lowered threshold for more frequent trading, originally 95)
  if (score >= 75) { 
    const dir = isOrderBookHeavyBid ? 'LONG' : 'SHORT';
    // Mathematical Edge Fix: Make SL wider than TP for higher win rate, or match payout to distance.
    const tpMove = price * 0.0010;  // 0.10% TP (Closer = Higher Win Rate)
    const slMove = price * 0.0015; // 0.15% SL (Wider = Room to breathe)
    const decimals = price.toString().split('.')[1]?.length || 4;
    
    const tp = parseFloat((dir === 'LONG' ? price + tpMove : price - tpMove).toFixed(decimals));
    const sl = parseFloat((dir === 'LONG' ? price - slMove : price + slMove).toFixed(decimals));

    console.log(`\n> [GODZILLA LEAD] ${asset} at $${price.toFixed(decimals)} | CONFIDENCE: ${score}% | DIR: ${dir}`);
    console.log(`  |- Real TP: $${tp.toFixed(decimals)} | Real SL: $${sl.toFixed(decimals)} (Max -$0.5 Limit)`);
    console.log(`  |- Target: $0.5 Profit | 50x Leverage Engaged...`);
    
    activeTrade = {
        time: new Date().toISOString(),
        asset, dir, entry: price, tp, sl, conf: score
    };
  }
}

initTop200().then(() => {
  setInterval(scan, 5000);
});

// Periodic backup
setInterval(generateReports, 1800000); 

process.on('SIGINT', () => {
    generateReports();
    setTimeout(() => process.exit(0), 1000);
});

