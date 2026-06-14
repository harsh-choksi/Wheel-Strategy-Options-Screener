const { SCREENERS, TRADINGVIEW_EXCHANGES } = require("../config");
const { applyAllocations } = require("./calculations");
const { getMockSymbols } = require("./mockSymbols");
const {
  applyCoveredCallSelections,
  applyOptionSelections,
  buildMockCallQuotesBySymbol,
  buildMockQuotesBySymbol,
  callOptionRequestsForRows,
  normalizeMinReturnDecimal,
  optionRequestsForRows
} = require("./options");
const { fetchCurrentPriceForSymbol, fetchForecastForSymbol } = require("./tradingview");

const FORECAST_CONCURRENCY = Number.parseInt(
  process.env.TRADINGVIEW_CONCURRENCY || "8",
  10
);

function getScreenerById(id) {
  return SCREENERS.find((screener) => screener.id === id) || SCREENERS[0];
}

function getScreenerMetadata(id, name) {
  const known = SCREENERS.find((screener) => screener.id === id);
  if (known) {
    return known;
  }

  const customName = String(name || "").trim();
  if (customName) {
    return {
      id: id || "custom",
      name: customName,
      shortName: customName
    };
  }

  return SCREENERS[0];
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
  screenerName,
  mode,
  portfolioValue,
  symbols,
  source,
  forecastFetcher = fetchForecastForSymbol,
  refreshMarketData = false
}) {
  const screener = getScreenerMetadata(screenerId, screenerName);
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

function normalizeCoveredCallPositions(positions) {
  if (!Array.isArray(positions)) {
    return [];
  }

  return positions
    .map((position, index) => {
      const symbol = String(position?.symbol || "").trim().toUpperCase();
      const averageCost = Number.parseFloat(position?.averageCost);
      const contracts = Number.parseFloat(position?.contracts);
      const shares = Number.parseFloat(position?.shares);
      const coveredCallUsable = position?.coveredCallUsable === false ? false : true;

      return {
        order: index + 1,
        symbol,
        averageCost: Number.isFinite(averageCost) ? averageCost : null,
        contracts: Number.isFinite(contracts) ? contracts : null,
        shares: Number.isFinite(shares) ? shares : null,
        coveredCallUsable
      };
    })
    .filter((position) => position.symbol);
}

async function buildCoveredCallForecastResult({
  positions,
  mode,
  source,
  forecastFetcher = fetchForecastForSymbol,
  currentPriceFetcher = fetchCurrentPriceForSymbol,
  refreshMarketData = false
}) {
  const normalizedMode = mode === "live" ? "live" : "mock";
  const normalizedPositions = normalizeCoveredCallPositions(positions);
  const uniqueSymbols = [...new Set(normalizedPositions.map((position) => position.symbol))];
  const forecastsBySymbol = new Map();

  const forecasts = await mapWithConcurrency(uniqueSymbols, FORECAST_CONCURRENCY, async (symbol) => {
    const forecast = await forecastFetcher(symbol, {
      bypassCache: refreshMarketData
    });
    let currentQuote = null;

    if (!Number.isFinite(forecast?.currentPrice)) {
      currentQuote = await currentPriceFetcher(symbol, {
        bypassCache: refreshMarketData,
        exchanges: TRADINGVIEW_EXCHANGES
      }).catch(() => null);
    }

    return [symbol, { forecast, currentQuote }];
  });

  for (const [symbol, forecast] of forecasts) {
    forecastsBySymbol.set(symbol, forecast);
  }

  const rows = normalizedPositions.map((position) => {
    const forecastBundle = forecastsBySymbol.get(position.symbol);
    const forecast = forecastBundle?.forecast;
    const currentQuote = forecastBundle?.currentQuote;
    const currentPrice = Number.isFinite(forecast?.currentPrice)
      ? forecast.currentPrice
      : currentQuote?.currentPrice ?? null;
    const averageCostValid =
      Number.isFinite(position.averageCost) && position.averageCost > 0;
    const canUseCoveredCallQuotes = averageCostValid && position.coveredCallUsable !== false;
    const hasTargets = Boolean(
      Number.isFinite(forecast?.minTarget) ||
        Number.isFinite(forecast?.averageTarget) ||
        Number.isFinite(forecast?.maxTarget)
    );
    const status = Number.isFinite(currentPrice)
      ? canUseCoveredCallQuotes
        ? "ok"
        : "unavailable"
      : canUseCoveredCallQuotes
        ? "missing-current"
        : forecast?.status || "unavailable";
    const warning =
      !hasTargets && Number.isFinite(currentPrice)
        ? "TradingView analyst targets were unavailable; using current price only."
        : !Number.isFinite(currentPrice) && averageCostValid
          ? "TradingView current price was unavailable; using average cost as the return base."
          : null;

    return {
      ...position,
      symbol: position.symbol,
      exchange: forecast?.exchange || currentQuote?.exchange || null,
      url: forecast?.url || currentQuote?.url || null,
      currentPrice,
      minTarget: forecast?.minTarget ?? null,
      averageTarget: forecast?.averageTarget ?? null,
      maxTarget: forecast?.maxTarget ?? null,
      analystCount: forecast?.analystCount ?? null,
      eligible: false,
      status,
      canUseCoveredCallQuotes,
      warning,
      error:
        position.coveredCallUsable === false
          ? "At least 100 shares are required for one covered-call contract."
          : warning ||
            forecast?.error ||
            (forecast
              ? null
              : "TradingView data was unavailable for this symbol."),
      ccStrike: null,
      ccBid: null,
      ccReturnPercent: null,
      totalReturnDollars: null,
      totalReturnPercent: null
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    strategy: "cc",
    mode: normalizedMode,
    source: source || (normalizedMode === "live" ? "robinhood" : "mock"),
    symbols: normalizedPositions.map((position) => position.symbol),
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

function finalizeCoveredCallResult(
  result,
  optionQuotesBySymbol,
  optionDiagnosticsBySymbol = {},
  minCspReturnDecimal
) {
  if (!result || !Array.isArray(result.rows)) {
    throw new Error("A covered-call forecast result is required for option finalization.");
  }

  const minimumReturn = normalizeMinReturnDecimal(minCspReturnDecimal);
  const quotesBySymbol =
    optionQuotesBySymbol ||
    (result.mode === "mock" ? buildMockCallQuotesBySymbol(result.rows) : {});
  const rows = applyCoveredCallSelections(
    result.rows,
    quotesBySymbol,
    minimumReturn,
    optionDiagnosticsBySymbol
  );

  return {
    ...result,
    strategy: "cc",
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
  buildCoveredCallForecastResult,
  buildForecastResult,
  callOptionRequestsForRows,
  finalizeCoveredCallResult,
  finalizeAnalyzedResult,
  getScreenerById,
  getScreenerMetadata,
  getSymbolsForScreener,
  mapWithConcurrency,
  optionRequestsForRows,
  reallocateAnalyzedResult
};
