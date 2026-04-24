const fs = require('fs');

let c = fs.readFileSync('C:/Users/Mohsin/Desktop/Trading bot/bitnode-v4/bot-headless.js', 'utf8');

c = c.replace(/const res = await axios\.get\(\https:\/\/bitnodes\.io\/api\/v1\/snapshots\/latest\/&symbol=\\$\{activeTrade\.asset\}USDT\\);/g, '');
c = c.replace(/const res = await axios\.get\(\https:\/\/bitnodes\.io\/api\/v1\/snapshots\/latest\/&symbol=\\$\{asset\}USDT\\);/g, '');

fs.writeFileSync('C:/Users/Mohsin/Desktop/Trading bot/bitnode-v4/bot-headless.js', c);
