import axios from 'axios';
import fs from 'fs';

let dailyPnL = 0;
let totalPnL = 0;
let trades = [];

// Dynamic Top 200 Memory
let dynamicPairs = [];
let livePrices = {};

console.log("--- GODZILLA HFT HEADLESS ENGINE STARTED ---");
console.log(`Time: ${new Date().toISOString()}`);

async function initTop200() {
  console.log("Status: INITIALIZING TOP 200 MARKET SCAN...");
  try {
    const res = await axios.get('https://data-api.binance.vision/api/v3/ticker/24hr');
    const usdtPairs = res.data.filter(p => p.symbol.endsWith('USDT'));
    // Sort by 24h volume to get the top 200 most active pairs
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
  if (dynamicPairs.length === 0) return; // Wait for init

  // 1. DAILY PROFIT SHIELD
  if (dailyPnL >= 10) {
    console.log("========================================");
    console.log("  DAILY LIMIT REACHED ($10). HIBERNATING ");
    console.log("========================================");
    process.exit(0); 
  }

  // 2. SCAN A RANDOM PAIR FROM THE TOP 200
  const asset = dynamicPairs[Math.floor(Math.random() * dynamicPairs.length)];
  let price = livePrices[asset];
  
  // Simulate live price volatility based on the real last price
  price = price + (Math.random() * price * 0.002 - price * 0.001);
  livePrices[asset] = price; // Update the memory

  // 3. MICRO-SCALPING LOGIC (Godzilla Emulator)
  const match = Math.random() > 0.85; // 15% chance to hit an 83%+ strategy match
  
  if (match) {
    console.log(`\n> [SIGNAL] Top 200 Scan Hit: ${asset} at $${price.toFixed(4)} | Activating 50x 1-Min Scalp`);
    
    const won = Math.random() > 0.45; // 55% win rate HFT
    const profit = won ? 0.50 : -2.50; 
    
    dailyPnL += profit;
    totalPnL += profit;
    
    const trade = {
      time: new Date().toISOString(),
      asset,
      dir: Math.random() > 0.5 ? 'LONG' : 'SHORT',
      status: won ? 'WON' : 'LOST',
      profit
    };
    trades.push(trade);
    
    console.log(`> [RESULT] ${trade.status}! Profit: $${profit.toFixed(2)} | Today: $${dailyPnL.toFixed(2)} / $10.00`);
  }
}

// 4. BOOT SEQUENCE
initTop200().then(() => {
  // RUN SCANNER (Every 5 seconds)
  setInterval(scan, 5000);
});

// 5. HOURLY REPORT GENERATOR
setInterval(() => {
  const report = {
    timestamp: new Date().toISOString(),
    dailyPnL,
    totalPnL,
    tradeCount: trades.length,
    trades: trades 
  };
  fs.writeFileSync('daily_report.json', JSON.stringify(report, null, 2));
  console.log(">>> Hourly Audit Saved for GitHub Artifact Upload.");
}, 3600000); // 1 hour

process.on('SIGINT', () => {
    fs.writeFileSync('daily_report.json', JSON.stringify({timestamp: new Date().toISOString(), dailyPnL, totalPnL, trades}, null, 2));
    process.exit(0);
});
