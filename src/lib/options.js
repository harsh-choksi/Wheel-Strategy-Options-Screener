const MIN_CSP_RETURN_DECIMAL = 0.02;

function toFiniteNumber(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  const normalized = String(value || "")
    .replace(/[$,%\s,]/g, "")
    .trim();
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeOptionQuotes(quotes) {
  if (!Array.isArray(quotes)) {
    return [];
  }

  return quotes
    .map((quote) => {
      const strike = toFiniteNumber(quote?.strike ?? quote?.strikePrice);
      const bid = toFiniteNumber(quote?.bid ?? quote?.bidPrice);

      return {
        strike,
        bid
      };
    })
    .filter((quote) => Number.isFinite(quote.strike) && Number.isFinite(quote.bid));
}

function normalizeMinReturnDecimal(value, fallback = MIN_CSP_RETURN_DECIMAL) {
  const parsed = toFiniteNumber(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function formatReturnRulePercent(minReturnDecimal) {
  const percent = normalizeMinReturnDecimal(minReturnDecimal) * 100;
  return Number.isInteger(percent) ? String(percent) : Number.parseFloat(percent.toFixed(4)).toString();
}

function compareLowestStrike(a, b) {
  return a.strike - b.strike || b.bid - a.bid || b.returnDecimal - a.returnDecimal;
}

function compareHighestStrike(a, b) {
  return b.strike - a.strike || b.bid - a.bid || b.returnDecimal - a.returnDecimal;
}

function selectHighestStrikeWithBid(candidates, bid) {
  return candidates
    .filter((quote) => quote.bid === bid)
    .sort(compareHighestStrike)[0] || null;
}

function selectCspQuote(currentPrice, quotes, minReturnDecimal = MIN_CSP_RETURN_DECIMAL) {
  const current = toFiniteNumber(currentPrice);
  const minimumReturn = normalizeMinReturnDecimal(minReturnDecimal);
  if (!Number.isFinite(current) || current <= 0) {
    return null;
  }

  const candidates = normalizeOptionQuotes(quotes)
    .filter((quote) => quote.strike > 0 && quote.strike < current && quote.bid > 0)
    .map((quote) => ({
      ...quote,
      returnDecimal: quote.bid / quote.strike
    }))
    .filter((quote) => quote.returnDecimal >= minimumReturn)
    .sort(compareLowestStrike);

  const selected = candidates[0];
  if (!selected) {
    return null;
  }

  return {
    cspStrike: selected.strike,
    cspBid: selected.bid,
    cspReturnPercent: selected.returnDecimal * 100
  };
}

function selectCoveredCallQuote({
  currentPrice,
  averageCost,
  quotes,
  minReturnDecimal = MIN_CSP_RETURN_DECIMAL
}) {
  const current = toFiniteNumber(currentPrice);
  const cost = toFiniteNumber(averageCost);
  const minimumReturn = normalizeMinReturnDecimal(minReturnDecimal);

  if (!Number.isFinite(cost) || cost <= 0) {
    return null;
  }

  const returnBase =
    Number.isFinite(current) && current > 0 ? Math.max(current, cost) : cost;
  const normalizedQuotes = normalizeOptionQuotes(quotes).filter(
    (quote) => quote.strike > 0 && quote.bid > 0
  );

  const primaryCandidates = normalizedQuotes
    .filter((quote) => quote.strike > returnBase)
    .map((quote) => ({
      ...quote,
      returnDecimal: quote.bid / returnBase,
      usedFallback: false
    }))
    .filter((quote) => quote.returnDecimal >= minimumReturn)
    .sort(compareHighestStrike);

  const aboveCostFallbackCandidates = normalizedQuotes
    .filter((quote) => quote.strike > cost)
    .map((quote) => ({
      ...quote,
      returnDecimal: quote.bid / returnBase,
      usedFallback: true
    }))
    .sort(compareLowestStrike);
  const aboveCostFallback = aboveCostFallbackCandidates[0]
    ? selectHighestStrikeWithBid(aboveCostFallbackCandidates, aboveCostFallbackCandidates[0].bid)
    : null;

  const belowCostFallback = normalizedQuotes
    .filter((quote) => quote.strike < cost)
    .map((quote) => ({
      ...quote,
      returnDecimal: quote.bid / returnBase,
      usedFallback: true
    }))
    .sort(compareHighestStrike);

  const selected =
    primaryCandidates[0] || aboveCostFallback || belowCostFallback[0];

  if (!selected) {
    return null;
  }

  return {
    ccStrike: selected.strike,
    ccBid: selected.bid,
    ccReturnPercent: selected.returnDecimal * 100,
    ccReturnBase: returnBase,
    ccUsedFallback: selected.usedFallback
  };
}

function normalizeQuotesBySymbol(optionQuotesBySymbol) {
  const normalized = new Map();

  if (!optionQuotesBySymbol || typeof optionQuotesBySymbol !== "object") {
    return normalized;
  }

  for (const [symbol, quotes] of Object.entries(optionQuotesBySymbol)) {
    normalized.set(String(symbol || "").trim().toUpperCase(), quotes);
  }

  return normalized;
}

function normalizeDiagnosticsBySymbol(optionDiagnosticsBySymbol) {
  const normalized = new Map();

  if (!optionDiagnosticsBySymbol || typeof optionDiagnosticsBySymbol !== "object") {
    return normalized;
  }

  for (const [symbol, diagnostics] of Object.entries(optionDiagnosticsBySymbol)) {
    normalized.set(String(symbol || "").trim().toUpperCase(), diagnostics);
  }

  return normalized;
}

function applyOptionSelections(
  rows,
  optionQuotesBySymbol,
  minReturnDecimal = MIN_CSP_RETURN_DECIMAL,
  optionDiagnosticsBySymbol = {}
) {
  const minimumReturn = normalizeMinReturnDecimal(minReturnDecimal);
  const quotesBySymbol = normalizeQuotesBySymbol(optionQuotesBySymbol);
  const diagnosticsBySymbol = normalizeDiagnosticsBySymbol(optionDiagnosticsBySymbol);

  return rows.map((row) => {
    const symbol = String(row.symbol || "").trim().toUpperCase();
    const forecastEligible = Boolean(
      row.forecastEligible ??
        (row.eligible &&
          row.status === "ok" &&
          Number.isFinite(row.currentPrice) &&
          Number.isFinite(row.minTarget) &&
          row.minTarget > row.currentPrice)
    );

    if (row.status !== "ok" || !forecastEligible) {
      return {
        ...row,
        forecastEligible,
        eligible: false,
        cspStrike: null,
        cspBid: null,
        cspReturnPercent: null
      };
    }

    const diagnostics = diagnosticsBySymbol.get(symbol);
    if (diagnostics?.error) {
      return {
        ...row,
        forecastEligible: true,
        eligible: false,
        status: "unavailable",
        cspStrike: null,
        cspBid: null,
        cspReturnPercent: null,
        error: diagnostics.error
      };
    }

    const rawQuotes = quotesBySymbol.get(symbol);
    const normalizedQuotes = normalizeOptionQuotes(rawQuotes);
    if (!Array.isArray(rawQuotes) || normalizedQuotes.length === 0) {
      return {
        ...row,
        forecastEligible: true,
        eligible: false,
        status: "unavailable",
        cspStrike: null,
        cspBid: null,
        cspReturnPercent: null,
        error: "No readable Robinhood sell-put quotes were returned for this symbol."
      };
    }

    const selected = selectCspQuote(row.currentPrice, normalizedQuotes, minimumReturn);

    if (!selected) {
      return {
        ...row,
        forecastEligible: true,
        eligible: false,
        status: "skip",
        cspStrike: null,
        cspBid: null,
        cspReturnPercent: null,
        error:
          `No below-current Robinhood put bid reached the ${formatReturnRulePercent(minimumReturn)}% bid/strike return rule.`
      };
    }

    return {
      ...row,
      forecastEligible: true,
      eligible: true,
      status: "ok",
      error: null,
      ...selected
    };
  });
}

function applyCoveredCallSelections(
  rows,
  optionQuotesBySymbol,
  minReturnDecimal = MIN_CSP_RETURN_DECIMAL,
  optionDiagnosticsBySymbol = {}
) {
  const minimumReturn = normalizeMinReturnDecimal(minReturnDecimal);
  const quotesBySymbol = normalizeQuotesBySymbol(optionQuotesBySymbol);
  const diagnosticsBySymbol = normalizeDiagnosticsBySymbol(optionDiagnosticsBySymbol);

  return rows.map((row) => {
    const symbol = String(row.symbol || "").trim().toUpperCase();
    const averageCost = toFiniteNumber(row.averageCost);
    const contracts = toFiniteNumber(row.contracts);
    const baseRow = {
      ...row,
      symbol,
      averageCost,
      contracts,
      eligible: false,
      ccStrike: null,
      ccBid: null,
      ccReturnPercent: null,
      totalReturnDollars: null,
      totalReturnPercent: null
    };

    if (row.status !== "ok" && !row.canUseCoveredCallQuotes) {
      return baseRow;
    }

    const diagnostics = diagnosticsBySymbol.get(symbol);
    if (diagnostics?.error) {
      return {
        ...baseRow,
        status: "unavailable",
        error: diagnostics.error
      };
    }

    const rawQuotes = quotesBySymbol.get(symbol);
    const normalizedQuotes = normalizeOptionQuotes(rawQuotes);
    if (!Array.isArray(rawQuotes) || normalizedQuotes.length === 0) {
      return {
        ...baseRow,
        status: "unavailable",
        error: "No readable Robinhood sell-call quotes were returned for this symbol."
      };
    }

    if (!Number.isFinite(averageCost) || averageCost <= 0) {
      return {
        ...baseRow,
        status: "unavailable",
        error: "Average cost is required for covered-call strike selection."
      };
    }

    const selected = selectCoveredCallQuote({
      currentPrice: row.currentPrice,
      averageCost,
      quotes: normalizedQuotes,
      minReturnDecimal: minimumReturn
    });

    if (!selected) {
      return {
        ...baseRow,
        status: "skip",
        error: "No positive-bid Robinhood call strike was above average cost."
      };
    }

    const validContracts = Number.isFinite(contracts) && contracts > 0;
    const totalReturnDollars = validContracts
      ? ((selected.ccStrike - averageCost) + selected.ccBid) * 100 * contracts
      : null;
    const totalReturnPercent =
      validContracts && averageCost > 0
        ? (totalReturnDollars / (averageCost * 100 * contracts)) * 100
        : null;

    return {
      ...baseRow,
      eligible: true,
      status: "ok",
      error: selected.ccUsedFallback
        ? [
            row.warning || row.error,
            `Fallback selected: no call strike above return base met the ${formatReturnRulePercent(minimumReturn)}% bid/base return rule.`
          ]
            .filter(Boolean)
            .join(" ")
        : row.warning || null,
      warning: row.warning || null,
      ...selected,
      totalReturnDollars,
      totalReturnPercent
    };
  });
}

function buildMockQuotesForRow(row, index = 0) {
  const currentPrice = toFiniteNumber(row.currentPrice);
  if (!Number.isFinite(currentPrice) || currentPrice <= 1) {
    return [];
  }

  const nearestBelow = Math.floor((currentPrice - 0.01) * 2) / 2;
  const oneLower = Math.max(0.5, nearestBelow - 0.5);
  const twoLower = Math.max(0.5, nearestBelow - 1);
  const threeLower = Math.max(0.5, nearestBelow - 1.5);
  const aboveCurrent = Math.ceil(currentPrice * 2) / 2;
  const bidAt = (strike, returnDecimal) => Math.round(strike * returnDecimal * 100) / 100;

  return [
    {
      strike: threeLower,
      bid: bidAt(threeLower, 0.01)
    },
    {
      strike: twoLower,
      bid: bidAt(twoLower, 0.022 + (index % 3) * 0.002)
    },
    {
      strike: oneLower,
      bid: bidAt(oneLower, 0.033 + (index % 2) * 0.003)
    },
    {
      strike: nearestBelow,
      bid: bidAt(nearestBelow, 0.012)
    },
    {
      strike: aboveCurrent,
      bid: bidAt(aboveCurrent, 0.05)
    }
  ];
}

function buildMockQuotesBySymbol(rows) {
  const quotesBySymbol = {};

  rows.forEach((row, index) => {
    if (row.forecastEligible || row.eligible) {
      quotesBySymbol[String(row.symbol || "").toUpperCase()] = buildMockQuotesForRow(row, index);
    }
  });

  return quotesBySymbol;
}

function buildMockCallQuotesForRow(row, index = 0) {
  const currentPrice = toFiniteNumber(row.currentPrice);
  const averageCost = toFiniteNumber(row.averageCost);
  const base = Math.max(
    Number.isFinite(currentPrice) && currentPrice > 0 ? currentPrice : 0,
    Number.isFinite(averageCost) && averageCost > 0 ? averageCost : 0
  );
  if (!Number.isFinite(base) || base <= 0) {
    return [];
  }

  const nearestAbove = Math.ceil((base + 0.01) * 2) / 2;
  const bidAt = (strike, returnDecimal) => Math.round(base * returnDecimal * 100) / 100;

  return [
    { strike: Math.max(0.5, nearestAbove - 1), bid: 0.01 },
    { strike: nearestAbove, bid: bidAt(nearestAbove, 0.011 + (index % 2) * 0.003) },
    { strike: nearestAbove + 0.5, bid: bidAt(nearestAbove + 0.5, 0.021 + (index % 3) * 0.002) },
    { strike: nearestAbove + 1, bid: bidAt(nearestAbove + 1, 0.027) },
    { strike: nearestAbove + 1.5, bid: bidAt(nearestAbove + 1.5, 0.018) }
  ];
}

function buildMockCallQuotesBySymbol(rows) {
  const quotesBySymbol = {};

  rows.forEach((row, index) => {
    if (Number.isFinite(toFiniteNumber(row.averageCost)) && toFiniteNumber(row.averageCost) > 0) {
      quotesBySymbol[String(row.symbol || "").toUpperCase()] = buildMockCallQuotesForRow(row, index);
    }
  });

  return quotesBySymbol;
}

function dedupeOptionRequests(requests) {
  const bySymbol = new Map();

  for (const request of requests) {
    const symbol = String(request?.symbol || "")
      .trim()
      .toUpperCase();
    if (!symbol) {
      continue;
    }

    const currentPrice = toFiniteNumber(request?.currentPrice);
    const averageCost = toFiniteNumber(request?.averageCost);
    const existing = bySymbol.get(symbol);

    if (!existing) {
      const nextRequest = { symbol };

      if ("currentPrice" in request) {
        nextRequest.currentPrice = Number.isFinite(currentPrice) ? currentPrice : null;
      }

      if ("averageCost" in request) {
        nextRequest.averageCost = Number.isFinite(averageCost) ? averageCost : null;
      }

      bySymbol.set(symbol, nextRequest);
      continue;
    }

    if ("currentPrice" in request && !Number.isFinite(existing.currentPrice) && Number.isFinite(currentPrice)) {
      existing.currentPrice = currentPrice;
    }

    if ("averageCost" in request && !Number.isFinite(existing.averageCost) && Number.isFinite(averageCost)) {
      existing.averageCost = averageCost;
    }
  }

  return [...bySymbol.values()];
}

function optionRequestsForRows(rows) {
  const requests = rows
    .filter(
      (row) =>
        row.status === "ok" &&
        Boolean(row.forecastEligible ?? row.eligible) &&
        Number.isFinite(row.currentPrice)
    )
    .map((row) => ({
      symbol: row.symbol,
      currentPrice: row.currentPrice
    }));

  return dedupeOptionRequests(requests);
}

function callOptionRequestsForRows(rows) {
  const requests = rows
    .filter((row) => {
      const symbol = String(row.symbol || "").trim();
      const averageCost = toFiniteNumber(row.averageCost);
      return (
        Boolean(symbol) &&
        row.canUseCoveredCallQuotes !== false &&
        Number.isFinite(averageCost) &&
        averageCost > 0
      );
    })
    .map((row) => ({
      symbol: row.symbol,
      currentPrice: Number.isFinite(row.currentPrice) ? row.currentPrice : null,
      averageCost: row.averageCost
    }));

  return dedupeOptionRequests(requests);
}

module.exports = {
  MIN_CSP_RETURN_DECIMAL,
  toFiniteNumber,
  normalizeOptionQuotes,
  normalizeMinReturnDecimal,
  selectCspQuote,
  selectCoveredCallQuote,
  applyOptionSelections,
  applyCoveredCallSelections,
  buildMockQuotesBySymbol,
  buildMockCallQuotesBySymbol,
  dedupeOptionRequests,
  optionRequestsForRows,
  callOptionRequestsForRows
};
