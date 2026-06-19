# Wheel Strategy Screener

Robinhood + TradingView dashboard for screening wheel strategy candidates and covered-call positions.

The site has two workflows:

- `CSP`: scans a user-saved Robinhood screener name or manual symbol list, checks TradingView forecast data, reads Robinhood Sell Put option quotes for TradingView-eligible stocks, calculates allocation, sizes contracts, and exports the table to CSV.
- `CC`: lets users enter covered-call positions manually or import stock positions from Robinhood, checks TradingView data, reads Robinhood Sell Call quotes, selects call strikes, and exports covered-call return estimates.

This is a personal/private-beta tool, not financial advice. Verify prices, option chains, collateral, assignment risk, and buying power before trading.

Current private-beta release: `0.2.8`. The app version shown by `/api/version`
comes from `package.json`; the Chrome helper version comes from
`extension/manifest.json`. Keep those version values, favicon cache keys,
`CHANGELOG.md`, and helper install copy in sync for each release.

## Setup Guide

The public site includes:

- A Command Center at `/` and `/home.html` with two main entries: CSP Dashboard and CC Dashboard.
- The scanner dashboard at `/dashboard.html`, with returning users resumed from `/` to their last selected strategy.
- A short first-visit walkthrough on the dashboard.
- A permanent setup guide at `https://wheelstrategyscreener.com/guide.html`.
- Learn, FAQ, Calculator, Contact, Changelog, Helper Health, Privacy Policy, and Terms of Service pages.
- CSP screener name management plus manual CSP symbol rows stored locally.
- JSON Settings export/import for strategy settings.
- Helper installation, scan instructions, diagnostics export, result explanations, privacy notes, and troubleshooting.

All linked public pages are intentional app surfaces. They are not placeholder or orphan pages:
the footer links and smoke tests expect the Command Center, dashboard, setup guide, helper install page,
Helper Health, changelog, learn page, FAQ, calculator, contact form, privacy policy, and terms page
to remain available.

Generated and local-only artifacts should not be committed. `node_modules/`,
`.server.pid`, `.server.log`, `.server.err`, `.env`, and npm debug logs are
ignored. The helper ZIP is generated on demand from the current `extension/`
folder by `/downloads/wheel-screener-helper.zip`; the ZIP file itself is not
stored in the repository. Public favicon files and extension icon files may
share artwork, but both sets are required because the website and Chrome
extension package use different paths.

## How It Works

The public website does not collect Robinhood credentials. A local Chrome helper extension reads symbols and option quote values from Robinhood in the user's own browser session.

Workflow:

1. Open `https://wheelstrategyscreener.com`.
2. Use the Command Center to open `CSP Dashboard` or `CC Dashboard`, or open `/dashboard.html` directly.
3. Follow `/guide.html` to create one or more Robinhood screeners and save their exact names in the dashboard.
4. Install the Chrome helper from `/helper.html`.
5. Check `/helper-health.html` if the helper is not detected or CC Auto needs Robinhood route verification.
6. Reload the dashboard page until it shows `Helper ready`.
7. Click `Open Robinhood`.
8. Log into Robinhood normally in Chrome and keep the tab open.
9. Return to the dashboard.
10. Choose `CSP` or `CC`.
11. For CSPs, keep the table toolbar on `Manual` to type symbols, or switch to `Auto` to use a saved Robinhood screener, then set portfolio value and return target.
12. For CCs, keep `Manual` to enter rows, or switch to `Auto` to import visible stock positions from Robinhood.
13. Choose `Robinhood` as the source and click `Scan`. After results exist, the same button becomes `Refresh` for a fresh read.
14. For CSP screeners, the helper opens the matching Robinhood list and sends ticker symbols to the site. Manual CSP symbols skip this list extraction.
15. The server scans TradingView for current price and analyst targets.
16. The helper checks full default-expiration Robinhood Sell Put or Sell Call chains.
17. The server selects qualifying strikes, sizes or summarizes the rows, and returns the table.

`Scan` is the first data collection for the active strategy. `Refresh` appears after that strategy has results and rereads Robinhood, TradingView, and the relevant option chains. Changing portfolio value, covered-call average cost/contracts, or Weekly/Yearly return reuses cached scan data when possible.

Covered-call rows and manual CSP symbols are saved locally in the browser with `localStorage`, so refreshing the tab keeps manually entered rows. Custom CSP screeners are also saved locally. Scanned TradingView data, Robinhood option quotes, imported Robinhood positions, helper status, and CSV data are not persisted; clearing site data resets the local lists.

The Settings button exports/imports strategy settings only: custom CSP screeners, selected CSP screener, portfolio value, CSP weekly return, CC weekly return, active strategy, selected data source, and CSP/CC strategy source modes as `manual` or `auto`. Older settings files that contain `screener` or `robinhood` source values are imported as `auto`. Settings files intentionally exclude manual CSP symbols, covered-call rows, scan results, option quotes, imported Robinhood positions, helper status, and CSV data.

The table toolbar filter appears only in `Auto` mode. `Hide unavailable and ineligible rows` is unchecked by default, so unavailable and ineligible rows remain visible unless the user chooses to hide them. CSP `SKIP` rows stay visible when the filter is enabled because they passed the TradingView target check but did not meet the selected option-return rule.

After a scan, `Export Diagnostics` downloads a safe JSON bundle with app/helper version, timestamp, strategy, data source, row statuses, safe errors, option-request counts, and helper diagnostics. It does not include Robinhood cookies, credentials, account session data, contact destination emails, or email API keys.

Settings also shows a release panel with the app version, Chrome helper version, and deploy timestamp. The app exposes `/healthz` for basic uptime checks and `/api/version` for safe version metadata.

Mock mode works without the helper and uses built-in sample symbols with live TradingView data.

## Create And Save Robinhood Screeners

Robinhood's web flow is:

1. Log in directly at `robinhood.com`.
2. From Home, scroll to `Lists`.
3. Select `Create watchlist or screener`.
4. Choose the stock screener option.
5. Enter a screener name, add filters using `+`, review Preview, and select Create.
6. Repeat for as many screeners as you want.
7. In the dashboard, use `Screener -> Manage` to save each exact Robinhood screener name.
8. Select the saved screener from the dropdown before scanning CSPs.

Starter examples:

```text
Wheel Strategy 1
Wheel Strategy 2
Wheel Strategy 3
```

These names are optional starter examples only. Users can save any Robinhood screener names in the dashboard. Saved names are stored locally in that user's browser, not globally on the website. The selected saved name must match Robinhood exactly because the helper clicks that visible screener by name. Users choose filters that fit their own strategy and risk tolerance. The project does not recommend investment filters.

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
8. Confirm Chrome shows helper version `0.2.8`.
9. Reload the screener page.

The download at `/downloads/wheel-screener-helper.zip` is built by the Node
server from the repository's `extension/` directory at request time. If
`extension/` changes, redeploy the app and reload the unpacked Chrome helper;
do not expect an old extracted helper folder to update itself.

Helper Health:

1. Open `https://wheelstrategyscreener.com/helper-health.html`.
2. Confirm the extension bridge answers with helper version `0.2.8`.
3. Confirm the app server health check is green.
4. For CC Auto, keep Robinhood on `https://robinhood.com/account/investing` so the route check is green before scanning.
5. If a check fails, reload the helper in `chrome://extensions`, refresh the page, and check Docker logs if the app server check fails.

## CSP Screener Logic

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
weekly_return_target defaults to 0.01
yearly_return = (1 + weekly_return_target)^52 - 1

For each TradingView-eligible symbol:
  open https://robinhood.com/options/chains/{SYMBOL}
  select Sell and Put
  keep Robinhood's default expiration
  scrape the full visible/scrollable strike and bid chain
  consider only strikes strictly below TradingView current price
  return_percent = bid / strike
  choose the lowest strike where return_percent >= weekly_return_target
  if multiple qualifying put strikes have the same bid, the lower strike wins
```

The dashboard shows linked `Weekly %` and `Yearly %` inputs. Weekly return controls the
option-chain rule. CSP mode defaults to `1%` weekly. Its yearly display is compounded over
52 weeks: `(1 + weekly)^52 - 1`.

If no below-current put meets the selected bid/strike return rule, the row is marked `SKIP`.
`SKIP` rows are not allocated and do not receive contracts.

Status meanings:

- `Eligible`: TradingView passed and Robinhood has a qualifying below-current put.
- `SKIP`: TradingView passed, but no default-expiration below-current put has `bid / strike` at or above the selected weekly return.
- `Below min`: TradingView minimum analyst target is not above current price.
- `Unused`: The row qualifies, but portfolio sizing cannot fit a contract for it after higher-priority affordable rows are considered.
- `Unavailable`: TradingView or Robinhood quote data could not be read. If TradingView has current price but no analyst target, CSP shows the current price as Unavailable and does not allocate.

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
When a small portfolio would otherwise round every eligible CSP row to zero contracts, the app uses a fallback pass: it walks the eligible rows in scan/rank order, assigns one contract to each row whose `csp_strike * 100` fits the remaining cash, and stops when no later affordable row can fit. The total actual used cash still cannot exceed the portfolio value.

Changing the portfolio value after a scan recalculates allocation and contract sizing immediately without re-reading Robinhood or TradingView. Changing the weekly/yearly return target reuses the latest TradingView rows and cached Robinhood option quotes, then reselects CSP strikes and resizes contracts. Click `Refresh` after a scan when you want new symbols, current TradingView data, and fresh Robinhood option quotes.

Option-chain extraction can take time because the helper opens each unique TradingView-eligible symbol's Robinhood chain and scrolls the default-expiration Sell Put quotes. Duplicate symbols are read once per Scan or Refresh. Keep the Robinhood tab open and avoid interacting with it during a scan.

## Covered Call Logic

The `CC` tab is for positions the user already owns. Leave the table toolbar on `Manual` to enter rows directly in the Covered Calls list:

```text
Symbol | Average Cost | Contracts
```

Average cost is per share. Contracts are entered directly by the user. Use `Add Entry` for more rows and the red `x`/`&times;` beside a symbol to remove a row.
These manually entered rows persist locally in the same browser across page refreshes. The app only stores `symbol`, `averageCost`, and `contracts`; it does not store scan results or option quote snapshots.
Multiple rows may use the same ticker for separate lots with different average costs or contract counts. During each Scan or Refresh, the helper reads that ticker's Robinhood Sell Call option chain once, then the server applies the shared raw call quotes separately to every matching row.

Switch the table toolbar to `Auto` to have the helper open `https://robinhood.com/account/investing`, iterate account choices in the account dropdown, and import the Investing page's Stocks table rows. The helper reads the `Symbol`, `Shares`, and `Average cost` columns for each selectable account group, such as Individual, Retirement, Joint, or any other visible group Robinhood shows. Contracts are calculated as `floor(shares / 100)`. Rows below 100 shares remain visible with `0` contracts, but they are not used for covered-call option-chain reads.

CC mode defaults to `2%` weekly. Its yearly display uses a simple annualized conversion:

```text
yearly_return = weekly_return * 52
weekly_return = yearly_return / 52
```

For each valid row:

```text
return_base = max(TradingView current price, average cost)
open https://robinhood.com/options/chains/{SYMBOL}
select Sell and Call
keep Robinhood's default expiration
scrape the full visible/scrollable strike and bid chain
primary rule:
  consider strikes strictly above return_base
  return_percent = bid / return_base
  choose the highest strike where return_percent >= weekly_return_target
  if multiple qualifying call strikes have the same bid, the higher strike wins
fallback rule:
  if no primary strike qualifies, choose the closest positive-bid strike strictly above average cost
  if that fallback bid appears on multiple above-cost strikes, the higher strike wins
  if no above-cost strike has a positive bid, choose the highest positive-bid strike below average cost
```

If no positive-bid call quote exists, the row is marked `SKIP`. A below-cost fallback can reduce or even make total assignment return negative, but it is only used when no positive-bid above-cost call exists. If TradingView or Robinhood call data cannot be read, the row is marked `Unavailable`. If TradingView analyst targets are unavailable but current price can still be read, CC mode can continue with current-only data and leaves Min/Avg/Max blank.

CC total return:

```text
weekly_return_dollars = sum(bid * 100 * contracts)
weekly_return_percent = weekly_return_dollars / sum(return_base * 100 * contracts)
total_return_dollars = ((strike - average_cost) + bid) * 100 * contracts
total_return_percent = total_return_dollars / (average_cost * 100 * contracts)
```

The CC summary cards show:

- `Positions`: nonblank symbol rows in the Covered Calls list.
- `Weekly Return`: premium-only dollars and percent from selected calls.
- `Total Return`: assignment gain plus premium, with percent based on average-cost basis.

Changing Average Cost, Contracts, Weekly, or Yearly return after a CC scan reuses cached call quotes and reselects strikes without re-reading Robinhood or TradingView. Changing a symbol requires `Scan` if no CC data exists yet, or `Refresh` after results exist, because the app needs new TradingView data and a new Robinhood option-chain snapshot.

## Environment

Create `/root/wheel-screener/.env` on the VPS:

```text
PUBLIC_DOMAIN=wheelstrategyscreener.com
NODE_ENV=production

TRADINGVIEW_CACHE_TTL_MS=900000
TRADINGVIEW_CONCURRENCY=8
TRADINGVIEW_REQUEST_TIMEOUT_MS=8000

CONTACT_TO_EMAIL=your_contact_email@example.com
CONTACT_FROM_EMAIL="Wheel Strategy Screener <notifications@your-domain.example>"
RESEND_API_KEY=
```

The contact form posts to `/api/contact` and sends mail through Resend's HTTPS
email API. `CONTACT_TO_EMAIL` stays private on the server and is never rendered
in public HTML. `CONTACT_FROM_EMAIL` must be a sender address or domain that is
verified in Resend. If the email API settings are missing, the endpoint returns
`CONTACT_EMAIL_NOT_CONFIGURED` and the Contact page tells the operator which
private environment variables to set.

For production, verify the sender domain in Resend first, then set:

```text
CONTACT_TO_EMAIL=your_private_destination@example.com
CONTACT_FROM_EMAIL="Wheel Strategy Screener <notifications@your-verified-domain.example>"
RESEND_API_KEY=re_your_resend_api_key
```

After restarting the service, submit a test message from `/contact.html`. A
successful send shows `Message sent.` on the page. If it fails, check
`docker compose logs --tail=120 app`; the server logs safe Resend failure codes
without exposing the private destination address in public files.

## Local Development

Use Node `20` or newer. This project is a plain Node HTTP server with static
HTML/CSS/JS assets; there is no bundler and no separate build step for local
development or deployment.

Install dependencies:

```powershell
npm install
```

In the Codex desktop workspace, the PowerShell scripts also look for Codex's
bundled Node runtime and bundled modules, which lets tests run even when
`node` or `npm` are not on the shell `PATH`.

Run tests:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\test.ps1
```

Run the headless route smoke test:

```powershell
npm run test:smoke
```

The smoke test starts `src/server.js` itself on `HOST=127.0.0.1` with an
ephemeral port, waits for the printed `Wheel Strategy Screener running at ...`
URL, then checks the primary static routes with Playwright. If Codex's in-app
browser cannot attach to the local page, that can be a sandbox/browser-attach
limitation rather than an app failure. Final manual verification is opening the
printed local URL in a normal browser.

Mobile layout verification should cover the primary public routes at narrow
phone, normal phone, tablet, and desktop widths. The dashboard table is expected
to stack into card-like rows on mobile, controls should become single-column
where needed, and no public route should create horizontal page overflow at a
`320px` viewport.

Start locally:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start.ps1
```

Open:

```text
Use the URL printed by the server, for example http://127.0.0.1:5173
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

From Git Bash on your computer:

```bash
cd "/c/Users/harsh/OneDrive/Documents/Wheel Strategy Options Screener"
tar --exclude='.git' --exclude='node_modules' --exclude='.env' -czf /c/Users/harsh/Downloads/wheel-screener-update.tar.gz .
scp /c/Users/harsh/Downloads/wheel-screener-update.tar.gz root@<VPS_IP>:/root/wheel-screener-update.tar.gz
ssh root@<VPS_IP>
```

Then on the VPS:

```bash
cd /root/wheel-screener
tar -xzf /root/wheel-screener-update.tar.gz -C /root/wheel-screener
docker compose up -d --build --force-recreate --remove-orphans
docker compose ps
docker compose logs --tail=80 app
```

Caddy handles HTTPS automatically when ports `80` and `443` are open.

Release checklist:

1. Confirm `node --check src/server.js`, `node --check src/public/app.js`, `node --check src/public/calculator.js`, `node --check src/public/guide.js`, and `node --check src/public/helper-health.js` pass locally.
2. Confirm `node --check extension/background.js`, `node --check extension/content-app.js`, and `node --check extension/content-robinhood.js` pass locally.
3. Run `node --test test/calculations.test.js test/publicApp.test.js test/tradingview.test.js`.
4. Run `npm run test:smoke` in a local environment with Playwright installed, or run `powershell -ExecutionPolicy Bypass -File .\scripts\test.ps1` to use the bundled Codex runtime when available.
5. Verify the public routes at mobile and desktop widths, including `320px`, `375px`, `430px`, `768px`, and a desktop viewport.
6. Create the tarball and upload it to the VPS.
7. Extract the tarball into `/root/wheel-screener`.
8. Rebuild with `docker compose up -d --build --force-recreate --remove-orphans`.
9. Check `docker compose ps`, `docker compose logs --tail=80 app`, `/healthz`, and `/api/version`.
10. Download and reload the Chrome helper if `extension/` changed.
11. Submit a Contact Us test and confirm Resend delivery.
12. Manually verify CSP Manual, CSP Auto, CC Manual, CC Auto, diagnostics export, Helper Health, and the primary public routes.

After any extension change, update the Chrome helper too:

1. Open `https://wheelstrategyscreener.com/helper.html`.
2. Download the helper ZIP.
3. Extract it.
4. Go to `chrome://extensions`.
5. Find `Wheel Strategy Screener Helper`.
6. Click reload if it points to the extracted updated folder, or remove it and click `Load unpacked`.
7. Select the newly extracted helper folder.
8. Confirm Chrome shows helper version `0.2.8`.
9. Refresh `https://wheelstrategyscreener.com`.

Manual deployment verification:

- Open `/`, `/home.html`, `/dashboard.html`, `/guide.html`, `/helper.html`, `/helper-health.html`, `/changelog.html`, `/learn.html`, `/faq.html`, `/calculator.html`, `/contact.html`, `/privacy.html`, and `/terms.html`.
- Confirm `/healthz` returns `"ok": true` and `/api/version` shows the current app/helper versions.
- Submit a Contact Us test and confirm the destination inbox receives it through Resend.
- In Mock mode, run CSP Manual and CC Manual scans.
- With the helper loaded, verify CSP Auto, CC Auto, and option-chain Refresh on Robinhood.
- After any scan, click `Export Diagnostics` and confirm the JSON contains row statuses but no private email, cookies, passwords, or API keys.

Rollback notes:

1. Keep the previous release tarball on the VPS before extracting a new one, for example `/root/wheel-screener-previous.tar.gz`.
2. If the deploy fails, stop the app with `docker compose down`.
3. Restore the previous tarball into `/root/wheel-screener`.
4. Run `docker compose up -d --build --force-recreate --remove-orphans`.
5. Reload the previous extracted Chrome helper folder if the helper version changed.
6. Re-check `/healthz`, Contact Us, CSP Manual, and CC Manual before returning to normal use.

Lightweight monitoring:

- Check `https://wheelstrategyscreener.com/healthz` after every deploy and periodically while the VPS is running.
- Check `docker compose logs --tail=120 app` for safe Resend errors, API exceptions, or repeated scan failures.
- Submit a short Contact Us canary message after contact or environment changes.
- Use diagnostics exports when Robinhood extraction or option-chain reads look wrong; they are meant to reduce screenshot-only debugging.
- Keep `/changelog.html` and `CHANGELOG.md` updated whenever the helper or dashboard behavior changes.

## Current Completion Status

Production-ready private-beta pieces:

- Command Center, dashboard, Helper Health, changelog, docs, FAQ, learn, calculator, contact, privacy, and terms are internally linked.
- CSP Manual/Auto and CC Manual/Auto flows exist and are covered by API/static tests.
- Contact Us uses Resend over HTTPS only, with private destination email in server env.
- The Chrome helper stays local to Chrome and does not request debugger permission.
- Release metadata, health endpoints, diagnostics export, helper install/update flow, and rollback notes are documented.
- Public pages are linked, smoke-tested, and intentionally retained.
- Docker/Caddy deployment is documented for the current VPS setup.

Completion criteria for each release:

- `node --check src/server.js` passes.
- `node --check src/public/app.js` passes.
- Public support scripts and extension scripts pass `node --check`.
- `node --test test/calculations.test.js test/publicApp.test.js test/tradingview.test.js` passes.
- Full Playwright smoke passes locally when dependencies are installed.
- Mobile viewport checks show no horizontal overflow on the primary public routes at `320px` and normal phone widths.
- VPS `.env` uses only current Resend contact variables: `CONTACT_TO_EMAIL`, `CONTACT_FROM_EMAIL`, and `RESEND_API_KEY`.
- Docker rebuild/recreate works, `/healthz` is healthy, the helper ZIP downloads, and the helper reload is verified.
- Manual browser verification covers CSP Manual, CSP Auto, CC Manual, CC Auto, Contact Us, Helper Health, diagnostics export, and primary static routes.

Future chatbot boundary:

- Treat a chatbot as a gated follow-up, not part of this completion release.
- Scope it as a strategy education and app help assistant.
- Retrieve from README, Guide, FAQ, Learn, glossary/status copy, and troubleshooting docs before using general model knowledge.
- Do not answer "what should I buy/sell", recommend trades, or give portfolio-specific advice.
- Add rate limits, minimal metadata logs, and a visible "not financial advice" boundary before enabling it.

## Project Layout

- `package.json` and `package-lock.json`: package metadata, app version, Node engine, and Playwright test dependency.
- `.env.example`, `Dockerfile`, `docker-compose.yml`, and `deploy/Caddyfile`: local examples and production Docker/Caddy deployment configuration.
- `scripts/`: PowerShell start, stop, and test helpers that prefer the bundled Codex Node runtime when present.
- `src/server.js`: HTTP server, API routes, static assets, helper ZIP download.
- `src/public/`: Command Center, dashboard, onboarding, setup guide, helper install page, Helper Health, changelog, calculator, contact form, FAQ, legal, and learning pages.
- `src/lib/analyze.js`: symbol source handling and TradingView scan orchestration.
- `src/lib/calculations.js`: allocation and contract sizing.
- `src/lib/options.js`: Robinhood put/call quote normalization, CSP strike selection, and covered-call strike selection.
- `src/lib/tradingview.js`: TradingView forecast lookup, timeout, and cache.
- `extension/`: Chrome helper that opens Robinhood lists and option chains.
- `test/`: calculation, TradingView parsing, API/static, helper parsing, and Playwright smoke tests.
