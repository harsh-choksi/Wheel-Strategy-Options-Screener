const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");
const { chromium } = require("playwright");

const ROUTES = [
  "/",
  "/guide.html",
  "/helper.html",
  "/learn.html",
  "/faq.html",
  "/calculator.html",
  "/contact.html",
  "/privacy.html",
  "/terms.html"
];

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

async function assertDashboardVisualLayout(page, baseUrl) {
  await page.addInitScript(() => {
    window.localStorage.setItem("wheel-screener-onboarding-v2", "true");
  });
  await page.setViewportSize({ width: 1760, height: 980 });
  await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
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

  for (const width of [390, 430]) {
    await page.setViewportSize({ width, height: 920 });
    await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
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
    await assertDashboardVisualLayout(page, baseUrl);

    for (const route of ROUTES) {
      const response = await page.goto(`${baseUrl}${route}`, {
        waitUntil: "domcontentloaded"
      });
      assert.equal(response?.status(), 200, `${route} should load`);
      await assert.doesNotReject(() => page.locator("body").waitFor({ timeout: 3000 }));
      const bodyText = await page.locator("body").innerText();
      assert.match(bodyText, /Wheel Strategy Screener|Setup Guide|Contact Us|Privacy Policy|Terms of Service|FAQ|Calculator|Learn/);
    }
  } finally {
    if (browser) {
      await browser.close();
    }
    await stopServer(child);
  }
});
