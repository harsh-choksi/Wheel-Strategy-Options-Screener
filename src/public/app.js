const state = {
  screeners: [],
  screenerId: "safe",
  mode: "mock",
  lastResult: null,
  lastForecastResult: null,
  lastOptionQuotesBySymbol: null,
  lastOptionDiagnosticsBySymbol: null,
  minCspReturnPercent: 2,
  showAll: true,
  helper: {
    installed: false,
    version: null
  },
  session: null
};

const elements = {
  sessionPill: document.querySelector("#sessionPill"),
  screenerTabs: document.querySelector("#screenerTabs"),
  portfolioInput: document.querySelector("#portfolioInput"),
  weeklyReturnInput: document.querySelector("#weeklyReturnInput"),
  yearlyReturnInput: document.querySelector("#yearlyReturnInput"),
  runButton: document.querySelector("#runButton"),
  exportButton: document.querySelector("#exportButton"),
  notice: document.querySelector("#notice"),
  resultBody: document.querySelector("#resultBody"),
  eligibleMetric: document.querySelector("#eligibleMetric"),
  symbolMetric: document.querySelector("#symbolMetric"),
  allocatedMetric: document.querySelector("#allocatedMetric"),
  updatedMetric: document.querySelector("#updatedMetric"),
  tableTitle: document.querySelector("#tableTitle"),
  tableSubtitle: document.querySelector("#tableSubtitle"),
  showAllToggle: document.querySelector("#showAllToggle"),
  connectionTitle: document.querySelector("#connectionTitle"),
  connectionSubtitle: document.querySelector("#connectionSubtitle"),
  connectionActions: document.querySelector("#connectionActions"),
  installHelperLink: document.querySelector("#installHelperLink"),
  connectButton: document.querySelector("#connectButton"),
  sourceModes: document.querySelector("#sourceModes"),
  onboardingDialog: document.querySelector("#onboardingDialog"),
  onboardingCloseButton: document.querySelector("#onboardingCloseButton"),
  onboardingMockButton: document.querySelector("#onboardingMockButton")
};

const moneyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2
});

const percentFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2
});
const TABLE_LABELS = [
  "Rank",
  "Symbol",
  "Status",
  "Current",
  "Min",
  "Avg",
  "Max",
  "Allocation",
  "Target",
  "Strike",
  "Bid",
  "Return",
  "Contracts",
  "Used"
];
const EXTENSION_REQUEST_TYPE = "WHEEL_SCREENER_EXTENSION_REQUEST";
const EXTENSION_RESPONSE_TYPE = "WHEEL_SCREENER_EXTENSION_RESPONSE";
const EXTENSION_READY_TYPE = "WHEEL_SCREENER_EXTENSION_READY";
const TRADING_WEEKS_PER_YEAR = 52;
const DEFAULT_WEEKLY_RETURN_PERCENT = 2;
let extensionRequestId = 0;
let extensionDetectionTimer = null;
let portfolioReallocationTimer = null;
let portfolioReallocationId = 0;
let returnRecalculationTimer = null;
let returnRecalculationId = 0;
let syncingReturnInputs = false;
const ONBOARDING_SEEN_KEY = "wheel-screener-onboarding-v1";

function rememberOnboardingDismissed() {
  try {
    window.localStorage.setItem(ONBOARDING_SEEN_KEY, "true");
  } catch {
    // The guide remains available when browser storage is disabled.
  }
}

function dismissOnboarding() {
  rememberOnboardingDismissed();

  if (elements.onboardingDialog.open) {
    elements.onboardingDialog.close();
  }
}

function initOnboarding() {
  let hasSeenOnboarding = false;

  try {
    hasSeenOnboarding = window.localStorage.getItem(ONBOARDING_SEEN_KEY) === "true";
  } catch {
    // Show the walkthrough when browser storage is unavailable.
  }

  elements.onboardingCloseButton.addEventListener("click", dismissOnboarding);
  elements.onboardingMockButton.addEventListener("click", () => {
    setMode("mock");
    dismissOnboarding();
  });
  elements.onboardingDialog.addEventListener("cancel", dismissOnboarding);
  elements.onboardingDialog.addEventListener("click", (event) => {
    if (event.target === elements.onboardingDialog) {
      dismissOnboarding();
    }
  });

  for (const link of elements.onboardingDialog.querySelectorAll("[data-onboarding-dismiss]")) {
    link.addEventListener("click", rememberOnboardingDismissed);
  }

  if (!hasSeenOnboarding) {
    elements.onboardingDialog.showModal();
  }
}

function formatMoney(value) {
  return Number.isFinite(value) ? moneyFormatter.format(value) : "--";
}

function formatNumber(value) {
  return Number.isFinite(value) ? value.toFixed(2) : "--";
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${percentFormatter.format(value)}%` : "--";
}

function weeklyToYearlyPercent(weeklyPercent) {
  return (Math.pow(1 + weeklyPercent / 100, TRADING_WEEKS_PER_YEAR) - 1) * 100;
}

function yearlyToWeeklyPercent(yearlyPercent) {
  return (Math.pow(1 + yearlyPercent / 100, 1 / TRADING_WEEKS_PER_YEAR) - 1) * 100;
}

function formatReturnInput(value) {
  if (!Number.isFinite(value)) {
    return "";
  }

  return Number.parseFloat(value.toFixed(4)).toString();
}

function parsePercentInput(input) {
  const value = Number.parseFloat(input.value);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function minCspReturnDecimal() {
  return state.minCspReturnPercent / 100;
}

function syncReturnInputsFromWeekly(weeklyPercent, activeInput) {
  if (!Number.isFinite(weeklyPercent) || weeklyPercent < 0) {
    return;
  }

  syncingReturnInputs = true;
  if (activeInput !== elements.weeklyReturnInput) {
    elements.weeklyReturnInput.value = formatReturnInput(weeklyPercent);
  }
  if (activeInput !== elements.yearlyReturnInput) {
    elements.yearlyReturnInput.value = formatReturnInput(weeklyToYearlyPercent(weeklyPercent));
  }
  syncingReturnInputs = false;
}

function resetReturnInputs() {
  state.minCspReturnPercent = DEFAULT_WEEKLY_RETURN_PERCENT;
  syncReturnInputsFromWeekly(DEFAULT_WEEKLY_RETURN_PERCENT, null);
}

function commitReturnTargetFromInputs() {
  const weeklyPercent = parsePercentInput(elements.weeklyReturnInput);
  if (weeklyPercent === null) {
    resetReturnInputs();
    return minCspReturnDecimal();
  }

  state.minCspReturnPercent = weeklyPercent;
  syncReturnInputsFromWeekly(weeklyPercent, elements.weeklyReturnInput);
  return minCspReturnDecimal();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function setNotice(message, type = "info") {
  if (!message) {
    elements.notice.hidden = true;
    elements.notice.textContent = "";
    elements.notice.className = "notice";
    return;
  }

  elements.notice.hidden = false;
  elements.notice.textContent = message;
  elements.notice.className = type === "error" ? "notice error" : "notice";
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json();

  if (!response.ok || payload.error) {
    throw new Error(payload.error || `Request failed with ${response.status}`);
  }

  return payload;
}

function requestExtension(action, payload = {}, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const id = `request-${Date.now()}-${extensionRequestId++}`;
    const timeout = setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(
        new Error(
          action === "extractScreener"
            ? "Chrome helper timed out while reading Robinhood. Keep the Robinhood tab open, then try again."
            : action === "extractPutOptionQuotes"
              ? "Chrome helper timed out while checking Robinhood option chains. Keep the Robinhood tab open, then try again."
            : "Chrome extension helper is not installed or did not respond."
        )
      );
    }, timeoutMs);

    function onMessage(event) {
      if (
        event.source !== window ||
        event.data?.type !== EXTENSION_RESPONSE_TYPE ||
        event.data.id !== id
      ) {
        return;
      }

      clearTimeout(timeout);
      window.removeEventListener("message", onMessage);

      if (!event.data.ok) {
        reject(new Error(event.data.error || "Chrome extension helper failed."));
        return;
      }

      resolve(event.data.payload || {});
    }

    window.addEventListener("message", onMessage);
    window.postMessage(
      {
        type: EXTENSION_REQUEST_TYPE,
        id,
        action,
        payload
      },
      window.location.origin
    );
  });
}

function applyHelperDetected(helper) {
  state.helper = {
    installed: true,
    version: helper.version || null
  };

  if (state.session) {
    renderSession(state.session);
    setMode("live");
  }
}

async function refreshExtensionHelper({ silent = true } = {}) {
  try {
    const helper = await requestExtension("ping", {}, 2500);
    applyHelperDetected(helper);
    stopExtensionDetection();
    return true;
  } catch {
    if (!silent) {
      state.helper = {
        installed: false,
        version: null
      };
      if (state.session) {
        renderSession(state.session);
      }
    }
    return false;
  }
}

function stopExtensionDetection() {
  if (extensionDetectionTimer) {
    clearInterval(extensionDetectionTimer);
    extensionDetectionTimer = null;
  }
}

function startExtensionDetection() {
  stopExtensionDetection();
  let attempts = 0;

  extensionDetectionTimer = setInterval(async () => {
    attempts += 1;
    const detected = await refreshExtensionHelper({ silent: true });
    if (detected || attempts >= 20) {
      stopExtensionDetection();
    }
  }, 1000);
}

function bindExtensionReadyListener() {
  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.type !== EXTENSION_READY_TYPE) {
      return;
    }

    applyHelperDetected({
      version: event.data.version || null
    });
    stopExtensionDetection();
  });
}

function activeConnection() {
  if (state.helper.installed) {
    return { id: "chrome-extension" };
  }

  return null;
}

function setMode(mode) {
  if (mode === "live" && !activeConnection()) {
    state.mode = "mock";
  } else {
    state.mode = mode;
  }

  for (const button of elements.sourceModes.querySelectorAll("[data-mode]")) {
    button.classList.toggle("active", button.dataset.mode === state.mode);
  }
  updateTableHeading();
}

function renderSourceModes() {
  for (const button of elements.sourceModes.querySelectorAll("[data-mode]")) {
    button.disabled = button.dataset.mode === "live" && !activeConnection();
  }

  setMode(state.mode);
}

function renderScreenerTabs() {
  elements.screenerTabs.innerHTML = "";

  for (const screener of state.screeners) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `segment${screener.id === state.screenerId ? " active" : ""}`;
    button.textContent = screener.shortName || screener.name;
    button.addEventListener("click", () => {
      if (screener.id === state.screenerId) {
        return;
      }

      state.screenerId = screener.id;
      renderScreenerTabs();
      updateTableHeading();

      if (state.lastResult && !elements.runButton.disabled) {
        runScan();
      }
    });
    elements.screenerTabs.append(button);
  }
}

function updateTableHeading() {
  const screener = state.screeners.find((item) => item.id === state.screenerId);
  elements.tableTitle.textContent = screener ? `${screener.shortName} Screener` : "Screener";
}

function renderSession(session) {
  state.session = session;
  const helperReady = Boolean(state.helper.installed);

  elements.connectionTitle.textContent = "Robinhood";
  elements.connectionSubtitle.textContent = helperReady
    ? "Helper ready. Open Robinhood, log in, then scan."
    : "Install the Chrome helper to scan Safe, Standard, and Mini lists.";

  elements.sessionPill.className = `session-pill ${helperReady ? "ready" : "missing"}`;
  elements.sessionPill.textContent = helperReady ? "Helper ready" : "Mock mode";

  elements.connectButton.hidden = false;
  elements.connectButton.disabled = !helperReady;
  elements.connectButton.textContent = "Open Robinhood";
  elements.installHelperLink.hidden = helperReady;

  renderSourceModes();
  updateTableHeading();
}

function rowStatus(row) {
  if (row.status === "skip") {
    return "skip";
  }

  if (row.eligible && row.used === false) {
    return "unused";
  }

  if (row.eligible) {
    return "eligible";
  }

  if (row.status === "ok") {
    return "ineligible";
  }

  return row.status || "unavailable";
}

function renderRows() {
  const result = state.lastResult;

  if (!result) {
    elements.resultBody.innerHTML =
      '<tr><td colspan="14" class="empty-cell">No scan has run yet.</td></tr>';
    elements.exportButton.disabled = true;
    return;
  }

  const rows = state.showAll
    ? result.rows
    : result.rows.filter((row) => row.eligible || rowStatus(row) === "skip");

  if (rows.length === 0) {
    elements.resultBody.innerHTML =
      '<tr><td colspan="14" class="empty-cell">No rows match the current filter.</td></tr>';
    elements.exportButton.disabled = true;
    return;
  }

  elements.exportButton.disabled = false;
  elements.resultBody.innerHTML = rows
    .map((row) => {
      const status = rowStatus(row);
      const label =
        status === "eligible"
          ? "Eligible"
          : status === "unused"
            ? "Unused"
            : status === "skip"
              ? "SKIP"
            : status === "ineligible"
              ? "Below min"
              : "Unavailable";
      const safeSymbol = escapeHtml(row.symbol);
      const symbolCell = row.url
        ? `<a class="symbol-link" href="${escapeHtml(row.url)}" target="_blank" rel="noreferrer">${safeSymbol}</a>`
        : safeSymbol;

      return `
        <tr title="${escapeHtml(row.error || "")}">
          <td data-label="${TABLE_LABELS[0]}">${row.rank ?? "--"}</td>
          <td data-label="${TABLE_LABELS[1]}">${symbolCell}</td>
          <td data-label="${TABLE_LABELS[2]}"><span class="status ${status}">${label}</span></td>
          <td data-label="${TABLE_LABELS[3]}">${formatMoney(row.currentPrice)}</td>
          <td data-label="${TABLE_LABELS[4]}">${formatMoney(row.minTarget)}</td>
          <td data-label="${TABLE_LABELS[5]}">${formatMoney(row.averageTarget)}</td>
          <td data-label="${TABLE_LABELS[6]}">${formatMoney(row.maxTarget)}</td>
          <td data-label="${TABLE_LABELS[7]}">${formatPercent(row.allocationPercent)}</td>
          <td data-label="${TABLE_LABELS[8]}">${formatMoney(row.allocationDollars)}</td>
          <td class="highlight-column" data-label="${TABLE_LABELS[9]}">${formatNumber(row.cspStrike)}</td>
          <td class="highlight-column" data-label="${TABLE_LABELS[10]}">${formatMoney(row.cspBid)}</td>
          <td data-label="${TABLE_LABELS[11]}">${formatPercent(row.cspReturnPercent)}</td>
          <td class="highlight-column" data-label="${TABLE_LABELS[12]}">${Number.isFinite(row.contracts) ? row.contracts : "--"}</td>
          <td data-label="${TABLE_LABELS[13]}">${formatMoney(row.actualCollateralDollars)}</td>
        </tr>
      `;
    })
    .join("");
}

function renderSummary(result) {
  const used = result.rows.reduce(
    (sum, row) =>
      sum + (Number.isFinite(row.actualCollateralDollars) ? row.actualCollateralDollars : 0),
    0
  );

  elements.eligibleMetric.textContent = String(result.eligibleCount);
  elements.symbolMetric.textContent = String(result.symbols.length);
  elements.allocatedMetric.textContent = formatMoney(used);
  elements.updatedMetric.textContent = new Date(result.generatedAt).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  });
  elements.tableSubtitle.textContent = `${result.source} source - ${result.symbols.length} symbols scanned`;
}

function clearPortfolioReallocationTimer() {
  if (portfolioReallocationTimer) {
    clearTimeout(portfolioReallocationTimer);
    portfolioReallocationTimer = null;
  }
}

function clearReturnRecalculationTimer() {
  if (returnRecalculationTimer) {
    clearTimeout(returnRecalculationTimer);
    returnRecalculationTimer = null;
  }
}

function hasCachedFinalizationInputs() {
  return Boolean(state.lastForecastResult);
}

async function finalizeFromCachedScan() {
  if (!hasCachedFinalizationInputs()) {
    return;
  }

  const portfolioValue = Number.parseFloat(elements.portfolioInput.value);
  const requestId = ++returnRecalculationId;

  try {
    const result = await fetchJson("/api/finalize", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        portfolioValue,
        result: state.lastForecastResult,
        optionQuotesBySymbol: state.lastOptionQuotesBySymbol,
        optionDiagnosticsBySymbol: state.lastOptionDiagnosticsBySymbol,
        minCspReturnDecimal: minCspReturnDecimal()
      })
    });

    if (requestId !== returnRecalculationId) {
      return;
    }

    state.lastResult = result;
    renderSummary(result);
    renderRows();
    setNotice("");
  } catch (error) {
    if (requestId === returnRecalculationId) {
      setNotice(error.message, "error");
    }
  }
}

async function reallocatePortfolio() {
  if (!state.lastResult) {
    return;
  }

  const portfolioValue = Number.parseFloat(elements.portfolioInput.value);
  const requestId = ++portfolioReallocationId;

  try {
    const result = await fetchJson("/api/reallocate", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        portfolioValue,
        result: state.lastResult
      })
    });

    if (requestId !== portfolioReallocationId) {
      return;
    }

    state.lastResult = result;
    renderSummary(result);
    renderRows();
    setNotice("");
  } catch (error) {
    if (requestId === portfolioReallocationId) {
      setNotice(error.message, "error");
    }
  }
}

function schedulePortfolioReallocation() {
  clearPortfolioReallocationTimer();

  if (!state.lastResult) {
    return;
  }

  portfolioReallocationTimer = setTimeout(() => {
    portfolioReallocationTimer = null;
    reallocatePortfolio();
  }, 250);
}

function scheduleReturnRecalculation() {
  clearReturnRecalculationTimer();

  if (!hasCachedFinalizationInputs()) {
    return;
  }

  returnRecalculationTimer = setTimeout(() => {
    returnRecalculationTimer = null;
    finalizeFromCachedScan();
  }, 250);
}

function handleWeeklyReturnInput() {
  if (syncingReturnInputs) {
    return;
  }

  const weeklyPercent = parsePercentInput(elements.weeklyReturnInput);
  if (weeklyPercent === null) {
    return;
  }

  state.minCspReturnPercent = weeklyPercent;
  syncReturnInputsFromWeekly(weeklyPercent, elements.weeklyReturnInput);
  scheduleReturnRecalculation();
}

function handleYearlyReturnInput() {
  if (syncingReturnInputs) {
    return;
  }

  const yearlyPercent = parsePercentInput(elements.yearlyReturnInput);
  if (yearlyPercent === null) {
    return;
  }

  const weeklyPercent = yearlyToWeeklyPercent(yearlyPercent);
  state.minCspReturnPercent = weeklyPercent;
  syncReturnInputsFromWeekly(weeklyPercent, elements.yearlyReturnInput);
  scheduleReturnRecalculation();
}

function restoreReturnInputIfInvalid(event) {
  if (parsePercentInput(event.currentTarget) === null) {
    resetReturnInputs();
  }
}

async function refreshSession() {
  const session = await fetchJson("/api/session");
  renderSession(session);
}

async function runScan() {
  clearPortfolioReallocationTimer();
  clearReturnRecalculationTimer();
  portfolioReallocationId += 1;
  returnRecalculationId += 1;
  const portfolioValue = Number.parseFloat(elements.portfolioInput.value);
  const selectedReturn = commitReturnTargetFromInputs();

  if (state.mode === "live" && !activeConnection()) {
    setNotice("Connect Robinhood and finish login before scanning.", "error");
    return;
  }

  elements.runButton.disabled = true;
  elements.runButton.textContent = "Scanning...";
  setNotice(
    state.mode === "live" && state.helper.installed
      ? "Reading the selected Robinhood list, then checking TradingView and put chains."
      : state.mode === "live"
        ? "Extracting the selected Robinhood screener list and scanning TradingView."
        : "Mock mode uses built-in symbols and sample option quotes with live TradingView data."
  );

  try {
    let helperSymbols = null;
    let result = null;
    let forecastResult = null;
    let optionQuotesBySymbol = null;
    let optionDiagnosticsBySymbol = null;

    if (state.mode === "live" && state.helper.installed) {
      const stillReady = await refreshExtensionHelper({ silent: false });
      if (!stillReady) {
        throw new Error("Chrome extension helper is not installed or did not respond.");
      }

      const screener = state.screeners.find((item) => item.id === state.screenerId);
      const extraction = await requestExtension(
        "extractScreener",
        {
          screenerId: state.screenerId,
          screenerName: screener?.name
        },
        300000
      );

      helperSymbols = Array.isArray(extraction.symbols) ? extraction.symbols : [];
      if (helperSymbols.length === 0) {
        throw new Error("The Chrome helper did not find any symbols in that Robinhood list.");
      }

      setNotice(`Scanning TradingView forecasts for ${helperSymbols.length} Robinhood symbols.`);
      forecastResult = await fetchJson("/api/forecast", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          portfolioValue,
          screenerId: state.screenerId,
          mode: state.mode,
          symbols: helperSymbols,
          source: "robinhood",
          minCspReturnDecimal: selectedReturn
        })
      });

      const optionRequests = Array.isArray(forecastResult.optionRequests)
        ? forecastResult.optionRequests
        : [];
      optionQuotesBySymbol = {};
      optionDiagnosticsBySymbol = {};

      if (optionRequests.length > 0) {
        setNotice(
          `Checking Robinhood sell-put chains for ${optionRequests.length} TradingView-eligible symbols.`
        );
        const quoteResult = await requestExtension(
          "extractPutOptionQuotes",
          {
            requests: optionRequests
          },
          Math.max(300000, optionRequests.length * 45000)
        );
        optionQuotesBySymbol = quoteResult.optionQuotesBySymbol || {};
        optionDiagnosticsBySymbol = quoteResult.optionDiagnosticsBySymbol || {};
      }

      result = await fetchJson("/api/finalize", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          portfolioValue,
          result: forecastResult,
          optionQuotesBySymbol,
          optionDiagnosticsBySymbol,
          minCspReturnDecimal: selectedReturn
        })
      });
    } else {
      forecastResult = await fetchJson("/api/forecast", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          portfolioValue,
          screenerId: state.screenerId,
          mode: state.mode,
          minCspReturnDecimal: selectedReturn
        })
      });

      result = await fetchJson("/api/finalize", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          portfolioValue,
          result: forecastResult,
          minCspReturnDecimal: selectedReturn
        })
      });
    }

    state.lastResult = result;
    state.lastForecastResult = forecastResult;
    state.lastOptionQuotesBySymbol = optionQuotesBySymbol;
    state.lastOptionDiagnosticsBySymbol = optionDiagnosticsBySymbol;
    renderSummary(result);
    renderRows();
    setNotice("");
  } catch (error) {
    setNotice(error.message, "error");
  } finally {
    elements.runButton.disabled = false;
    elements.runButton.textContent = "Refresh";
  }
}

async function connectRobinhood() {
  elements.connectButton.disabled = true;
  elements.connectButton.textContent = "Opening...";

  try {
    if (state.helper.installed) {
      await requestExtension("connect", {}, 10000);
      setNotice("Robinhood opened in Chrome. Log in there, then return here and refresh.");
    } else {
      window.location.href = "/helper.html";
    }
  } catch (error) {
    setNotice(error.message, "error");
    await refreshSession().catch(() => {});
  } finally {
    elements.connectButton.disabled = false;
    elements.connectButton.disabled = !state.helper.installed;
    elements.connectButton.textContent = "Open Robinhood";
  }
}

function escapeCsv(value) {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function exportCsv() {
  if (!state.lastResult) {
    return;
  }

  const headers = [
    "Rank",
    "Symbol",
    "Status",
    "Current",
    "Min Target",
    "Avg Target",
    "Max Target",
    "Allocation %",
    "Target $",
    "CSP Strike",
    "Bid",
    "Return %",
    "Contracts",
    "Actual Used"
  ];
  const rows = state.lastResult.rows.map((row) => [
    row.rank ?? "",
    row.symbol,
    rowStatus(row),
    row.currentPrice ?? "",
    row.minTarget ?? "",
    row.averageTarget ?? "",
    row.maxTarget ?? "",
    row.allocationPercent ?? "",
    row.allocationDollars ?? "",
    row.cspStrike ?? "",
    row.cspBid ?? "",
    row.cspReturnPercent ?? "",
    row.contracts ?? "",
    row.actualCollateralDollars ?? ""
  ]);
  const csv = [headers, ...rows].map((row) => row.map(escapeCsv).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `wheel-screener-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function bindModeButtons() {
  elements.sourceModes.addEventListener("click", (event) => {
    const button = event.target.closest("[data-mode]");
    if (!button || button.disabled) {
      return;
    }
    setMode(button.dataset.mode);
  });
}

async function init() {
  initOnboarding();
  bindExtensionReadyListener();
  bindModeButtons();
  elements.runButton.addEventListener("click", runScan);
  elements.exportButton.addEventListener("click", exportCsv);
  elements.connectButton.addEventListener("click", connectRobinhood);
  elements.portfolioInput.addEventListener("input", schedulePortfolioReallocation);
  elements.portfolioInput.addEventListener("change", schedulePortfolioReallocation);
  elements.weeklyReturnInput.addEventListener("input", handleWeeklyReturnInput);
  elements.yearlyReturnInput.addEventListener("input", handleYearlyReturnInput);
  elements.weeklyReturnInput.addEventListener("change", restoreReturnInputIfInvalid);
  elements.yearlyReturnInput.addEventListener("change", restoreReturnInputIfInvalid);
  window.addEventListener("pageshow", () => {
    if (!state.lastResult) {
      resetReturnInputs();
    }
  });
  elements.showAllToggle.addEventListener("change", () => {
    state.showAll = elements.showAllToggle.checked;
    renderRows();
  });
  resetReturnInputs();
  setTimeout(() => {
    if (!state.lastResult) {
      resetReturnInputs();
    }
  }, 0);

  const [screeners, session] = await Promise.all([
    fetchJson("/api/screeners"),
    fetchJson("/api/session"),
    refreshExtensionHelper({ silent: false })
  ]);

  state.screeners = screeners.screeners;
  state.screenerId = screeners.defaultScreenerId;

  renderScreenerTabs();
  renderSession(session);

  setMode(state.mode);
  if (!state.helper.installed) {
    startExtensionDetection();
  }
}

init().catch((error) => {
  setNotice(error.message, "error");
});
