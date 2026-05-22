const assert = require("node:assert/strict");
const test = require("node:test");
const {
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
