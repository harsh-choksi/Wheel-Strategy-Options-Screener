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
    assert.match(guide, /Wheel Strategy Screener Safe/);
    assert.match(guide, /Wheel Strategy Screener Mini/);
    assert.match(guide, /data-copy="Wheel Strategy Screener"/);
    assert.match(script, /navigator\.clipboard\.writeText/);
  } finally {
    await close(server);
  }
});

test("dashboard and helper page link to setup guide", () => {
  const index = fs.readFileSync(path.resolve(__dirname, "../src/public/index.html"), "utf8");
  const helper = fs.readFileSync(path.resolve(__dirname, "../src/public/helper.html"), "utf8");

  assert.match(index, /href="\/guide\.html"/);
  assert.match(helper, /href="\/guide\.html"/);
});

test("dashboard title and filtered SKIP rows match current UI rules", () => {
  const index = fs.readFileSync(path.resolve(__dirname, "../src/public/index.html"), "utf8");
  const appSource = fs.readFileSync(path.resolve(__dirname, "../src/public/app.js"), "utf8");

  assert.match(index, /<title>Wheel Strategy Options Screener \(EOW\)<\/title>/);
  assert.match(index, /<h1>Wheel Strategy Options Screener \(EOW\)<\/h1>/);
  assert.match(index, /href="\/favicon\.ico\?v=0\.2\.5"/);
  assert.match(index, /href="\/favicon-32\.png\?v=0\.2\.5"/);
  assert.doesNotMatch(index, /class="brand-logo"/);
  assert.match(appSource, /rowStatus\(row\) === "skip"/);
});

test("dashboard first-visit walkthrough uses versioned local storage dismissal", () => {
  const index = fs.readFileSync(path.resolve(__dirname, "../src/public/index.html"), "utf8");
  const appSource = fs.readFileSync(path.resolve(__dirname, "../src/public/app.js"), "utf8");

  assert.match(index, /id="onboardingDialog"/);
  assert.match(index, /View Setup Guide/);
  assert.match(index, /Start with Mock Mode/);
  assert.match(appSource, /wheel-screener-onboarding-v1/);
  assert.match(appSource, /window\.localStorage\.getItem/);
  assert.match(appSource, /window\.localStorage\.setItem/);
});

test("helper install instructions match manifest version", () => {
  const helper = fs.readFileSync(path.resolve(__dirname, "../src/public/helper.html"), "utf8");
  const readme = fs.readFileSync(path.resolve(__dirname, "../README.md"), "utf8");

  assert.match(helper, /0\.2\.5/);
  assert.doesNotMatch(helper, /0\.1\.9/);
  assert.match(readme, /0\.2\.5/);
  assert.doesNotMatch(readme, /0\.1\.9/);
});

test("public docs describe the current extension workflow without stale provider setup", () => {
  const docs = [
    fs.readFileSync(path.resolve(__dirname, "../src/public/guide.html"), "utf8"),
    fs.readFileSync(path.resolve(__dirname, "../src/public/helper.html"), "utf8"),
    fs.readFileSync(path.resolve(__dirname, "../src/public/index.html"), "utf8"),
    fs.readFileSync(path.resolve(__dirname, "../README.md"), "utf8")
  ].join("\n");

  assert.match(docs, /Chrome helper/);
  assert.match(docs, /Sell Put/);
  assert.match(docs, /bid \/ strike/);
  assert.doesNotMatch(docs, /Plaid|SnapTrade|Browserless|LiveURL|magic link/i);
  assert.doesNotMatch(docs, /server-side Playwright login|hosted browser|remote browser/i);
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

  assert.equal(manifest.version, "0.2.5");
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
  assert.match(contentRobinhood, /extractPutOptionQuotes/);
  assert.match(contentRobinhood, /ensureOptionSide\(symbol, "sell"\)/);
  assert.match(contentRobinhood, /ensureOptionMode\(symbol, "sell", "put"\)/);
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
});

test("guide documents SKIP, bid, return percent, and configurable return rule", () => {
  const guide = fs.readFileSync(path.resolve(__dirname, "../src/public/guide.html"), "utf8");

  assert.match(guide, /SKIP/);
  assert.match(guide, /Bid/);
  assert.match(guide, /Return %/);
  assert.match(guide, /selected\s+weekly return target/);
  assert.match(guide, /180\.03% yearly/);
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
  assert.match(index, /role="group" aria-label="CSP return target"/);
  assert.match(index, /id="weeklyReturnInput"[\s\S]*?value="2"[\s\S]*?autocomplete="off"/);
  assert.match(index, /value="180\.0328"/);
  assert.match(index, /id="yearlyReturnInput"[\s\S]*?value="180\.0328"[\s\S]*?autocomplete="off"/);
  assert.match(appSource, /const TRADING_WEEKS_PER_YEAR = 52/);
  assert.match(appSource, /weeklyToYearlyPercent/);
  assert.match(appSource, /yearlyToWeeklyPercent/);
  assert.match(appSource, /finalizeFromCachedScan/);
  assert.match(appSource, /minCspReturnDecimal: minCspReturnDecimal\(\)/);
  assert.match(appSource, /function commitReturnTargetFromInputs/);
  assert.match(appSource, /const selectedReturn = commitReturnTargetFromInputs\(\)/);
  assert.match(appSource, /window\.addEventListener\("pageshow"/);
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
  assert.match(appSource, /data-label="\$\{TABLE_LABELS\[13\]\}"/);
});
