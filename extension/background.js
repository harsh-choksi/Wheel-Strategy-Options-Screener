const SCREENERS = {
  safe: "Wheel Strategy Screener Safe",
  standard: "Wheel Strategy Screener",
  mini: "Wheel Strategy Screener Mini"
};

function callbackApi(call) {
  return new Promise((resolve, reject) => {
    call((result) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(result);
    });
  });
}

function queryTabs(query) {
  return callbackApi((done) => chrome.tabs.query(query, done));
}

function createTab(createProperties) {
  return callbackApi((done) => chrome.tabs.create(createProperties, done));
}

function updateTab(tabId, updateProperties) {
  return callbackApi((done) => chrome.tabs.update(tabId, updateProperties, done));
}

function getTab(tabId) {
  return callbackApi((done) => chrome.tabs.get(tabId, done));
}

function sendTabMessage(tabId, message) {
  return callbackApi((done) => chrome.tabs.sendMessage(tabId, message, done));
}

function executeScript(tabId, files) {
  return callbackApi((done) =>
    chrome.scripting.executeScript(
      {
        target: { tabId },
        files
      },
      done
    )
  );
}

function waitForTabComplete(tabId, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("Timed out waiting for Robinhood to load."));
    }, timeoutMs);

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }

    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function waitForOptionsUrl(tabId, symbol, timeoutMs = 12000) {
  const startedAt = Date.now();
  const expected = String(symbol || "").trim().toUpperCase();

  while (Date.now() - startedAt < timeoutMs) {
    const tab = await getTab(tabId);
    const url = String(tab?.url || "");
    const pathSymbol = decodeURIComponent(
      url.match(/\/options\/chains\/([^/?#]+)/i)?.[1] || ""
    ).toUpperCase();

    if (pathSymbol === expected) {
      return tab;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Timed out opening Robinhood options chain for ${expected}.`);
}

async function findRobinhoodTab() {
  const tabs = await queryTabs({
    url: ["https://robinhood.com/*", "https://*.robinhood.com/*"]
  });
  return tabs[0] || null;
}

async function openRobinhoodLogin() {
  const existing = await findRobinhoodTab();
  if (existing) {
    await updateTab(existing.id, { active: true });
    if (existing.windowId) {
      await callbackApi((done) => chrome.windows.update(existing.windowId, { focused: true }, done));
    }
    return existing;
  }

  return createTab({
    url: "https://robinhood.com/login",
    active: true
  });
}

async function ensureRobinhoodTabForScan() {
  let tab = await findRobinhoodTab();
  if (!tab) {
    tab = await createTab({
      url: "https://robinhood.com/",
      active: true
    });
    await waitForTabComplete(tab.id).catch(() => {});
    return tab;
  }

  if (!/^https:\/\/([^/]+\.)?robinhood\.com\//i.test(tab.url || "")) {
    await updateTab(tab.id, { url: "https://robinhood.com/" });
    await waitForTabComplete(tab.id).catch(() => {});
    tab = (await queryTabs({ active: false })).find((candidate) => candidate.id === tab.id) || tab;
  }

  if (/\/login\b|\/signup\b/i.test(tab.url || "")) {
    await updateTab(tab.id, { active: true });
    throw new Error("Log in to Robinhood in the opened Chrome tab, then return and refresh.");
  }

  await updateTab(tab.id, { url: "https://robinhood.com/" });
  await waitForTabComplete(tab.id).catch(() => {});
  return tab;
}

async function ensureRobinhoodTabForOptions() {
  let tab = await findRobinhoodTab();
  if (!tab) {
    tab = await createTab({
      url: "https://robinhood.com/",
      active: true
    });
    await waitForTabComplete(tab.id).catch(() => {});
    return tab;
  }

  if (/\/login\b|\/signup\b/i.test(tab.url || "")) {
    await updateTab(tab.id, { active: true });
    throw new Error("Log in to Robinhood in the opened Chrome tab, then return and refresh.");
  }

  return tab;
}

async function sendRobinhoodMessage(tabId, message) {
  try {
    return await sendTabMessage(tabId, message);
  } catch {
    await executeScript(tabId, ["content-robinhood.js"]);
    return sendTabMessage(tabId, message);
  }
}

async function extractScreener(payload) {
  const screenerName = payload?.screenerName || SCREENERS[payload?.screenerId || "safe"];
  if (!screenerName) {
    throw new Error("Unknown screener.");
  }

  const tab = await ensureRobinhoodTabForScan();
  const result = await sendRobinhoodMessage(tab.id, {
    action: "extractScreener",
    screenerName
  });

  if (result?.error) {
    throw new Error(result.error);
  }

  return result;
}

async function extractPutOptionQuotes(payload) {
  const requests = Array.isArray(payload?.requests) ? payload.requests : [];
  const tab = await ensureRobinhoodTabForOptions();
  const optionQuotesBySymbol = {};
  const optionDiagnosticsBySymbol = {};

  for (const request of requests) {
    const symbol = String(request?.symbol || "")
      .trim()
      .toUpperCase();
    if (!symbol) {
      continue;
    }

    try {
      await updateTab(tab.id, {
        active: true,
        url: `https://robinhood.com/options/chains/${encodeURIComponent(symbol)}`
      });
      await waitForOptionsUrl(tab.id, symbol);

      const result = await sendRobinhoodMessage(tab.id, {
        action: "extractPutOptionQuotes",
        symbol,
        currentPrice: request.currentPrice
      });

      if (result?.error) {
        throw new Error(result.error);
      }

      optionQuotesBySymbol[symbol] = Array.isArray(result?.quotes) ? result.quotes : [];
      optionDiagnosticsBySymbol[symbol] = result?.diagnostics || {};
    } catch (error) {
      optionQuotesBySymbol[symbol] = [];
      optionDiagnosticsBySymbol[symbol] = {
        error: error.message
      };
    }
  }

  return {
    optionQuotesBySymbol,
    optionDiagnosticsBySymbol
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message?.action === "ping") {
      return {
        installed: true,
        version: chrome.runtime.getManifest().version
      };
    }

    if (message?.action === "connect") {
      await openRobinhoodLogin();
      return {
        ok: true
      };
    }

    if (message?.action === "extractScreener") {
      return extractScreener(message.payload || {});
    }

    if (message?.action === "extractPutOptionQuotes") {
      return extractPutOptionQuotes(message.payload || {});
    }

    throw new Error("Unknown helper action.");
  })()
    .then(sendResponse)
    .catch((error) => sendResponse({ error: error.message }));

  return true;
});
