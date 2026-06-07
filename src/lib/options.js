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
    .sort((a, b) => a.strike - b.strike || b.returnDecimal - a.returnDecimal);

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

function optionRequestsForRows(rows) {
  return rows
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
}

module.exports = {
  MIN_CSP_RETURN_DECIMAL,
  normalizeOptionQuotes,
  normalizeMinReturnDecimal,
  selectCspQuote,
  applyOptionSelections,
  buildMockQuotesBySymbol,
  optionRequestsForRows
};
