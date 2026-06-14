const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { createAppServer } = require("../src/server");
const { analyzeScreener } = require("../src/lib/analyze");
const { SCREENERS } = require("../src/config");

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve(`http://127.0.0.1:${server.address().port}`);
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

test("analyzer accepts explicit Robinhood helper symbols", async () => {
  const result = await analyzeScreener({
    mode: "live",
    portfolioValue: 10000,
    symbols: ["AAA", "BBB"],
    source: "robinhood",
    optionQuotesBySymbol: {
      AAA: [{ strike: 9, bid: 0.2 }]
    },
    forecastFetcher: async (symbol) => ({
      symbol,
      status: "ok",
      currentPrice: 10,
      minTarget: symbol === "AAA" ? 12 : 9,
      averageTarget: 13,
      maxTarget: 20,
      eligible: symbol === "AAA"
    })
  });

  assert.equal(result.source, "robinhood");
  assert.deepEqual(result.symbols, ["AAA", "BBB"]);
  assert.equal(result.eligibleCount, 1);
  assert.equal(result.rows[0].cspStrike, 9);
});

test("public user can use mock flow", async () => {
  const server = createAppServer({
    forecastFetcher: async (symbol) => ({
      symbol,
      status: "ok",
      currentPrice: 10,
      minTarget: 11,
      averageTarget: 12,
      maxTarget: 14,
      eligible: true
    })
  });
  const base = await listen(server);

  try {
    const run = await fetch(`${base}/api/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "mock", screenerId: "safe", portfolioValue: 10000 })
    }).then((response) => response.json());
    assert.equal(run.mode, "mock");
    assert.ok(run.symbols.length > 0);
  } finally {
    await close(server);
  }
});

test("serves Chrome extension helper download", async () => {
  const server = createAppServer();
  const base = await listen(server);

  try {
    const response = await fetch(`${base}/downloads/wheel-screener-helper.zip`);
    const bytes = new Uint8Array(await response.arrayBuffer());

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/zip");
    assert.deepEqual([...bytes.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  } finally {
    await close(server);
  }
});

test("serves setup guide and guide copy script", async () => {
  const server = createAppServer();
  const base = await listen(server);

  try {
    const [guideResponse, scriptResponse] = await Promise.all([
      fetch(`${base}/guide.html`),
      fetch(`${base}/guide.js`)
    ]);
    const guide = await guideResponse.text();
    const script = await scriptResponse.text();

    assert.equal(guideResponse.status, 200);
    assert.equal(scriptResponse.status, 200);
    assert.match(guide, /Wheel Strategy 1/);
    assert.match(guide, /Wheel Strategy 2/);
    assert.match(guide, /Wheel Strategy 3/);
    assert.match(guide, /data-copy="Wheel Strategy 1"/);
    assert.match(script, /navigator\.clipboard\.writeText/);
  } finally {
    await close(server);
  }
});

test("dashboard and helper page link to setup guide", () => {
  const index = fs.readFileSync(path.resolve(__dirname, "../src/public/index.html"), "utf8");
  const helper = fs.readFileSync(path.resolve(__dirname, "../src/public/helper.html"), "utf8");
  const guide = fs.readFileSync(path.resolve(__dirname, "../src/public/guide.html"), "utf8");

  assert.match(index, /href="\/guide\.html"/);
  assert.match(helper, /href="\/guide\.html"/);
  assert.match(helper, /class="title-block"/);
  assert.match(guide, /class="title-block"/);
});

test("public pages include real footer navigation routes", () => {
  const publicDir = path.resolve(__dirname, "../src/public");
  const pageFiles = [
    "index.html",
    "guide.html",
    "helper.html",
    "learn.html",
    "faq.html",
    "calculator.html",
    "contact.html",
    "privacy.html",
    "terms.html"
  ];
  const footerRoutes = [
    ["/", "Dashboard"],
    ["/guide.html", "Setup Guide"],
    ["/helper.html", "Install Helper"],
    ["/learn.html", "Learn"],
    ["/faq.html", "FAQ"],
    ["/calculator.html", "Calculator"],
    ["/contact.html", "Contact Us"],
    ["/privacy.html", "Privacy Policy"],
    ["/terms.html", "Terms of Service"]
  ];

  for (const file of pageFiles) {
    const html = fs.readFileSync(path.join(publicDir, file), "utf8");
    assert.match(html, /class="site-footer"/, `${file} should include the shared footer`);
    assert.match(html, />Product</);
    assert.match(html, />Resources</);
    assert.match(html, />Company</);
    assert.doesNotMatch(html, /href="#"/);
    assert.doesNotMatch(html, /href=""/);

    for (const [route, label] of footerRoutes) {
      assert.match(html, new RegExp(`href="${route.replace("/", "\\/")}"`), `${file} missing ${route}`);
      assert.match(html, new RegExp(`>${label}<`), `${file} missing ${label}`);
    }
  }

  for (const [route] of footerRoutes) {
    const expectedFile = route === "/" ? "index.html" : route.slice(1);
    assert.ok(fs.existsSync(path.join(publicDir, expectedFile)), `${route} should resolve to a real file`);
  }

  assert.equal(fs.existsSync(path.join(publicDir, "blog.html")), false);
  assert.equal(fs.existsSync(path.join(publicDir, "plans.html")), false);
});

test("public copy does not expose the private contact destination email", () => {
  const publicDir = path.resolve(__dirname, "../src/public");
  const publicFiles = fs
    .readdirSync(publicDir)
    .filter((file) => /\.(?:html|js|css)$/.test(file));

  for (const file of publicFiles) {
    const content = fs.readFileSync(path.join(publicDir, file), "utf8");
    assert.doesNotMatch(content, /legendharsh21@gmail\.com/, `${file} leaks private email`);
  }

  const readme = fs.readFileSync(path.resolve(__dirname, "../README.md"), "utf8");
  assert.doesNotMatch(readme, /legendharsh21@gmail\.com/);
  assert.match(readme, /CONTACT_TO_EMAIL=your_contact_email@example\.com/);
});

test("new resource pages contain current workflow, legal, and calculator content", () => {
  const learn = fs.readFileSync(path.resolve(__dirname, "../src/public/learn.html"), "utf8");
  const faq = fs.readFileSync(path.resolve(__dirname, "../src/public/faq.html"), "utf8");
  const calculator = fs.readFileSync(path.resolve(__dirname, "../src/public/calculator.html"), "utf8");
  const contact = fs.readFileSync(path.resolve(__dirname, "../src/public/contact.html"), "utf8");
  const privacy = fs.readFileSync(path.resolve(__dirname, "../src/public/privacy.html"), "utf8");
  const terms = fs.readFileSync(path.resolve(__dirname, "../src/public/terms.html"), "utf8");
  const css = fs.readFileSync(path.resolve(__dirname, "../src/public/styles.css"), "utf8");

  assert.match(learn, /wheel strategy/i);
  assert.match(learn, /Assignment is the core mechanic/);
  assert.match(learn, /covered-call cycle/);
  assert.match(learn, /Manual is the default for both strategies/);
  assert.match(learn, /Auto uses Robinhood-based import/);
  assert.match(faq, /Why is this called a wheel strategy/i);
  assert.match(faq, /helper install/i);
  assert.match(faq, /Scan vs Refresh/i);
  assert.match(faq, /SKIP means/);
  assert.match(calculator, /data-calculator="csp-yearly"/);
  assert.match(calculator, /data-calculator="cc-yearly"/);
  assert.match(calculator, /data-calculator="csp-return"/);
  assert.match(calculator, /data-calculator="cc-total"/);
  assert.match(calculator, /calculator\.js/);
  assert.match(contact, /id="contactForm"/);
  assert.match(contact, /action="\/api\/contact"/);
  assert.match(contact, /name="website"/);
  assert.match(contact, /private\s+contact form/);
  assert.doesNotMatch(contact, /legendharsh21@gmail\.com/);
  assert.doesNotMatch(contact, /Contact details are not published yet/);
  assert.match(privacy, /Last updated/);
  assert.match(privacy, /Information stored in your browser/);
  assert.match(privacy, /browser localStorage/);
  assert.match(privacy, /manual CSP symbols/);
  assert.match(privacy, /imported Robinhood positions/);
  assert.match(privacy, /Robinhood passwords, MFA codes, cookies, and account sessions are not sent/);
  assert.match(privacy, /Contact form information/);
  assert.match(terms, /Last updated/);
  assert.match(terms, /not affiliated with, endorsed by, sponsored by, or approved/);
  assert.match(terms, /No financial, investment, tax, or legal advice/);
  assert.match(terms, /No trade placement/);
  assert.match(terms, /account position rows/);
  assert.match(terms, /Options risk and assignment risk/);
  assert.match(terms, /Limitation of liability/);
  assert.match(css, /\.site-footer/);
  assert.match(css, /\.footer-inner/);
  assert.match(css, /\.page-hero-band/);
  assert.match(css, /\.helper-hero/);
  assert.match(css, /\.contact-form/);
  assert.match(css, /\.calculator-grid/);
  assert.match(css, /\.calculator-output/);
  assert.match(css, /\.faq-list/);
});

test("calculator helper formulas update expected values", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../src/public/calculator.js"), "utf8");
  const sandbox = { window: {}, Intl, Math, Number };

  vm.runInNewContext(source, sandbox);
  const calculator = sandbox.window.WheelStrategyCalculators;

  assert.equal(calculator.WEEKS_PER_YEAR, 52);
  assert.equal(calculator.ccWeeklyToYearly(2), 104);
  assert.equal(calculator.cspWeeklyToYearly(1).toFixed(4), "67.7689");
  assert.equal(calculator.cspReturnPercent(10, 0.2), 2);

  const cc = calculator.coveredCallTotals(12, 14, 0.35, 2);
  assert.equal(cc.premiumDollars, 70);
  assert.equal(cc.totalReturnDollars, 470);
  assert.equal(cc.totalReturnPercent.toFixed(2), "19.58");
  assert.equal(calculator.coveredCallTotals("", 14, 0.35, 2), null);
});

test("new static footer pages are served by the app", async () => {
  const server = createAppServer();
  const base = await listen(server);
  const routes = [
    "/learn.html",
    "/faq.html",
    "/calculator.html",
    "/calculator.js",
    "/contact.html",
    "/privacy.html",
    "/terms.html"
  ];

  try {
    const responses = await Promise.all(routes.map((route) => fetch(`${base}${route}`)));
    for (const response of responses) {
      assert.equal(response.status, 200);
    }
  } finally {
    await close(server);
  }
});

test("server startup supports HOST and logs the bound local URL", () => {
  const configSource = fs.readFileSync(path.resolve(__dirname, "../src/config.js"), "utf8");
  const serverSource = fs.readFileSync(path.resolve(__dirname, "../src/server.js"), "utf8");
  const smokeSource = fs.readFileSync(path.resolve(__dirname, "./smoke.test.js"), "utf8");

  assert.match(configSource, /DEFAULT_HOST: process\.env\.HOST \|\| "0\.0\.0\.0"/);
  assert.match(serverSource, /server\.address\(\)/);
  assert.match(serverSource, /Wheel Strategy Screener running at http:\/\/\$\{displayHost\}:\$\{boundPort\}/);
  assert.match(smokeSource, /HOST: "127\.0\.0\.1"/);
  assert.match(smokeSource, /PORT: "0"/);
  assert.match(smokeSource, /127\\.0\\.0\\.1:\\d\+/);
});

test("contact API validates fields and sends with injected mailer", async () => {
  const sentMessages = [];
  const server = createAppServer({
    contactMailer: async (payload) => {
      sentMessages.push(payload);
    }
  });
  const base = await listen(server);

  try {
    const invalid = await fetch(`${base}/api/contact`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Harsh",
        email: "not-an-email",
        subject: "Question",
        message: "This is a long enough message."
      })
    });
    assert.equal(invalid.status, 400);
    assert.match((await invalid.json()).error, /valid reply email/);

    const honeypot = await fetch(`${base}/api/contact`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Harsh",
        email: "harsh@example.com",
        subject: "Question",
        message: "This is a long enough message.",
        website: "bot"
      })
    });
    assert.equal(honeypot.status, 400);

    const success = await fetch(`${base}/api/contact`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Harsh",
        email: "harsh@example.com",
        subject: "Setup help",
        message: "I need help setting up the helper."
      })
    });
    const payload = await success.json();

    assert.equal(success.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(sentMessages.length, 1);
    assert.deepEqual(sentMessages[0], {
      name: "Harsh",
      email: "harsh@example.com",
      subject: "Setup help",
      message: "I need help setting up the helper."
    });
  } finally {
    await close(server);
  }
});

test("contact API reports missing SMTP configuration when no mailer is injected", async () => {
  const server = createAppServer();
  const base = await listen(server);

  try {
    const response = await fetch(`${base}/api/contact`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Harsh",
        email: "harsh@example.com",
        subject: "Setup help",
        message: "I need help setting up the helper."
      })
    });
    const payload = await response.json();

    assert.equal(response.status, 503);
    assert.match(payload.error, /Contact email is not configured|Email dependency is not installed/);
  } finally {
    await close(server);
  }
});

test("dashboard title and filtered SKIP rows match current UI rules", () => {
  const index = fs.readFileSync(path.resolve(__dirname, "../src/public/index.html"), "utf8");
  const appSource = fs.readFileSync(path.resolve(__dirname, "../src/public/app.js"), "utf8");
  const css = fs.readFileSync(path.resolve(__dirname, "../src/public/styles.css"), "utf8");

  assert.match(index, /<title>Wheel Strategy Screener<\/title>/);
  assert.match(index, /<h1>Wheel Strategy Screener<\/h1>/);
  assert.match(index, /class="title-block"/);
  assert.match(index, /class="title-subtitle">End of Week<\/p>/);
  assert.match(index, /class="connection-subtitle-row"/);
  assert.match(index, /id="connectionSubtitle"[\s\S]*?Need setup help\?/);
  assert.match(index, /connection-disclosure/);
  assert.match(
    index,
    /<p>The Chrome helper runs locally in your browser\. It reads screener symbols, stock positions, and option-chain quotes only\.<\/p>/
  );
  assert.match(
    index,
    /<p>Robinhood passwords, MFA codes, and cookies are not sent to this site\.<\/p>/
  );
  const disclosureBlock = index.match(/<div class="disclosure connection-disclosure">([\s\S]*?)<\/div>/)?.[1] ?? "";
  assert.doesNotMatch(disclosureBlock, /Need setup help/);
  assert.match(css, /\.title-block\s*\{/);
  assert.match(css, /\.title-subtitle\s*\{/);
  assert.match(css, /--surface-glass:/);
  assert.match(css, /\.topbar\s*\{[\s\S]*?background:\s*var\(--surface-glass\)/);
  assert.doesNotMatch(css, /backdrop-filter/);
  assert.match(css, /button,\s*input,\s*select,\s*textarea/);
  assert.match(css, /\.connection-subtitle-row\s*\{/);
  assert.match(css, /\.session-pill\.missing\s*\{[\s\S]*?background:\s*#fff7d8/);
  assert.match(css, /\.connection-disclosure\s*\{/);
  assert.match(index, /href="\/favicon\.ico\?v=0\.2\.6"/);
  assert.match(index, /href="\/favicon-32\.png\?v=0\.2\.6"/);
  assert.doesNotMatch(index, /class="brand-logo"/);
  assert.match(index, /Install the Chrome helper to scan Robinhood screeners, positions, and option chains\./);
  assert.match(index, /reads screener symbols, stock positions, and option-chain quotes only/);
  assert.match(appSource, /Helper ready\. Open Robinhood in Chrome, log in there, then scan\./);
  assert.match(appSource, /Install the Chrome helper to scan Robinhood screeners, positions, and option chains\./);
  assert.match(appSource, /rowStatus\(row\) === "skip"/);
});

test("dashboard first-visit walkthrough uses versioned local storage dismissal", () => {
  const index = fs.readFileSync(path.resolve(__dirname, "../src/public/index.html"), "utf8");
  const appSource = fs.readFileSync(path.resolve(__dirname, "../src/public/app.js"), "utf8");

  assert.match(index, /id="onboardingDialog"/);
  assert.match(index, /Set up CSPs and covered calls/);
  assert.match(index, /Install the Chrome helper/);
  assert.match(index, /Set up your strategy/);
  assert.match(index, /Use Manual or Auto strategy sources/);
  assert.match(index, /type manual CSP symbols/);
  assert.match(index, /import positions from Robinhood/);
  assert.match(index, /Choose CSP or CC, select Mock or Robinhood, and click Scan/);
  assert.match(index, /View Setup Guide/);
  assert.match(index, /Start with Mock Mode/);
  assert.match(appSource, /wheel-screener-onboarding-v2/);
  assert.match(appSource, /window\.localStorage\.getItem/);
  assert.match(appSource, /window\.localStorage\.setItem/);
});

test("dashboard manages custom CSP screeners and settings presets locally", () => {
  const index = fs.readFileSync(path.resolve(__dirname, "../src/public/index.html"), "utf8");
  const appSource = fs.readFileSync(path.resolve(__dirname, "../src/public/app.js"), "utf8");
  const serverSource = fs.readFileSync(path.resolve(__dirname, "../src/server.js"), "utf8");
  const readme = fs.readFileSync(path.resolve(__dirname, "../README.md"), "utf8");
  const guide = fs.readFileSync(path.resolve(__dirname, "../src/public/guide.html"), "utf8");

  assert.match(index, /id="screenerSelect"/);
  assert.match(index, /id="manageScreenersButton"/);
  assert.match(index, /id="screenersDialog"/);
  assert.match(index, /id="settingsButton"/);
  assert.match(index, /id="settingsDialog"/);
  assert.match(index, /Export Settings/);
  assert.match(index, /Import Settings/);
  assert.match(appSource, /const CSP_SCREENERS_STORAGE_KEY = "wheel-screener-csp-screeners-v2"/);
  assert.match(appSource, /STARTER_SCREENER_NAMES/);
  assert.match(appSource, /Wheel Strategy 1/);
  assert.match(appSource, /Wheel Strategy 2/);
  assert.match(appSource, /Wheel Strategy 3/);
  assert.match(appSource, /function loadCspScreenersFromStorage/);
  assert.match(appSource, /function saveCspScreenersToStorage/);
  assert.match(appSource, /function renderScreenerSelect/);
  assert.match(appSource, /function renderScreenerManager/);
  assert.match(appSource, /screenerName: screener\?\.name/);
  assert.match(appSource, /const SETTINGS_EXPORT_APP = "wheel-strategy-screener"/);
  assert.match(appSource, /function buildSettingsExport/);
  assert.match(appSource, /function parseImportedSettings/);
  assert.match(appSource, /function applyImportedSettings/);
  assert.match(appSource, /clearScanResults\(\)/);
  assert.match(appSource, /cspScreeners: state\.screeners\.map/);
  assert.match(appSource, /selectedCspScreenerId: state\.screenerId/);
  assert.match(appSource, /cspInputMode: state\.cspInputMode/);
  assert.match(appSource, /ccInputMode: state\.ccInputMode/);
  assert.doesNotMatch(appSource.match(/function buildSettingsExport\(\)[\s\S]*?\n\}/)?.[0] || "", /manualCspSymbols|ccPositions|autoCcPositions|lastResult|OptionQuotes|session/);
  assert.match(guide, /Create and save your Robinhood screeners/);
  assert.match(guide, /Screener &rarr; Manage/);
  assert.match(guide, /starter examples only/);
  assert.match(guide, /not saved globally on the website/);
  assert.match(guide, /Export and import settings/);
  assert.match(readme, /CSP screener name management/);
  assert.match(readme, /not globally on the website/);
  assert.match(readme, /Settings button exports\/imports strategy settings only/);
  assert.match(readme, /Multiple rows may use the same ticker/);
  assert.match(readme, /Sell Call option chain once/);
  assert.doesNotMatch(serverSource, /CSP_SCREENERS_STORAGE_KEY|CC_POSITIONS_STORAGE_KEY|localStorage/);
  assert.doesNotMatch(serverSource, /writeFile|appendFile|createWriteStream/);
});

test("dashboard exposes CSP and CC source modes", () => {
  const index = fs.readFileSync(path.resolve(__dirname, "../src/public/index.html"), "utf8");
  const appSource = fs.readFileSync(path.resolve(__dirname, "../src/public/app.js"), "utf8");

  assert.match(index, /id="cspInputModes"/);
  assert.match(index, /data-csp-input-mode="manual"/);
  assert.match(index, /data-csp-input-mode="auto"/);
  assert.match(index, /id="manualCspListActions"/);
  assert.match(index, /data-csp-add-entry/);
  assert.match(index, /id="ccInputModes"/);
  assert.match(index, /data-cc-input-mode="manual"/);
  assert.match(index, /data-cc-input-mode="auto"/);
  assert.match(index, />\s*Manual\s*<\/button>/);
  assert.match(index, />\s*Auto\s*<\/button>/);
  assert.doesNotMatch(index, /<span>CSP source<\/span>|<span>CC source<\/span>/);
  assert.match(index, /id="showAllToggle" type="checkbox"/);
  assert.doesNotMatch(index, /id="showAllToggle" type="checkbox" checked/);
  assert.match(index, /Hide unavailable and ineligible rows/);
  const controlBandMarkup = index.match(/<section class="control-band"[\s\S]*?<\/section>/)?.[0] || "";
  const tableHeaderMarkup = index.match(/<div class="table-header">[\s\S]*?<div class="table-wrap">/)?.[0] || "";
  assert.doesNotMatch(controlBandMarkup, /id="cspInputModes"|id="ccInputModes"/);
  assert.match(tableHeaderMarkup, /id="cspInputModes"/);
  assert.match(tableHeaderMarkup, /id="ccInputModes"/);
  assert.doesNotMatch(tableHeaderMarkup, />\s*CSP source\s*</);
  assert.doesNotMatch(tableHeaderMarkup, />\s*CC source\s*</);
  assert.match(appSource, /function bindInputSourceModes/);
  assert.match(appSource, /function bindManualCspList/);
  assert.match(appSource, /manualCspSymbolsForScan/);
  assert.match(appSource, /const MANUAL_CSP_TABLE_LABELS = CSP_TABLE_LABELS\.slice\(1\)/);
  assert.match(appSource, /manual-csp-symbol-header/);
  assert.match(appSource, /data-csp-remove="\$\{index\}"/);
  assert.match(appSource, /data-label="\$\{MANUAL_CSP_TABLE_LABELS\[0\]\}"/);
  assert.doesNotMatch(
    appSource.match(/function renderManualCspRows\(result\) \{[\s\S]*?\n\}/)?.[0] || "",
    /row\?\.rank|(?<!MANUAL_)CSP_TABLE_LABELS\[0\]/
  );
  assert.match(appSource, /cspInputMode: "manual"/);
  assert.match(appSource, /ccInputMode: "manual"/);
  assert.match(appSource, /function normalizeCspInputMode/);
  assert.match(appSource, /mode === "auto" \|\| mode === "screener" \|\| mode === "robinhood"/);
  assert.match(appSource, /source: isCspAutoMode\(\) \? "robinhood" : "manual-symbols"/);
  assert.match(appSource, /source: isCcAutoMode\(\) \? "robinhood-positions"/);
  assert.match(appSource, /state\.hideUnavailable && isCspAutoMode\(\)/);
  assert.match(appSource, /hideUnavailableControl\.hidden = !isActiveAutoMode\(\)/);
});

test("dashboard control and manual CSP layouts keep desktop content visible", () => {
  const css = fs.readFileSync(path.resolve(__dirname, "../src/public/styles.css"), "utf8");
  const appSource = fs.readFileSync(path.resolve(__dirname, "../src/public/app.js"), "utf8");

  assert.match(css, /grid-template-columns:\s*minmax\(156px,\s*184px\)[\s\S]*?minmax\(320px,\s*356px\)[\s\S]*?minmax\(132px,\s*142px\)/);
  assert.match(css, /\.screener-select-row\s*\{[\s\S]*?grid-template-columns:\s*minmax\(190px,\s*1fr\) auto/);
  assert.match(css, /body\[data-strategy="csp"\]\s+#exportButton\s*\{[\s\S]*?grid-column:\s*7/);
  assert.match(css, /body\[data-strategy="csp"\]\[data-csp-input-mode="manual"\]\s+\.source-control\s*\{[\s\S]*?grid-column:\s*4/);
  assert.match(css, /body\[data-strategy="csp"\]\[data-csp-input-mode="manual"\]\s+#exportButton\s*\{[\s\S]*?grid-column:\s*6/);
  assert.match(css, /body\[data-strategy="cc"\]\s+\.source-control\s*\{[\s\S]*?grid-column:\s*3/);
  assert.match(css, /body\[data-strategy="cc"\]\s+#runButton\s*\{[\s\S]*?grid-column:\s*4/);
  assert.match(css, /body\[data-strategy="cc"\]\s+#exportButton\s*\{[\s\S]*?grid-column:\s*5/);
  assert.match(css, /\.table-header\s*\{[\s\S]*?grid-template-columns:\s*minmax\(220px,\s*1fr\) minmax\(260px,\s*420px\)/);
  assert.match(css, /\.table-source-toolbar\s*\{[\s\S]*?justify-self:\s*end/);
  assert.match(css, /\.table-source-toolbar\s*\{[\s\S]*?width:\s*min\(340px,\s*100%\)/);
  assert.match(css, /\.table-header \.check-control\s*\{[\s\S]*?justify-self:\s*end/);
  assert.match(css, /@media \(max-width: 820px\)[\s\S]*?\.table-header\s*\{[\s\S]*?grid-template-columns:\s*1fr/);
  assert.doesNotMatch(css, /@media \(max-width: 1450px\)\s*\{[\s\S]*?\.control-band\s*\{[\s\S]*?grid-template-columns:\s*minmax\(160px,\s*1fr\) minmax\(220px,\s*1fr\)/);
  assert.match(css, /@media \(max-width: 1400px\)/);
  assert.match(css, /body\[data-strategy="csp"\]\[data-csp-input-mode="auto"\]\s+\.control-band/);
  assert.match(css, /@media \(max-width: 1180px\)/);
  assert.match(css, /@media \(max-width: 980px\)/);
  assert.match(css, /\.site-footer\s*\{[\s\S]*?margin:\s*132px calc\(50% - 50vw\) -52px/);
  assert.match(css, /\.segment\s*\{[\s\S]*?min-width:\s*0/);
  assert.match(css, /\.segment\s*\{[\s\S]*?white-space:\s*nowrap/);
  assert.match(css, /body\[data-strategy="csp"\]\[data-csp-input-mode="manual"\]\s+th:nth-child\(1\)/);
  assert.match(css, /\.manual-symbol-cell\s*\{[\s\S]*?grid-template-columns:\s*28px minmax\(8ch,\s*12ch\)/);
  assert.match(css, /\.manual-csp-symbol-input\s*\{[\s\S]*?width:\s*12ch/);
  assert.match(css, /body\[data-strategy="csp"\]\[data-csp-input-mode="manual"\]\s+th:nth-child\(n \+ 3\)/);
  assert.match(css, /@media \(max-width: 820px\)[\s\S]*?\.manual-symbol-cell\s*\{[\s\S]*?grid-template-columns:\s*28px minmax\(0,\s*1fr\)/);
  assert.match(css, /\.empty-row \.empty-cell\s*\{[\s\S]*?text-align:\s*center !important/);
  assert.doesNotMatch(appSource, /Click Scan to import Robinhood stock positions/);
  assert.match(appSource, /<tr class="empty-row"><td colspan="12" class="empty-cell">No scan has run yet\.<\/td><\/tr>/);
  assert.match(appSource, /isCcAutoMode\(\)[\s\S]*?\? "Click Scan to populate the table\."/);
  assert.match(appSource, /Robinhood Screener imports symbols from your selected Robinhood screener during Scan\./);
  assert.match(appSource, /Robinhood Positions imports stock lots from your open Robinhood account page during Scan\./);
});

test("custom CSP screeners use standard mock symbols when they are not starter defaults", async () => {
  const result = await analyzeScreener({
    screenerId: "custom-breakout",
    screenerName: "My Breakout Screener",
    mode: "mock",
    portfolioValue: 10000,
    optionQuotesBySymbol: {
      TMC: [{ strike: 5, bid: 0.2 }]
    },
    forecastFetcher: async (symbol) => ({
      symbol,
      status: "ok",
      currentPrice: 5,
      minTarget: symbol === "TMC" ? 6 : 4,
      averageTarget: 8,
      maxTarget: 10,
      eligible: symbol === "TMC"
    })
  });

  assert.equal(result.screener.name, "My Breakout Screener");
  assert.ok(result.symbols.includes("TMC"));
});

test("dashboard persists manual rows in local storage only", () => {
  const appSource = fs.readFileSync(path.resolve(__dirname, "../src/public/app.js"), "utf8");
  const guide = fs.readFileSync(path.resolve(__dirname, "../src/public/guide.html"), "utf8");
  const readme = fs.readFileSync(path.resolve(__dirname, "../README.md"), "utf8");
  const localStorageLines = appSource
    .split("\n")
    .filter((line) => line.includes("localStorage"))
    .join("\n");

  assert.match(appSource, /const CC_POSITIONS_STORAGE_KEY = "wheel-screener-cc-positions-v1"/);
  assert.match(appSource, /const MANUAL_CSP_SYMBOLS_STORAGE_KEY = "wheel-screener-manual-csp-symbols-v1"/);
  assert.match(appSource, /function storedCcPosition/);
  assert.match(appSource, /function normalizeStoredCcPositions/);
  assert.match(appSource, /function loadCcPositionsFromStorage/);
  assert.match(appSource, /function saveCcPositionsToStorage/);
  assert.match(appSource, /function loadManualCspSymbolsFromStorage/);
  assert.match(appSource, /function saveManualCspSymbolsToStorage/);
  assert.match(appSource, /window\.localStorage\.getItem\(CC_POSITIONS_STORAGE_KEY\)/);
  assert.match(appSource, /window\.localStorage\.setItem\(\s*CC_POSITIONS_STORAGE_KEY/);
  assert.match(appSource, /window\.localStorage\.getItem\(MANUAL_CSP_SYMBOLS_STORAGE_KEY\)/);
  assert.match(appSource, /window\.localStorage\.setItem\(\s*MANUAL_CSP_SYMBOLS_STORAGE_KEY/);
  assert.match(appSource, /loadCcPositionsFromStorage\(\);/);
  assert.match(appSource, /loadManualCspSymbolsFromStorage\(\);/);
  assert.match(appSource, /saveCcPositionsToStorage\(\);/);
  assert.match(appSource, /symbol: normalizeCcSymbol\(position\?\.symbol\)/);
  assert.match(appSource, /averageCost: String\(position\?\.averageCost \?\? ""\)/);
  assert.match(appSource, /contracts: String\(position\?\.contracts \?\? ""\)/);
  assert.match(appSource, /hasUsableRow/);
  assert.doesNotMatch(localStorageLines, /lastResult|lastCcResult|OptionQuotes|Diagnostics|session/);
  assert.match(guide, /Manual CC entries are saved locally in this browser/);
  assert.match(readme, /Covered-call rows and manual CSP symbols are saved locally in the browser/);
});

test("dashboard run button switches between first scan and refresh states", () => {
  const index = fs.readFileSync(path.resolve(__dirname, "../src/public/index.html"), "utf8");
  const appSource = fs.readFileSync(path.resolve(__dirname, "../src/public/app.js"), "utf8");
  const css = fs.readFileSync(path.resolve(__dirname, "../src/public/styles.css"), "utf8");
  const scanningHelper = appSource.match(/function setRunButtonScanning\(\) \{[\s\S]*?\n\}/)?.[0] || "";

  assert.match(index, /id="runButton"[^>]*run-scan[^>]*>\s*Scan\s*<\/button>/);
  assert.match(appSource, /function hasScannedStrategy/);
  assert.match(appSource, /function runActionLabel/);
  assert.match(appSource, /function updateRunButtonState/);
  assert.match(appSource, /return strategy === "cc" \? Boolean\(state\.lastCcResult\) : Boolean\(state\.lastResult\)/);
  assert.match(appSource, /elements\.runButton\.textContent = isRefresh \? "Refresh" : "Scan"/);
  assert.match(appSource, /classList\.toggle\("run-refresh", isRefresh\)/);
  assert.match(appSource, /classList\.toggle\("run-scan", !isRefresh\)/);
  assert.match(appSource, /function setRunButtonScanning/);
  assert.match(scanningHelper, /elements\.runButton\.disabled = true/);
  assert.match(scanningHelper, /elements\.runButton\.textContent = "Scanning\.\.\."/);
  assert.doesNotMatch(scanningHelper, /setRunButtonScanning\(\);/);
  assert.match(css, /#runButton\.run-scan/);
  assert.match(css, /#runButton\.run-refresh/);
  assert.match(css, /#runButton\.run-scan,\s*#runButton\.run-refresh\s*\{[\s\S]*?background:\s*#07110d;[\s\S]*?color:\s*#ffffff;/);
  assert.match(css, /#runButton\.run-busy/);
});

test("helper install instructions match manifest version", () => {
  const helper = fs.readFileSync(path.resolve(__dirname, "../src/public/helper.html"), "utf8");
  const readme = fs.readFileSync(path.resolve(__dirname, "../README.md"), "utf8");

  assert.match(helper, /0\.2\.6/);
  assert.doesNotMatch(helper, /0\.1\.9/);
  assert.match(readme, /0\.2\.6/);
  assert.doesNotMatch(readme, /0\.1\.9/);
});

test("public docs describe the current extension workflow", () => {
  const docs = [
    fs.readFileSync(path.resolve(__dirname, "../src/public/guide.html"), "utf8"),
    fs.readFileSync(path.resolve(__dirname, "../src/public/helper.html"), "utf8"),
    fs.readFileSync(path.resolve(__dirname, "../src/public/index.html"), "utf8"),
    fs.readFileSync(path.resolve(__dirname, "../README.md"), "utf8")
  ].join("\n");

  assert.match(docs, /Chrome helper/);
  assert.match(docs, /custom CSP screeners/);
  assert.match(docs, /covered-call rows/);
  assert.match(docs, /TradingView/);
  assert.match(docs, /Sell Put/);
  assert.match(docs, /Sell Call/);
  assert.match(docs, /option-chain quotes/);
  assert.match(docs, /bid \/ strike/);
  assert.match(docs, /locally in your browser/);
});

test("guide and README explain Scan before Refresh", () => {
  const guide = fs.readFileSync(path.resolve(__dirname, "../src/public/guide.html"), "utf8");
  const readme = fs.readFileSync(path.resolve(__dirname, "../README.md"), "utf8");

  assert.match(guide, /main action button says <strong>Scan<\/strong> before a strategy has data/);
  assert.match(guide, /changes to <strong>Refresh<\/strong>/);
  assert.match(readme, /Choose `Robinhood` as the source and click `Scan`/);
  assert.match(readme, /same button becomes `Refresh`/);
  assert.match(readme, /`Scan` is the first data collection/);
});

test("live scan requires Chrome helper symbols", async () => {
  const server = createAppServer();
  const base = await listen(server);

  try {
    const response = await fetch(`${base}/api/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "live",
        screenerId: "standard",
        portfolioValue: 10000
      })
    });
    const payload = await response.json();

    assert.equal(response.status, 422);
    assert.match(payload.error, /No stock symbols were found/);
  } finally {
    await close(server);
  }
});

test("live scan accepts Chrome extension provided Robinhood symbols", async () => {
  const server = createAppServer({
    forecastFetcher: async (symbol) => ({
      symbol,
      status: "ok",
      currentPrice: 10,
      minTarget: 12,
      averageTarget: 13,
      maxTarget: 20,
      eligible: true
    })
  });
  const base = await listen(server);

  try {
    const run = await fetch(`${base}/api/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "live",
        screenerId: "safe",
        portfolioValue: 10000,
        symbols: ["ONDS", "RGTI"],
        source: "robinhood",
        optionQuotesBySymbol: {
          ONDS: [{ strike: 9, bid: 0.2 }],
          RGTI: [{ strike: 9, bid: 0.2 }]
        }
      })
    }).then((response) => response.json());

    assert.equal(run.mode, "live");
    assert.equal(run.source, "robinhood");
    assert.deepEqual(run.symbols, ["ONDS", "RGTI"]);
    assert.equal(run.eligibleCount, 2);
  } finally {
    await close(server);
  }
});

test("manual CSP symbols ignore blank rows and continue later symbols", async () => {
  const server = createAppServer({
    forecastFetcher: async (symbol) => ({
      symbol,
      status: "ok",
      currentPrice: 10,
      minTarget: symbol === "BBB" ? 13 : 12,
      averageTarget: 14,
      maxTarget: 16,
      eligible: true
    })
  });
  const base = await listen(server);

  try {
    const forecast = await fetch(`${base}/api/forecast`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "live",
        portfolioValue: 10000,
        symbols: ["AAA", "", "   ", "BBB"],
        source: "manual-symbols"
      })
    }).then((response) => response.json());

    assert.equal(forecast.source, "manual-symbols");
    assert.deepEqual(forecast.symbols, ["AAA", "BBB"]);
    assert.deepEqual(
      forecast.rows.map((row) => [row.order, row.symbol]),
      [
        [1, "AAA"],
        [2, "BBB"]
      ]
    );
  } finally {
    await close(server);
  }
});

test("staged live scan forecasts first and finalizes with option quotes", async () => {
  const server = createAppServer({
    forecastFetcher: async (symbol) => ({
      symbol,
      status: "ok",
      currentPrice: symbol === "AAA" ? 10 : 20,
      minTarget: symbol === "AAA" ? 12 : 19,
      averageTarget: 13,
      maxTarget: 20,
      eligible: symbol === "AAA"
    })
  });
  const base = await listen(server);

  try {
    const forecast = await fetch(`${base}/api/forecast`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "live",
        screenerId: "safe",
        portfolioValue: 10000,
        symbols: ["AAA", "BBB"],
        source: "robinhood"
      })
    }).then((response) => response.json());

    assert.deepEqual(forecast.optionRequests, [{ symbol: "AAA", currentPrice: 10 }]);

    const finalized = await fetch(`${base}/api/finalize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        portfolioValue: 10000,
        result: forecast,
        optionQuotesBySymbol: {
          AAA: [{ strike: 9, bid: 0.2 }]
        }
      })
    }).then((response) => response.json());

    assert.equal(finalized.eligibleCount, 1);
    assert.equal(finalized.rows[0].cspStrike, 9);
    assert.equal(finalized.rows[0].cspBid, 0.2);
    assert.equal(finalized.rows[1].status, "ok");
    assert.equal(finalized.rows[1].eligible, false);
  } finally {
    await close(server);
  }
});

test("covered-call API finalizes manual rows with cached call quotes", async () => {
  const server = createAppServer({
    forecastFetcher: async (symbol) => ({
      symbol,
      status: "ok",
      currentPrice: symbol === "AAA" ? 15 : 20,
      minTarget: 10,
      averageTarget: 14,
      maxTarget: 25,
      eligible: true,
      url: `https://www.tradingview.com/symbols/${symbol}/forecast/`
    })
  });
  const base = await listen(server);

  try {
    const forecast = await fetch(`${base}/api/covered-calls/forecast`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "live",
        positions: [
          { symbol: "AAA", averageCost: 12, contracts: 2 },
          { symbol: "BBB", averageCost: 22, contracts: 1 }
        ]
      })
    }).then((response) => response.json());

    assert.equal(forecast.strategy, "cc");
    assert.equal(forecast.optionRequests.length, 2);
    assert.equal(forecast.optionRequests[0].symbol, "AAA");

    const finalized = await fetch(`${base}/api/covered-calls/finalize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        result: forecast,
        minCspReturnDecimal: 0.02,
        optionQuotesBySymbol: {
          AAA: [
            { strike: 16, bid: 0.3 },
            { strike: 18, bid: 0.4 }
          ],
          BBB: [
            { strike: 22, bid: 0.5 },
            { strike: 23, bid: 0.1 }
          ]
        }
      })
    }).then((response) => response.json());

    assert.equal(finalized.eligibleCount, 2);
    assert.equal(finalized.rows[0].ccStrike, 18);
    assert.equal(finalized.rows[0].ccBid, 0.4);
    assert.equal(finalized.rows[0].totalReturnDollars, ((18 - 12) + 0.4) * 100 * 2);
    assert.equal(finalized.rows[1].ccStrike, 23);
    assert.equal(finalized.rows[1].ccUsedFallback, true);
  } finally {
    await close(server);
  }
});

test("covered-call Robinhood positions floor shares and skip under-100-share option reads", async () => {
  const server = createAppServer({
    forecastFetcher: async (symbol) => ({
      symbol,
      status: "ok",
      currentPrice: 15,
      minTarget: 16,
      averageTarget: 20,
      maxTarget: 25,
      eligible: true
    })
  });
  const base = await listen(server);

  try {
    const forecast = await fetch(`${base}/api/covered-calls/forecast`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "live",
        source: "robinhood-positions",
        positions: [
          {
            accountName: "Individual",
            symbol: "AAA",
            shares: 250,
            averageCost: 12,
            contracts: Math.floor(250 / 100),
            coveredCallUsable: true
          },
          {
            accountName: "IRA",
            symbol: "BBB",
            shares: 80,
            averageCost: 9,
            contracts: Math.floor(80 / 100),
            coveredCallUsable: false
          }
        ]
      })
    }).then((response) => response.json());

    assert.equal(forecast.source, "robinhood-positions");
    assert.equal(forecast.rows.length, 2);
    assert.equal(forecast.rows[0].contracts, 2);
    assert.equal(forecast.rows[1].contracts, 0);
    assert.equal(forecast.rows[1].status, "unavailable");
    assert.match(forecast.rows[1].error, /At least 100 shares/);
    assert.deepEqual(forecast.optionRequests, [
      {
        symbol: "AAA",
        currentPrice: 15,
        averageCost: 12
      }
    ]);
  } finally {
    await close(server);
  }
});

test("covered-call API dedupes option requests while preserving duplicate rows", async () => {
  const server = createAppServer({
    forecastFetcher: async (symbol) => ({
      symbol,
      status: "ok",
      currentPrice: 15,
      minTarget: 10,
      averageTarget: 14,
      maxTarget: 25,
      eligible: true
    })
  });
  const base = await listen(server);

  try {
    const forecast = await fetch(`${base}/api/covered-calls/forecast`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "live",
        positions: [
          { symbol: "ONDS", averageCost: 12, contracts: 2 },
          { symbol: "onds", averageCost: 14, contracts: 1 }
        ]
      })
    }).then((response) => response.json());

    assert.equal(forecast.rows.length, 2);
    assert.deepEqual(forecast.optionRequests, [
      {
        symbol: "ONDS",
        currentPrice: 15,
        averageCost: 12
      }
    ]);

    const finalized = await fetch(`${base}/api/covered-calls/finalize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        result: forecast,
        minCspReturnDecimal: 0.02,
        optionQuotesBySymbol: {
          ONDS: [
            { strike: 16, bid: 0.3 },
            { strike: 18, bid: 0.4 }
          ]
        }
      })
    }).then((response) => response.json());

    assert.equal(finalized.rows.length, 2);
    assert.equal(finalized.rows[0].ccStrike, 18);
    assert.equal(finalized.rows[1].ccStrike, 18);
    assert.equal(finalized.rows[0].totalReturnDollars, ((18 - 12) + 0.4) * 100 * 2);
    assert.equal(finalized.rows[1].totalReturnDollars, ((18 - 14) + 0.4) * 100);
  } finally {
    await close(server);
  }
});

test("covered-call API requests options when forecast targets are unavailable", async () => {
  const server = createAppServer({
    forecastFetcher: async (symbol) => ({
      symbol,
      status: "unavailable",
      currentPrice: null,
      minTarget: null,
      averageTarget: null,
      maxTarget: null,
      eligible: false,
      error: "No TradingView forecast data found."
    }),
    currentPriceFetcher: async (symbol) => ({
      symbol,
      currentPrice: 2.4,
      exchange: "NASDAQ",
      url: `https://www.tradingview.com/symbols/NASDAQ-${symbol}/`
    })
  });
  const base = await listen(server);

  try {
    const forecast = await fetch(`${base}/api/covered-calls/forecast`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "live",
        positions: [{ symbol: "RR", averageCost: 3.81, contracts: 33 }]
      })
    }).then((response) => response.json());

    assert.equal(forecast.rows[0].symbol, "RR");
    assert.equal(forecast.rows[0].currentPrice, 2.4);
    assert.equal(forecast.rows[0].minTarget, null);
    assert.equal(forecast.rows[0].warning, "TradingView analyst targets were unavailable; using current price only.");
    assert.deepEqual(forecast.optionRequests, [
      {
        symbol: "RR",
        currentPrice: 2.4,
        averageCost: 3.81
      }
    ]);
  } finally {
    await close(server);
  }
});

test("finalization marks TradingView eligible rows as SKIP without a qualifying put", async () => {
  const server = createAppServer({
    forecastFetcher: async (symbol) => ({
      symbol,
      status: "ok",
      currentPrice: 10,
      minTarget: 12,
      averageTarget: 13,
      maxTarget: 20,
      eligible: true
    })
  });
  const base = await listen(server);

  try {
    const forecast = await fetch(`${base}/api/forecast`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "live",
        screenerId: "safe",
        portfolioValue: 10000,
        symbols: ["AAA"],
        source: "robinhood"
      })
    }).then((response) => response.json());

    const finalized = await fetch(`${base}/api/finalize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        portfolioValue: 10000,
        result: forecast,
        optionQuotesBySymbol: {
          AAA: [{ strike: 9, bid: 0.1 }]
        }
      })
    }).then((response) => response.json());

    assert.equal(finalized.eligibleCount, 0);
    assert.equal(finalized.rows[0].status, "skip");
    assert.equal(finalized.rows[0].rank, null);
  } finally {
    await close(server);
  }
});

test("CSP current-only TradingView rows are unavailable and do not request put quotes", async () => {
  const server = createAppServer({
    forecastFetcher: async (symbol) => ({
      symbol,
      status: "missing-data",
      currentPrice: 12.34,
      minTarget: null,
      averageTarget: null,
      maxTarget: null,
      eligible: false,
      error: "TradingView analyst targets were unavailable for this symbol."
    })
  });
  const base = await listen(server);

  try {
    const forecast = await fetch(`${base}/api/forecast`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "live",
        portfolioValue: 10000,
        symbols: ["AAA"],
        source: "manual-symbols"
      })
    }).then((response) => response.json());

    assert.equal(forecast.rows[0].currentPrice, 12.34);
    assert.equal(forecast.rows[0].status, "missing-data");
    assert.deepEqual(forecast.optionRequests, []);

    const finalized = await fetch(`${base}/api/finalize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        portfolioValue: 10000,
        result: forecast,
        optionQuotesBySymbol: {
          AAA: [{ strike: 10, bid: 0.5 }]
        }
      })
    }).then((response) => response.json());

    assert.equal(finalized.rows[0].eligible, false);
    assert.equal(finalized.rows[0].contracts, null);
    assert.equal(finalized.rows[0].actualCollateralDollars, null);
  } finally {
    await close(server);
  }
});

test("finalization reuses full cached quote chains for changing return targets", async () => {
  const server = createAppServer({
    forecastFetcher: async (symbol) => ({
      symbol,
      status: "ok",
      currentPrice: 10,
      minTarget: 12,
      averageTarget: 13,
      maxTarget: 20,
      eligible: true
    })
  });
  const base = await listen(server);

  try {
    const forecast = await fetch(`${base}/api/forecast`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "live",
        screenerId: "safe",
        portfolioValue: 10000,
        symbols: ["AAA"],
        source: "robinhood"
      })
    }).then((response) => response.json());

    const optionQuotesBySymbol = {
      AAA: [
        { strike: 8, bid: 0.17 },
        { strike: 8.5, bid: 0.2 },
        { strike: 9, bid: 0.32 },
        { strike: 10.5, bid: 0.5 }
      ]
    };

    const twoPercent = await fetch(`${base}/api/finalize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        portfolioValue: 10000,
        result: forecast,
        minCspReturnPercent: 2,
        optionQuotesBySymbol
      })
    }).then((response) => response.json());

    const threePercent = await fetch(`${base}/api/finalize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        portfolioValue: 10000,
        result: forecast,
        minCspReturnPercent: 3,
        optionQuotesBySymbol
      })
    }).then((response) => response.json());

    const fourPercent = await fetch(`${base}/api/finalize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        portfolioValue: 10000,
        result: forecast,
        minCspReturnPercent: 4,
        optionQuotesBySymbol
      })
    }).then((response) => response.json());

    assert.equal(twoPercent.rows[0].cspStrike, 8);
    assert.equal(threePercent.rows[0].cspStrike, 9);
    assert.equal(fourPercent.rows[0].status, "skip");
  } finally {
    await close(server);
  }
});

test("empty Robinhood option quote reads are unavailable instead of SKIP", async () => {
  const server = createAppServer({
    forecastFetcher: async (symbol) => ({
      symbol,
      status: "ok",
      currentPrice: 10,
      minTarget: 12,
      averageTarget: 13,
      maxTarget: 20,
      eligible: true
    })
  });
  const base = await listen(server);

  try {
    const forecast = await fetch(`${base}/api/forecast`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "live",
        screenerId: "safe",
        portfolioValue: 10000,
        symbols: ["AAA"],
        source: "robinhood"
      })
    }).then((response) => response.json());

    const finalized = await fetch(`${base}/api/finalize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        portfolioValue: 10000,
        result: forecast,
        optionQuotesBySymbol: {
          AAA: []
        },
        optionDiagnosticsBySymbol: {
          AAA: {
            quotesFound: 0
          }
        }
      })
    }).then((response) => response.json());

    assert.equal(finalized.eligibleCount, 0);
    assert.equal(finalized.rows[0].status, "unavailable");
    assert.match(finalized.rows[0].error, /No readable Robinhood sell-put quotes/);
  } finally {
    await close(server);
  }
});

test("custom CSP return threshold flows through run and finalization", async () => {
  const server = createAppServer({
    forecastFetcher: async (symbol) => ({
      symbol,
      status: "ok",
      currentPrice: 10,
      minTarget: 12,
      averageTarget: 13,
      maxTarget: 20,
      eligible: true
    })
  });
  const base = await listen(server);

  try {
    const run = await fetch(`${base}/api/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "live",
        screenerId: "safe",
        portfolioValue: 10000,
        symbols: ["AAA"],
        source: "robinhood",
        minCspReturnDecimal: 0.03,
        optionQuotesBySymbol: {
          AAA: [{ strike: 9, bid: 0.2 }]
        }
      })
    }).then((response) => response.json());

    assert.equal(run.eligibleCount, 0);
    assert.equal(run.rows[0].status, "skip");
    assert.match(run.rows[0].error, /3% bid\/strike/);

    const forecast = await fetch(`${base}/api/forecast`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "live",
        screenerId: "safe",
        portfolioValue: 10000,
        symbols: ["AAA"],
        source: "robinhood"
      })
    }).then((response) => response.json());

    const finalized = await fetch(`${base}/api/finalize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        portfolioValue: 10000,
        result: forecast,
        minCspReturnPercent: 1.5,
        optionQuotesBySymbol: {
          AAA: [{ strike: 9, bid: 0.2 }]
        }
      })
    }).then((response) => response.json());

    assert.equal(finalized.eligibleCount, 1);
    assert.equal(finalized.minCspReturnPercent, 1.5);
    assert.equal(finalized.rows[0].cspStrike, 9);
  } finally {
    await close(server);
  }
});

test("covered call scan preserves blank rows before populated rows", async () => {
  const server = createAppServer({
    forecastFetcher: async (symbol) => ({
      symbol,
      status: "ok",
      currentPrice: 11.68,
      minTarget: 17.5,
      averageTarget: 17.5,
      maxTarget: 17.5,
      eligible: true
    })
  });
  const base = await listen(server);

  try {
    const forecast = await fetch(`${base}/api/covered-calls/forecast`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "live",
        positions: [
          { symbol: "", averageCost: "", contracts: "" },
          { symbol: "POET", averageCost: 12.24, contracts: 4 }
        ]
      })
    }).then((response) => response.json());

    assert.equal(forecast.rows.length, 1);
    assert.equal(forecast.rows[0].order, 2);
    assert.equal(forecast.rows[0].symbol, "POET");
    assert.deepEqual(forecast.optionRequests, [
      {
        symbol: "POET",
        currentPrice: 11.68,
        averageCost: 12.24
      }
    ]);

    const finalized = await fetch(`${base}/api/covered-calls/finalize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        result: forecast,
        minCspReturnDecimal: 0.02,
        optionQuotesBySymbol: {
          POET: [{ strike: 14, bid: 0.35 }]
        }
      })
    }).then((response) => response.json());

    assert.equal(finalized.rows[0].order, 2);
    assert.equal(finalized.rows[0].eligible, true);
    assert.equal(finalized.rows[0].ccStrike, 14);
  } finally {
    await close(server);
  }
});

test("covered call scan rejects rows with no symbols", async () => {
  const server = createAppServer();
  const base = await listen(server);

  try {
    const response = await fetch(`${base}/api/covered-calls/forecast`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "mock",
        positions: [{ symbol: "", averageCost: "", contracts: "" }]
      })
    });
    const payload = await response.json();

    assert.equal(response.status, 422);
    assert.match(payload.error, /Add at least one covered-call position/);
  } finally {
    await close(server);
  }
});

test("reallocate updates portfolio sizing without fetching forecasts", async () => {
  let forecastCalls = 0;
  const server = createAppServer({
    forecastFetcher: async (symbol) => {
      forecastCalls += 1;
      return {
        symbol,
        status: "ok",
        currentPrice: 10,
        minTarget: 12,
        averageTarget: 13,
        maxTarget: 20,
        eligible: true
      };
    }
  });
  const base = await listen(server);

  try {
    const run = await fetch(`${base}/api/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "live",
        screenerId: "safe",
        portfolioValue: 10000,
        symbols: ["AAA", "BBB"],
        source: "robinhood",
        optionQuotesBySymbol: {
          AAA: [{ strike: 9, bid: 0.2 }],
          BBB: [{ strike: 9, bid: 0.2 }]
        }
      })
    }).then((response) => response.json());
    const callsAfterRun = forecastCalls;

    const reallocated = await fetch(`${base}/api/reallocate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        portfolioValue: 20000,
        result: run
      })
    }).then((response) => response.json());

    assert.equal(forecastCalls, callsAfterRun);
    assert.equal(reallocated.generatedAt, run.generatedAt);
    assert.equal(reallocated.portfolioValue, 20000);
    assert.ok(reallocated.rows[0].allocationDollars > run.rows[0].allocationDollars);
    assert.ok(
      reallocated.rows.reduce(
        (sum, row) => sum + (Number.isFinite(row.actualCollateralDollars) ? row.actualCollateralDollars : 0),
        0
      ) <= 20000
    );
  } finally {
    await close(server);
  }
});

test("run refresh bypasses cached TradingView forecast data", async () => {
  const fetchOptions = [];
  const server = createAppServer({
    forecastFetcher: async (symbol, options = {}) => {
      fetchOptions.push(options);
      return {
        symbol,
        status: "ok",
        currentPrice: 10,
        minTarget: 12,
        averageTarget: 13,
        maxTarget: 20,
        eligible: true
      };
    }
  });
  const base = await listen(server);

  try {
    await fetch(`${base}/api/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "live",
        screenerId: "safe",
        portfolioValue: 10000,
        symbols: ["ONDS", "RGTI"],
        source: "robinhood",
        optionQuotesBySymbol: {
          ONDS: [{ strike: 9, bid: 0.2 }],
          RGTI: [{ strike: 9, bid: 0.2 }]
        }
      })
    }).then((response) => response.json());

    assert.deepEqual(
      fetchOptions.map((options) => options.bypassCache),
      [true, true]
    );
  } finally {
    await close(server);
  }
});

test("screener ids map to exact Robinhood list names", () => {
  assert.deepEqual(
    SCREENERS.map((screener) => [screener.id, screener.name]),
    [
      ["safe", "Wheel Strategy 1"],
      ["standard", "Wheel Strategy 2"],
      ["mini", "Wheel Strategy 3"]
    ]
  );
});

test("Chrome helper does not request debugger permission", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../extension/manifest.json"), "utf8")
  );

  assert.equal(manifest.version, "0.2.6");
  assert.ok(!manifest.permissions.includes("debugger"));
});

test("Chrome helper wires option quote extraction action", () => {
  const background = fs.readFileSync(path.resolve(__dirname, "../extension/background.js"), "utf8");
  const contentRobinhood = fs.readFileSync(
    path.resolve(__dirname, "../extension/content-robinhood.js"),
    "utf8"
  );
  const appSource = fs.readFileSync(path.resolve(__dirname, "../src/public/app.js"), "utf8");

  assert.match(background, /extractPutOptionQuotes/);
  assert.match(background, /extractCallOptionQuotes/);
  assert.match(background, /extractStockPositions/);
  assert.match(background, /account\/investing/);
  assert.match(contentRobinhood, /extractPutOptionQuotes/);
  assert.match(contentRobinhood, /extractCallOptionQuotes/);
  assert.match(contentRobinhood, /extractStockPositions/);
  assert.match(contentRobinhood, /accountOptionLabels/);
  assert.match(contentRobinhood, /parseShares/);
  assert.match(contentRobinhood, /parseAverageCost/);
  assert.match(contentRobinhood, /ensureOptionSide\(symbol, "sell"\)/);
  assert.match(contentRobinhood, /ensureOptionMode\(symbol, "sell", normalizedType\)/);
  assert.match(contentRobinhood, /optionType === "call"/);
  assert.match(background, /function uniqueOptionRequests/);
  assert.match(background, /const requests = uniqueOptionRequests\(payload\?\.requests\)/);
  assert.doesNotMatch(background, /const SCREENERS =/);
  assert.match(contentRobinhood, /addQuote\(quotesByKey/);
  assert.doesNotMatch(contentRobinhood, /minCspReturn/);
  assert.match(contentRobinhood, /Ask Price\|Bid Price/);
  assert.match(contentRobinhood, /OptionChainSelectRowButton/);
  assert.match(contentRobinhood, /addVisibleButtonQuotes\(quotesByKey\)/);
  assert.match(contentRobinhood, /diagnostics\.initialVisibleButtons = visibleOptionButtons\(\)\.length/);
  assert.match(contentRobinhood, /primaryOptionScrollTarget/);
  assert.match(contentRobinhood, /const initialScrollSnapshot = optionScrollSnapshot\(primaryTarget\)/);
  assert.match(contentRobinhood, /diagnostics\.reachedBottom/);
  assert.match(contentRobinhood, /optionButtonsIn\(element\)\.length > 0/);
  assert.match(contentRobinhood, /quote\.bid <= existing\.bid/);
  assert.match(background, /waitForOptionsUrl/);
  assert.doesNotMatch(background, /waitForTabComplete\(tab\.id, 30000\)/);
  assert.doesNotMatch(contentRobinhood, /collectOptionSweep\(quotesByKey, diagnostics, 1, 140/);
  assert.doesNotMatch(contentRobinhood, /parseOptionRowText/);
  assert.doesNotMatch(contentRobinhood, /optionRowAncestorForButton/);
  assert.doesNotMatch(contentRobinhood, /strikeFromOptionRow/);
  assert.doesNotMatch(contentRobinhood, /visibleOptionRowCandidates/);
  assert.match(appSource, /\/api\/forecast/);
  assert.match(appSource, /\/api\/finalize/);
  assert.match(appSource, /\/api\/covered-calls\/forecast/);
  assert.match(appSource, /\/api\/covered-calls\/finalize/);
  assert.match(appSource, /requestExtension\("extractStockPositions"/);
  assert.match(appSource, /Math\.floor\(shares \/ 100\)/);
});

test("guide documents both strategy workflows and return rules", () => {
  const guide = fs.readFileSync(path.resolve(__dirname, "../src/public/guide.html"), "utf8");

  assert.match(guide, /Cash-Secured Puts/);
  assert.match(guide, /Covered Calls/);
  assert.match(guide, /Manual<\/strong> mode to type symbols/);
  assert.match(guide, /switch to <strong>Auto<\/strong> and select a saved Robinhood screener/);
  assert.match(guide, /Switch to <strong>Auto<\/strong> to import visible stock positions/);
  assert.match(guide, /Hide unavailable and ineligible rows/);
  assert.match(guide, /Older settings files/);
  assert.match(guide, /floor\(shares \/ 100\)/);
  assert.match(guide, /Wheel Strategy 1/);
  assert.match(guide, /Wheel Strategy 3/);
  assert.match(guide, /Add Entry/);
  assert.match(guide, /red\s+<code>&times;<\/code>/);
  assert.match(guide, /Average Cost/);
  assert.match(guide, /Contracts/);
  assert.match(guide, /Total Return/);
  assert.match(guide, /Sell Put/);
  assert.match(guide, /Sell Call/);
  assert.match(guide, /bid \/ strike >= Weekly %/);
  assert.match(guide, /bid \/ baseline >= Weekly %/);
  assert.match(guide, /52 weeks/);
  assert.match(guide, /1% weekly/);
  assert.match(guide, /67\.77% yearly/);
  assert.match(guide, /2% weekly/);
  assert.match(guide, /104% yearly/);
  assert.match(guide, /Positions/);
  assert.match(guide, /Weekly Return/);
  assert.match(guide, /multiple covered-call rows for the same ticker/);
  assert.match(guide, /Sell Call chain once/);
  assert.match(guide, /Duplicate covered-call lots share the same raw quote read/);
  assert.match(guide, /button says <strong>Scan<\/strong> before a strategy has data/);
  assert.match(guide, /changes to <strong>Refresh<\/strong>/);
  assert.match(guide, /SKIP/);
  assert.match(guide, /Status/);
  assert.match(guide, /current-only data/);
  assert.match(guide, /Bid/);
  assert.match(guide, /Return/);
  assert.match(guide, /not a guaranteed fill/);
});

test("portfolio input is wired for reallocation without refresh", () => {
  const appSource = fs.readFileSync(path.resolve(__dirname, "../src/public/app.js"), "utf8");

  assert.match(appSource, /\/api\/reallocate/);
  assert.ok(
    appSource.includes(
      'elements.portfolioInput.addEventListener("input", schedulePortfolioReallocation)'
    )
  );
});

test("dashboard has linked return inputs and cached return-target finalization", () => {
  const index = fs.readFileSync(path.resolve(__dirname, "../src/public/index.html"), "utf8");
  const appSource = fs.readFileSync(path.resolve(__dirname, "../src/public/app.js"), "utf8");

  assert.match(index, /id="weeklyReturnInput"/);
  assert.match(index, /id="yearlyReturnInput"/);
  assert.doesNotMatch(index, />CSP return target</);
  assert.match(index, /role="group" aria-label="Option return target"/);
  assert.match(index, /id="weeklyReturnInput"[\s\S]*?value="1"[\s\S]*?autocomplete="off"/);
  assert.match(index, /value="67\.7689"/);
  assert.match(index, /id="yearlyReturnInput"[\s\S]*?value="67\.7689"[\s\S]*?autocomplete="off"/);
  assert.match(appSource, /const TRADING_WEEKS_PER_YEAR = 52/);
  assert.match(appSource, /const DEFAULT_CSP_WEEKLY_RETURN_PERCENT = 1/);
  assert.match(appSource, /const DEFAULT_CC_WEEKLY_RETURN_PERCENT = 2/);
  assert.match(appSource, /weeklyToYearlyPercent/);
  assert.match(appSource, /yearlyToWeeklyPercent/);
  assert.match(appSource, /ccWeeklyToYearlyPercent/);
  assert.match(appSource, /ccYearlyToWeeklyPercent/);
  assert.match(appSource, /activeWeeklyReturnPercent/);
  assert.match(appSource, /finalizeFromCachedScan/);
  assert.match(appSource, /minCspReturnDecimal: minCspReturnDecimal\(\)/);
  assert.match(appSource, /function commitReturnTargetFromInputs/);
  assert.match(appSource, /const selectedReturn = commitReturnTargetFromInputs\(\)/);
  assert.match(appSource, /positions: positionsForScan/);
  assert.match(appSource, /window\.addEventListener\("pageshow"/);
});

test("dashboard exposes covered-call strategy controls", () => {
  const index = fs.readFileSync(path.resolve(__dirname, "../src/public/index.html"), "utf8");
  const appSource = fs.readFileSync(path.resolve(__dirname, "../src/public/app.js"), "utf8");
  const css = fs.readFileSync(path.resolve(__dirname, "../src/public/styles.css"), "utf8");

  assert.match(index, /data-strategy="csp"/);
  assert.match(index, /data-strategy="cc"/);
  assert.match(index, /id="ccInputModes"/);
  assert.match(index, /data-cc-input-mode="manual"/);
  assert.match(index, /data-cc-input-mode="auto"/);
  assert.match(index, /id="eligibleMetricLabel"/);
  assert.doesNotMatch(index, /ccEditorSection/);
  assert.doesNotMatch(index, /Covered Call Positions/);
  assert.doesNotMatch(index, />\s*Add Row\s*</);
  assert.doesNotMatch(appSource, />\s*Remove\s*</);
  assert.match(appSource, /data-cc-field="symbol"/);
  assert.match(appSource, /data-cc-field="averageCost"/);
  assert.match(appSource, /data-cc-field="contracts"/);
  assert.match(appSource, /"Symbol",\s*"Status",\s*"Average Cost"/);
  assert.match(appSource, /data-label="\$\{CC_TABLE_LABELS\[1\]\}">[\s\S]*?<span class="status/);
  assert.match(appSource, /class="cc-remove-button"/);
  assert.match(appSource, /class="cc-remove-button"[\s\S]*?data-cc-field="symbol"/);
  assert.match(appSource, /cc-symbol-header/);
  assert.match(appSource, /cc-header-remove-spacer/);
  assert.match(appSource, /cc-header-label/);
  assert.match(appSource, />\s*&times;\s*<\/button>/);
  assert.match(index, /id="ccListActions"/);
  assert.match(index, /class="cc-list-actions cc-control"/);
  assert.match(index, /data-cc-add-entry/);
  assert.match(index, /Add Entry/);
  assert.doesNotMatch(appSource, /cc-add-entry-row/);
  assert.match(css, /\.cc-remove-button/);
  assert.match(css, /color:\s*var\(--red\)/);
  assert.match(css, /\.cc-symbol-header/);
  assert.match(css, /\.cc-header-remove-spacer/);
  assert.match(css, /\.cc-symbol-header\s*\{[\s\S]*?white-space:\s*nowrap/);
  assert.match(css, /\.cc-header-label\s*\{[\s\S]*?white-space:\s*nowrap/);
  assert.match(css, /\.cc-header-remove-spacer\s*\{[\s\S]*?margin-right:\s*10px/);
  assert.match(css, /\.cc-symbol-cell\s*\{[\s\S]*?gap:\s*10px/);
  assert.match(css, /\.cc-list-actions\s*\{[\s\S]*?justify-content:\s*center/);
  assert.match(css, /body\[data-strategy="cc"\]\s+\.control-band\s*\{/);
  assert.match(css, /body\[data-strategy="cc"\]\s+\.source-control\s*\{[\s\S]*?grid-column:\s*3/);
  assert.match(css, /body\[data-strategy="cc"\]\s+#runButton\s*\{[\s\S]*?grid-column:\s*4/);
  assert.match(css, /body\[data-strategy="cc"\]\s+#exportButton\s*\{[\s\S]*?grid-column:\s*5/);
  assert.match(css, /\.table-source-toolbar/);
  assert.match(css, /\.cc-symbol-input\s*\{[\s\S]*?width:\s*10ch/);
  assert.match(css, /\.cc-average-cost-input\s*\{[\s\S]*?width:\s*11ch/);
  assert.match(css, /\.cc-contracts-input\s*\{[\s\S]*?width:\s*7ch/);
  assert.match(appSource, /runCoveredCallScan/);
  assert.match(appSource, /extractCallOptionQuotes/);
  assert.match(appSource, /extractStockPositions/);
  assert.match(appSource, /normalizeImportedStockPositions/);
  assert.match(appSource, /coveredCallUsable/);
  assert.match(appSource, /function captureActiveCcInput/);
  assert.match(appSource, /function restoreActiveCcInput/);
  assert.match(appSource, /function calculateCcSummary/);
  assert.match(appSource, /Weekly Return/);
  assert.match(appSource, /Positions/);
  assert.match(appSource, /const activeCcInput = captureActiveCcInput\(\)/);
  assert.match(appSource, /restoreActiveCcInput\(activeCcInput\)/);
  assert.match(appSource, /CC_TABLE_LABELS/);
});

test("results table is compact on desktop and stacked on mobile", () => {
  const index = fs.readFileSync(path.resolve(__dirname, "../src/public/index.html"), "utf8");
  const css = fs.readFileSync(path.resolve(__dirname, "../src/public/styles.css"), "utf8");
  const appSource = fs.readFileSync(path.resolve(__dirname, "../src/public/app.js"), "utf8");

  assert.match(
    index,
    /<th>Allocation<\/th>\s*<th>Target<\/th>\s*<th class="highlight-column">Strike<\/th>\s*<th class="highlight-column">Bid<\/th>\s*<th>Return<\/th>\s*<th class="highlight-column">Contracts<\/th>\s*<th>Used<\/th>/
  );
  assert.match(css, /table-layout: fixed/);
  assert.doesNotMatch(css, /min-width:\s*1480px/);
  assert.match(css, /\.highlight-column\s*\{/);
  assert.match(css, /td\.highlight-column::before/);
  assert.match(css, /font-size:\s*0\.9rem/);
  assert.match(css, /padding:\s*12px 10px/);
  assert.match(css, /content: attr\(data-label\)/);
  assert.match(appSource, /data-label="\$\{CSP_TABLE_LABELS\[13\]\}"/);
  assert.match(appSource, /data-label="\$\{CC_TABLE_LABELS\[11\]\}"/);
});
