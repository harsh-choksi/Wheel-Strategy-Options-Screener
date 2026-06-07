const { SCREENERS } = require("../config");
const { applyAllocations } = require("./calculations");
const { getMockSymbols } = require("./mockSymbols");
const {
  applyOptionSelections,
  buildMockQuotesBySymbol,
  normalizeMinReturnDecimal,
  optionRequestsForRows
} = require("./options");
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

async function buildForecastResult({
  screenerId,
  mode,
  portfolioValue,
  symbols,
  source,
  forecastFetcher = fetchForecastForSymbol,
  refreshMarketData = false
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
    const result = await forecastFetcher(symbol, {
      bypassCache: refreshMarketData
    });
    return {
      order: index + 1,
      ...result,
      forecastEligible: Boolean(result.eligible),
      eligible: false,
      cspStrike: null,
      cspBid: null,
      cspReturnPercent: null
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    mode: normalizedMode,
    source: symbolSource.source,
    screener,
    portfolioValue: portfolio,
    symbols: uniqueSymbols,
    eligibleCount: 0,
    rows
  };
}

function finalizeAnalyzedResult(
  result,
  portfolioValue,
  optionQuotesBySymbol,
  optionDiagnosticsBySymbol = {},
  minCspReturnDecimal
) {
  if (!result || !Array.isArray(result.rows)) {
    throw new Error("A forecast scan result is required for option finalization.");
  }

  const portfolio = Number.isFinite(portfolioValue) ? portfolioValue : 0;
  const minimumReturn = normalizeMinReturnDecimal(minCspReturnDecimal);
  const quotesBySymbol =
    optionQuotesBySymbol ||
    (result.mode === "mock" ? buildMockQuotesBySymbol(result.rows) : {});
  const rowsWithOptions = applyOptionSelections(
    result.rows,
    quotesBySymbol,
    minimumReturn,
    optionDiagnosticsBySymbol
  );
  const rows = applyAllocations(rowsWithOptions, portfolio);

  return {
    ...result,
    portfolioValue: portfolio,
    minCspReturnDecimal: minimumReturn,
    minCspReturnPercent: minimumReturn * 100,
    eligibleCount: rows.filter((row) => row.eligible).length,
    rows
  };
}

async function analyzeScreener(args) {
  const forecastResult = await buildForecastResult(args);
  return finalizeAnalyzedResult(
    forecastResult,
    args.portfolioValue,
    args.optionQuotesBySymbol ||
      (forecastResult.mode === "mock" ? buildMockQuotesBySymbol(forecastResult.rows) : {}),
    args.optionDiagnosticsBySymbol || {},
    args.minCspReturnDecimal
  );
}

function reallocateAnalyzedResult(result, portfolioValue) {
  if (!result || !Array.isArray(result.rows)) {
    throw new Error("A previous scan result is required for reallocation.");
  }

  const portfolio = Number.isFinite(portfolioValue) ? portfolioValue : 0;
  const rows = applyAllocations(result.rows, portfolio);

  return {
    ...result,
    portfolioValue: portfolio,
    eligibleCount: rows.filter((row) => row.eligible).length,
    rows
  };
}

module.exports = {
  analyzeScreener,
  buildForecastResult,
  finalizeAnalyzedResult,
  getScreenerById,
  getSymbolsForScreener,
  mapWithConcurrency,
  optionRequestsForRows,
  reallocateAnalyzedResult
};
