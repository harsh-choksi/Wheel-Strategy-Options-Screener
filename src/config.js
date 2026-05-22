const NODE_ENV = process.env.NODE_ENV || "development";
const IS_PRODUCTION = NODE_ENV === "production";

const SCREENERS = [
  {
    id: "safe",
    name: "Wheel Strategy Screener Safe",
    shortName: "Safe"
  },
  {
    id: "standard",
    name: "Wheel Strategy Screener",
    shortName: "Standard"
  },
  {
    id: "mini",
    name: "Wheel Strategy Screener Mini",
    shortName: "Mini"
  }
];

const TRADINGVIEW_EXCHANGES = [
  "NASDAQ",
  "NYSE",
  "AMEX",
  "NYSEARCA",
  "OTC"
];

module.exports = {
  SCREENERS,
  TRADINGVIEW_EXCHANGES,
  NODE_ENV,
  IS_PRODUCTION,
  TRADINGVIEW_CACHE_TTL_MS: Number.parseInt(
    process.env.TRADINGVIEW_CACHE_TTL_MS || "900000",
    10
  ),
  DEFAULT_PORT: Number.parseInt(process.env.PORT || "5173", 10)
};
