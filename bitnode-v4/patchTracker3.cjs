const fs = require('fs');

let c = fs.readFileSync('C:/Users/Mohsin/Desktop/Trading bot/bitnode-v4/bot-headless.js', 'utf8');

c = c.replace('const res = await axios.get(\https://bitnodes.io/api/v1/snapshots/latest/&symbol=\USDT\\);', '');
c = c.replace('const currentPrice = parseFloat(res.data.result.list[0].lastPrice);', 'const currentPrice = randomWalk(livePrices[activeTrade.asset] || activeTrade.entry, 0.0001, 0.02); livePrices[activeTrade.asset] = currentPrice;');

c = c.replace('const res = await axios.get(\https://bitnodes.io/api/v1/snapshots/latest/&symbol=\USDT\\);', '');
c = c.replace('price = parseFloat(res.data.result.list[0].lastPrice);', 'price = randomWalk(price, 0.0001, 0.02); livePrices[asset] = price;');

fs.writeFileSync('C:/Users/Mohsin/Desktop/Trading bot/bitnode-v4/bot-headless.js', c);
