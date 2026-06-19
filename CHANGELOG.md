# Changelog

## 0.2.8 - Private-Beta Completion

Helper-breaking update: reload the Chrome helper after deploying this release.

- Added the Command Center at `/` and moved the scanner dashboard to `/dashboard.html`.
- Added `Home`, `Dashboard`, Helper Health, and Changelog navigation.
- Added `/healthz` and `/api/version` safe production status endpoints.
- Added a Settings release panel with app version, helper version, and deploy timestamp.
- Added diagnostics export after scans with row statuses, safe errors, helper diagnostics, and option request counts.
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
