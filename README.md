# Wheel Strategy Options Screener

Robinhood + TradingView dashboard for screening wheel strategy candidates from three Robinhood lists:

- `Wheel Strategy Screener Safe`
- `Wheel Strategy Screener`
- `Wheel Strategy Screener Mini`

The site scans the selected Robinhood list, checks TradingView forecast data, filters eligible stocks, calculates allocation, selects CSP strikes, sizes contracts, and exports the table to CSV.

This is a personal/private-beta tool, not financial advice. Verify prices, option chains, collateral, assignment risk, and buying power before trading.

## How It Works

The public website does not collect Robinhood credentials or cookies. A local Chrome helper extension reads symbols from Robinhood in the user's own browser session.

Workflow:

1. Open `https://wheelstrategyscreener.com`.
2. Install the Chrome helper from `/helper.html`.
3. Refresh the screener until it shows `Helper ready`.
4. Click `Open Robinhood`.
5. Log into Robinhood normally in Chrome.
6. Return to the screener.
7. Choose `Safe`, `Standard`, or `Mini`.
8. Choose `Robinhood` as the source and click `Refresh`.
9. The helper opens the matching Robinhood list and sends only ticker symbols to the site.
10. The server scans TradingView and returns the ranked table.

Mock mode works without the helper and uses built-in sample symbols with live TradingView data.

## Security Model

- Robinhood login happens only on `robinhood.com`.
- No custom Robinhood username/password form exists.
- No Robinhood password, MFA code, cookie, or storage state is sent to the website.
- The helper sends ticker symbols only.
- The server handles TradingView lookups and calculations.
- The helper does not use Chrome's `debugger` permission.

Robinhood website automation may still raise policy/legal concerns. Treat this as private beta unless reviewed.

## Chrome Helper

Private beta install:

1. Open `https://wheelstrategyscreener.com/helper.html`.
2. Download the helper ZIP.
3. Extract it to a folder you can keep.
4. Open `chrome://extensions`.
5. Enable `Developer mode`.
6. Click `Load unpacked`.
7. Select the extracted helper folder.
8. Confirm Chrome shows helper version `0.1.8`.
9. Refresh the screener.

For one-click public installation later, publish the `extension/` folder through the Chrome Web Store and link the store listing from `/helper.html`.

## Screener Logic

Eligibility:

```text
TradingView minimum analyst target > TradingView current price
```

Allocation:

```text
weight(rank i) = 1.5 ^ (used_stock_count - i)
allocation_percent = weight / sum(all_weights)
```

CSP strike:

```text
opposite allocation = allocation at mirrored rank
buffer = (2 / 3) * used_stock_count * opposite_allocation_decimal
csp_strike = current_price - buffer
rounded_csp_strike = nearest 0.50
```

Contract sizing:

```text
target_dollars = portfolio_value * allocation_percent
collateral_per_contract = csp_strike * 100
contracts = nearest whole-contract count that keeps total actual used <= portfolio_value
actual_used = contracts * collateral_per_contract
```

If an eligible stock receives zero contracts, it is removed from the used set and allocation/CSP/contract sizing are recalculated.

## Environment

Create `/root/wheel-screener/.env` on the VPS:

```text
PUBLIC_DOMAIN=wheelstrategyscreener.com
NODE_ENV=production

TRADINGVIEW_CACHE_TTL_MS=900000
TRADINGVIEW_CONCURRENCY=8
TRADINGVIEW_REQUEST_TIMEOUT_MS=8000
```

No Postgres, Plaid, SnapTrade, Browserless, server-side Playwright login, or Robinhood session state is used in the current build.

## Local Development

Install dependencies:

```powershell
npm install
```

Run tests:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\test.ps1
```

Start locally:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start.ps1
```

Open:

```text
http://localhost:5173
```

Stop:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\stop.ps1
```

For local helper testing, load the repo's `extension/` folder in `chrome://extensions`.

## VPS Deployment

DNS:

```text
A      @      <VPS public IP>
CNAME  www    wheelstrategyscreener.com
```

Deploy:

```bash
cd /root/wheel-screener
tar -xzf /root/wheel-screener-update.tar.gz -C /root/wheel-screener
docker compose up -d --build --force-recreate --remove-orphans
docker compose ps
docker compose logs --tail=80 app
```

Caddy handles HTTPS automatically when ports `80` and `443` are open.

After any extension change, download/reload the helper from `/helper.html`.

## Project Layout

- `src/server.js`: HTTP server, API routes, static assets, helper ZIP download.
- `src/public/`: dashboard and helper install page.
- `src/lib/analyze.js`: symbol source handling and TradingView scan orchestration.
- `src/lib/calculations.js`: allocation, CSP strike, contract sizing.
- `src/lib/tradingview.js`: TradingView forecast lookup, timeout, and cache.
- `extension/`: Chrome helper that opens Robinhood lists and extracts ticker symbols.
- `test/`: calculation, TradingView parsing, and API tests.
