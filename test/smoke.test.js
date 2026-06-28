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
    symbols: ["AAA"],
    eligibleCount: 0,
    optionRequests: [{ symbol: "AAA", currentPrice: 9.61 }],
    rows: [
      {
        order: 1,
        symbol: "AAA",
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
      coveredCallUsable: position.coveredCallUsable === false ? false : true,
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
    optionRequests: rows
      .filter((row) => row.coveredCallUsable !== false && Number.isFinite(row.contracts) && row.contracts > 0)
      .map((row) => ({
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

async function installDashboardApiStubs(page, recorder = null) {
  const record = (kind, route, body) => {
    recorder?.push({
      kind,
      url: route.request().url(),
      body
    });
  };

  await page.route("**/api/forecast", (route) => {
    const body = readPostJson(route);
    record("cspForecast", route, body);
    return fulfillJson(route, cspForecastPayload(body));
  });
  await page.route("**/api/finalize", (route) => {
    const body = readPostJson(route);
    record("cspFinalize", route, body);
    return fulfillJson(route, cspFinalPayload(body));
  });
  await page.route("**/api/reallocate", (route) => {
    const body = readPostJson(route);
    record("cspReallocate", route, body);
    return fulfillJson(route, cspFinalPayload(body));
  });
  await page.route("**/api/covered-calls/forecast", (route) => {
    const body = readPostJson(route);
    record("ccForecast", route, body);
    return fulfillJson(route, ccForecastPayload(body));
  });
  await page.route("**/api/covered-calls/finalize", (route) => {
    const body = readPostJson(route);
    record("ccFinalize", route, body);
    return fulfillJson(route, ccFinalPayload(body));
  });
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
          .account-control { margin-bottom: 760px; }
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
          .distractor-bar {
            display: flex;
            gap: 12px;
            margin: 18px 0 28px;
          }
          .distractor-bar button {
            min-height: 36px;
            color: #fff;
            background: #15191c;
            border: 1px solid #3a3f42;
            padding: 6px 12px;
          }
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
          .-URCNCRkOrsFeQ6BHrJU3Q--,
          .sTkTMJqe3B7iJLnJngmcMA-- {
            color: #fff;
          }
        </style>
      </head>
      <body>
        <main>
          <h1>Investing</h1>
          <div class="distractor-bar" aria-label="Unrelated controls">
            <button id="helpIconButton" type="button" aria-label="Help">
              <svg fill="none" height="16" role="img" viewBox="0 0 16 16" width="16"><path d="M5.368 6.453C5.39 4.793 6.425 3.8 8.133 3.8c1.428 0 2.5.938 2.5 2.177 0 1.07-.526 1.512-1.156 1.939a3.16 3.16 0 0 1-.127.086l-.09.06-.022.016c-.429.285-.713.475-.713.874v.133H7.16v-.217c0-.82.462-1.183 1.071-1.575l.077-.05c.497-.335.89-.601.89-1.19 0-.202-.085-.874-1.093-.874-.833 0-1.26.462-1.316 1.4l-.007.112-1.414-.14v-.098Z" fill="currentColor"></path></svg>
            </button>
            <button id="navigationButton" type="button">Portfolio overview</button>
            <button id="sortCombobox" type="button" role="combobox" aria-busy="false">
              <span><div>Sort menu</div></span>
              <svg fill="none" height="16" role="img" viewBox="0 0 16 16" width="16"></svg>
            </button>
          </div>
          <div class="web-app-emotion-cache-16lfj6j account-control">
            <button id="accountDropdown" type="button" role="combobox" aria-busy="false" class="web-app-emotion-cache-14qs35g">
              <span class="css-1md9imy"><div class="web-app-emotion-cache-1a07lwf" id="currentAccountLabel">Account One</div></span>
              <svg fill="none" height="16" role="img" viewBox="0 0 16 16" width="16"></svg>
            </button>
            <div id="accountMenu" hidden>
              <div class="web-app-emotion-cache-11cxeba"><span class="css-v72tci">Group Alpha</span></div>
              <button type="button" aria-busy="false" class="web-app-emotion-cache-1uknxyu" data-account-option="alpha">
                <svg fill="none" height="24" role="img" viewBox="0 0 24 24" width="24"></svg>
                <div class="web-app-emotion-cache-m9fipx"><p class="css-y3z1hq">Account One</p></div>
                <svg aria-label="Selected account" fill="none" height="24" role="img" viewBox="0 0 24 24" width="24"></svg>
              </button>
              <div class="web-app-emotion-cache-11cxeba"><span class="css-v72tci">Group Beta</span></div>
              <button type="button" aria-busy="false" class="web-app-emotion-cache-1uknxyu" data-account-option="beta">
                <svg fill="none" height="24" role="img" viewBox="0 0 24 24" width="24"></svg>
                <div class="web-app-emotion-cache-m9fipx"><p class="css-y3z1hq">Account Two</p></div>
              </button>
              <div class="web-app-emotion-cache-11cxeba"><span class="css-v72tci">Group Gamma</span></div>
              <button type="button" aria-busy="false" class="web-app-emotion-cache-1uknxyu" data-account-option="gamma">
                <svg fill="none" height="24" role="img" viewBox="0 0 24 24" width="24"></svg>
                <div class="web-app-emotion-cache-m9fipx"><p class="css-y3z1hq">Account Three</p></div>
              </button>
            </div>
          </div>
          <h2 class="web-app-emotion-cache-mzpff5"><span class="css-z4smye">Stocks</span></h2>
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
          window.__clickedControls = [];
          const accounts = {
            alpha: [
              ["Alpha Example Inc.", "AAA", "200", "$24.10", "$21.55", "$4,820.00"],
              ["Beta Example Corp.", "BBB", "450", "$12.45", "$13.37", "$5,602.50"],
              ["Gamma Example Ltd.", "CCC", "1,250", "$4.20", "$4.75", "$5,250.00"]
            ],
            beta: [
              ["Beta Example Corp.", "BBB", "125", "$12.10", "$11.11", "$1,512.50"]
            ],
            gamma: [
              ["Delta Example Co.", "DDD", "75", "$7.30", "$7.25", "$547.50"]
            ]
          };
          const labels = {
            alpha: "Account One",
            beta: "Account Two",
            gamma: "Account Three"
          };
          for (const id of ["helpIconButton", "navigationButton", "sortCombobox"]) {
            document.getElementById(id).addEventListener("click", () => {
              window.__clickedControls.push("distractor:" + id);
            });
          }
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
                '<span class="sTkTMJqe3B7iJLnJngmcMA--">' + averageCost + '</span>',
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
            window.__clickedControls.push("control:account-dropdown");
            document.getElementById("accountMenu").hidden = !document.getElementById("accountMenu").hidden;
          });
          document.addEventListener("click", (event) => {
            const option = event.target.closest("[data-account-option]");
            if (!option) {
              return;
            }
            const key = option.dataset.accountOption;
            window.__clickedControls.push("option:" + key);
            document.getElementById("currentAccountLabel").textContent = labels[key];
            document.getElementById("accountMenu").hidden = true;
            renderRows(key);
          });
          renderRows("alpha");
        </script>
      </body>
    </html>`;
}

function robinhoodScreenerFixtureHtml({
  targetBelowFold = false,
  navigateOnClick = true,
  nameControlMode = "title"
} = {}) {
  const targetName = "Primary Saved Screener";
  const savedListNames = targetBelowFold
    ? [
        "Neutral Saved List One",
        "Neutral Saved List Two",
        "Neutral Saved List Three",
        "Neutral Saved List Four",
        targetName,
        "Neutral Saved List Five"
      ]
    : [
        `${targetName} Growth`,
        `${targetName} Income`,
        targetName
      ];
  const fillerSymbols = ["XXX", "YYY", "ZZZ", "QQQ", "VVV", "WWW"];
  const symbolsByScreener = Object.fromEntries(
    savedListNames.map((name, index) => [
      name,
      name === targetName ? ["AAA", "BBB", "CCC", "DDD", "EEE"] : [fillerSymbols[index] || "MMM"]
    ])
  );
  const savedListRows = savedListNames.map((name) => `
              <div class="web-app-emotion-cache-8uhtka" data-screener-name="${name}">
                <span class="css-y3z1hq">${name}</span>
              </div>`).join("");

  return `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Robinhood Screener Fixture</title>
        <style>
          body { margin: 0; color: #111; font-family: Arial, sans-serif; }
          main { display: grid; grid-template-columns: 1fr 420px; gap: 18px; padding: 110px 28px; }
          .portfolio-home {
            display: grid;
            gap: 16px;
            align-content: start;
          }
          .home-holdings {
            border: 1px solid #d8e0e5;
            padding: 18px;
          }
          .home-holdings a {
            display: block;
            padding: 10px 0;
          }
          [hidden] { display: none !important; }
          .screener-view {
            display: grid;
            gap: 0;
          }
          .screener-header {
            border: 1px solid #d8e0e5;
            padding: 18px;
          }
          .screener-grid {
            border: 1px solid #d8e0e5;
            border-top: 0;
          }
          .screener-grid-scroll {
            max-height: 150px;
            overflow-y: auto;
          }
          .screener-grid-heading,
          [data-stock-row] {
            display: grid;
            grid-template-columns: 52px 180px 160px;
            gap: 16px;
            align-items: center;
            min-height: 68px;
            border-bottom: 1px solid #d8e0e5;
          }
          .lists-card {
            border: 1px solid #d8e0e5;
          }
          .lists-scroll {
            max-height: ${targetBelowFold ? "190px" : "360px"};
            overflow-y: auto;
          }
          .lists-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            min-height: 64px;
            padding: 0 28px;
            border-bottom: 1px solid #d8e0e5;
          }
          [data-screener-name] {
            display: flex;
            align-items: center;
            gap: 14px;
            min-height: 88px;
            border: 1px solid #d8e0e5;
            padding: 8px 28px;
            cursor: pointer;
          }
          [data-screener-name] span { font-weight: 700; }
        </style>
      </head>
      <body>
        <main>
          <section class="portfolio-home" aria-label="Portfolio home">
            <div id="homeView">
              <h1>Account Home</h1>
              <div class="home-holdings" aria-label="Visible holdings">
                <a href="/stocks/HHH"><strong>HHH</strong><span> 200 shares</span></a>
                <a href="/stocks/III"><strong>III</strong><span> 125 shares</span></a>
                <a href="/stocks/JJJ"><strong>JJJ</strong><span> 50 shares</span></a>
              </div>
            </div>
            <div id="screenerView" class="screener-view" aria-label="Screener detail" hidden>
              <section id="screenerHeader" class="screener-header"></section>
              <section id="screenerGrid" class="screener-grid">
                <div class="screener-grid-heading"><span>Rank</span><strong>Symbol</strong><span>Company</span></div>
                <div id="screenerGridScroll" class="screener-grid-scroll">
                  <div id="screenerRows"></div>
                  <div id="screenerGridSpacer" aria-hidden="true"></div>
                </div>
              </section>
            </div>
          </section>
          <section class="lists-card" aria-label="Saved lists">
            <div class="css-1mev3pd lists-header">
              <span class="css-bp1p2y">Lists</span>
              <button type="button" aria-label="Create new list or screener" data-testid="SidebarCreateListButton" aria-busy="false" class="web-app-emotion-cache-v5z1gx">+</button>
            </div>
            <div class="lists-scroll">
${savedListRows}
            </div>
          </section>
        </main>
        <script>
          window.__bodyWheelCount = 0;
          window.__listsWheelCount = 0;
          window.__bodyWheelBeforeScreenerClick = 0;
          document.addEventListener("wheel", (event) => {
            if (event.target.closest(".lists-scroll")) {
              window.__listsWheelCount += 1;
            } else {
              window.__bodyWheelCount += 1;
              if (!window.__clickedScreener) {
                window.__bodyWheelBeforeScreenerClick += 1;
              }
            }
          });
          const symbolsByScreener = ${JSON.stringify(symbolsByScreener)};
          const nameControlMode = ${JSON.stringify(nameControlMode)};
          function renderScreener(name) {
            window.__clickedScreener = name;
            if (${navigateOnClick ? "true" : "false"}) {
              const fixtureId = Object.keys(symbolsByScreener).indexOf(name) + 1;
              window.history.pushState({}, "", "/screener/fixture-" + fixtureId + "?source=lists_section_saved_screener");
              document.getElementById("homeView")?.remove();
              document.getElementById("screenerView").hidden = false;
            }
            const symbols = symbolsByScreener[name] || [];
            const titleValue = nameControlMode === "text-only"
              ? ""
              : nameControlMode === "normalized-title"
                ? "  " + name.toUpperCase().replace(/ /g, "   ") + "  "
                : name;
            document.getElementById("screenerHeader").innerHTML =
              nameControlMode === "missing"
                ? '<p>Screener loading</p>'
                : '<button type="button" data-testid="screener-name-input" title="' + titleValue + '">' +
                  '<span class="css-6547ym">' + name + '</span></button>' +
                  '<p>' + symbols.length + ' items</p>';
            const rows = document.getElementById("screenerRows");
            const spacer = document.getElementById("screenerGridSpacer");
            const renderRows = (count) => {
              rows.innerHTML = symbols.slice(0, count).map((symbol, index) =>
                '<div data-stock-row>' +
                '<span>' + (index + 1) + '</span><strong data-symbol-cell>' + symbol + '</strong><span>Company</span></div>'
              ).join("");
              spacer.style.height = count < symbols.length ? "900px" : "0px";
              window.__renderedScreenerSymbols = symbols.slice(0, count);
            };
            renderRows(Math.min(2, symbols.length));
            const scroll = document.getElementById("screenerGridScroll");
            scroll.onscroll = () => {
              if (scroll.scrollTop > 0) {
                renderRows(symbols.length);
              }
            };
          }
          document.querySelectorAll("div.web-app-emotion-cache-8uhtka > span.css-y3z1hq").forEach((label) => {
            label.addEventListener("click", (event) => {
              window.__clickedScreenerTarget = {
                tagName: event.target.tagName,
                className: event.target.className
              };
              renderScreener(label.textContent.trim());
            });
          });
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

async function installDashboardExtensionStub(page) {
  await page.addInitScript(() => {
    window.__dashboardHelperRequests = [];
    window.addEventListener("message", (event) => {
      if (event.source !== window || event.data?.type !== "WHEEL_SCREENER_EXTENSION_REQUEST") {
        return;
      }

      const request = {
        action: event.data.action,
        payload: event.data.payload || {}
      };
      window.__dashboardHelperRequests.push(request);

      let payload = {};
      if (request.action === "ping") {
        payload = { installed: true, version: "0.2.14" };
      } else if (request.action === "extractScreener") {
        payload = {
          source: "robinhood",
          symbols: ["AAA"]
        };
      } else if (request.action === "extractStockPositions") {
        payload = {
          source: "robinhood-positions",
          positions: [
            { accountName: "Group Alpha - Account One", symbol: "AAA", shares: 200, averageCost: 21.55 },
            { accountName: "Group Alpha - Account One", symbol: "BBB", shares: 450, averageCost: 13.37 },
            { accountName: "Group Alpha - Account One", symbol: "CCC", shares: 1250, averageCost: 4.75 },
            { accountName: "Group Beta - Account Two", symbol: "BBB", shares: 125, averageCost: 11.11 },
            { accountName: "Group Gamma - Account Three", symbol: "DDD", shares: 75, averageCost: 7.25 }
          ]
        };
      } else if (request.action === "extractCallOptionQuotes") {
        const quotesBySymbol = {};
        const diagnosticsBySymbol = {};
        for (const requestRow of request.payload.requests || []) {
          const symbol = String(requestRow.symbol || "").toUpperCase();
          if (!symbol || quotesBySymbol[symbol]) {
            continue;
          }
          quotesBySymbol[symbol] = [
            {
              strike: 14,
              bid: 0.25,
              rawText: "strike 14 price 0.25"
            }
          ];
          diagnosticsBySymbol[symbol] = { quotesFound: 1 };
        }
        payload = {
          optionQuotesBySymbol: quotesBySymbol,
          optionDiagnosticsBySymbol: diagnosticsBySymbol
        };
      }

      window.postMessage(
        {
          type: "WHEEL_SCREENER_EXTENSION_RESPONSE",
          id: event.data.id,
          ok: true,
          payload
        },
        window.location.origin
      );
    });
  });
}

async function announceDashboardExtensionReady(page) {
  await page.evaluate(() => {
    window.postMessage(
      {
        type: "WHEEL_SCREENER_EXTENSION_READY",
        version: "0.2.14"
      },
      window.location.origin
    );
  });
}

async function assertCcAutoFinalizesImportedPositions(page, baseUrl) {
  const apiCalls = [];
  await installDashboardExtensionStub(page);
  await installDashboardApiStubs(page, apiCalls);

  await page.addInitScript(() => {
    window.localStorage.setItem("wheel-screener-onboarding-v2", "true");
  });
  await page.goto(`${baseUrl}/dashboard.html?strategy=cc`, { waitUntil: "domcontentloaded" });
  await announceDashboardExtensionReady(page);
  await page.locator("#sourceModes").getByRole("button", { name: "Robinhood", exact: true }).waitFor({ timeout: 3000 });
  await page.locator("#ccInputModes").getByRole("button", { name: "Auto", exact: true }).click();
  await page.getByRole("button", { name: "Scan", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("#runButton")?.textContent.trim() === "Refresh");

  const helperRequests = await page.evaluate(() => window.__dashboardHelperRequests || []);
  const prepareRequest = helperRequests.find((request) => request.action === "prepareRobinhoodScan");
  assert.deepEqual(prepareRequest?.payload, { strategy: "cc", inputMode: "auto" });
  assert.ok(helperRequests.some((request) => request.action === "extractStockPositions"));
  assert.ok(helperRequests.some((request) => request.action === "extractCallOptionQuotes"));
  assert.ok(
    helperRequests.findIndex((request) => request.action === "prepareRobinhoodScan") <
      helperRequests.findIndex((request) => request.action === "extractStockPositions")
  );
  assert.ok(apiCalls.some((call) => call.kind === "ccForecast"));
  assert.ok(apiCalls.some((call) => call.kind === "ccFinalize"));

  const quoteRequest = helperRequests.find((request) => request.action === "extractCallOptionQuotes");
  assert.ok(quoteRequest.payload.requests.some((request) => request.symbol === "AAA"));
  assert.ok(quoteRequest.payload.requests.some((request) => request.symbol === "BBB"));
  assert.ok(quoteRequest.payload.requests.some((request) => request.symbol === "CCC"));
  assert.equal(quoteRequest.payload.requests.some((request) => request.symbol === "DDD"), false);

  const symbolValues = await page.locator("[data-cc-field='symbol']").evaluateAll((inputs) =>
    inputs.map((input) => input.value)
  );
  assert.ok(symbolValues.includes("AAA"));
  assert.ok(symbolValues.includes("BBB"));
  assert.ok(symbolValues.includes("CCC"));
  assert.ok(symbolValues.includes("DDD"));
  const rowText = await page.locator("#resultBody").innerText();
  assert.match(rowText, /\$0\.25/);
  assert.match(rowText, /\(10%\)/);
}

async function assertCspAutoUsesEditedScreenerName(page, baseUrl) {
  const apiCalls = [];
  await installDashboardExtensionStub(page);
  await installDashboardApiStubs(page, apiCalls);
  await page.addInitScript(() => {
    window.localStorage.setItem("wheel-screener-onboarding-v2", "true");
  });

  await page.goto(`${baseUrl}/dashboard.html?strategy=csp`, { waitUntil: "domcontentloaded" });
  await announceDashboardExtensionReady(page);
  await page.locator("#cspInputModes").getByRole("button", { name: "Auto", exact: true }).click();
  await page.getByRole("button", { name: "Manage", exact: true }).click();
  await page.locator("#screenersDialog").waitFor({ state: "visible" });

  const selectedId = await page.locator("#screenersList input[name='activeScreener']:checked").inputValue();
  const editedName = "Neutral Edited Screener";
  await page.locator(`#screenersList [data-screener-name='${selectedId}']`).fill(editedName);
  await page.getByRole("button", { name: "Close screener manager", exact: true }).click();
  await page.getByRole("button", { name: "Scan", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("#runButton")?.textContent.trim() === "Refresh");

  const helperRequests = await page.evaluate(() => window.__dashboardHelperRequests || []);
  const extractionRequest = helperRequests.find((request) => request.action === "extractScreener");
  assert.equal(extractionRequest?.payload?.screenerName, editedName);
  assert.ok(apiCalls.some((call) => call.kind === "cspForecast"));
  assert.ok(apiCalls.some((call) => call.kind === "cspFinalize"));
}

test("Robinhood helper clicks the exact CSP screener name before extracting symbols", async () => {
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();
    await page.route("https://robinhood.com/**", (route) => route.fulfill({
      status: 200,
      contentType: "text/html",
      body: robinhoodScreenerFixtureHtml()
    }));
    await page.goto("https://robinhood.com/?classic=1", { waitUntil: "domcontentloaded" });
    await injectRobinhoodContentScript(page);

    const result = await sendRobinhoodHelperMessage(page, {
      action: "extractScreener",
      screenerName: "Primary Saved Screener"
    });

    assert.equal(result.error, undefined);
    assert.equal(result.source, "robinhood");
    assert.match(result.url, /^https:\/\/robinhood\.com\/screener\/fixture-\d+\?source=/);
    assert.deepEqual(result.symbols.slice(0, 5), ["AAA", "BBB", "CCC", "DDD", "EEE"]);
    assert.deepEqual(
      await page.evaluate(() => window.__renderedScreenerSymbols),
      ["AAA", "BBB", "CCC", "DDD", "EEE"]
    );
    assert.equal(await page.evaluate(() => window.__clickedScreener), "Primary Saved Screener");
    assert.deepEqual(
      await page.evaluate(() => window.__clickedScreenerTarget),
      { tagName: "SPAN", className: "css-y3z1hq" }
    );
    assert.equal(result.symbols.includes("XXX"), false);
    assert.equal(result.symbols.includes("YYY"), false);
    assert.equal(result.symbols.includes("HHH"), false);
    assert.equal(result.symbols.includes("III"), false);
    assert.equal(result.symbols.includes("JJJ"), false);
    const scrollState = await page.evaluate(() => ({
      scrollY: window.scrollY,
      bodyWheelCount: window.__bodyWheelCount,
      bodyWheelBeforeScreenerClick: window.__bodyWheelBeforeScreenerClick,
      listsWheelCount: window.__listsWheelCount
    }));
    assert.equal(scrollState.bodyWheelBeforeScreenerClick, 0);
  } finally {
    await browser.close();
  }
});

test("Robinhood helper searches the Lists panel without slowly scrolling Home", async () => {
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();
    await page.route("https://robinhood.com/**", (route) => route.fulfill({
      status: 200,
      contentType: "text/html",
      body: robinhoodScreenerFixtureHtml({ targetBelowFold: true })
    }));
    await page.goto("https://robinhood.com/", { waitUntil: "domcontentloaded" });
    await injectRobinhoodContentScript(page);

    const result = await sendRobinhoodHelperMessage(page, {
      action: "extractScreener",
      screenerName: "Primary Saved Screener"
    });

    assert.equal(result.error, undefined);
    assert.equal(result.source, "robinhood");
    assert.deepEqual(result.symbols.slice(0, 5), ["AAA", "BBB", "CCC", "DDD", "EEE"]);
    assert.equal(await page.evaluate(() => window.__clickedScreener), "Primary Saved Screener");
    assert.deepEqual(
      await page.evaluate(() => window.__clickedScreenerTarget),
      { tagName: "SPAN", className: "css-y3z1hq" }
    );
    assert.equal(result.symbols.includes("HHH"), false);
    assert.equal(result.symbols.includes("III"), false);
    assert.equal(result.symbols.includes("JJJ"), false);
    const scrollState = await page.evaluate(() => ({
      scrollY: window.scrollY,
      bodyWheelCount: window.__bodyWheelCount,
      bodyWheelBeforeScreenerClick: window.__bodyWheelBeforeScreenerClick
    }));
    assert.equal(scrollState.bodyWheelBeforeScreenerClick, 0);
  } finally {
    await browser.close();
  }
});

test("Robinhood helper does not extract Home symbols when the CSP screener is missing", async () => {
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();
    await page.route("https://robinhood.com/**", (route) => route.fulfill({
      status: 200,
      contentType: "text/html",
      body: robinhoodScreenerFixtureHtml()
    }));
    await page.goto("https://robinhood.com/", { waitUntil: "domcontentloaded" });
    await injectRobinhoodContentScript(page);

    const result = await sendRobinhoodHelperMessage(page, {
      action: "extractScreener",
      screenerName: "Missing Saved Screener"
    });

    assert.match(result.error, /Could not find Robinhood screener named/);
    assert.equal(await page.evaluate(() => window.__clickedScreener || null), null);
  } finally {
    await browser.close();
  }
});

test("Robinhood helper reuses only an already-open matching screener", async () => {
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();
    await page.route("https://robinhood.com/**", (route) => route.fulfill({
      status: 200,
      contentType: "text/html",
      body: robinhoodScreenerFixtureHtml()
    }));
    await page.goto("https://robinhood.com/?classic=1", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => window.renderScreener("Primary Saved Screener"));
    await injectRobinhoodContentScript(page);

    const result = await sendRobinhoodHelperMessage(page, {
      action: "extractScreener",
      screenerName: "Primary Saved Screener"
    });

    assert.equal(result.error, undefined);
    assert.equal(result.retryFromHome, undefined);
    assert.deepEqual(result.symbols.slice(0, 5), ["AAA", "BBB", "CCC", "DDD", "EEE"]);
  } finally {
    await browser.close();
  }
});

test("Robinhood helper requests Home when the open screener name does not match", async () => {
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();
    await page.route("https://robinhood.com/**", (route) => route.fulfill({
      status: 200,
      contentType: "text/html",
      body: robinhoodScreenerFixtureHtml()
    }));
    await page.goto("https://robinhood.com/?classic=1", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => window.renderScreener("Primary Saved Screener Growth"));
    await injectRobinhoodContentScript(page);

    const result = await sendRobinhoodHelperMessage(page, {
      action: "extractScreener",
      screenerName: "Primary Saved Screener"
    });

    assert.deepEqual(result, { retryFromHome: true });
  } finally {
    await browser.close();
  }
});

test("Robinhood helper validates screener name title normalization and visible-text fallback", async () => {
  const browser = await chromium.launch({ headless: true });

  try {
    for (const nameControlMode of ["normalized-title", "text-only"]) {
      const page = await browser.newPage();
      try {
        await page.route("https://robinhood.com/**", (route) => route.fulfill({
          status: 200,
          contentType: "text/html",
          body: robinhoodScreenerFixtureHtml({ nameControlMode })
        }));
        await page.goto("https://robinhood.com/?classic=1", { waitUntil: "domcontentloaded" });
        await page.evaluate(() => window.renderScreener("Primary Saved Screener"));
        await injectRobinhoodContentScript(page);

        const result = await sendRobinhoodHelperMessage(page, {
          action: "extractScreener",
          screenerName: "Primary Saved Screener"
        });

        assert.equal(result.error, undefined);
        assert.deepEqual(result.symbols.slice(0, 5), ["AAA", "BBB", "CCC", "DDD", "EEE"]);
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
});

test("Robinhood helper does not validate a screener route from the sidebar label alone", async () => {
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();
    await page.route("https://robinhood.com/**", (route) => route.fulfill({
      status: 200,
      contentType: "text/html",
      body: robinhoodScreenerFixtureHtml({ nameControlMode: "missing" })
    }));
    await page.goto("https://robinhood.com/?classic=1", { waitUntil: "domcontentloaded" });
    await injectRobinhoodContentScript(page);

    const result = await sendRobinhoodHelperMessage(page, {
      action: "extractScreener",
      screenerName: "Primary Saved Screener"
    });

    assert.match(result.error, /screener name could not be confirmed/);
    assert.equal(result.symbols, undefined);
  } finally {
    await browser.close();
  }
});

test("Robinhood helper refuses CSP extraction when a list click does not open a screener URL", async () => {
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();
    await page.route("https://robinhood.com/**", (route) => route.fulfill({
      status: 200,
      contentType: "text/html",
      body: robinhoodScreenerFixtureHtml({ navigateOnClick: false })
    }));
    await page.goto("https://robinhood.com/?classic=1", { waitUntil: "domcontentloaded" });
    await injectRobinhoodContentScript(page);

    const result = await sendRobinhoodHelperMessage(page, {
      action: "extractScreener",
      screenerName: "Primary Saved Screener"
    });

    assert.match(result.error, /did not open its screener page/);
    assert.equal(result.symbols, undefined);
  } finally {
    await browser.close();
  }
});

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
      position.accountName === "Group Alpha - Account One" &&
      position.symbol === "AAA" &&
      position.shares === 200 &&
      position.averageCost === 21.55
    ));
    assert.ok(positions.some((position) =>
      position.accountName === "Group Alpha - Account One" &&
      position.symbol === "BBB" &&
      position.shares === 450 &&
      position.averageCost === 13.37
    ));
    assert.ok(positions.some((position) =>
      position.accountName === "Group Alpha - Account One" &&
      position.symbol === "CCC" &&
      position.shares === 1250 &&
      position.averageCost === 4.75
    ));
    assert.ok(positions.some((position) =>
      position.accountName === "Group Beta - Account Two" &&
      position.symbol === "BBB" &&
      position.shares === 125 &&
      position.averageCost === 11.11
    ));
    assert.ok(positions.some((position) =>
      position.accountName === "Group Gamma - Account Three" &&
      position.symbol === "DDD" &&
      position.shares === 75 &&
      position.averageCost === 7.25
    ));
    assert.equal(positions.filter((position) => position.symbol === "BBB").length, 2);

    const clickedControls = await page.evaluate(() => window.__clickedControls);
    assert.equal(clickedControls.some((entry) => entry.startsWith("distractor:")), false);
    assert.ok(clickedControls.filter((entry) => entry === "control:account-dropdown").length >= 1);
    assert.deepEqual(
      clickedControls.filter((entry) => entry.startsWith("option:")).sort(),
      ["option:beta", "option:gamma"]
    );
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
    const ccAutoPage = await browser.newPage();
    try {
      await assertCcAutoFinalizesImportedPositions(ccAutoPage, baseUrl);
    } finally {
      await ccAutoPage.close();
    }
    const cspEditedNamePage = await browser.newPage();
    try {
      await assertCspAutoUsesEditedScreenerName(cspEditedNamePage, baseUrl);
    } finally {
      await cspEditedNamePage.close();
    }

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
