const { SCREENERS } = require("../config");
const { applyAllocations } = require("./calculations");
const { getMockSymbols } = require("./mockSymbols");
const { fetchForecastForSymbol } = require("./tradingview");

const FORECAST_CONCURRENCY = Number.parseInt(
  process.env.TRADINGVIEW_CONCURRENCY || "8",
  10
);

function getScreenerById(id) {
  return SCREENERS.find((screener) => screener.id === id) || SCREENERS[0];
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker()
  );
  await Promise.all(workers);

  return results;
}

async function getSymbolsForScreener(screener, mode, explicitSymbols, explicitSource) {
  if (Array.isArray(explicitSymbols)) {
    return {
      symbols: explicitSymbols,
      source: explicitSource || "symbols"
    };
  }

  if (mode === "mock") {
    return {
      symbols: getMockSymbols(screener.id),
      source: "mock"
    };
  }

  throw new Error("Live Robinhood scans require symbols from the Chrome helper.");
}

async function analyzeScreener({
  screenerId,
  mode,
  portfolioValue,
  symbols,
  source,
  forecastFetcher = fetchForecastForSymbol
}) {
  const screener = getScreenerById(screenerId);
  const normalizedMode = mode === "live" ? "live" : "mock";
  const portfolio = Number.isFinite(portfolioValue) ? portfolioValue : 0;

  const symbolSource = await getSymbolsForScreener(
    screener,
    normalizedMode,
    symbols,
    source
  );
  const uniqueSymbols = [
    ...new Set(
      symbolSource.symbols
        .map((symbol) => String(symbol || "").trim().toUpperCase())
        .filter(Boolean)
    )
  ];

  const rows = await mapWithConcurrency(uniqueSymbols, FORECAST_CONCURRENCY, async (symbol, index) => {
    const result = await forecastFetcher(symbol);
    return {
      order: index + 1,
      ...result
    };
  });

  const allocatedRows = applyAllocations(rows, portfolio);
  const eligibleCount = allocatedRows.filter((row) => row.eligible).length;

  return {
    generatedAt: new Date().toISOString(),
    mode: normalizedMode,
    source: symbolSource.source,
    screener,
    portfolioValue: portfolio,
    symbols: uniqueSymbols,
    eligibleCount,
    rows: allocatedRows
  };
}

module.exports = {
  analyzeScreener,
  getScreenerById,
  getSymbolsForScreener,
  mapWithConcurrency
};
