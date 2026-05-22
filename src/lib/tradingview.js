const { TRADINGVIEW_EXCHANGES } = require("../config");

const CACHE_TTL_MS = Number.parseInt(process.env.TRADINGVIEW_CACHE_TTL_MS || "900000", 10);
const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.TRADINGVIEW_REQUEST_TIMEOUT_MS || "8000", 10);
const forecastCache = new Map();

const REQUEST_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
};

function normalizeSymbolForTradingView(symbol) {
  return String(symbol || "")
    .trim()
    .toUpperCase()
    .replace(".", "-");
}

function parseNumber(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value
    .replace(/[\u202a-\u202e]/g, "")
    .replace(/[,\s]/g, "")
    .replace(/[—–-]$/g, "");

  if (!normalized || normalized === "—") {
    return null;
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function htmlToText(html) {
  return decodeHtmlEntities(
    String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function extractAnalystCount(text) {
  const match = text.match(/The\s+(\d+)\s+analysts?\s+offering/i);
  if (!match) {
    return null;
  }

  return Number.parseInt(match[1], 10);
}

function parseForecastHtml(html, symbol) {
  const text = htmlToText(html);
  const cleanedSymbol = normalizeSymbolForTradingView(symbol).replace("-", "[.-]?");

  const faqPattern = new RegExp(
    `${cleanedSymbol}\\s+price target is\\s+([\\d,.]+)\\s*USD\\s+with a max estimate of\\s+([\\d,.]+|—)\\s*USD\\s+and a min estimate of\\s+([\\d,.]+|—)`,
    "i"
  );
  const faqMatch = text.match(faqPattern);

  const genericPattern =
    /price target is\s+([\d,.]+)\s*USD\s+with a max estimate of\s+([\d,.]+|—)\s*USD\s+and a min estimate of\s+([\d,.]+|—)/i;
  const genericMatch = text.match(genericPattern);
  const targetMatch = faqMatch || genericMatch;

  let averageTarget = null;
  let maxTarget = null;
  let minTarget = null;

  if (targetMatch) {
    averageTarget = parseNumber(targetMatch[1]);
    maxTarget = parseNumber(targetMatch[2]);
    minTarget = parseNumber(targetMatch[3]);
  }

  return {
    averageTarget,
    maxTarget,
    minTarget,
    analystCount: extractAnalystCount(text),
    rawText: text
  };
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        ...REQUEST_HEADERS,
        ...(options.headers || {})
      }
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchText(url, options = {}) {
  const response = await fetchWithTimeout(url, options);

  const text = await response.text();

  return {
    ok: response.ok,
    status: response.status,
    text
  };
}

async function fetchCurrentPrice(exchange, symbol) {
  const tvSymbol = normalizeSymbolForTradingView(symbol);
  const body = {
    symbols: {
      tickers: [`${exchange}:${tvSymbol}`],
      query: {
        types: []
      }
    },
    columns: ["close", "currency", "name", "description", "exchange"]
  };

  const response = await fetchWithTimeout("https://scanner.tradingview.com/america/scan", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": REQUEST_HEADERS["user-agent"]
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    return null;
  }

  const payload = await response.json();
  const row = Array.isArray(payload.data) ? payload.data[0] : null;
  const values = Array.isArray(row?.d) ? row.d : [];
  const close = values[0];

  return Number.isFinite(close)
    ? {
        currentPrice: close,
        currency: values[1] || "USD",
        description: values[3] || null
      }
    : null;
}

async function fetchForecastForSymbol(symbol, options = {}) {
  const cacheKey = `${String(symbol || "").trim().toUpperCase()}::${(options.exchanges || TRADINGVIEW_EXCHANGES).join(",")}`;
  const cached = forecastCache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) {
    return { ...cached.value };
  }

  const result = await fetchForecastForSymbolUncached(symbol, options);
  forecastCache.set(cacheKey, {
    createdAt: Date.now(),
    value: result
  });
  return { ...result };
}

async function fetchForecastForSymbolUncached(symbol, options = {}) {
  const exchanges = options.exchanges || TRADINGVIEW_EXCHANGES;
  const tvSymbol = normalizeSymbolForTradingView(symbol);
  const attempted = [];

  for (const exchange of exchanges) {
    const url = `https://www.tradingview.com/symbols/${exchange}-${tvSymbol}/forecast/`;
    attempted.push(url);

    try {
      const [forecastResponse, quote] = await Promise.all([
        fetchText(url),
        fetchCurrentPrice(exchange, tvSymbol).catch(() => null)
      ]);

      if (!forecastResponse.ok) {
        continue;
      }

      const forecast = parseForecastHtml(forecastResponse.text, tvSymbol);

      if (
        forecast.averageTarget === null &&
        forecast.maxTarget === null &&
        forecast.minTarget === null
      ) {
        continue;
      }

      const currentPrice = quote?.currentPrice ?? null;

      return {
        symbol: String(symbol).toUpperCase(),
        exchange,
        url,
        currentPrice,
        minTarget: forecast.minTarget,
        averageTarget: forecast.averageTarget,
        maxTarget: forecast.maxTarget,
        analystCount: forecast.analystCount,
        eligible:
          Number.isFinite(currentPrice) &&
          Number.isFinite(forecast.minTarget) &&
          forecast.minTarget > currentPrice,
        status:
          Number.isFinite(currentPrice) && Number.isFinite(forecast.minTarget)
            ? "ok"
            : "missing-data",
        error:
          currentPrice === null
            ? "TradingView forecast found, but current price was unavailable."
            : null
      };
    } catch (error) {
      attempted.push(`${exchange}: ${error.message}`);
    }
  }

  return {
    symbol: String(symbol).toUpperCase(),
    exchange: null,
    url: null,
    currentPrice: null,
    minTarget: null,
    averageTarget: null,
    maxTarget: null,
    analystCount: null,
    eligible: false,
    status: "unavailable",
    error: `No TradingView forecast data found. Tried ${attempted.length} lookups.`
  };
}

module.exports = {
  normalizeSymbolForTradingView,
  parseNumber,
  htmlToText,
  parseForecastHtml,
  fetchForecastForSymbol,
  fetchForecastForSymbolUncached,
  fetchCurrentPrice
};
