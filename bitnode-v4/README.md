# Bitnode v4 - Crypto HFT (Binance Data)

This workspace now includes a headless crypto bot at `bot-headless.js` that:

- Uses real Binance market data (spot public API).
- Scans high-volume USDT pairs.
- Opens one trade at a time with TP/SL.
- Closes the trade at TP, SL, or max-hold timeout.
- Books PnL, then moves to the next trade.
- Writes audit logs to JSON + PDF reports.

## Important Reality Check

No strategy can be made guaranteed profitable in live markets. This bot is structured for safe testing, risk controls, and measurable iteration.

## Execution Modes

Set `EXECUTION_MODE`:

- `paper` (default): Real market data, simulated fills. Safest mode.
- `binance-testnet`: Sends real API orders to Binance Spot Testnet.
- `binance-live`: Sends real API orders to Binance live account (high risk).

## Quick Start

1. Open terminal in this folder.
2. Install packages (if needed):

```bash
npm install
```

3. Run in paper mode:

```bash
set EXECUTION_MODE=paper
node bot-headless.js
```

PowerShell version:

```powershell
$env:EXECUTION_MODE='paper'
node bot-headless.js
```

## Binance Demo/Testnet Connection

1. Create Binance Spot Testnet API key/secret from Binance testnet portal.
2. Set environment variables:

PowerShell:

```powershell
$env:EXECUTION_MODE='binance-testnet'
$env:BINANCE_API_KEY='your_testnet_key'
$env:BINANCE_API_SECRET='your_testnet_secret'
node bot-headless.js
```

3. Verify first runs in testnet before trying live.

## Core Risk Parameters

You can tune these with env vars:

- `RISK_PER_TRADE_USD` (default `15`)
- `TP_PCT` (default `0.003` = 0.30%)
- `SL_PCT` (default `0.002` = 0.20%)
- `MAX_HOLD_SECONDS` (default `180`)
- `MIN_SIGNAL_SCORE` (default `5`)
- `DAILY_PROFIT_TARGET_USD` (default `20`)
- `DAILY_LOSS_LIMIT_USD` (default `-8`)

Example:

```powershell
$env:EXECUTION_MODE='paper'
$env:RISK_PER_TRADE_USD='10'
$env:TP_PCT='0.0025'
$env:SL_PCT='0.0018'
$env:MIN_SIGNAL_SCORE='6'
node bot-headless.js
```

## Reports

Generated in this folder:

- `daily_report.json`
- `daily_report.pdf`

Each closed trade stores entry/exit, TP/SL, hold time, reason (`TP_HIT`, `SL_HIT`, `TIME_EXIT`) and PnL.

## Recommended Rollout

1. Run `paper` mode for several days and inspect report statistics.
2. Move to `binance-testnet` with small size and validate order behavior.
3. Only then consider `binance-live` with strict risk limits.
