const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const backgroundSource = fs.readFileSync(
  path.resolve(__dirname, "../extension/background.js"),
  "utf8"
);

function loadBackground({ initialUrl, tabMessageResponses = [] }) {
  const events = [];
  const updateListeners = new Set();
  let runtimeListener = null;
  let nextTabMessage = 0;
  const tab = {
    id: 17,
    windowId: 23,
    active: false,
    status: "complete",
    url: initialUrl
  };

  const chrome = {
    runtime: {
      lastError: null,
      getManifest: () => ({ version: "0.2.14" }),
      onMessage: {
        addListener(listener) {
          runtimeListener = listener;
        }
      }
    },
    tabs: {
      query(_query, done) {
        done([tab]);
      },
      create(properties, done) {
        Object.assign(tab, properties, { status: "complete" });
        events.push({ type: "tab-create", properties: { ...properties } });
        done({ ...tab });
      },
      update(_tabId, properties, done) {
        Object.assign(tab, properties, { status: "complete" });
        events.push({ type: "tab-update", properties: { ...properties } });
        done({ ...tab });
        for (const listener of updateListeners) {
          listener(tab.id, { status: "complete" }, { ...tab });
        }
      },
      get(_tabId, done) {
        done({ ...tab });
      },
      sendMessage(_tabId, message, done) {
        events.push({ type: "tab-message", message: { ...message } });
        done(tabMessageResponses[nextTabMessage++] || {});
      },
      onUpdated: {
        addListener(listener) {
          updateListeners.add(listener);
        },
        removeListener(listener) {
          updateListeners.delete(listener);
        }
      }
    },
    windows: {
      update(windowId, properties, done) {
        events.push({ type: "window-update", windowId, properties: { ...properties } });
        done({ id: windowId, ...properties });
      }
    },
    scripting: {
      executeScript(_details, done) {
        done([]);
      }
    }
  };

  vm.runInNewContext(backgroundSource, {
    chrome,
    URL,
    console,
    setTimeout,
    clearTimeout
  });

  async function send(action, payload = {}) {
    return new Promise((resolve) => {
      runtimeListener({ action, payload }, {}, resolve);
    });
  }

  return { events, send, tab };
}

function firstEventIndex(events, type, predicate = () => true) {
  return events.findIndex((event) => event.type === type && predicate(event));
}

test("every live scan preparation focuses the Robinhood tab and window", async () => {
  const cases = [
    { strategy: "csp", inputMode: "manual" },
    { strategy: "csp", inputMode: "auto" },
    { strategy: "cc", inputMode: "manual" },
    { strategy: "cc", inputMode: "auto" }
  ];

  for (const scan of cases) {
    const helper = loadBackground({ initialUrl: "https://robinhood.com/" });
    const result = await helper.send("prepareRobinhoodScan", scan);

    assert.equal(result.ok, true);
    assert.ok(firstEventIndex(helper.events, "tab-update", (event) => event.properties.active) >= 0);
    assert.ok(firstEventIndex(helper.events, "window-update", (event) => event.properties.focused) >= 0);
  }
});

test("Auto preparation routes CSP and CC without moving Manual scans", async () => {
  const cspAuto = loadBackground({ initialUrl: "https://robinhood.com/options/chains/AAA" });
  await cspAuto.send("prepareRobinhoodScan", { strategy: "csp", inputMode: "auto" });
  assert.equal(cspAuto.tab.url, "https://robinhood.com/");

  const matchingCspPage = loadBackground({
    initialUrl: "https://robinhood.com/screener/fixture-id?source=lists_section_saved_screener"
  });
  await matchingCspPage.send("prepareRobinhoodScan", { strategy: "csp", inputMode: "auto" });
  assert.equal(
    matchingCspPage.tab.url,
    "https://robinhood.com/screener/fixture-id?source=lists_section_saved_screener"
  );

  const ccAuto = loadBackground({ initialUrl: "https://robinhood.com/" });
  await ccAuto.send("prepareRobinhoodScan", { strategy: "cc", inputMode: "auto" });
  assert.equal(ccAuto.tab.url, "https://robinhood.com/account/investing");

  const manual = loadBackground({ initialUrl: "https://robinhood.com/stocks/AAA" });
  await manual.send("prepareRobinhoodScan", { strategy: "cc", inputMode: "manual" });
  assert.equal(manual.tab.url, "https://robinhood.com/stocks/AAA");
});

test("CSP extraction retries from Home when the open screener name is wrong", async () => {
  const helper = loadBackground({
    initialUrl: "https://robinhood.com/screener/wrong-fixture",
    tabMessageResponses: [
      { retryFromHome: true },
      { source: "robinhood", symbols: ["AAA"], url: "https://robinhood.com/screener/right-fixture" }
    ]
  });

  const result = await helper.send("extractScreener", {
    screenerName: "Neutral Saved Screener"
  });

  assert.deepEqual(result.symbols, ["AAA"]);
  assert.equal(helper.tab.url, "https://robinhood.com/");
  assert.equal(
    helper.events.filter((event) => event.type === "tab-message" && event.message.action === "extractScreener").length,
    2
  );
  const focusIndex = firstEventIndex(helper.events, "window-update", (event) => event.properties.focused);
  const homeIndex = firstEventIndex(
    helper.events,
    "tab-update",
    (event) => event.properties.url === "https://robinhood.com/"
  );
  assert.ok(focusIndex >= 0 && homeIndex > focusIndex);
});
