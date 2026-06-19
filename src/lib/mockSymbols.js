const MOCK_SYMBOLS = {
  safe: ["ONDS", "MARA", "RGTI", "CLSK", "RIOT"],
  standard: ["ONDS", "MARA", "RGTI", "CLSK", "RIOT", "TMC", "RR"],
  mini: ["ONDS", "TMC", "RR"]
};

function getMockSymbols(screenerId) {
  return MOCK_SYMBOLS[screenerId] || MOCK_SYMBOLS.standard;
}

module.exports = {
  MOCK_SYMBOLS,
  getMockSymbols
};
