const MOCK_SYMBOLS = {
  safe: ["AAA", "BBB", "CCC", "DDD", "EEE"],
  standard: ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF", "GGG"],
  mini: ["AAA", "FFF", "GGG"]
};

function getMockSymbols(screenerId) {
  return MOCK_SYMBOLS[screenerId] || MOCK_SYMBOLS.standard;
}

module.exports = {
  MOCK_SYMBOLS,
  getMockSymbols
};
