const fs = require('fs');

let code = fs.readFileSync('C:/Users/Mohsin/Desktop/Trading bot/bitnode-v4/bot-headless.js', 'utf8');

// The block to replace in tracker
const trackerStartStr = "const res = await axios.get(\https://bitnodes.io/api/v1/snapshots/latest/&symbol=\USDT\\);";
const trackerTargetRegex = /const res = await axios\.get\(\https:\/\/bitnodes\.io\/api\/v1\/snapshots\/latest\/&symbol=\\$\{activeTrade\.asset\}USDT\\);\s*const currentPrice = parseFloat\(res\.data\.result\.list\[0\]\.lastPrice\);/gm;

code = code.replace(trackerTargetRegex, 'const currentPrice = randomWalk(livePrices[activeTrade.asset] || activeTrade.entry, 0.0001, 0.02); livePrices[activeTrade.asset] = currentPrice;');

// The block to replace in scanner
const scannerTargetRegex = /const res = await axios\.get\(\https:\/\/bitnodes\.io\/api\/v1\/snapshots\/latest\/&symbol=\\$\{asset\}USDT\\);\s*price = parseFloat\(res\.data\.result\.list\[0\]\.lastPrice\);/gm;

code = code.replace(scannerTargetRegex, 'price = randomWalk(price, 0.0001, 0.02);');

fs.writeFileSync('C:/Users/Mohsin/Desktop/Trading bot/bitnode-v4/bot-headless.js', code);
