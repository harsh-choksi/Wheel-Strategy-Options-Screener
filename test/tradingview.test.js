const assert = require("node:assert/strict");
const test = require("node:test");
const {
  fetchScannerForecast,
  normalizeSymbolForTradingView,
  parseForecastHtml,
  parseNumber
} = require("../src/lib/tradingview");

test("normalizes symbols for TradingView URLs", () => {
  assert.equal(normalizeSymbolForTradingView("brk.b"), "BRK-B");
  assert.equal(normalizeSymbolForTradingView(" onds "), "ONDS");
});

test("parses localized numeric text", () => {
  assert.equal(parseNumber("1,234.56"), 1234.56);
  assert.equal(parseNumber("—"), null);
});

test("parses forecast values from TradingView-like HTML text", () => {
  const html = `
    <main>
      <p>The 8 analysts offering 1-year price forecasts have estimates.</p>
      <p>
        According to analysts, ONDS price target is 20.13 USD with a max
        estimate of 25.00 USD and a min estimate of 16.00 USD.
      </p>
    </main>
  `;

  const parsed = parseForecastHtml(html, "ONDS");

  assert.equal(parsed.averageTarget, 20.13);
  assert.equal(parsed.maxTarget, 25);
  assert.equal(parsed.minTarget, 16);
  assert.equal(parsed.analystCount, 8);
});

test("handles unavailable target estimates", () => {
  const html = `
    <p>According to analysts, ABC price target is 12.00 USD with a max estimate of — USD and a min estimate of —.</p>
  `;

  const parsed = parseForecastHtml(html, "ABC");

  assert.equal(parsed.averageTarget, 12);
  assert.equal(parsed.maxTarget, null);
  assert.equal(parsed.minTarget, null);
});

test("maps TradingView scanner forecast columns", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      totalCount: 1,
      data: [
        {
          s: "NASDAQ:ONDS",
          d: [9.96, 10.01, "USD", "ONDS", "Ondas Inc", "NASDAQ", 20.125, 25, 16, 9, 0, 0]
        }
      ]
    })
  });

  try {
    const forecast = await fetchScannerForecast("NASDAQ", "ONDS");

    assert.equal(forecast.currentPrice, 9.96);
    assert.equal(forecast.averageTarget, 20.125);
    assert.equal(forecast.maxTarget, 25);
    assert.equal(forecast.minTarget, 16);
    assert.equal(forecast.analystCount, 9);
  } finally {
    global.fetch = originalFetch;
  }
});

test("falls back to close when TradingView realtime current price is unavailable", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      totalCount: 1,
      data: [
        {
          s: "NASDAQ:ONDS",
          d: [null, 10.01, "USD", "ONDS", "Ondas Inc", "NASDAQ", 20.125, 25, 16, 9, 0, 0]
        }
      ]
    })
  });

  try {
    const forecast = await fetchScannerForecast("NASDAQ", "ONDS");

    assert.equal(forecast.currentPrice, 10.01);
    assert.equal(forecast.minTarget, 16);
  } finally {
    global.fetch = originalFetch;
  }
});
