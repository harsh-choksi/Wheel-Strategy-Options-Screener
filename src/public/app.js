const state = {
  strategy: "csp",
  screeners: [],
  screenerId: "safe",
  cspInputMode: "manual",
  manualCspSymbols: [
    { symbol: "" }
  ],
  ccInputMode: "manual",
  mode: "mock",
  lastResult: null,
  lastForecastResult: null,
  lastOptionQuotesBySymbol: null,
  lastOptionDiagnosticsBySymbol: null,
  lastCcResult: null,
  lastCcForecastResult: null,
  lastCcOptionQuotesBySymbol: null,
  lastCcOptionDiagnosticsBySymbol: null,
  ccPositions: [
    { symbol: "", averageCost: "", contracts: "" }
  ],
  autoCcPositions: [],
  minCspReturnPercent: 1,
  minCcReturnPercent: 2,
  hideUnavailable: false,
  versionInfo: null,
  helper: {
    installed: false,
    version: null
  }
};

const elements = {
  strategyTabs: document.querySelector("#strategyTabs"),
  sessionPill: document.querySelector("#sessionPill"),
  settingsButton: document.querySelector("#settingsButton"),
  cspInputModes: document.querySelector("#cspInputModes"),
  ccInputModes: document.querySelector("#ccInputModes"),
  screenerSelect: document.querySelector("#screenerSelect"),
  manageScreenersButton: document.querySelector("#manageScreenersButton"),
  portfolioInput: document.querySelector("#portfolioInput"),
  weeklyReturnInput: document.querySelector("#weeklyReturnInput"),
  yearlyReturnInput: document.querySelector("#yearlyReturnInput"),
  runButton: document.querySelector("#runButton"),
  exportButton: document.querySelector("#exportButton"),
  notice: document.querySelector("#notice"),
  resultBody: document.querySelector("#resultBody"),
  eligibleMetricLabel: document.querySelector("#eligibleMetricLabel"),
  eligibleMetric: document.querySelector("#eligibleMetric"),
  symbolMetricLabel: document.querySelector("#symbolMetricLabel"),
  symbolMetric: document.querySelector("#symbolMetric"),
  allocatedMetricLabel: document.querySelector("#allocatedMetricLabel"),
  allocatedMetric: document.querySelector("#allocatedMetric"),
  updatedMetric: document.querySelector("#updatedMetric"),
  tableTitle: document.querySelector("#tableTitle"),
  tableSubtitle: document.querySelector("#tableSubtitle"),
  ccListActions: document.querySelector("#ccListActions"),
  manualCspListActions: document.querySelector("#manualCspListActions"),
  showAllToggle: document.querySelector("#showAllToggle"),
  connectionTitle: document.querySelector("#connectionTitle"),
  connectionSubtitle: document.querySelector("#connectionSubtitle"),
  connectionActions: document.querySelector("#connectionActions"),
  installHelperLink: document.querySelector("#installHelperLink"),
  connectButton: document.querySelector("#connectButton"),
  sourceModes: document.querySelector("#sourceModes"),
  resultHead: document.querySelector("#resultHead"),
  onboardingDialog: document.querySelector("#onboardingDialog"),
  onboardingCloseButton: document.querySelector("#onboardingCloseButton"),
  onboardingMockButton: document.querySelector("#onboardingMockButton"),
  screenersDialog: document.querySelector("#screenersDialog"),
  screenersDialogClose: document.querySelector("#screenersDialogClose"),
  screenersList: document.querySelector("#screenersList"),
  newScreenerInput: document.querySelector("#newScreenerInput"),
  addScreenerButton: document.querySelector("#addScreenerButton"),
  settingsDialog: document.querySelector("#settingsDialog"),
  settingsDialogClose: document.querySelector("#settingsDialogClose"),
  exportSettingsButton: document.querySelector("#exportSettingsButton"),
  importSettingsButton: document.querySelector("#importSettingsButton"),
  settingsImportInput: document.querySelector("#settingsImportInput"),
  appVersionLabel: document.querySelector("#appVersionLabel"),
  helperVersionLabel: document.querySelector("#helperVersionLabel"),
  deployedAtLabel: document.querySelector("#deployedAtLabel")
};

const moneyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2
});

const percentFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2
});
const CSP_TABLE_LABELS = [
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
const MANUAL_CSP_TABLE_LABELS = CSP_TABLE_LABELS.slice(1);
const CC_TABLE_LABELS = [
  "Symbol",
  "Status",
  "Average Cost",
  "Current",
  "Min",
  "Avg",
  "Max",
  "Strike",
  "Bid",
  "Return",
  "Contracts",
  "Total Return"
];
const EXTENSION_REQUEST_TYPE = "WHEEL_SCREENER_EXTENSION_REQUEST";
const EXTENSION_RESPONSE_TYPE = "WHEEL_SCREENER_EXTENSION_RESPONSE";
const EXTENSION_READY_TYPE = "WHEEL_SCREENER_EXTENSION_READY";
const TRADING_WEEKS_PER_YEAR = 52;
const DEFAULT_CSP_WEEKLY_RETURN_PERCENT = 1;
const DEFAULT_CC_WEEKLY_RETURN_PERCENT = 2;
let extensionRequestId = 0;
let extensionDetectionTimer = null;
let portfolioReallocationTimer = null;
let portfolioReallocationId = 0;
let returnRecalculationTimer = null;
let returnRecalculationId = 0;
let syncingReturnInputs = false;
const CARET_CONTROL_INPUT_IDS = new Set([
  "portfolioInput",
  "weeklyReturnInput",
  "yearlyReturnInput"
]);
const ONBOARDING_SEEN_KEY = "wheel-screener-onboarding-v2";
const LAST_STRATEGY_KEY = "wheel-screener-last-strategy-v1";
const CC_POSITIONS_STORAGE_KEY = "wheel-screener-cc-positions-v1";
const CSP_SCREENERS_STORAGE_KEY = "wheel-screener-csp-screeners-v2";
const MANUAL_CSP_SYMBOLS_STORAGE_KEY = "wheel-screener-manual-csp-symbols-v1";
const SETTINGS_EXPORT_APP = "wheel-strategy-screener";
const SETTINGS_EXPORT_VERSION = 1;
const STARTER_SCREENER_NAMES = {
  safe: "Wheel Strategy 1",
  standard: "Wheel Strategy 2",
  mini: "Wheel Strategy 3"
};

function rememberLastStrategy(strategy = state.strategy) {
  try {
    window.localStorage.setItem(LAST_STRATEGY_KEY, strategy === "cc" ? "cc" : "csp");
  } catch {
    // Last strategy is only a navigation convenience.
  }
}

function applyInitialStrategyFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const strategy = params.get("strategy");
  if (strategy === "cc" || strategy === "csp") {
    state.strategy = strategy;
    rememberLastStrategy(strategy);
  }
}

function formatDeployTimestamp(value) {
  if (!value || value === "local") {
    return value || "Unknown";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function renderReleasePanel() {
  if (elements.appVersionLabel) {
    elements.appVersionLabel.textContent = state.versionInfo?.appVersion || "Unknown";
  }

  if (elements.helperVersionLabel) {
    elements.helperVersionLabel.textContent =
      state.helper.version || state.versionInfo?.helperVersion || "Not detected";
  }

  if (elements.deployedAtLabel) {
    elements.deployedAtLabel.textContent = formatDeployTimestamp(state.versionInfo?.deployedAt);
  }
}

async function loadVersionInfo() {
  try {
    state.versionInfo = await fetchJson("/api/version");
  } catch {
    state.versionInfo = null;
  }

  renderReleasePanel();
}

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

function formatTotalReturn(row) {
  if (!Number.isFinite(row.totalReturnDollars) || !Number.isFinite(row.totalReturnPercent)) {
    return "--";
  }

  return `${formatMoney(row.totalReturnDollars)} (${formatPercent(row.totalReturnPercent)})`;
}

function formatMoneyPercent(amount, percent) {
  if (Number.isFinite(amount) && amount === 0 && !Number.isFinite(percent)) {
    return `${formatMoney(0)} (${formatPercent(0)})`;
  }

  if (!Number.isFinite(amount) || !Number.isFinite(percent)) {
    return "--";
  }

  return `${formatMoney(amount)} (${formatPercent(percent)})`;
}

function weeklyToYearlyPercent(weeklyPercent) {
  return (Math.pow(1 + weeklyPercent / 100, TRADING_WEEKS_PER_YEAR) - 1) * 100;
}

function yearlyToWeeklyPercent(yearlyPercent) {
  return (Math.pow(1 + yearlyPercent / 100, 1 / TRADING_WEEKS_PER_YEAR) - 1) * 100;
}

function ccWeeklyToYearlyPercent(weeklyPercent) {
  return weeklyPercent * TRADING_WEEKS_PER_YEAR;
}

function ccYearlyToWeeklyPercent(yearlyPercent) {
  return yearlyPercent / TRADING_WEEKS_PER_YEAR;
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
  return activeWeeklyReturnPercent() / 100;
}

function activeWeeklyReturnPercent() {
  return state.strategy === "cc" ? state.minCcReturnPercent : state.minCspReturnPercent;
}

function setActiveWeeklyReturnPercent(weeklyPercent) {
  if (state.strategy === "cc") {
    state.minCcReturnPercent = weeklyPercent;
  } else {
    state.minCspReturnPercent = weeklyPercent;
  }
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
    const yearlyPercent =
      state.strategy === "cc"
        ? ccWeeklyToYearlyPercent(weeklyPercent)
        : weeklyToYearlyPercent(weeklyPercent);
    elements.yearlyReturnInput.value = formatReturnInput(yearlyPercent);
  }
  syncingReturnInputs = false;
}

function resetReturnInputs() {
  const defaultWeekly =
    state.strategy === "cc"
      ? DEFAULT_CC_WEEKLY_RETURN_PERCENT
      : DEFAULT_CSP_WEEKLY_RETURN_PERCENT;
  setActiveWeeklyReturnPercent(defaultWeekly);
  syncReturnInputsFromWeekly(defaultWeekly, null);
}

function syncReturnInputsFromActiveStrategy() {
  syncReturnInputsFromWeekly(activeWeeklyReturnPercent(), null);
}

function commitReturnTargetFromInputs() {
  const weeklyPercent = parsePercentInput(elements.weeklyReturnInput);
  if (weeklyPercent === null) {
    resetReturnInputs();
    return minCspReturnDecimal();
  }

  setActiveWeeklyReturnPercent(weeklyPercent);
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

function uniqueScreenerId(base = "screener") {
  return `${base}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeScreenerName(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalizeStoredScreeners(screeners) {
  if (!Array.isArray(screeners)) {
    return [];
  }

  const seenIds = new Set();
  return screeners
    .map((screener, index) => {
      const name = normalizeScreenerName(screener?.name);
      if (!name) {
        return null;
      }

      let id = String(screener?.id || "").trim();
      if (!id || seenIds.has(id)) {
        id = uniqueScreenerId(`custom-${index + 1}`);
      }
      seenIds.add(id);
      return {
        id,
        name,
        shortName: normalizeScreenerName(screener?.shortName) || name
      };
    })
    .filter(Boolean);
}

function defaultScreenersFromServer(screeners) {
  return normalizeStoredScreeners(screeners).map((screener) => ({
    ...screener,
    starter: true
  }));
}

function ensureScreeners() {
  if (!Array.isArray(state.screeners) || state.screeners.length === 0) {
    state.screeners = [
      {
        id: uniqueScreenerId("custom"),
        name: "My Robinhood Screener",
        shortName: "My Robinhood Screener"
      }
    ];
  }

  if (!state.screeners.some((screener) => screener.id === state.screenerId)) {
    state.screenerId = state.screeners[0].id;
  }
}

function loadCspScreenersFromStorage(defaultScreeners) {
  try {
    const stored = window.localStorage.getItem(CSP_SCREENERS_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      const rawScreeners = parsed?.screeners || parsed;
      const screeners = normalizeStoredScreeners(rawScreeners);
      if (screeners.length > 0) {
        state.screeners = screeners;
        const selectedId =
          typeof parsed?.selectedScreenerId === "string" &&
          screeners.some((screener) => screener.id === parsed.selectedScreenerId)
            ? parsed.selectedScreenerId
            : screeners[0].id;
        state.screenerId = selectedId;
        if (!screeners.some((screener) => screener.id === state.screenerId)) {
          state.screenerId = screeners[0].id;
        }
        saveCspScreenersToStorage();
        return;
      }
    }
  } catch {
    // Defaults below keep the app usable when browser storage is unavailable or corrupt.
  }

  state.screeners = defaultScreenersFromServer(defaultScreeners);
  state.screenerId = state.screeners[0]?.id || state.screenerId;
  saveCspScreenersToStorage();
}

function saveCspScreenersToStorage() {
  ensureScreeners();
  try {
    window.localStorage.setItem(
      CSP_SCREENERS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        selectedScreenerId: state.screenerId,
        screeners: state.screeners.map((screener) => ({
          id: screener.id,
          name: screener.name,
          shortName: screener.shortName || screener.name
        }))
      })
    );
  } catch {
    // Saved screeners are a convenience; scans still work in the current page.
  }
}

function selectedScreener() {
  ensureScreeners();
  return state.screeners.find((screener) => screener.id === state.screenerId) || state.screeners[0];
}

function clearScanResults() {
  state.lastResult = null;
  state.lastForecastResult = null;
  state.lastOptionQuotesBySymbol = null;
  state.lastOptionDiagnosticsBySymbol = null;
  state.lastCcResult = null;
  state.lastCcForecastResult = null;
  state.lastCcOptionQuotesBySymbol = null;
  state.lastCcOptionDiagnosticsBySymbol = null;
}

function applySelectedScreener(id, { rescan = false } = {}) {
  if (!state.screeners.some((screener) => screener.id === id)) {
    return;
  }

  state.screenerId = id;
  saveCspScreenersToStorage();
  renderScreenerSelect();
  updateTableHeading();

  if (rescan && state.lastResult && !elements.runButton.disabled) {
    runScan();
  }
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
            : action === "extractStockPositions"
              ? "Chrome helper timed out while reading Robinhood positions. Keep the Robinhood account page open, then try again."
            : action === "extractPutOptionQuotes" || action === "extractCallOptionQuotes"
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

  renderConnectionStatus();
  renderReleasePanel();
  setMode("live");
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
      renderConnectionStatus();
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

function normalizeCspInputMode(mode) {
  return mode === "auto" || mode === "screener" || mode === "robinhood" ? "auto" : "manual";
}

function normalizeCcInputMode(mode) {
  return mode === "auto" || mode === "robinhood" ? "auto" : "manual";
}

function isCspAutoMode() {
  return state.cspInputMode === "auto";
}

function isCcAutoMode() {
  return state.ccInputMode === "auto";
}

function isActiveAutoMode() {
  return state.strategy === "cc" ? isCcAutoMode() : isCspAutoMode();
}

function renderStrategyControls() {
  for (const button of elements.strategyTabs.querySelectorAll("[data-strategy]")) {
    button.classList.toggle("active", button.dataset.strategy === state.strategy);
  }

  for (const element of document.querySelectorAll(".csp-control")) {
    element.hidden = state.strategy !== "csp";
  }

  for (const element of document.querySelectorAll(".cc-control")) {
    element.hidden = state.strategy !== "cc";
  }

  for (const element of document.querySelectorAll(".csp-screener-control")) {
    element.hidden = state.strategy !== "csp" || !isCspAutoMode();
  }

  for (const element of document.querySelectorAll(".manual-csp-control")) {
    element.hidden = state.strategy !== "csp" || state.cspInputMode !== "manual";
  }

  if (elements.ccListActions) {
    elements.ccListActions.hidden = state.strategy !== "cc" || state.ccInputMode !== "manual";
  }

  const hideUnavailableControl = elements.showAllToggle?.closest(".check-control");
  if (hideUnavailableControl) {
    hideUnavailableControl.hidden = !isActiveAutoMode();
  }
  if (elements.showAllToggle) {
    elements.showAllToggle.checked = state.hideUnavailable;
  }

  document.body.dataset.strategy = state.strategy;
  document.body.dataset.cspInputMode = state.cspInputMode;
  document.body.dataset.ccInputMode = state.ccInputMode;
  renderScreenerSelect();
  renderInputSourceModes();
  syncReturnInputsFromActiveStrategy();
  updateTableHeading();
  renderSummary(activeResult());
  renderRows();
}

function setStrategy(strategy) {
  state.strategy = strategy === "cc" ? "cc" : "csp";
  rememberLastStrategy(state.strategy);
  setNotice("");
  renderStrategyControls();
}

function setCspInputMode(mode) {
  const nextMode = normalizeCspInputMode(mode);
  if (state.cspInputMode === nextMode) {
    return;
  }

  state.cspInputMode = nextMode;
  clearScanResults();
  setNotice(
    nextMode === "auto"
      ? "Robinhood Screener imports symbols from your selected Robinhood screener during Scan."
      : ""
  );
  renderStrategyControls();
}

function setCcInputMode(mode) {
  const nextMode = normalizeCcInputMode(mode);
  if (state.ccInputMode === nextMode) {
    return;
  }

  state.ccInputMode = nextMode;
  clearScanResults();
  setNotice(
    nextMode === "auto"
      ? "Robinhood Positions imports stock lots from your open Robinhood account page during Scan."
      : ""
  );
  renderStrategyControls();
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

function renderInputSourceModes() {
  if (elements.cspInputModes) {
    for (const button of elements.cspInputModes.querySelectorAll("[data-csp-input-mode]")) {
      button.classList.toggle("active", button.dataset.cspInputMode === state.cspInputMode);
    }
  }

  if (elements.ccInputModes) {
    for (const button of elements.ccInputModes.querySelectorAll("[data-cc-input-mode]")) {
      button.classList.toggle("active", button.dataset.ccInputMode === state.ccInputMode);
    }
  }
}

function renderScreenerSelect() {
  ensureScreeners();
  elements.screenerSelect.innerHTML = "";

  for (const screener of state.screeners) {
    const option = document.createElement("option");
    option.value = screener.id;
    option.textContent = screener.name;
    option.selected = screener.id === state.screenerId;
    elements.screenerSelect.append(option);
  }
}

function renderScreenerManager() {
  ensureScreeners();
  elements.screenersList.innerHTML = state.screeners
    .map((screener, index) => {
      const isSelected = screener.id === state.screenerId;
      const deleteDisabled = state.screeners.length <= 1 ? " disabled" : "";
      return `
        <div class="screener-manager-row" data-screener-row="${escapeHtml(screener.id)}">
          <input
            type="radio"
            name="activeScreener"
            value="${escapeHtml(screener.id)}"
            ${isSelected ? "checked" : ""}
            aria-label="Select ${escapeHtml(screener.name)}"
          />
          <input
            type="text"
            data-screener-name="${escapeHtml(screener.id)}"
            value="${escapeHtml(screener.name)}"
            aria-label="Robinhood screener name ${index + 1}"
            autocomplete="off"
          />
          <button
            class="secondary-button select-screener-button"
            data-select-screener="${escapeHtml(screener.id)}"
            type="button"
          >
            ${isSelected ? "Selected" : "Select"}
          </button>
          <button
            class="secondary-button delete-screener-button"
            data-delete-screener="${escapeHtml(screener.id)}"
            type="button"
            ${deleteDisabled}
          >
            Delete
          </button>
        </div>
      `;
    })
    .join("");
}

function updateTableHeading() {
  if (state.strategy === "cc") {
    elements.tableTitle.textContent =
      isCcAutoMode() ? "Robinhood Covered Calls" : "Covered Calls";
    return;
  }

  if (state.cspInputMode === "manual") {
    elements.tableTitle.textContent = "Manual CSP Symbols";
    return;
  }

  const screener = selectedScreener();
  elements.tableTitle.textContent = screener?.name || "CSP Screener";
}

function activeResult() {
  return state.strategy === "cc" ? currentCcResultFrom(state.lastCcResult) : state.lastResult;
}

function hasScannedStrategy(strategy = state.strategy) {
  return strategy === "cc" ? Boolean(state.lastCcResult) : Boolean(state.lastResult);
}

function runActionLabel(strategy = state.strategy) {
  return hasScannedStrategy(strategy) ? "Refresh" : "Scan";
}

function updateRunButtonState() {
  if (!elements.runButton || elements.runButton.disabled) {
    return;
  }

  const isRefresh = hasScannedStrategy();
  elements.runButton.textContent = isRefresh ? "Refresh" : "Scan";
  elements.runButton.classList.toggle("run-refresh", isRefresh);
  elements.runButton.classList.toggle("run-scan", !isRefresh);
  elements.runButton.classList.remove("run-busy");
}

function setRunButtonScanning() {
  elements.runButton.disabled = true;
  elements.runButton.textContent = "Scanning...";
  elements.runButton.classList.remove("run-scan", "run-refresh");
  elements.runButton.classList.add("run-busy");
}

function blankManualCspSymbol() {
  return { symbol: "" };
}

function ensureManualCspSymbols() {
  if (!Array.isArray(state.manualCspSymbols) || state.manualCspSymbols.length === 0) {
    state.manualCspSymbols = [blankManualCspSymbol()];
  }
}

function normalizeManualCspSymbol(value) {
  return String(value || "").trim().toUpperCase();
}

function persistManualCspEditor() {
  if (state.strategy !== "csp" || state.cspInputMode !== "manual") {
    return;
  }

  const rows = [...elements.resultBody.querySelectorAll("[data-csp-row-index]")].map((row) => ({
    symbol: normalizeManualCspSymbol(row.querySelector("[data-csp-field='symbol']")?.value)
  }));

  state.manualCspSymbols = rows.length > 0 ? rows : [blankManualCspSymbol()];
  saveManualCspSymbolsToStorage();
}

function manualCspSymbolsForScan() {
  ensureManualCspSymbols();
  return state.manualCspSymbols
    .map((row) => normalizeManualCspSymbol(row.symbol))
    .filter(Boolean);
}

function findMatchingCspResultRow(result, entry, index) {
  if (!result || !Array.isArray(result.rows)) {
    return null;
  }

  const symbol = normalizeManualCspSymbol(entry?.symbol);
  if (!symbol) {
    return null;
  }

  return (
    result.rows.find(
      (row) => normalizeManualCspSymbol(row.symbol) === symbol && row.order === index + 1
    ) ||
    result.rows.find((row) => normalizeManualCspSymbol(row.symbol) === symbol) ||
    null
  );
}

function normalizeStoredManualCspSymbols(symbols) {
  if (!Array.isArray(symbols)) {
    return [blankManualCspSymbol()];
  }

  const normalized = symbols.map((row) => ({
    symbol: normalizeManualCspSymbol(row?.symbol ?? row)
  }));
  const hasSymbol = normalized.some((row) => row.symbol);
  return normalized.length > 0 && hasSymbol ? normalized : [blankManualCspSymbol()];
}

function loadManualCspSymbolsFromStorage() {
  try {
    const stored = window.localStorage.getItem(MANUAL_CSP_SYMBOLS_STORAGE_KEY);
    if (!stored) {
      return;
    }

    state.manualCspSymbols = normalizeStoredManualCspSymbols(JSON.parse(stored));
  } catch {
    state.manualCspSymbols = [blankManualCspSymbol()];
  }
}

function saveManualCspSymbolsToStorage() {
  try {
    window.localStorage.setItem(
      MANUAL_CSP_SYMBOLS_STORAGE_KEY,
      JSON.stringify(normalizeStoredManualCspSymbols(state.manualCspSymbols))
    );
  } catch {
    // Manual CSP symbols are a convenience; scanning still works in the current page.
  }
}

function blankCcPosition() {
  return { symbol: "", averageCost: "", contracts: "" };
}

function ensureCcPositions() {
  if (!Array.isArray(state.ccPositions) || state.ccPositions.length === 0) {
    state.ccPositions = [blankCcPosition()];
  }
}

function normalizeCcSymbol(value) {
  return String(value || "").trim().toUpperCase();
}

function storedCcPosition(position) {
  return {
    symbol: normalizeCcSymbol(position?.symbol),
    averageCost: String(position?.averageCost ?? ""),
    contracts: String(position?.contracts ?? "")
  };
}

function normalizeStoredCcPositions(positions) {
  if (!Array.isArray(positions)) {
    return [blankCcPosition()];
  }

  const normalized = positions.map(storedCcPosition);
  const hasUsableRow = normalized.some(
    (position) => position.symbol || position.averageCost || position.contracts
  );
  return normalized.length > 0 && hasUsableRow ? normalized : [blankCcPosition()];
}

function loadCcPositionsFromStorage() {
  try {
    const stored = window.localStorage.getItem(CC_POSITIONS_STORAGE_KEY);
    if (!stored) {
      return;
    }

    state.ccPositions = normalizeStoredCcPositions(JSON.parse(stored));
  } catch {
    state.ccPositions = [blankCcPosition()];
  }
}

function saveCcPositionsToStorage() {
  try {
    window.localStorage.setItem(
      CC_POSITIONS_STORAGE_KEY,
      JSON.stringify(normalizeStoredCcPositions(state.ccPositions))
    );
  } catch {
    // Row persistence is a convenience; scanning still works when storage is unavailable.
  }
}

function activeCcPositions() {
  return isCcAutoMode() ? state.autoCcPositions : state.ccPositions;
}

function parseOptionalNumber(value) {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeImportedStockPositions(positions) {
  if (!Array.isArray(positions)) {
    return [];
  }

  return positions
    .map((position) => {
      const symbol = normalizeCcSymbol(position?.symbol);
      const shares = parseOptionalNumber(position?.shares);
      const averageCost = parseOptionalNumber(position?.averageCost);
      const contracts = Number.isFinite(shares) && shares > 0 ? Math.floor(shares / 100) : 0;

      return {
        symbol,
        shares: Number.isFinite(shares) ? shares : "",
        averageCost: Number.isFinite(averageCost) ? averageCost : "",
        contracts,
        accountName: String(position?.accountName || position?.account || "").trim(),
        coveredCallUsable: contracts > 0
      };
    })
    .filter((position) => position.symbol);
}

function currentCcPosition(position, index) {
  const shares = parseOptionalNumber(position?.shares);
  const coveredCallUsable =
    position?.coveredCallUsable === false ? false : undefined;

  return {
    order: index + 1,
    symbol: normalizeCcSymbol(position?.symbol),
    averageCost: parseOptionalNumber(position?.averageCost),
    contracts: parseOptionalNumber(position?.contracts),
    shares,
    coveredCallUsable
  };
}

function findMatchingCcResultRow(result, position, index) {
  if (!result || !Array.isArray(result.rows)) {
    return null;
  }

  const normalized = currentCcPosition(position, index);
  if (!normalized.symbol) {
    return null;
  }

  return (
    result.rows.find(
      (row) => row.order === normalized.order && normalizeCcSymbol(row.symbol) === normalized.symbol
    ) || null
  );
}

function currentCcResultFrom(result) {
  if (!result) {
    return null;
  }

  ensureCcPositions();
  const positions = activeCcPositions();
  const rows = positions
    .map((position, index) => {
      const matched = findMatchingCcResultRow(result, position, index);
      if (!matched) {
        return null;
      }

      const normalized = currentCcPosition(position, index);
      return {
        ...matched,
        averageCost: normalized.averageCost,
        contracts: normalized.contracts
      };
    })
    .filter(Boolean);

  return {
    ...result,
    symbols: rows.map((row) => row.symbol),
    eligibleCount: rows.filter((row) => row.eligible).length,
    rows
  };
}

function currentCcForecastResult() {
  return currentCcResultFrom(state.lastCcForecastResult);
}

function countCcPositions() {
  ensureCcPositions();
  return activeCcPositions().filter((position) => normalizeCcSymbol(position.symbol)).length;
}

function calculateCcSummary(result) {
  const rows = Array.isArray(result?.rows) ? result.rows : [];
  let weeklyPremiumDollars = 0;
  let weeklyReturnBaseDollars = 0;
  let totalReturnDollars = 0;
  let totalCostBasisDollars = 0;

  for (const row of rows) {
    const contracts = Number.isFinite(row.contracts) && row.contracts > 0 ? row.contracts : null;
    if (!contracts) {
      continue;
    }

    if (Number.isFinite(row.ccBid) && Number.isFinite(row.ccReturnBase)) {
      weeklyPremiumDollars += row.ccBid * 100 * contracts;
      weeklyReturnBaseDollars += row.ccReturnBase * 100 * contracts;
    }

    if (
      Number.isFinite(row.totalReturnDollars) &&
      Number.isFinite(row.averageCost) &&
      row.averageCost > 0
    ) {
      totalReturnDollars += row.totalReturnDollars;
      totalCostBasisDollars += row.averageCost * 100 * contracts;
    }
  }

  return {
    weeklyPremiumDollars,
    weeklyReturnPercent:
      weeklyReturnBaseDollars > 0
        ? (weeklyPremiumDollars / weeklyReturnBaseDollars) * 100
        : null,
    totalReturnDollars,
    totalReturnPercent:
      totalCostBasisDollars > 0
        ? (totalReturnDollars / totalCostBasisDollars) * 100
        : null
  };
}

function renderConnectionStatus() {
  const helperReady = Boolean(state.helper.installed);

  elements.connectionTitle.textContent = "Robinhood";
  elements.connectionSubtitle.textContent = helperReady
    ? "Helper ready. Open Robinhood in Chrome, log in there, then scan."
    : "Install the Chrome helper to scan Robinhood screeners, positions, and option chains.";

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

function statusLabel(status) {
  return status === "eligible"
    ? "Eligible"
    : status === "unused"
      ? "Unused"
      : status === "skip"
        ? "SKIP"
        : status === "ineligible"
          ? state.strategy === "cc" ? "Pending" : "Below min"
          : "Unavailable";
}

function renderTableHead() {
  const labels =
    state.strategy === "cc"
      ? CC_TABLE_LABELS
      : state.cspInputMode === "manual"
        ? MANUAL_CSP_TABLE_LABELS
        : CSP_TABLE_LABELS;
  const highlightLabels = new Set(
    state.strategy === "cc" ? ["Strike", "Bid", "Contracts"] : ["Strike", "Bid", "Contracts"]
  );

  elements.resultHead.innerHTML = `
    <tr>
      ${labels
        .map((label, index) => {
          const classNames = [];
          if (highlightLabels.has(label)) {
            classNames.push("highlight-column");
          }
          const hasRemoveSpacer =
            index === 0 && (state.strategy === "cc" || state.cspInputMode === "manual");
          if (hasRemoveSpacer) {
            classNames.push("cc-symbol-header");
          }
          if (state.strategy === "csp" && state.cspInputMode === "manual" && index === 0) {
            classNames.push("manual-csp-symbol-header");
          }
          const classAttribute = classNames.length ? ` class="${classNames.join(" ")}"` : "";
          const labelContent =
            hasRemoveSpacer
              ? `<span class="cc-header-remove-spacer" aria-hidden="true"></span><span class="cc-header-label">${escapeHtml(label)}</span>`
              : escapeHtml(label);

          return `<th${classAttribute}>${labelContent}</th>`;
        })
        .join("")}
    </tr>
  `;
}

function renderCspRows(result) {
  const rows = state.hideUnavailable && isCspAutoMode()
    ? result.rows.filter((row) => row.eligible || rowStatus(row) === "skip")
    : result.rows;

  if (rows.length === 0) {
    elements.resultBody.innerHTML =
      '<tr class="empty-row"><td colspan="14" class="empty-cell">No rows match the current filter.</td></tr>';
    elements.exportButton.disabled = true;
    return;
  }

  elements.exportButton.disabled = false;
  elements.resultBody.innerHTML = rows
    .map((row) => {
      const status = rowStatus(row);
      const label = statusLabel(status);
      const safeSymbol = escapeHtml(row.symbol);
      const symbolCell = row.url
        ? `<a class="symbol-link" href="${escapeHtml(row.url)}" target="_blank" rel="noreferrer">${safeSymbol}</a>`
        : safeSymbol;

      return `
        <tr title="${escapeHtml(row.error || "")}">
          <td data-label="${CSP_TABLE_LABELS[0]}">${row.rank ?? "--"}</td>
          <td data-label="${CSP_TABLE_LABELS[1]}">${symbolCell}</td>
          <td data-label="${CSP_TABLE_LABELS[2]}"><span class="status ${status}">${label}</span></td>
          <td data-label="${CSP_TABLE_LABELS[3]}">${formatMoney(row.currentPrice)}</td>
          <td data-label="${CSP_TABLE_LABELS[4]}">${formatMoney(row.minTarget)}</td>
          <td data-label="${CSP_TABLE_LABELS[5]}">${formatMoney(row.averageTarget)}</td>
          <td data-label="${CSP_TABLE_LABELS[6]}">${formatMoney(row.maxTarget)}</td>
          <td data-label="${CSP_TABLE_LABELS[7]}">${formatPercent(row.allocationPercent)}</td>
          <td data-label="${CSP_TABLE_LABELS[8]}">${formatMoney(row.allocationDollars)}</td>
          <td class="highlight-column" data-label="${CSP_TABLE_LABELS[9]}">${formatNumber(row.cspStrike)}</td>
          <td class="highlight-column" data-label="${CSP_TABLE_LABELS[10]}">${formatMoney(row.cspBid)}</td>
          <td data-label="${CSP_TABLE_LABELS[11]}">${formatPercent(row.cspReturnPercent)}</td>
          <td class="highlight-column" data-label="${CSP_TABLE_LABELS[12]}">${Number.isFinite(row.contracts) ? row.contracts : "--"}</td>
          <td data-label="${CSP_TABLE_LABELS[13]}">${formatMoney(row.actualCollateralDollars)}</td>
        </tr>
      `;
    })
    .join("");
}

function renderManualCspRows(result) {
  ensureManualCspSymbols();
  const scannedRows = Array.isArray(result?.rows) ? result.rows : [];
  elements.exportButton.disabled = scannedRows.length === 0;

  elements.resultBody.innerHTML = state.manualCspSymbols
    .map((entry, index) => {
      const row = findMatchingCspResultRow(result, entry, index);
      const normalizedSymbol = normalizeManualCspSymbol(entry.symbol);
      const hasStaleSymbol = normalizedSymbol && !row && Boolean(state.lastResult);
      const rowTitle =
        row?.error ||
        row?.warning ||
        (hasStaleSymbol ? `${runActionLabel()} to scan this symbol.` : "");
      const removeLabel = normalizedSymbol ? `Remove ${normalizedSymbol}` : "Remove row";
      const status = row ? rowStatus(row) : null;
      const label = status ? statusLabel(status) : "--";
      const symbolInput = `
        <div class="manual-symbol-cell">
          <button
            class="cc-remove-button"
            data-csp-remove="${index}"
            type="button"
            aria-label="${escapeHtml(removeLabel)}"
            title="${escapeHtml(removeLabel)}"
          >&times;</button>
          <input
            class="cc-inline-input manual-csp-symbol-input"
            data-csp-field="symbol"
            aria-label="Symbol"
            value="${escapeHtml(entry.symbol || "")}"
            autocomplete="off"
          />
        </div>
      `;

      return `
        <tr class="manual-csp-row" data-csp-row-index="${index}" title="${escapeHtml(rowTitle)}">
          <td data-label="${MANUAL_CSP_TABLE_LABELS[0]}">${symbolInput}</td>
          <td data-label="${MANUAL_CSP_TABLE_LABELS[1]}">${row ? `<span class="status ${status}">${label}</span>` : "--"}</td>
          <td data-label="${MANUAL_CSP_TABLE_LABELS[2]}">${row ? formatMoney(row.currentPrice) : "--"}</td>
          <td data-label="${MANUAL_CSP_TABLE_LABELS[3]}">${row ? formatMoney(row.minTarget) : "--"}</td>
          <td data-label="${MANUAL_CSP_TABLE_LABELS[4]}">${row ? formatMoney(row.averageTarget) : "--"}</td>
          <td data-label="${MANUAL_CSP_TABLE_LABELS[5]}">${row ? formatMoney(row.maxTarget) : "--"}</td>
          <td data-label="${MANUAL_CSP_TABLE_LABELS[6]}">${row ? formatPercent(row.allocationPercent) : "--"}</td>
          <td data-label="${MANUAL_CSP_TABLE_LABELS[7]}">${row ? formatMoney(row.allocationDollars) : "--"}</td>
          <td class="highlight-column" data-label="${MANUAL_CSP_TABLE_LABELS[8]}">${row ? formatNumber(row.cspStrike) : "--"}</td>
          <td class="highlight-column" data-label="${MANUAL_CSP_TABLE_LABELS[9]}">${row ? formatMoney(row.cspBid) : "--"}</td>
          <td data-label="${MANUAL_CSP_TABLE_LABELS[10]}">${row ? formatPercent(row.cspReturnPercent) : "--"}</td>
          <td class="highlight-column" data-label="${MANUAL_CSP_TABLE_LABELS[11]}">${row && Number.isFinite(row.contracts) ? row.contracts : "--"}</td>
          <td data-label="${MANUAL_CSP_TABLE_LABELS[12]}">${row ? formatMoney(row.actualCollateralDollars) : "--"}</td>
        </tr>
      `;
    })
    .join("");
}

function renderCcRows(result) {
  ensureCcPositions();
  const scannedRows = Array.isArray(result?.rows) ? result.rows : [];
  elements.exportButton.disabled = scannedRows.length === 0;
  const positions = activeCcPositions();
  const isRobinhoodPositions = isCcAutoMode();

  if (positions.length === 0) {
    elements.resultBody.innerHTML =
      '<tr class="empty-row"><td colspan="12" class="empty-cell">No scan has run yet.</td></tr>';
    return;
  }

  const positionRows = positions
    .map((position, index) => {
      const row = findMatchingCcResultRow(result, position, index);
      if (
        row &&
        state.hideUnavailable &&
        isRobinhoodPositions &&
        !row.eligible &&
        rowStatus(row) !== "skip"
      ) {
        return null;
      }

      const normalized = currentCcPosition(position, index);
      const hasStaleSymbol = normalized.symbol && !row && Boolean(state.lastCcResult);
      const rowTitle =
        row?.error ||
        row?.warning ||
        (normalized.coveredCallUsable === false
          ? "At least 100 shares are required for one covered-call contract."
          : "") ||
        (hasStaleSymbol ? `${runActionLabel()} to scan this covered-call symbol.` : "");
      const removeLabel = normalized.symbol ? `Remove ${normalized.symbol}` : "Remove row";
      const status = row ? rowStatus(row) : null;
      const label = status ? statusLabel(status) : "--";
      const readonlyAttribute = isRobinhoodPositions ? " readonly" : "";
      const symbolTitle =
        isRobinhoodPositions && position.accountName
          ? `Account: ${escapeHtml(position.accountName)}`
          : "";

      return `
        <tr class="cc-list-row" data-cc-row-index="${index}" title="${escapeHtml(rowTitle)}">
          <td data-label="${CC_TABLE_LABELS[0]}">
            <div class="cc-symbol-cell" title="${symbolTitle}">
              <button
                class="cc-remove-button"
                data-cc-remove="${index}"
                type="button"
                aria-label="${escapeHtml(removeLabel)}"
                title="${escapeHtml(removeLabel)}"
              >&times;</button>
              <input
                class="cc-inline-input cc-symbol-input"
                data-cc-field="symbol"
                aria-label="Symbol"
                value="${escapeHtml(position.symbol)}"
                autocomplete="off"
                ${readonlyAttribute}
              />
            </div>
          </td>
          <td data-label="${CC_TABLE_LABELS[1]}">
            ${row ? `<span class="status ${status}">${label}</span>` : "--"}
          </td>
          <td data-label="${CC_TABLE_LABELS[2]}">
            <input
              class="cc-inline-input cc-average-cost-input"
              data-cc-field="averageCost"
              aria-label="Average Cost"
              type="text"
              value="${escapeHtml(position.averageCost)}"
              inputmode="decimal"
              autocomplete="off"
              ${readonlyAttribute}
            />
          </td>
          <td data-label="${CC_TABLE_LABELS[3]}">${row ? formatMoney(row.currentPrice) : "--"}</td>
          <td data-label="${CC_TABLE_LABELS[4]}">${row ? formatMoney(row.minTarget) : "--"}</td>
          <td data-label="${CC_TABLE_LABELS[5]}">${row ? formatMoney(row.averageTarget) : "--"}</td>
          <td data-label="${CC_TABLE_LABELS[6]}">${row ? formatMoney(row.maxTarget) : "--"}</td>
          <td class="highlight-column" data-label="${CC_TABLE_LABELS[7]}">${row ? formatNumber(row.ccStrike) : "--"}</td>
          <td class="highlight-column" data-label="${CC_TABLE_LABELS[8]}">${row ? formatMoney(row.ccBid) : "--"}</td>
          <td data-label="${CC_TABLE_LABELS[9]}">${row ? formatPercent(row.ccReturnPercent) : "--"}</td>
          <td class="highlight-column" data-label="${CC_TABLE_LABELS[10]}">
            <input
              class="cc-inline-input cc-contracts-input"
              data-cc-field="contracts"
              aria-label="Contracts"
              type="text"
              value="${escapeHtml(position.contracts)}"
              inputmode="numeric"
              autocomplete="off"
              ${readonlyAttribute}
            />
          </td>
          <td data-label="${CC_TABLE_LABELS[11]}">${row ? formatTotalReturn(row) : "--"}</td>
        </tr>
      `;
    })
    .filter(Boolean)
    .join("");

  elements.resultBody.innerHTML =
    positionRows ||
    '<tr class="empty-row"><td colspan="12" class="empty-cell">No rows match the current filter.</td></tr>';
}

function renderRows() {
  renderTableHead();
  const result = activeResult();

  if (state.strategy === "csp" && state.cspInputMode === "manual") {
    renderManualCspRows(result);
    return;
  }

  if (!result && state.strategy !== "cc") {
    elements.resultBody.innerHTML =
      '<tr class="empty-row"><td colspan="14" class="empty-cell">No scan has run yet.</td></tr>';
    elements.exportButton.disabled = true;
    return;
  }

  if (state.strategy === "cc") {
    renderCcRows(result);
  } else {
    renderCspRows(result);
  }
}

function renderSummary(result) {
  const isCoveredCall = state.strategy === "cc";
  elements.eligibleMetricLabel.textContent = isCoveredCall ? "Positions" : "Eligible";
  elements.symbolMetricLabel.textContent = isCoveredCall ? "Weekly Return" : "Symbols";
  elements.allocatedMetricLabel.textContent = isCoveredCall ? "Total Return" : "Used";

  if (!result) {
    elements.eligibleMetric.textContent = isCoveredCall ? String(countCcPositions()) : "0";
    elements.symbolMetric.textContent = isCoveredCall ? "--" : "0";
    elements.allocatedMetric.textContent = isCoveredCall ? "--" : "$0";
    elements.updatedMetric.textContent = "Never";
    elements.tableSubtitle.textContent =
      isCoveredCall
        ? isCcAutoMode()
          ? "Click Scan to populate the table."
          : "Enter covered-call rows in this list, then click Scan."
        : state.cspInputMode === "manual"
          ? "Enter manual CSP symbols, then click Scan."
          : "Click Scan to populate the table.";
    updateRunButtonState();
    return;
  }

  const totalUsed = result.rows.reduce(
    (sum, row) =>
      sum + (Number.isFinite(row.actualCollateralDollars) ? row.actualCollateralDollars : 0),
    0
  );
  const ccSummary = isCoveredCall ? calculateCcSummary(result) : null;

  elements.eligibleMetric.textContent = isCoveredCall
    ? String(countCcPositions())
    : String(result.eligibleCount);
  elements.symbolMetric.textContent = isCoveredCall
    ? formatMoneyPercent(ccSummary.weeklyPremiumDollars, ccSummary.weeklyReturnPercent)
    : String(result.symbols.length);
  elements.allocatedMetric.textContent = isCoveredCall
    ? formatMoneyPercent(ccSummary.totalReturnDollars, ccSummary.totalReturnPercent)
    : formatMoney(totalUsed);
  elements.updatedMetric.textContent = new Date(result.generatedAt).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  });
  elements.tableSubtitle.textContent =
    isCoveredCall
      ? `${result.source} source - ${result.symbols.length} covered-call rows scanned`
      : `${result.source} source - ${result.symbols.length} symbols scanned`;
  updateRunButtonState();
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
  return state.strategy === "cc"
    ? Boolean(state.lastCcForecastResult)
    : Boolean(state.lastForecastResult);
}

function persistCcEditor() {
  if (state.strategy !== "cc" || state.ccInputMode !== "manual") {
    return;
  }

  const rows = [...elements.resultBody.querySelectorAll("[data-cc-row-index]")]
    .map((row) => ({
      symbol: row.querySelector("[data-cc-field='symbol']")?.value.trim().toUpperCase() || "",
      averageCost: row.querySelector("[data-cc-field='averageCost']")?.value || "",
      contracts: row.querySelector("[data-cc-field='contracts']")?.value || ""
    }));

  state.ccPositions = rows.length > 0 ? rows : [blankCcPosition()];
  saveCcPositionsToStorage();
}

function captureActiveCcInput() {
  const active = document.activeElement;
  if (
    state.strategy !== "cc" ||
    state.ccInputMode !== "manual" ||
    !active ||
    !active.matches("[data-cc-field]") ||
    !elements.resultBody.contains(active)
  ) {
    return null;
  }

  const row = active.closest("[data-cc-row-index]");
  if (!row) {
    return null;
  }

  const selectionCapable =
    active instanceof HTMLInputElement &&
    ["text", "search", "tel", "url", "password"].includes(active.type);

  return {
    rowIndex: row.dataset.ccRowIndex,
    field: active.dataset.ccField,
    selectionStart: selectionCapable ? active.selectionStart : null,
    selectionEnd: selectionCapable ? active.selectionEnd : null
  };
}

function restoreActiveCcInput(activeInput) {
  if (!activeInput || state.strategy !== "cc") {
    return;
  }

  window.setTimeout(() => {
    const selector =
      `[data-cc-row-index="${activeInput.rowIndex}"] ` +
      `[data-cc-field="${activeInput.field}"]`;
    const input = elements.resultBody.querySelector(selector);
    if (!input) {
      return;
    }

    input.focus();
    if (
      input instanceof HTMLInputElement &&
      activeInput.selectionStart !== null &&
      typeof input.setSelectionRange === "function"
    ) {
      input.setSelectionRange(activeInput.selectionStart, activeInput.selectionEnd);
    }
  }, 0);
}

function captureActiveControlInput() {
  const active = document.activeElement;
  if (
    !(active instanceof HTMLInputElement) ||
    !CARET_CONTROL_INPUT_IDS.has(active.id)
  ) {
    return null;
  }

  const selectionCapable = ["text", "search", "tel", "url", "password"].includes(active.type);
  return {
    id: active.id,
    selectionStart: selectionCapable ? active.selectionStart : null,
    selectionEnd: selectionCapable ? active.selectionEnd : null
  };
}

function restoreActiveControlInput(activeInput) {
  if (!activeInput) {
    return;
  }

  window.setTimeout(() => {
    const input = document.getElementById(activeInput.id);
    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    const current = document.activeElement;
    if (current && current !== document.body && current !== input) {
      return;
    }

    input.focus();
    if (
      activeInput.selectionStart !== null &&
      typeof input.setSelectionRange === "function"
    ) {
      input.setSelectionRange(activeInput.selectionStart, activeInput.selectionEnd);
    }
  }, 0);
}

async function finalizeFromCachedScan() {
  if (state.strategy === "cc") {
    await finalizeCoveredCallsFromCachedScan();
    return;
  }

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

    const activeControlInput = captureActiveControlInput();
    state.lastResult = result;
    renderSummary(result);
    renderRows();
    restoreActiveControlInput(activeControlInput);
    setNotice("");
  } catch (error) {
    if (requestId === returnRecalculationId) {
      setNotice(error.message, "error");
    }
  }
}

async function finalizeCoveredCallsFromCachedScan() {
  const forecastResult = currentCcForecastResult();
  if (!forecastResult) {
    return;
  }

  const requestId = ++returnRecalculationId;
  const activeCcInput = captureActiveCcInput();
  const activeControlInput = captureActiveControlInput();

  try {
    const result = await fetchJson("/api/covered-calls/finalize", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        result: forecastResult,
        optionQuotesBySymbol: state.lastCcOptionQuotesBySymbol,
        optionDiagnosticsBySymbol: state.lastCcOptionDiagnosticsBySymbol,
        minCspReturnDecimal: minCspReturnDecimal()
      })
    });

    if (requestId !== returnRecalculationId) {
      return;
    }

    const latestCcInput = captureActiveCcInput() || activeCcInput;
    state.lastCcResult = result;
    renderSummary(result);
    renderRows();
    restoreActiveCcInput(latestCcInput);
    restoreActiveControlInput(activeControlInput);
    setNotice("");
  } catch (error) {
    if (requestId === returnRecalculationId) {
      setNotice(error.message, "error");
    }
  }
}

async function reallocatePortfolio() {
  if (state.strategy !== "csp" || !state.lastResult) {
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

    const activeControlInput = captureActiveControlInput();
    state.lastResult = result;
    renderSummary(result);
    renderRows();
    restoreActiveControlInput(activeControlInput);
    setNotice("");
  } catch (error) {
    if (requestId === portfolioReallocationId) {
      setNotice(error.message, "error");
    }
  }
}

function schedulePortfolioReallocation() {
  clearPortfolioReallocationTimer();

  if (state.strategy !== "csp" || !state.lastResult) {
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

  setActiveWeeklyReturnPercent(weeklyPercent);
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

  const weeklyPercent =
    state.strategy === "cc"
      ? ccYearlyToWeeklyPercent(yearlyPercent)
      : yearlyToWeeklyPercent(yearlyPercent);
  setActiveWeeklyReturnPercent(weeklyPercent);
  syncReturnInputsFromWeekly(weeklyPercent, elements.yearlyReturnInput);
  scheduleReturnRecalculation();
}

function restoreReturnInputIfInvalid(event) {
  if (parsePercentInput(event.currentTarget) === null) {
    resetReturnInputs();
  }
}

async function runCoveredCallScan() {
  clearPortfolioReallocationTimer();
  clearReturnRecalculationTimer();
  portfolioReallocationId += 1;
  returnRecalculationId += 1;
  persistCcEditor();
  const selectedReturn = commitReturnTargetFromInputs();
  let positionsForScan = activeCcPositions();

  if (state.ccInputMode === "manual" && positionsForScan.filter((position) => String(position.symbol || "").trim()).length === 0) {
    setNotice("Add at least one covered-call symbol before scanning.", "error");
    return;
  }

  if (isCcAutoMode() && state.mode !== "live") {
    setNotice("Choose Robinhood as the source to import Robinhood positions.", "error");
    return;
  }

  if ((state.mode === "live" || isCcAutoMode()) && !activeConnection()) {
    setNotice("Connect Robinhood and finish login before scanning.", "error");
    return;
  }

  setRunButtonScanning();
  setNotice(
    isCcAutoMode()
      ? "Importing stock positions from Robinhood, then scanning covered calls."
      : state.mode === "live" && state.helper.installed
      ? "Scanning TradingView, then checking Robinhood sell-call chains."
      : "Mock mode uses your symbols with sample covered-call quotes and live TradingView data."
  );

  try {
    if (state.mode === "live" && state.helper.installed) {
      await requestExtension(
        "prepareRobinhoodScan",
        {
          strategy: "cc",
          inputMode: state.ccInputMode
        },
        45000
      );
    }

    if (isCcAutoMode()) {
      const extraction = await requestExtension("extractStockPositions", {}, 300000);
      state.autoCcPositions = normalizeImportedStockPositions(extraction.positions);
      positionsForScan = state.autoCcPositions;
      if (positionsForScan.length === 0) {
        throw new Error("The Chrome helper did not find any stock positions in Robinhood.");
      }
      renderSummary(null);
      renderRows();
      setNotice(`Imported ${positionsForScan.length} Robinhood stock position rows.`);
    }

    let forecastResult = await fetchJson("/api/covered-calls/forecast", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        mode: state.mode,
        positions: positionsForScan,
        source: isCcAutoMode() ? "robinhood-positions" : undefined,
        minCspReturnDecimal: selectedReturn
      })
    });
    let optionQuotesBySymbol = null;
    let optionDiagnosticsBySymbol = null;

    if (state.mode === "live" && state.helper.installed) {
      const stillReady = await refreshExtensionHelper({ silent: false });
      if (!stillReady) {
        throw new Error("Chrome extension helper is not installed or did not respond.");
      }

      const optionRequests = Array.isArray(forecastResult.optionRequests)
        ? forecastResult.optionRequests
        : [];
      optionQuotesBySymbol = {};
      optionDiagnosticsBySymbol = {};

      if (optionRequests.length > 0) {
        setNotice(`Checking Robinhood sell-call chains for ${optionRequests.length} covered-call symbols.`);
        const quoteResult = await requestExtension(
          "extractCallOptionQuotes",
          {
            requests: optionRequests
          },
          Math.max(300000, optionRequests.length * 45000)
        );
        optionQuotesBySymbol = quoteResult.optionQuotesBySymbol || {};
        optionDiagnosticsBySymbol = quoteResult.optionDiagnosticsBySymbol || {};
      }
    }

    const result = await fetchJson("/api/covered-calls/finalize", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        result: forecastResult,
        optionQuotesBySymbol,
        optionDiagnosticsBySymbol,
        minCspReturnDecimal: selectedReturn
      })
    });

    state.lastCcResult = result;
    state.lastCcForecastResult = forecastResult;
    state.lastCcOptionQuotesBySymbol = optionQuotesBySymbol;
    state.lastCcOptionDiagnosticsBySymbol = optionDiagnosticsBySymbol;
    renderSummary(result);
    renderRows();
    setNotice("");
  } catch (error) {
    setNotice(error.message, "error");
  } finally {
    elements.runButton.disabled = false;
    updateRunButtonState();
  }
}

async function runScan() {
  if (state.strategy === "cc") {
    await runCoveredCallScan();
    return;
  }

  clearPortfolioReallocationTimer();
  clearReturnRecalculationTimer();
  portfolioReallocationId += 1;
  returnRecalculationId += 1;
  persistManualCspEditor();
  const portfolioValue = Number.parseFloat(elements.portfolioInput.value);
  const selectedReturn = commitReturnTargetFromInputs();
  const manualSymbols = isCspAutoMode() ? null : manualCspSymbolsForScan();

  if (state.mode === "live" && !activeConnection()) {
    setNotice("Connect Robinhood and finish login before scanning.", "error");
    return;
  }

  if (state.cspInputMode === "manual" && manualSymbols.length === 0) {
    setNotice("Add at least one manual CSP symbol before scanning.", "error");
    return;
  }

  setRunButtonScanning();
  setNotice(
    !isCspAutoMode() && state.mode === "live" && state.helper.installed
      ? "Scanning manual symbols with TradingView, then checking Robinhood put chains."
      : !isCspAutoMode()
        ? "Scanning manual symbols with TradingView and sample put quotes."
        : state.mode === "live" && state.helper.installed
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
    const screener = selectedScreener();

    if (state.mode === "live" && state.helper.installed) {
      await requestExtension(
        "prepareRobinhoodScan",
        {
          strategy: "csp",
          inputMode: state.cspInputMode
        },
        45000
      );

      if (!isCspAutoMode()) {
        helperSymbols = manualSymbols;
      } else {
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
      }

      setNotice(`Scanning TradingView forecasts for ${helperSymbols.length} symbols.`);
      forecastResult = await fetchJson("/api/forecast", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          portfolioValue,
          screenerId: state.screenerId,
          screenerName: screener?.name,
          mode: state.mode,
          symbols: helperSymbols,
          source: isCspAutoMode() ? "robinhood" : "manual-symbols",
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
          screenerName: screener?.name,
          mode: state.mode,
          symbols: manualSymbols,
          source: isCspAutoMode() ? undefined : "manual-symbols",
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
    updateRunButtonState();
  }
}

async function connectRobinhood() {
  elements.connectButton.disabled = true;
  elements.connectButton.textContent = "Opening...";

  try {
    if (state.helper.installed) {
      await requestExtension("connect", {}, 10000);
      setNotice("Robinhood opened in Chrome. Log in there, then return here and click Scan or Refresh.");
    } else {
      window.location.href = "/helper.html";
    }
  } catch (error) {
    setNotice(error.message, "error");
    await refreshExtensionHelper({ silent: false }).catch(() => {});
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
  const result = activeResult();
  if (!result) {
    return;
  }

  const headers =
    state.strategy === "cc"
      ? [
          "Symbol",
          "Status",
          "Average Cost",
          "Current",
          "Min Target",
          "Avg Target",
          "Max Target",
          "Strike",
          "Bid",
          "Return %",
          "Contracts",
          "Total Return $",
          "Total Return %"
        ]
      : [
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
  const rows =
    state.strategy === "cc"
      ? result.rows.map((row) => [
          row.symbol,
          rowStatus(row),
          row.averageCost ?? "",
          row.currentPrice ?? "",
          row.minTarget ?? "",
          row.averageTarget ?? "",
          row.maxTarget ?? "",
          row.ccStrike ?? "",
          row.ccBid ?? "",
          row.ccReturnPercent ?? "",
          row.contracts ?? "",
          row.totalReturnDollars ?? "",
          row.totalReturnPercent ?? ""
        ])
      : result.rows.map((row) => [
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
  link.download = `wheel-screener-${state.strategy}-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function activeForecastResult() {
  return state.strategy === "cc" ? state.lastCcForecastResult : state.lastForecastResult;
}

function activeOptionQuotesBySymbol() {
  return state.strategy === "cc" ? state.lastCcOptionQuotesBySymbol : state.lastOptionQuotesBySymbol;
}

function buildSettingsExport() {
  commitReturnTargetFromInputs();
  ensureScreeners();

  return {
    app: SETTINGS_EXPORT_APP,
    version: SETTINGS_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    settings: {
      activeStrategy: state.strategy,
      sourceMode: state.mode,
      portfolioValue: Number.parseFloat(elements.portfolioInput.value) || 0,
      cspWeeklyReturnPercent: state.minCspReturnPercent,
      ccWeeklyReturnPercent: state.minCcReturnPercent,
      cspInputMode: state.cspInputMode,
      ccInputMode: state.ccInputMode,
      selectedCspScreenerId: state.screenerId,
      cspScreeners: state.screeners.map((screener) => ({
        id: screener.id,
        name: screener.name
      }))
    }
  };
}

function exportSettings() {
  const settings = buildSettingsExport();
  const blob = new Blob([JSON.stringify(settings, null, 2)], {
    type: "application/json;charset=utf-8"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `wheel-strategy-screener-settings-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function finitePercent(value, label) {
  const number = Number.parseFloat(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`${label} must be a non-negative number.`);
  }
  return number;
}

function parseImportedSettings(payload) {
  if (!payload || payload.app !== SETTINGS_EXPORT_APP || payload.version !== SETTINGS_EXPORT_VERSION) {
    throw new Error("Settings file is not a supported Wheel Strategy Screener export.");
  }

  const settings = payload.settings || {};
  const screeners = normalizeStoredScreeners(settings.cspScreeners);
  if (screeners.length === 0) {
    throw new Error("Settings file must include at least one CSP screener.");
  }

  const portfolioValue = Number.parseFloat(settings.portfolioValue);
  if (!Number.isFinite(portfolioValue) || portfolioValue < 0) {
    throw new Error("Portfolio value must be a non-negative number.");
  }

  const selectedCspScreenerId =
    typeof settings.selectedCspScreenerId === "string" &&
    screeners.some((screener) => screener.id === settings.selectedCspScreenerId)
      ? settings.selectedCspScreenerId
      : screeners[0].id;

  return {
    screeners,
    selectedCspScreenerId,
    portfolioValue,
    cspWeeklyReturnPercent: finitePercent(settings.cspWeeklyReturnPercent, "CSP weekly return"),
    ccWeeklyReturnPercent: finitePercent(settings.ccWeeklyReturnPercent, "CC weekly return"),
    activeStrategy: settings.activeStrategy === "cc" ? "cc" : "csp",
    sourceMode: settings.sourceMode === "live" ? "live" : "mock",
    cspInputMode: normalizeCspInputMode(settings.cspInputMode),
    ccInputMode: normalizeCcInputMode(settings.ccInputMode)
  };
}

function applyImportedSettings(settings) {
  state.screeners = settings.screeners;
  state.screenerId = settings.selectedCspScreenerId;
  state.minCspReturnPercent = settings.cspWeeklyReturnPercent;
  state.minCcReturnPercent = settings.ccWeeklyReturnPercent;
  state.strategy = settings.activeStrategy;
  state.mode = settings.sourceMode;
  state.cspInputMode = settings.cspInputMode;
  state.ccInputMode = settings.ccInputMode;
  elements.portfolioInput.value = String(settings.portfolioValue);
  clearPortfolioReallocationTimer();
  clearReturnRecalculationTimer();
  clearScanResults();
  saveCspScreenersToStorage();
  renderScreenerSelect();
  renderScreenerManager();
  renderStrategyControls();
  setMode(settings.sourceMode);
  renderSummary(activeResult());
  renderRows();
  setNotice("Settings imported. Click Scan to collect fresh data.");
}

async function importSettingsFile(file) {
  if (!file) {
    return;
  }

  try {
    const payload = JSON.parse(await file.text());
    applyImportedSettings(parseImportedSettings(payload));
    elements.settingsDialog.close();
  } catch (error) {
    setNotice(error.message || "Settings import failed.", "error");
  } finally {
    elements.settingsImportInput.value = "";
  }
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

function bindStrategyTabs() {
  elements.strategyTabs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-strategy]");
    if (!button) {
      return;
    }
    setStrategy(button.dataset.strategy);
  });
}

function bindInputSourceModes() {
  elements.cspInputModes?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-csp-input-mode]");
    if (!button) {
      return;
    }

    persistManualCspEditor();
    setCspInputMode(button.dataset.cspInputMode);
  });

  elements.ccInputModes?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-cc-input-mode]");
    if (!button) {
      return;
    }

    persistCcEditor();
    setCcInputMode(button.dataset.ccInputMode);
  });
}

function bindScreenerControls() {
  elements.screenerSelect.addEventListener("change", () => {
    applySelectedScreener(elements.screenerSelect.value, { rescan: true });
  });

  elements.manageScreenersButton.addEventListener("click", () => {
    renderScreenerManager();
    elements.screenersDialog.showModal();
  });

  elements.screenersDialogClose.addEventListener("click", () => {
    elements.screenersDialog.close();
  });

  elements.screenersDialog.addEventListener("cancel", () => {
    renderScreenerSelect();
  });

  elements.screenersDialog.addEventListener("click", (event) => {
    if (event.target === elements.screenersDialog) {
      elements.screenersDialog.close();
      return;
    }

    const selectButton = event.target.closest("[data-select-screener]");
    if (selectButton) {
      applySelectedScreener(selectButton.dataset.selectScreener);
      renderScreenerManager();
      return;
    }

    const deleteButton = event.target.closest("[data-delete-screener]");
    if (deleteButton) {
      const id = deleteButton.dataset.deleteScreener;
      if (state.screeners.length <= 1) {
        return;
      }
      state.screeners = state.screeners.filter((screener) => screener.id !== id);
      if (state.screenerId === id) {
        state.screenerId = state.screeners[0].id;
        clearScanResults();
      }
      saveCspScreenersToStorage();
      renderScreenerSelect();
      renderScreenerManager();
      renderStrategyControls();
    }
  });

  elements.screenersList.addEventListener("input", (event) => {
    const input = event.target.closest("[data-screener-name]");
    if (!input) {
      return;
    }

    const screener = state.screeners.find((item) => item.id === input.dataset.screenerName);
    if (!screener) {
      return;
    }

    const nextName = normalizeScreenerName(input.value);
    if (nextName) {
      screener.name = nextName;
      screener.shortName = nextName;
      saveCspScreenersToStorage();
      renderScreenerSelect();
      updateTableHeading();
    }
  });

  elements.screenersList.addEventListener("change", (event) => {
    const radio = event.target.closest("input[name='activeScreener']");
    if (radio) {
      applySelectedScreener(radio.value);
      renderScreenerManager();
    }
  });

  elements.addScreenerButton.addEventListener("click", () => {
    const name = normalizeScreenerName(elements.newScreenerInput.value);
    if (!name) {
      setNotice("Enter a Robinhood screener name before adding it.", "error");
      return;
    }

    const screener = {
      id: uniqueScreenerId("custom"),
      name,
      shortName: name
    };
    state.screeners.push(screener);
    state.screenerId = screener.id;
    elements.newScreenerInput.value = "";
    saveCspScreenersToStorage();
    renderScreenerSelect();
    renderScreenerManager();
    updateTableHeading();
    setNotice("");
  });
}

function bindSettingsControls() {
  elements.settingsButton.addEventListener("click", () => {
    elements.settingsDialog.showModal();
  });

  elements.settingsDialogClose.addEventListener("click", () => {
    elements.settingsDialog.close();
  });

  elements.settingsDialog.addEventListener("click", (event) => {
    if (event.target === elements.settingsDialog) {
      elements.settingsDialog.close();
    }
  });

  elements.exportSettingsButton.addEventListener("click", exportSettings);
  elements.importSettingsButton.addEventListener("click", () => {
    elements.settingsImportInput.click();
  });
  elements.settingsImportInput.addEventListener("change", () => {
    importSettingsFile(elements.settingsImportInput.files?.[0]);
  });
}

function focusCcSymbolInput(index) {
  window.setTimeout(() => {
    const input = elements.resultBody.querySelector(
      `[data-cc-row-index="${index}"] [data-cc-field="symbol"]`
    );
    input?.focus();
  }, 0);
}

function focusManualCspSymbolInput(index) {
  window.setTimeout(() => {
    const input = elements.resultBody.querySelector(
      `[data-csp-row-index="${index}"] [data-csp-field="symbol"]`
    );
    input?.focus();
  }, 0);
}

function rerenderCcList() {
  renderSummary(activeResult());
  renderRows();
}

function rerenderManualCspList() {
  renderSummary(activeResult());
  renderRows();
}

function bindManualCspList() {
  elements.manualCspListActions.addEventListener("click", (event) => {
    if (state.strategy !== "csp" || state.cspInputMode !== "manual") {
      return;
    }

    const addButton = event.target.closest("[data-csp-add-entry]");
    if (!addButton) {
      return;
    }

    persistManualCspEditor();
    state.manualCspSymbols.push(blankManualCspSymbol());
    saveManualCspSymbolsToStorage();
    renderRows();
    focusManualCspSymbolInput(state.manualCspSymbols.length - 1);
  });

  elements.resultBody.addEventListener("input", (event) => {
    if (state.strategy !== "csp" || state.cspInputMode !== "manual") {
      return;
    }
    if (!event.target.matches("[data-csp-field]")) {
      return;
    }

    persistManualCspEditor();
    renderSummary(activeResult());
    setNotice(`${runActionLabel()} to scan changed manual CSP symbols.`);
  });

  elements.resultBody.addEventListener("change", (event) => {
    if (state.strategy !== "csp" || state.cspInputMode !== "manual") {
      return;
    }
    if (!event.target.matches("[data-csp-field]")) {
      return;
    }

    persistManualCspEditor();
    rerenderManualCspList();
    setNotice(`${runActionLabel()} to scan changed manual CSP symbols.`);
  });

  elements.resultBody.addEventListener("click", (event) => {
    if (state.strategy !== "csp" || state.cspInputMode !== "manual") {
      return;
    }

    const button = event.target.closest("[data-csp-remove]");
    if (!button) {
      return;
    }

    persistManualCspEditor();
    const index = Number.parseInt(button.dataset.cspRemove, 10);
    state.manualCspSymbols.splice(index, 1);
    if (state.manualCspSymbols.length === 0) {
      state.manualCspSymbols.push(blankManualCspSymbol());
    }
    saveManualCspSymbolsToStorage();
    rerenderManualCspList();
  });
}

function bindCcList() {
  elements.ccListActions.addEventListener("click", (event) => {
    if (state.strategy !== "cc") {
      return;
    }

    const addButton = event.target.closest("[data-cc-add-entry]");
    if (!addButton) {
      return;
    }

    persistCcEditor();
    state.ccPositions.push(blankCcPosition());
    saveCcPositionsToStorage();
    renderRows();
    focusCcSymbolInput(state.ccPositions.length - 1);
  });

  elements.resultBody.addEventListener("input", (event) => {
    if (state.strategy !== "cc" || !event.target.matches("[data-cc-field]")) {
      return;
    }

    const field = event.target.dataset.ccField;
    persistCcEditor();

    if (field === "symbol") {
      renderSummary(activeResult());
      setNotice(`${runActionLabel()} to scan changed covered-call symbols.`);
      return;
    }

    scheduleReturnRecalculation();
  });

  elements.resultBody.addEventListener("change", (event) => {
    if (state.strategy !== "cc" || !event.target.matches("[data-cc-field]")) {
      return;
    }

    const field = event.target.dataset.ccField;
    persistCcEditor();

    if (field === "symbol") {
      rerenderCcList();
      setNotice(`${runActionLabel()} to scan changed covered-call symbols.`);
      return;
    }

    scheduleReturnRecalculation();
  });

  elements.resultBody.addEventListener("click", (event) => {
    if (state.strategy !== "cc") {
      return;
    }

    const button = event.target.closest("[data-cc-remove]");
    if (!button) {
      return;
    }

    persistCcEditor();
    const index = Number.parseInt(button.dataset.ccRemove, 10);
    state.ccPositions.splice(index, 1);
    if (state.ccPositions.length === 0) {
      state.ccPositions.push(blankCcPosition());
    }
    saveCcPositionsToStorage();
    rerenderCcList();
  });
}

async function init() {
  applyInitialStrategyFromUrl();
  initOnboarding();
  loadCcPositionsFromStorage();
  loadManualCspSymbolsFromStorage();
  bindExtensionReadyListener();
  bindModeButtons();
  bindStrategyTabs();
  bindInputSourceModes();
  bindScreenerControls();
  bindSettingsControls();
  bindManualCspList();
  bindCcList();
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
    if (!hasScannedStrategy()) {
      resetReturnInputs();
    }
  });
  elements.showAllToggle.addEventListener("change", () => {
    state.hideUnavailable = elements.showAllToggle.checked;
    renderRows();
  });
  resetReturnInputs();
  renderStrategyControls();
  setTimeout(() => {
    if (!hasScannedStrategy()) {
      resetReturnInputs();
    }
  }, 0);

  const [screeners] = await Promise.all([
    fetchJson("/api/screeners"),
    refreshExtensionHelper({ silent: false }),
    loadVersionInfo()
  ]);

  loadCspScreenersFromStorage(screeners.screeners);
  renderScreenerSelect();
  renderScreenerManager();
  renderConnectionStatus();

  setMode(state.mode);
  renderStrategyControls();
  if (!state.helper.installed) {
    startExtensionDetection();
  }
}

init().catch((error) => {
  setNotice(error.message, "error");
});
