# Wheel Strategy Options Screener

Robinhood + TradingView dashboard for screening wheel strategy candidates from three Robinhood lists:

- `Wheel Strategy Screener Safe`
- `Wheel Strategy Screener`
- `Wheel Strategy Screener Mini`

The site scans the selected Robinhood list, checks TradingView forecast data, reads Robinhood Sell Put option quotes for TradingView-eligible stocks, calculates allocation, sizes contracts, and exports the table to CSV.

This is a personal/private-beta tool, not financial advice. Verify prices, option chains, collateral, assignment risk, and buying power before trading.

## Setup Guide

The public site includes:

- A short first-visit walkthrough on the dashboard.
- A permanent setup guide at `https://wheelstrategyscreener.com/guide.html`.
- Copy buttons for the exact Robinhood screener names.
- Helper installation, scan instructions, result explanations, privacy notes, and troubleshooting.

## How It Works

The public website does not collect Robinhood credentials. A local Chrome helper extension reads symbols and option quote values from Robinhood in the user's own browser session.

Workflow:

1. Open `https://wheelstrategyscreener.com`.
2. Follow `/guide.html` to create the three Robinhood screeners.
3. Install the Chrome helper from `/helper.html`.
4. Refresh the screener until it shows `Helper ready`.
5. Click `Open Robinhood`.
6. Log into Robinhood normally in Chrome and keep the tab open.
7. Return to the screener.
8. Choose `Safe`, `Standard`, or `Mini`.
9. Set the portfolio value and CSP return target.
10. Choose `Robinhood` as the source and click `Refresh`.
11. The helper opens the matching Robinhood list and sends ticker symbols to the site.
12. The server scans TradingView for current price and analyst targets.
13. The helper checks full default-expiration Robinhood Sell Put chains for TradingView-eligible symbols.
14. The server selects qualifying CSP strikes, sizes contracts, and returns the ranked table.

Mock mode works without the helper and uses built-in sample symbols with live TradingView data.

## Create The Robinhood Screeners

Robinhood's web flow is:

1. Log in directly at `robinhood.com`.
2. From Home, scroll to `Lists`.
3. Select `Create watchlist or screener`.
4. Choose the stock screener option.
5. Enter a screener name, add filters using `+`, review Preview, and select Create.
6. Repeat until all three screeners exist.

Use these exact names:

```text
Wheel Strategy Screener Safe
Wheel Strategy Screener
Wheel Strategy Screener Mini
```

The names must match exactly because the dashboard maps its Safe, Standard, and Mini tabs to those lists. Users choose filters that fit their own strategy and risk tolerance. The project does not recommend investment filters.

Robinhood references:

- [Stock Screeners](https://robinhood.com/support/articles/stock-screeners/)
- [Lists](https://robinhood.com/support/articles/lists/)
- [Watchlists](https://robinhood.com/support/articles/building-your-watchlist/)

## Security Model

- Robinhood login happens only on `robinhood.com`.
- No custom Robinhood username/password form exists.
- No Robinhood password, MFA code, cookie, or storage state is sent to the website.
- The helper sends ticker symbols and visible option quote values only.
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
8. Confirm Chrome shows helper version `0.2.5`.
9. Refresh the screener.

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
weekly_return_target defaults to 0.02
yearly_return = (1 + weekly_return_target)^52 - 1

For each TradingView-eligible symbol:
  open https://robinhood.com/options/chains/{SYMBOL}
  select Sell and Put
  keep Robinhood's default expiration
  scrape the full visible/scrollable strike and bid chain
  consider only strikes strictly below TradingView current price
  return_percent = bid / strike
  choose the lowest strike where return_percent >= weekly_return_target
```

The dashboard shows linked `Weekly %` and `Yearly %` inputs. Weekly return controls the
option-chain rule. Yearly return is compounded over 52 weeks.

If no below-current put meets the selected bid/strike return rule, the row is marked `SKIP`.
`SKIP` rows are not allocated and do not receive contracts.

Status meanings:

- `Eligible`: TradingView passed and Robinhood has a qualifying below-current put.
- `SKIP`: TradingView passed, but no default-expiration below-current put has `bid / strike` at or above the selected weekly return.
- `Below min`: TradingView minimum analyst target is not above current price.
- `Unused`: The row qualifies, but portfolio sizing gives it zero contracts.
- `Unavailable`: TradingView or Robinhood quote data could not be read.

Quote columns:

- `CSP Strike`: selected Robinhood sell-put strike.
- `Bid`: Robinhood bid for that strike.
- `Return %`: `bid / strike`.

Contract sizing:

```text
target_dollars = portfolio_value * allocation_percent
collateral_per_contract = csp_strike * 100
contracts = nearest whole-contract count that keeps total actual used <= portfolio_value
actual_used = contracts * collateral_per_contract
```

If an eligible stock receives zero contracts, it is marked `Unused`, removed from the used set, and allocation/contract sizing are recalculated.

Changing the portfolio value after a scan recalculates allocation and contract sizing immediately without re-reading Robinhood or TradingView. Changing the weekly/yearly return target reuses the latest TradingView rows and cached Robinhood option quotes, then reselects CSP strikes and resizes contracts. Click `Refresh` when you want new symbols, current TradingView data, and fresh Robinhood option quotes.

Option-chain extraction can take time because the helper opens each TradingView-eligible symbol's Robinhood chain and scrolls the default-expiration Sell Put quotes. Keep the Robinhood tab open and avoid interacting with it during a scan.

## Environment

Create `/root/wheel-screener/.env` on the VPS:

```text
PUBLIC_DOMAIN=wheelstrategyscreener.com
NODE_ENV=production

TRADINGVIEW_CACHE_TTL_MS=900000
TRADINGVIEW_CONCURRENCY=8
TRADINGVIEW_REQUEST_TIMEOUT_MS=8000
```

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
- `src/public/`: dashboard, first-visit onboarding, setup guide, and helper install page.
- `src/lib/analyze.js`: symbol source handling and TradingView scan orchestration.
- `src/lib/calculations.js`: allocation and contract sizing.
- `src/lib/options.js`: Robinhood put quote normalization and CSP strike selection.
- `src/lib/tradingview.js`: TradingView forecast lookup, timeout, and cache.
- `extension/`: Chrome helper that opens Robinhood lists and option chains.
- `test/`: calculation, TradingView parsing, and API tests.
