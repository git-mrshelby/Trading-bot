# Godzilla Crypto HFT Bot (Binance Data)

This bot now runs in crypto mode and uses real Binance Futures market data.
It scans high-volume USDT perpetual pairs, opens one trade at a time, books TP or SL, then rotates to the next setup.

Default mode is paper trading. You can also connect Binance Futures testnet for demo account execution.

## Strategy Summary

The signal engine follows a fast confluence model inspired by high-frequency crypto scanners:

1. Top symbols by volatility x quote volume.
2. 1m structure checks on each symbol in sequence.
3. EMA(9/21), RSI, breakout, volume spike, and momentum vote scoring.
4. Trade only if confidence reaches threshold.
5. Set TP/SL at entry and exit quickly, then move to next trade.

## Setup

1. Open a terminal in this folder.
2. Install dependencies:

```bash
npm install
```

3. Copy environment template and edit:

```bash
copy .env.example .env
```

4. Run the bot:

```bash
npm run bot
```

Reports are written to:

- daily_report.json
- daily_report.pdf

## Connect Binance Demo Account (Testnet)

1. Create/login at Binance Futures testnet:
	https://testnet.binancefuture.com
2. Create API key and secret in testnet API management.
3. In .env set:

```env
EXECUTION_MODE=testnet
BINANCE_API_KEY=your_testnet_key
BINANCE_API_SECRET=your_testnet_secret
```

4. Keep market data on real endpoint:

```env
BINANCE_MARKET_BASE=https://fapi.binance.com
```

5. Start bot with npm run bot.

## Important Notes

- Testnet mode sends real API orders to Binance Futures testnet (demo money only).
- Paper mode never sends exchange orders.
- This is an experimental strategy bot, not guaranteed profit.
- Tune risk limits in .env before live experimentation.
