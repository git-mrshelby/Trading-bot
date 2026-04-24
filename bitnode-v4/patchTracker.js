import fs from 'fs';
let b = fs.readFileSync('./bot-headless.js', 'utf8');

const target1 = 'const res = await axios.get(https://bitnodes.io/api/v1/snapshots/latest/&symbol=USDT);';
const target2 = 'const currentPrice = parseFloat(res.data.result.list[0].lastPrice);';
const replacement1 = 'const currentPrice = randomWalk(livePrices[activeTrade.asset] || activeTrade.entry, 0.0001, 0.02); livePrices[activeTrade.asset] = currentPrice;';

b = b.replace(target1 + '\n          ' + target2, replacement1);
b = b.replace(target1 + '\r\n          ' + target2, replacement1);

const target3 = 'const res = await axios.get(https://bitnodes.io/api/v1/snapshots/latest/&symbol=USDT);';
const target4 = 'price = parseFloat(res.data.result.list[0].lastPrice);';
const replacement2 = 'price = randomWalk(price, 0.0001, 0.02); livePrices[asset] = price;';

b = b.replace(target3 + '\n      ' + target4, replacement2);
b = b.replace(target3 + '\r\n      ' + target4, replacement2);

fs.writeFileSync('./bot-headless.js', b);

