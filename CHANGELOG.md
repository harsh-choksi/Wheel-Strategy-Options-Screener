# Changelog

## 0.2.14 - Authoritative CSP Screener Name Validation

Helper-breaking update: reload the Chrome helper after deploying this release.

- Validated open CSP screeners through Robinhood's `screener-name-input` button instead of inferred heading markup.
- Preferred the button title with normalized visible-text fallback and excluded sidebar labels from confirmation.
- Added distinct route, name-confirmation, and no-symbol failures for easier troubleshooting.

## 0.2.13 - Restored CSP Screener Symbol Extraction

Helper-breaking update: reload the Chrome helper after deploying this release.

- Restored CSP Auto extraction across the full confirmed Robinhood screener main region.
- Kept exact label clicking and `/screener/...` confirmation while allowing sibling stock-grid containers.
- Added plain-text and scroll-loaded symbol regression coverage matching Robinhood's screener layout.

## 0.2.12 - Direct CSP Screener Label Click

Helper-breaking update: reload the Chrome helper after deploying this release.

- Fixed CSP Auto to click the exact matching Robinhood screener text label instead of replacing it with an ancestor row.
- Kept exact browser-local screener name matching and `/screener/...` confirmation before symbol extraction.
- Hardened browser fixtures so ancestor clicks no longer produce a false successful test.

## 0.2.11 - Reliable Robinhood Scan Handoff

Helper-breaking update: reload the Chrome helper after deploying this release.

- Made every live Scan and Refresh bring the Robinhood tab and Chrome window to the foreground immediately.
- Required CSP Auto to match the currently selected screener name and confirm a real `/screener/...` page before reading symbols.
- Added a safe Home retry when the open screener does not match, while keeping Home holdings out of CSP results.

## 0.2.10 - Faster CSP Auto List Selection

Helper-breaking update: reload the Chrome helper after deploying this release.

- Fixed CSP Auto list selection to search the Robinhood Home `Lists` panel directly instead of slowly scrolling the Home page.
- Kept exact saved screener name matching and blocked Home holdings from being used as screener symbols.
- Added regression coverage for visible and lower-in-panel saved list matches.

## 0.2.9 - Robinhood Auto Extraction Repair

Helper-breaking update: reload the Chrome helper after deploying this release.

- Fixed CSP Auto to open Robinhood Home and click the exact saved screener name before extracting symbols.
- Fixed CC Auto to import positions from every visible Robinhood Investing account, including the current account first.
- Updated CC Auto stock parsing for Robinhood's current Stocks table markup and average-cost class.
- Confirmed CC Auto continues through covered-call forecast, sell-call quote extraction, and finalization after positions import.

## 0.2.8 - Private-Beta Completion

Helper-breaking update: reload the Chrome helper after deploying this release.

- Added the Command Center at `/` and moved the scanner dashboard to `/dashboard.html`.
- Added `Home`, `Dashboard`, Helper Health, and Changelog navigation.
- Added `/healthz` and `/api/version` safe production status endpoints.
- Added a Settings release panel with app version, helper version, and deploy timestamp.
- Added Helper Health checks for extension status, helper version, the current Robinhood route, and app server health.
- Kept Resend as the only contact email provider.
- Documented release checklist, rollback notes, monitoring checks, and chatbot boundaries.

## 0.2.7 - Robinhood Position Import And Resend Contact

Helper-breaking update: reload the Chrome helper after deploying this release.

- Added CC Auto Robinhood stock-position import from `https://robinhood.com/account/investing`.
- Preserved duplicate tickers across accounts while reusing option-chain reads by unique ticker.
- Added Manual and Auto modes for CSP and CC, with Manual as the default.
- Reworked Contact Us to send through Resend over HTTPS only.
- Kept contact delivery Resend-only across configuration, code, tests, and documentation.

## 0.2.6 - CSP And CC Source Modes

- Added manual CSP symbols and manual covered-call rows.
- Added Robinhood screener import for CSP and Robinhood positions import groundwork for CC.
- Added headless smoke testing for primary routes.
- Removed public exposure of the private contact destination email.
