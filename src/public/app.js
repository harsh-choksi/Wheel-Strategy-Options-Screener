const state = {
  screeners: [],
  screenerId: "safe",
  mode: "mock",
  lastResult: null,
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
  sourceModes: document.querySelector("#sourceModes")
};

const moneyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2
});

const percentFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2
});
const EXTENSION_REQUEST_TYPE = "WHEEL_SCREENER_EXTENSION_REQUEST";
const EXTENSION_RESPONSE_TYPE = "WHEEL_SCREENER_EXTENSION_RESPONSE";
const EXTENSION_READY_TYPE = "WHEEL_SCREENER_EXTENSION_READY";
let extensionRequestId = 0;
let extensionDetectionTimer = null;

function formatMoney(value) {
  return Number.isFinite(value) ? moneyFormatter.format(value) : "--";
}

function formatNumber(value) {
  return Number.isFinite(value) ? value.toFixed(2) : "--";
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${percentFormatter.format(value)}%` : "--";
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
      '<tr><td colspan="12" class="empty-cell">No scan has run yet.</td></tr>';
    elements.exportButton.disabled = true;
    return;
  }

  const rows = state.showAll ? result.rows : result.rows.filter((row) => row.eligible);

  if (rows.length === 0) {
    elements.resultBody.innerHTML =
      '<tr><td colspan="12" class="empty-cell">No rows match the current filter.</td></tr>';
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
            : status === "ineligible"
              ? "Below min"
              : "Unavailable";
      const safeSymbol = escapeHtml(row.symbol);
      const symbolCell = row.url
        ? `<a class="symbol-link" href="${escapeHtml(row.url)}" target="_blank" rel="noreferrer">${safeSymbol}</a>`
        : safeSymbol;

      return `
        <tr title="${escapeHtml(row.error || "")}">
          <td>${row.rank ?? "--"}</td>
          <td>${symbolCell}</td>
          <td><span class="status ${status}">${label}</span></td>
          <td>${formatMoney(row.currentPrice)}</td>
          <td>${formatMoney(row.minTarget)}</td>
          <td>${formatMoney(row.averageTarget)}</td>
          <td>${formatMoney(row.maxTarget)}</td>
          <td>${formatPercent(row.allocationPercent)}</td>
          <td>${formatMoney(row.allocationDollars)}</td>
          <td>${Number.isFinite(row.contracts) ? row.contracts : "--"}</td>
          <td>${formatMoney(row.actualCollateralDollars)}</td>
          <td>${formatNumber(row.cspStrike)}</td>
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

async function refreshSession() {
  const session = await fetchJson("/api/session");
  renderSession(session);
}

async function runScan() {
  const portfolioValue = Number.parseFloat(elements.portfolioInput.value);

  if (state.mode === "live" && !activeConnection()) {
    setNotice("Connect Robinhood and finish login before scanning.", "error");
    return;
  }

  elements.runButton.disabled = true;
  elements.runButton.textContent = "Scanning...";
  setNotice(
    state.mode === "live" && state.helper.installed
      ? "Asking the Chrome helper for the selected Robinhood list, then scanning TradingView."
      : state.mode === "live"
        ? "Extracting the selected Robinhood screener list and scanning TradingView."
      : "Mock mode uses built-in symbols and live TradingView data."
  );

  try {
    let helperSymbols = null;

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
    }

    const result = await fetchJson("/api/run", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        portfolioValue,
        screenerId: state.screenerId,
        mode: state.mode,
        symbols: helperSymbols,
        source: helperSymbols ? "robinhood" : undefined
      })
    });

    state.lastResult = result;
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
    "Contracts",
    "Actual Used",
    "CSP Strike"
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
    row.contracts ?? "",
    row.actualCollateralDollars ?? "",
    row.cspStrike ?? ""
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
  bindExtensionReadyListener();
  bindModeButtons();
  elements.runButton.addEventListener("click", runScan);
  elements.exportButton.addEventListener("click", exportCsv);
  elements.connectButton.addEventListener("click", connectRobinhood);
  elements.showAllToggle.addEventListener("change", () => {
    state.showAll = elements.showAllToggle.checked;
    renderRows();
  });

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
