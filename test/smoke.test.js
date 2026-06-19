const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");
const { chromium } = require("playwright");

const ROUTES = [
  "/",
  "/home.html",
  "/dashboard.html",
  "/guide.html",
  "/helper.html",
  "/helper-health.html",
  "/changelog.html",
  "/learn.html",
  "/faq.html",
  "/calculator.html",
  "/contact.html",
  "/privacy.html",
  "/terms.html"
];
const MOBILE_VIEWPORT_WIDTHS = [320, 375, 430, 768];
const DESKTOP_VIEWPORT = { width: 1280, height: 900 };

function waitForReady(child) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for server readiness. Output:\n${output}`));
    }, 15000);

    function onData(chunk) {
      output += chunk.toString();
      const match = output.match(/Wheel Strategy Screener running at (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[1]);
      }
    }

    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("exit", (code) => {
      if (code !== null && code !== 0) {
        clearTimeout(timeout);
        reject(new Error(`Server exited before readiness with code ${code}. Output:\n${output}`));
      }
    });
  });
}

function stopServer(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode) {
      resolve();
      return;
    }

    child.once("exit", () => resolve());
    child.kill();
    setTimeout(() => {
      if (child.exitCode === null && !child.signalCode) {
        child.kill("SIGKILL");
      }
    }, 2000).unref();
  });
}

async function dashboardLayoutSnapshot(page) {
  return page.evaluate(() => {
    const band = document.querySelector(".control-band");
    const controls = [...band.children].filter((element) => {
      const style = window.getComputedStyle(element);
      return !element.hidden && style.display !== "none" && style.visibility !== "hidden";
    });
    const controlRects = controls.map((element) => element.getBoundingClientRect());
    const rowBottom = Math.max(...controlRects.map((rect) => rect.bottom));
    const clippedLabels = [...band.querySelectorAll(".segment, .primary-button, .secondary-button")]
      .filter((element) => {
        const style = window.getComputedStyle(element);
        return !element.hidden && style.display !== "none" && style.visibility !== "hidden";
      })
      .filter((element) => (
        element.scrollWidth > element.clientWidth + 2 ||
        element.scrollHeight > element.clientHeight + 2
      ))
      .map((element) => element.textContent.trim());

    return {
      visibleControlCount: controls.length,
      sameVisualRow: controlRects.every((rect) => Math.abs(rect.bottom - rowBottom) <= 3),
      bandFits: band.scrollWidth <= band.clientWidth + 2,
      clippedLabels
    };
  });
}

async function tableSourceSnapshot(page) {
  return page.evaluate(() => {
    const toolbar = document.querySelector(".table-source-toolbar");
    const filter = toolbar.querySelector(".check-control");
    const filterStyle = filter ? window.getComputedStyle(filter) : null;
    const controls = [...toolbar.querySelectorAll(".table-source-control")].filter((element) => {
      const style = window.getComputedStyle(element);
      return !element.hidden && style.display !== "none" && style.visibility !== "hidden";
    });
    const clippedLabels = [...toolbar.querySelectorAll(".segment")]
      .filter((element) => {
        const style = window.getComputedStyle(element);
        return !element.hidden && style.display !== "none" && style.visibility !== "hidden";
      })
      .filter((element) => (
        element.scrollWidth > element.clientWidth + 2 ||
        element.scrollHeight > element.clientHeight + 2
      ))
      .map((element) => element.textContent.trim());

    return {
      visibleControlCount: controls.length,
      inTableHeader: Boolean(toolbar.closest(".table-header")),
      inControlBand: Boolean(document.querySelector(".control-band #cspInputModes, .control-band #ccInputModes")),
      label: controls[0]?.querySelector(":scope > span")?.textContent.trim() || "",
      buttons: controls[0]
        ? [...controls[0].querySelectorAll(".segment")].map((button) => button.textContent.trim())
        : [],
      activeButton: controls[0]?.querySelector(".segment.active")?.textContent.trim() || "",
      filterVisible: Boolean(
        filter &&
        !filter.hidden &&
        filterStyle.display !== "none" &&
        filterStyle.visibility !== "hidden"
      ),
      filterText: filter?.textContent.trim() || "",
      filterChecked: Boolean(filter?.querySelector("input")?.checked),
      clippedLabels
    };
  });
}

async function assertNoPageOverflow(page) {
  const overflow = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth
  }));

  assert.ok(
    overflow.documentWidth <= overflow.viewportWidth + 2,
    `document width ${overflow.documentWidth} should fit viewport ${overflow.viewportWidth}`
  );
  assert.ok(
    overflow.bodyWidth <= overflow.viewportWidth + 2,
    `body width ${overflow.bodyWidth} should fit viewport ${overflow.viewportWidth}`
  );
}

async function commandCenterSnapshot(page) {
  return page.evaluate(() => {
    const center = document.querySelector(".command-center");
    const title = document.querySelector(".command-title");
    const actions = document.querySelector(".command-actions");
    const cards = [...document.querySelectorAll(".command-card")];
    const titleStyle = title ? window.getComputedStyle(title) : null;

    return {
      hasCenter: Boolean(center),
      footerCount: document.querySelectorAll(".site-footer").length,
      title: title?.textContent.trim() || "",
      titleWhiteSpace: titleStyle?.whiteSpace || "",
      titleOverflows: title ? title.scrollWidth > title.clientWidth + 2 : true,
      cardCount: cards.length,
      cardTexts: cards.map((card) => card.textContent.trim()),
      actionTop: actions?.getBoundingClientRect().top || 0,
      titleBottom: title?.getBoundingClientRect().bottom || 0
    };
  });
}

function fulfillJson(route, payload) {
  return route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(payload)
  });
}

function readPostJson(route) {
  try {
    return JSON.parse(route.request().postData() || "{}");
  } catch {
    return {};
  }
}

function cspForecastPayload(body = {}) {
  return {
    strategy: "csp",
    mode: body.mode === "live" ? "live" : "mock",
    source: body.source || "mock",
    portfolioValue: Number.parseFloat(body.portfolioValue) || 10000,
    generatedAt: new Date().toISOString(),
    symbols: ["ONDS"],
    eligibleCount: 0,
    optionRequests: [{ symbol: "ONDS", currentPrice: 9.61 }],
    rows: [
      {
        order: 1,
        symbol: "ONDS",
        status: "ok",
        currentPrice: 9.61,
        minTarget: 16,
        averageTarget: 20.13,
        maxTarget: 25,
        forecastEligible: true,
        eligible: false
      }
    ]
  };
}

function cspFinalPayload(body = {}) {
  const result = body.result || cspForecastPayload(body);
  const portfolioValue = Number.parseFloat(body.portfolioValue) || result.portfolioValue || 10000;
  const contracts = portfolioValue >= 900 ? Math.max(1, Math.floor(portfolioValue / 900)) : 0;

  return {
    ...result,
    portfolioValue,
    generatedAt: result.generatedAt || new Date().toISOString(),
    eligibleCount: 1,
    rows: result.rows.map((row) => ({
      ...row,
      status: "ok",
      eligible: true,
      rank: contracts > 0 ? 1 : null,
      allocationPercent: contracts > 0 ? 100 : null,
      allocationDollars: contracts > 0 ? portfolioValue : null,
      cspStrike: 9,
      cspBid: 0.1,
      cspReturnPercent: 1.11,
      contracts,
      actualCollateralDollars: contracts * 900
    }))
  };
}

function ccForecastPayload(body = {}) {
  const positions = Array.isArray(body.positions) ? body.positions : [];
  const rows = positions
    .map((position, index) => ({
      order: index + 1,
      symbol: String(position.symbol || "").trim().toUpperCase(),
      status: "ok",
      currentPrice: 12,
      minTarget: 14,
      averageTarget: 16,
      maxTarget: 18,
      averageCost: Number.parseFloat(position.averageCost),
      contracts: Number.parseFloat(position.contracts),
      eligible: false
    }))
    .filter((row) => row.symbol);

  return {
    strategy: "cc",
    mode: body.mode === "live" ? "live" : "mock",
    source: body.source || "mock",
    generatedAt: new Date().toISOString(),
    symbols: rows.map((row) => row.symbol),
    eligibleCount: 0,
    optionRequests: rows.map((row) => ({
      symbol: row.symbol,
      currentPrice: row.currentPrice,
      averageCost: row.averageCost
    })),
    rows
  };
}

function ccFinalPayload(body = {}) {
  const result = body.result || ccForecastPayload(body);

  return {
    ...result,
    generatedAt: result.generatedAt || new Date().toISOString(),
    eligibleCount: result.rows.length,
    rows: result.rows.map((row) => ({
      ...row,
      eligible: true,
      ccStrike: 14,
      ccBid: 0.25,
      ccReturnBase: Number.isFinite(row.averageCost) ? row.averageCost : row.currentPrice,
      ccReturnPercent: 2,
      totalReturnDollars:
        ((14 - (Number.isFinite(row.averageCost) ? row.averageCost : 12)) + 0.25) *
        100 *
        (Number.isFinite(row.contracts) ? row.contracts : 1),
      totalReturnPercent: 10
    }))
  };
}

async function installDashboardApiStubs(page) {
  await page.route("**/api/forecast", (route) => fulfillJson(route, cspForecastPayload(readPostJson(route))));
  await page.route("**/api/finalize", (route) => fulfillJson(route, cspFinalPayload(readPostJson(route))));
  await page.route("**/api/reallocate", (route) => fulfillJson(route, cspFinalPayload(readPostJson(route))));
  await page.route("**/api/covered-calls/forecast", (route) => fulfillJson(route, ccForecastPayload(readPostJson(route))));
  await page.route("**/api/covered-calls/finalize", (route) => fulfillJson(route, ccFinalPayload(readPostJson(route))));
}

async function assertInputCaret(page, selector, initialValue, caretPosition, typedText, expectedValue) {
  const input = page.locator(selector).first();
  await input.fill(initialValue);
  await input.evaluate((element, position) => {
    element.focus();
    element.setSelectionRange(position, position);
  }, caretPosition);
  await page.keyboard.type(typedText);
  await page.waitForTimeout(650);

  const result = await input.evaluate((element) => ({
    value: element.value,
    selectionStart: element.selectionStart,
    selectionEnd: element.selectionEnd
  }));

  assert.equal(result.value, expectedValue);
  assert.equal(result.selectionStart, caretPosition + typedText.length);
  assert.equal(result.selectionEnd, caretPosition + typedText.length);
}

async function assertScannedInputCaretStability(page) {
  await page.getByRole("button", { name: "CSP", exact: true }).click();
  await page.locator("#cspInputModes").getByRole("button", { name: "Auto", exact: true }).click();
  await page.getByRole("button", { name: "Scan", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("#runButton")?.textContent.trim() === "Refresh");

  await assertInputCaret(page, "#portfolioInput", "1000", 1, "2", "12000");
  await assertInputCaret(page, "#weeklyReturnInput", "1.5", 1, "2", "12.5");
  await assertInputCaret(page, "#yearlyReturnInput", "54", 1, "2", "524");

  await page.getByRole("button", { name: "CC", exact: true }).click();
  await page.locator("#ccInputModes").getByRole("button", { name: "Manual", exact: true }).click();
  await page.locator('[data-cc-field="symbol"]').fill("AAPL");
  await page.locator('[data-cc-field="averageCost"]').fill("12.34");
  await page.locator('[data-cc-field="contracts"]').fill("2");
  await page.getByRole("button", { name: "Scan", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("#runButton")?.textContent.trim() === "Refresh");

  await assertInputCaret(page, '[data-cc-field="averageCost"]', "12.34", 2, "9", "129.34");
  await assertInputCaret(page, '[data-cc-field="contracts"]', "2", 1, "5", "25");
}

async function assertDashboardVisualLayout(page, baseUrl) {
  await installDashboardApiStubs(page);
  await page.addInitScript(() => {
    window.localStorage.setItem("wheel-screener-onboarding-v2", "true");
  });
  await page.setViewportSize({ width: 1760, height: 980 });
  await page.goto(`${baseUrl}/dashboard.html`, { waitUntil: "domcontentloaded" });
  await page.locator(".control-band").waitFor({ timeout: 3000 });

  const manualCspLayout = await dashboardLayoutSnapshot(page);
  assert.equal(manualCspLayout.visibleControlCount, 5);
  assert.equal(manualCspLayout.sameVisualRow, true, "Manual CSP controls should stay on one desktop row");
  assert.equal(manualCspLayout.bandFits, true, "Manual CSP controls should fit inside the card");
  assert.deepEqual(manualCspLayout.clippedLabels, []);
  const cspSource = await tableSourceSnapshot(page);
  assert.equal(cspSource.visibleControlCount, 1);
  assert.equal(cspSource.inTableHeader, true);
  assert.equal(cspSource.inControlBand, false);
  assert.equal(cspSource.label, "");
  assert.deepEqual(cspSource.buttons, ["Manual", "Auto"]);
  assert.equal(cspSource.activeButton, "Manual");
  assert.equal(cspSource.filterVisible, false);
  assert.deepEqual(cspSource.clippedLabels, []);
  await assertNoPageOverflow(page);

  const manualCsp = await page.evaluate(() => {
    const headers = [...document.querySelectorAll("#resultHead th")].map((header) =>
      header.textContent.trim()
    );
    const removeButton = document.querySelector(".manual-symbol-cell .cc-remove-button");
    const input = document.querySelector(".manual-symbol-cell .manual-csp-symbol-input");
    const removeRect = removeButton.getBoundingClientRect();
    const inputRect = input.getBoundingClientRect();

    return {
      headers,
      removeLeftOfInput: removeRect.right < inputRect.left,
      inputVisible: inputRect.width > 70 && inputRect.height > 28,
      gap: inputRect.left - removeRect.right
    };
  });
  assert.equal(manualCsp.headers[0], "Symbol");
  assert.equal(manualCsp.headers.includes("Rank"), false);
  assert.equal(manualCsp.removeLeftOfInput, true);
  assert.equal(manualCsp.inputVisible, true);
  assert.ok(manualCsp.gap >= 6 && manualCsp.gap <= 16);
  await assertNoPageOverflow(page);

  await page.locator("#cspInputModes").getByRole("button", { name: "Auto", exact: true }).click();
  const cspAutoLayout = await dashboardLayoutSnapshot(page);
  assert.equal(cspAutoLayout.visibleControlCount, 6);
  assert.equal(cspAutoLayout.sameVisualRow, true, "Auto CSP controls should stay on one desktop row");
  assert.equal(cspAutoLayout.bandFits, true, "Auto CSP controls should fit inside the card");
  assert.deepEqual(cspAutoLayout.clippedLabels, []);
  const cspAutoSource = await tableSourceSnapshot(page);
  assert.equal(cspAutoSource.activeButton, "Auto");
  assert.equal(cspAutoSource.filterVisible, true);
  assert.equal(cspAutoSource.filterText, "Hide unavailable and ineligible rows");
  assert.equal(cspAutoSource.filterChecked, false);
  assert.deepEqual(cspAutoSource.clippedLabels, []);

  await page.getByRole("button", { name: "CC", exact: true }).click();
  const ccManualLayout = await dashboardLayoutSnapshot(page);
  assert.equal(ccManualLayout.visibleControlCount, 4);
  assert.equal(ccManualLayout.sameVisualRow, true, "CC controls should remain one desktop row");
  assert.equal(ccManualLayout.bandFits, true, "CC controls should fit inside the card");
  assert.deepEqual(ccManualLayout.clippedLabels, []);
  const ccSource = await tableSourceSnapshot(page);
  assert.equal(ccSource.visibleControlCount, 1);
  assert.equal(ccSource.label, "");
  assert.deepEqual(ccSource.buttons, ["Manual", "Auto"]);
  assert.equal(ccSource.activeButton, "Manual");
  assert.equal(ccSource.filterVisible, false);
  assert.deepEqual(ccSource.clippedLabels, []);

  await page.locator("#ccInputModes").getByRole("button", { name: "Auto", exact: true }).click();
  const ccEmptyText = await page.locator(".empty-cell").innerText();
  assert.equal(ccEmptyText.trim(), "No scan has run yet.");
  const ccEmptyAlignment = await page.evaluate(() => {
    const cell = document.querySelector(".empty-cell");
    const wrap = document.querySelector(".table-wrap");
    const cellRect = cell.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    return {
      textAlign: window.getComputedStyle(cell).textAlign,
      cellCenter: cellRect.left + cellRect.width / 2,
      wrapCenter: wrapRect.left + wrapRect.width / 2
    };
  });
  assert.equal(ccEmptyAlignment.textAlign, "center");
  assert.ok(Math.abs(ccEmptyAlignment.cellCenter - ccEmptyAlignment.wrapCenter) <= 3);
  const ccAutoSource = await tableSourceSnapshot(page);
  assert.equal(ccAutoSource.activeButton, "Auto");
  assert.equal(ccAutoSource.filterVisible, true);
  assert.equal(ccAutoSource.filterText, "Hide unavailable and ineligible rows");
  assert.equal(ccAutoSource.filterChecked, false);
  const ccRobinhoodLayout = await dashboardLayoutSnapshot(page);
  assert.equal(ccRobinhoodLayout.visibleControlCount, 4);
  assert.equal(ccRobinhoodLayout.sameVisualRow, true, "CC Robinhood controls should remain one row");
  assert.deepEqual(ccRobinhoodLayout.clippedLabels, []);
  assert.deepEqual((await tableSourceSnapshot(page)).clippedLabels, []);

  await assertScannedInputCaretStability(page);

  for (const width of [390, 430]) {
    await page.setViewportSize({ width, height: 920 });
    await page.goto(`${baseUrl}/dashboard.html`, { waitUntil: "domcontentloaded" });
    await page.locator(".control-band").waitFor({ timeout: 3000 });
    await assertNoPageOverflow(page);
    assert.deepEqual((await dashboardLayoutSnapshot(page)).clippedLabels, []);
    assert.deepEqual((await tableSourceSnapshot(page)).clippedLabels, []);
    assert.equal((await tableSourceSnapshot(page)).filterVisible, false);
    await page.locator("#cspInputModes").getByRole("button", { name: "Auto", exact: true }).click();
    await assertNoPageOverflow(page);
    assert.deepEqual((await dashboardLayoutSnapshot(page)).clippedLabels, []);
    assert.deepEqual((await tableSourceSnapshot(page)).clippedLabels, []);
    assert.equal((await tableSourceSnapshot(page)).filterVisible, true);
    await page.getByRole("button", { name: "CC", exact: true }).click();
    await assertNoPageOverflow(page);
    assert.deepEqual((await dashboardLayoutSnapshot(page)).clippedLabels, []);
    assert.deepEqual((await tableSourceSnapshot(page)).clippedLabels, []);
    assert.equal((await tableSourceSnapshot(page)).filterVisible, false);
  }
}

function robinhoodInvestingFixtureHtml() {
  return `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Robinhood Investing Fixture</title>
        <style>
          body { margin: 0; background: #000; color: #fff; font-family: Arial, sans-serif; }
          main { padding: 24px 32px 1200px; }
          #accountDropdown, [data-account-option] {
            display: flex;
            align-items: center;
            gap: 12px;
            width: 240px;
            min-height: 48px;
            color: #fff;
            background: #111;
            border: 1px solid #3a3f42;
            padding: 8px 16px;
          }
          #accountMenu {
            width: 408px;
            margin: 4px 0 24px;
            background: #1c2023;
            border: 1px solid #454b50;
          }
          #accountMenu[hidden] { display: none; }
          .web-app-emotion-cache-11cxeba {
            min-height: 40px;
            display: flex;
            align-items: center;
            padding: 8px 30px;
            font-weight: 700;
          }
          .stock-table {
            display: grid;
            grid-template-columns: 230px 90px 90px 110px 140px 120px;
            align-items: center;
            width: 780px;
            row-gap: 0;
          }
          .stock-table > div {
            min-height: 52px;
            display: flex;
            align-items: center;
            border-bottom: 1px solid #333;
          }
          .stock-header {
            color: #9fb4ca;
            font-weight: 700;
          }
          .qVizNsgJursdUUgiZtoQzg-- {
            color: #fff;
          }
          .gic1rUwO9ldk9zzcggr7uA-- {
            color: #b5dcff;
          }
          .-URCNCRkOrsFeQ6BHrJU3Q-- {
            color: #fff;
          }
        </style>
      </head>
      <body>
        <main>
          <h1>Investing</h1>
          <button id="accountDropdown" type="button" aria-haspopup="listbox" aria-busy="false">
            <svg fill="none" height="24" role="img" viewBox="0 0 24 24" width="24"></svg>
            <div><p id="currentAccountLabel">Personal</p></div>
          </button>
          <div id="accountMenu" hidden>
            <div class="web-app-emotion-cache-11cxeba"><span class="css-v72tci">Individual</span></div>
            <button type="button" aria-busy="false" class="web-app-emotion-cache-1uknxyu" data-account-option="individual">
              <svg fill="none" height="24" role="img" viewBox="0 0 24 24" width="24"></svg>
              <div class="web-app-emotion-cache-m9fipx"><p class="css-y3z1hq">Personal</p></div>
            </button>
            <div class="web-app-emotion-cache-11cxeba"><span class="css-v72tci">Retirement</span></div>
            <button type="button" aria-busy="false" class="web-app-emotion-cache-1uknxyu" data-account-option="retirement">
              <svg fill="none" height="24" role="img" viewBox="0 0 24 24" width="24"></svg>
              <div class="web-app-emotion-cache-m9fipx"><p class="css-y3z1hq">Roth IRA</p></div>
            </button>
            <div class="web-app-emotion-cache-11cxeba"><span class="css-v72tci">Joint</span></div>
            <button type="button" aria-busy="false" class="web-app-emotion-cache-1uknxyu" data-account-option="joint">
              <svg fill="none" height="24" role="img" viewBox="0 0 24 24" width="24"></svg>
              <div class="web-app-emotion-cache-m9fipx"><p class="css-y3z1hq">Joint investing</p></div>
            </button>
          </div>
          <h2>Stocks</h2>
          <div class="stock-table" aria-label="Stocks">
            <div class="stock-header">Name</div>
            <div class="stock-header">Symbol</div>
            <div class="stock-header">Shares</div>
            <div class="stock-header">Price</div>
            <div class="stock-header">Average cost</div>
            <div class="stock-header">Equity</div>
          </div>
        </main>
        <script>
          const accounts = {
            individual: [
              ["POET Technologies", "POET", "400", "$12.45", "$12.46", "$4,980.00"],
              ["Richtech Robotics", "RR", "3,300", "$2.11", "$3.81", "$6,963.00"]
            ],
            retirement: [
              ["POET Technologies", "POET", "125", "$12.10", "$11.11", "$1,512.50"]
            ],
            joint: [
              ["Acme Biotech", "ABC", "50", "$7.30", "$7.25", "$365.00"]
            ]
          };
          const labels = {
            individual: "Personal",
            retirement: "Roth IRA",
            joint: "Joint investing"
          };
          function renderRows(key) {
            document.querySelectorAll(".stock-table [data-stock-cell]").forEach((cell) => cell.remove());
            const table = document.querySelector(".stock-table");
            for (const row of accounts[key]) {
              const [name, symbol, shares, price, averageCost, equity] = row;
              const cells = [
                '<span>' + name + '</span>',
                '<span class="gic1rUwO9ldk9zzcggr7uA--">' + symbol + '</span>',
                '<span>' + shares + '</span>',
                '<span>' + price + '</span>',
                '<span class="-URCNCRkOrsFeQ6BHrJU3Q--">' + averageCost + '</span>',
                '<span>' + equity + '</span>'
              ];
              for (const html of cells) {
                const cell = document.createElement("div");
                cell.className = "qVizNsgJursdUUgiZtoQzg--";
                cell.dataset.stockCell = "true";
                cell.innerHTML = html;
                table.append(cell);
              }
            }
          }
          document.getElementById("accountDropdown").addEventListener("click", () => {
            document.getElementById("accountMenu").hidden = !document.getElementById("accountMenu").hidden;
          });
          document.addEventListener("click", (event) => {
            const option = event.target.closest("[data-account-option]");
            if (!option) {
              return;
            }
            const key = option.dataset.accountOption;
            document.getElementById("currentAccountLabel").textContent = labels[key];
            document.getElementById("accountMenu").hidden = true;
            renderRows(key);
          });
          renderRows("individual");
        </script>
      </body>
    </html>`;
}

async function injectRobinhoodContentScript(page) {
  await page.evaluate(() => {
    window.chrome = {
      runtime: {
        onMessage: {
          addListener(listener) {
            window.__wheelHelperListener = listener;
          }
        }
      }
    };
  });
  await page.addScriptTag({
    path: path.resolve(__dirname, "../extension/content-robinhood.js")
  });
  await page.waitForFunction(() => Boolean(window.__wheelHelperListener));
}

async function sendRobinhoodHelperMessage(page, message) {
  return page.evaluate((payload) => new Promise((resolve) => {
    window.__wheelHelperListener(payload, {}, resolve);
  }), message);
}

test("Robinhood helper extracts CC Auto positions from Investing Stocks table", async () => {
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();
    await page.route("https://robinhood.com/account/investing", (route) => route.fulfill({
      status: 200,
      contentType: "text/html",
      body: robinhoodInvestingFixtureHtml()
    }));
    await page.goto("https://robinhood.com/account/investing", { waitUntil: "domcontentloaded" });
    await injectRobinhoodContentScript(page);

    const result = await sendRobinhoodHelperMessage(page, { action: "extractStockPositions" });
    assert.equal(result.error, undefined);
    assert.equal(result.source, "robinhood-positions");

    const positions = result.positions;
    assert.ok(Array.isArray(positions));
    assert.ok(positions.some((position) =>
      position.accountName === "Individual - Personal" &&
      position.symbol === "POET" &&
      position.shares === 400 &&
      position.averageCost === 12.46
    ));
    assert.ok(positions.some((position) =>
      position.accountName === "Individual - Personal" &&
      position.symbol === "RR" &&
      position.shares === 3300 &&
      position.averageCost === 3.81
    ));
    assert.ok(positions.some((position) =>
      position.accountName === "Retirement - Roth IRA" &&
      position.symbol === "POET" &&
      position.shares === 125 &&
      position.averageCost === 11.11
    ));
    assert.ok(positions.some((position) =>
      position.accountName === "Joint - Joint investing" &&
      position.symbol === "ABC" &&
      position.shares === 50 &&
      position.averageCost === 7.25
    ));
    assert.equal(positions.filter((position) => position.symbol === "POET").length, 2);
  } finally {
    await browser.close();
  }
});

test("Robinhood helper refuses CC Auto extraction away from Investing page", async () => {
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();
    await page.route("https://robinhood.com/account", (route) => route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><main><h1>Portfolio overview</h1><p>This route has enough text for the helper readiness wait but is not the investing page.</p><p>It should not be scraped for covered-call positions.</p></main>"
    }));
    await page.goto("https://robinhood.com/account", { waitUntil: "domcontentloaded" });
    await injectRobinhoodContentScript(page);

    const result = await sendRobinhoodHelperMessage(page, { action: "extractStockPositions" });
    assert.match(result.error, /account\/investing/);
  } finally {
    await browser.close();
  }
});

test("headless smoke starts server and validates primary static routes", async () => {
  const cwd = path.resolve(__dirname, "..");
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: "0"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let browser;
  try {
    const baseUrl = await waitForReady(child);
    assert.match(baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/);

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const browserErrors = [];
    page.on("console", (message) => {
      if (message.type() === "error") {
        browserErrors.push(message.text());
      }
    });
    page.on("pageerror", (error) => {
      browserErrors.push(error.message);
    });

    await assertDashboardVisualLayout(page, baseUrl);

    await page.setViewportSize(DESKTOP_VIEWPORT);
    await page.goto(`${baseUrl}/home.html`, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => window.localStorage.clear());
    await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
    await page.locator(".command-center").waitFor({ timeout: 3000 });
    await assertNoPageOverflow(page);
    const commandCenter = await commandCenterSnapshot(page);
    assert.equal(commandCenter.hasCenter, true);
    assert.equal(commandCenter.footerCount, 0);
    assert.equal(commandCenter.title, "Wheel Strategy Screener");
    assert.equal(commandCenter.titleWhiteSpace, "nowrap");
    assert.equal(commandCenter.titleOverflows, false);
    assert.equal(commandCenter.cardCount, 2);
    assert.deepEqual(commandCenter.cardTexts, ["CSP Dashboard", "CC Dashboard"]);
    assert.ok(commandCenter.actionTop > commandCenter.titleBottom);
    await assert.doesNotReject(() =>
      page.getByRole("link", { name: /CSP Dashboard/ }).waitFor({ timeout: 3000 })
    );
    await assert.doesNotReject(() =>
      page.getByRole("link", { name: /CC Dashboard/ }).waitFor({ timeout: 3000 })
    );

    await page.goto(`${baseUrl}/home.html`, { waitUntil: "domcontentloaded" });
    await page.locator(".command-center").waitFor({ timeout: 3000 });
    await assertNoPageOverflow(page);
    const explicitHome = await commandCenterSnapshot(page);
    assert.equal(explicitHome.footerCount, 0);
    assert.equal(explicitHome.cardCount, 2);
    assert.equal(explicitHome.titleWhiteSpace, "nowrap");

    for (const width of MOBILE_VIEWPORT_WIDTHS) {
      await page.setViewportSize({ width, height: 820 });
      for (const route of ROUTES) {
        await page.goto(`${baseUrl}/home.html`, { waitUntil: "domcontentloaded" });
        await page.evaluate(() => window.localStorage.clear());
        const response = await page.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded" });
        assert.equal(response?.status(), 200, `${route} should load at ${width}px`);
        await assert.doesNotReject(() => page.locator("body").waitFor({ timeout: 3000 }));
        await assertNoPageOverflow(page);
        if (route === "/" || route === "/home.html") {
          await page.locator(".command-center").waitFor({ timeout: 3000 });
          const mobileHome = await commandCenterSnapshot(page);
          assert.equal(mobileHome.footerCount, 0);
          assert.equal(mobileHome.titleWhiteSpace, width <= 540 ? "normal" : "nowrap");
          assert.equal(mobileHome.titleOverflows, false);
          assert.equal(mobileHome.cardCount, 2);
        }
      }
    }
    await page.setViewportSize(DESKTOP_VIEWPORT);

    for (const route of ROUTES) {
      const response = await page.goto(`${baseUrl}${route}`, {
        waitUntil: "domcontentloaded"
      });
      assert.equal(response?.status(), 200, `${route} should load`);
      await assert.doesNotReject(() => page.locator("body").waitFor({ timeout: 3000 }));
      const bodyText = await page.locator("body").innerText();
      assert.match(bodyText, /Wheel Strategy Screener|Setup Guide|Contact Us|Privacy Policy|Terms of Service|FAQ|Calculator|Learn/);
    }
    assert.deepEqual(browserErrors, []);
  } finally {
    if (browser) {
      await browser.close();
    }
    await stopServer(child);
  }
});
