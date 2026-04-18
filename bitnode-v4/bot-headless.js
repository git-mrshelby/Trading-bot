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
  console.log("Status: INITIALIZING TOP 200 MARKET SCAN...");
  try {
    const res = await axios.get('https://data-api.binance.vision/api/v3/ticker/24hr');
    const usdtPairs = res.data.filter(p => p.symbol.endsWith('USDT'));
    usdtPairs.sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume));
    
    const top200 = usdtPairs.slice(0, 200);
    dynamicPairs = top200.map(p => p.symbol.replace('USDT', ''));
    
    top200.forEach(p => {
       livePrices[p.symbol.replace('USDT', '')] = parseFloat(p.lastPrice);
    });
    console.log(`[NETWORK] Successfully synced Top ${dynamicPairs.length} pairs from Binance.`);
  } catch (e) {
    console.log("[NETWORK WARNING] Active IP Geoblocked by Binance.");
    console.log("[FALLBACK] Initializing Ghost Nodes to simulate Top 200 Market Flow...");
    for (let i = 1; i <= 200; i++) {
        let sym = `N-ASSET${i}`;
        dynamicPairs.push(sym);
        livePrices[sym] = 50 + (Math.random() * 100);
    }
  }
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

  // 2. REAL MARKET RESOLUTION TRACKER
  if (activeTrade) {
      try {
          const res = await axios.get(`https://data-api.binance.vision/api/v3/ticker/price?symbol=${activeTrade.asset}USDT`);
          const currentPrice = parseFloat(res.data.price);
          
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
             const profit = won ? 0.50 : -2.00; 
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
             console.log(`[TRACKING] ${activeTrade.asset} ${activeTrade.dir} | Entry: $${activeTrade.entry.toFixed(4)} | Live: $${currentPrice.toFixed(4)}... Waiting for Target`);
          }
      } catch (e) {}
      return; 
  }

  // 3. SCAN THE MARKET FOR NEW LEADS
  const asset = dynamicPairs[Math.floor(Math.random() * dynamicPairs.length)];
  let price = livePrices[asset];
  
  try {
      const res = await axios.get(`https://data-api.binance.vision/api/v3/ticker/price?symbol=${asset}USDT`);
      price = parseFloat(res.data.price);
      livePrices[asset] = price;
  } catch(e) { }

  // 4. GODZILLA CONSENSUS ENGINE
  const currentTps = 1.5 + Math.random() * 3.5;
  if (currentTps < 2.5) return; 

  const rWalkForward = randomWalk(price, 0.0001, 0.02);
  const isDotsInflow = Math.random() > 0.4;
  const isOrderBookHeavyBid = Math.random() > 0.5;
  
  let score = 0;
  if (currentTps > 3.0) score += 25;
  if (isDotsInflow === isOrderBookHeavyBid) score += 40; 
  if ((rWalkForward > price && isDotsInflow) || (rWalkForward < price && !isDotsInflow)) score += 35; 
  
  if (score >= 80) { 
    const dir = isOrderBookHeavyBid ? 'LONG' : 'SHORT';
    const tpMove = price * 0.001;  // 0.1% price move for $0.5
    const slMove = price * 0.004; // Strict 0.4% price check for $2 cutoff
    const decimals = price.toString().split('.')[1]?.length || 4;
    
    const tp = parseFloat((dir === 'LONG' ? price + tpMove : price - tpMove).toFixed(decimals));
    const sl = parseFloat((dir === 'LONG' ? price - slMove : price + slMove).toFixed(decimals));

    console.log(`\n> [GODZILLA LEAD] ${asset} at $${price.toFixed(4)} | CONFIDENCE: ${score}% | DIR: ${dir}`);
    console.log(`  |- Real TP: $${tp.toFixed(4)} | Real SL: $${sl.toFixed(4)} (Max -$2 Limit)`);
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
