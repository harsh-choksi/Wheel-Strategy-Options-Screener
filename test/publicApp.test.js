const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
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
});

test("unsigned user can use mock flow", async () => {
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
    const session = await fetch(`${base}/api/session`).then((response) => response.json());
    assert.equal(session.user, null);
    assert.equal(session.helperWorkflow, true);

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
    assert.equal(payload.error, "Robinhood source requires the Chrome helper.");
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
        source: "robinhood"
      })
    }).then((response) => response.json());

    assert.equal(run.mode, "live");
    assert.equal(run.source, "robinhood");
    assert.deepEqual(run.symbols, ["ONDS", "RGTI"]);
  } finally {
    await close(server);
  }
});

test("screener ids map to exact Robinhood list names", () => {
  assert.deepEqual(
    SCREENERS.map((screener) => [screener.id, screener.name]),
    [
      ["safe", "Wheel Strategy Screener Safe"],
      ["standard", "Wheel Strategy Screener"],
      ["mini", "Wheel Strategy Screener Mini"]
    ]
  );
});

test("Chrome helper does not request debugger permission", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../extension/manifest.json"), "utf8")
  );

  assert.equal(manifest.version, "0.1.8");
  assert.ok(!manifest.permissions.includes("debugger"));
});
