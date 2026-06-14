const NODE_ENV = process.env.NODE_ENV || "development";
const IS_PRODUCTION = NODE_ENV === "production";

const SCREENERS = [
  {
    id: "safe",
    name: "Wheel Strategy 1",
    shortName: "Wheel Strategy 1"
  },
  {
    id: "standard",
    name: "Wheel Strategy 2",
    shortName: "Wheel Strategy 2"
  },
  {
    id: "mini",
    name: "Wheel Strategy 3",
    shortName: "Wheel Strategy 3"
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
  DEFAULT_HOST: process.env.HOST || "0.0.0.0",
  DEFAULT_PORT: Number.parseInt(process.env.PORT || "5173", 10)
};
