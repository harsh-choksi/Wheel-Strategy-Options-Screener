(function () {
  const WEEKS_PER_YEAR = 52;

  function finiteNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function cspWeeklyToYearly(weeklyPercent) {
    const weekly = finiteNumber(weeklyPercent);
    if (weekly === null || weekly < 0) return null;
    return (Math.pow(1 + weekly / 100, WEEKS_PER_YEAR) - 1) * 100;
  }

  function ccWeeklyToYearly(weeklyPercent) {
    const weekly = finiteNumber(weeklyPercent);
    if (weekly === null || weekly < 0) return null;
    return weekly * WEEKS_PER_YEAR;
  }

  function cspReturnPercent(strike, bid) {
    const parsedStrike = finiteNumber(strike);
    const parsedBid = finiteNumber(bid);
    if (parsedStrike === null || parsedBid === null || parsedStrike <= 0 || parsedBid < 0) {
      return null;
    }
    return (parsedBid / parsedStrike) * 100;
  }

  function coveredCallTotals(averageCost, strike, bid, contracts) {
    const parsedAverageCost = finiteNumber(averageCost);
    const parsedStrike = finiteNumber(strike);
    const parsedBid = finiteNumber(bid);
    const parsedContracts = finiteNumber(contracts);
    if (
      parsedAverageCost === null ||
      parsedStrike === null ||
      parsedBid === null ||
      parsedContracts === null ||
      parsedAverageCost <= 0 ||
      parsedBid < 0 ||
      parsedContracts < 0
    ) {
      return null;
    }
    const premiumDollars = parsedBid * 100 * parsedContracts;
    const totalReturnDollars =
      ((parsedStrike - parsedAverageCost) + parsedBid) * 100 * parsedContracts;
    const totalReturnPercent =
      parsedContracts > 0
        ? (totalReturnDollars / (parsedAverageCost * 100 * parsedContracts)) * 100
        : 0;
    return {
      premiumDollars,
      totalReturnDollars,
      totalReturnPercent
    };
  }

  function formatPercent(value) {
    return value === null ? "--" : `${value.toFixed(2)}%`;
  }

  function formatCurrency(value) {
    return value === null
      ? "--"
      : new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: "USD",
          maximumFractionDigits: 2
        }).format(value);
  }

  const api = {
    WEEKS_PER_YEAR,
    cspWeeklyToYearly,
    ccWeeklyToYearly,
    cspReturnPercent,
    coveredCallTotals
  };

  window.WheelStrategyCalculators = api;

  if (typeof document === "undefined") return;

  const elements = {
    cspWeekly: document.getElementById("calcCspWeekly"),
    cspYearly: document.getElementById("calcCspYearly"),
    ccWeekly: document.getElementById("calcCcWeekly"),
    ccYearly: document.getElementById("calcCcYearly"),
    cspStrike: document.getElementById("calcCspStrike"),
    cspBid: document.getElementById("calcCspBid"),
    cspReturn: document.getElementById("calcCspReturn"),
    ccAverageCost: document.getElementById("calcCcAverageCost"),
    ccStrike: document.getElementById("calcCcStrike"),
    ccBid: document.getElementById("calcCcBid"),
    ccContracts: document.getElementById("calcCcContracts"),
    ccPremium: document.getElementById("calcCcPremium"),
    ccTotal: document.getElementById("calcCcTotal")
  };

  function updateCspYearly() {
    const yearly = cspWeeklyToYearly(elements.cspWeekly.value);
    elements.cspYearly.textContent = `${formatPercent(yearly)} yearly`;
  }

  function updateCcYearly() {
    const yearly = ccWeeklyToYearly(elements.ccWeekly.value);
    elements.ccYearly.textContent = `${formatPercent(yearly)} yearly`;
  }

  function updateCspReturn() {
    const result = cspReturnPercent(elements.cspStrike.value, elements.cspBid.value);
    elements.cspReturn.textContent = `${formatPercent(result)} return`;
  }

  function updateCcTotals() {
    const result = coveredCallTotals(
      elements.ccAverageCost.value,
      elements.ccStrike.value,
      elements.ccBid.value,
      elements.ccContracts.value
    );
    elements.ccPremium.textContent = result
      ? `${formatCurrency(result.premiumDollars)} premium`
      : "-- premium";
    elements.ccTotal.textContent = result
      ? `${formatCurrency(result.totalReturnDollars)} total return (${formatPercent(result.totalReturnPercent)})`
      : "-- total return";
  }

  [
    [elements.cspWeekly, updateCspYearly],
    [elements.ccWeekly, updateCcYearly],
    [elements.cspStrike, updateCspReturn],
    [elements.cspBid, updateCspReturn],
    [elements.ccAverageCost, updateCcTotals],
    [elements.ccStrike, updateCcTotals],
    [elements.ccBid, updateCcTotals],
    [elements.ccContracts, updateCcTotals]
  ].forEach(([element, handler]) => {
    element?.addEventListener("input", handler);
  });

  updateCspYearly();
  updateCcYearly();
  updateCspReturn();
  updateCcTotals();
})();
