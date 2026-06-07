const assert = require("node:assert/strict");
const test = require("node:test");
const {
  calculateAllocationPercentages,
  calculateContractAllocations,
  calculateUsedEligibleRows,
  applyAllocations
} = require("../src/lib/calculations");
const {
  applyOptionSelections,
  selectCspQuote
} = require("../src/lib/options");

test("allocation normalization handles one eligible stock", () => {
  assert.deepEqual(calculateAllocationPercentages(1), [100]);
});

test("allocation normalization handles two eligible stocks", () => {
  const allocations = calculateAllocationPercentages(2);

  assert.equal(Math.round(allocations[0] * 100) / 100, 60);
  assert.equal(Math.round(allocations[1] * 100) / 100, 40);
  assert.equal(Math.round(allocations.reduce((sum, value) => sum + value, 0)), 100);
});

test("allocation normalization handles three eligible stocks", () => {
  const allocations = calculateAllocationPercentages(3);

  assert.equal(Math.round(allocations.reduce((sum, value) => sum + value, 0)), 100);
  assert.deepEqual(
    allocations.map((value) => Math.round(value * 100) / 100),
    [47.37, 31.58, 21.05]
  );
});

test("allocation normalization handles many eligible stocks", () => {
  const allocations = calculateAllocationPercentages(10);

  assert.equal(allocations.length, 10);
  assert.ok(Math.abs(allocations.reduce((sum, value) => sum + value, 0) - 100) < 0.000001);
  assert.ok(allocations[0] > allocations[9]);
});

test("selects the lowest below-current put strike with at least 2 percent return", () => {
  const selected = selectCspQuote(10.73, [
    { strike: 8, bid: 0.15 },
    { strike: 8.5, bid: 0.18 },
    { strike: 9, bid: 0.3 },
    { strike: 11, bid: 0.5 }
  ]);

  assert.deepEqual(selected, {
    cspStrike: 8.5,
    cspBid: 0.18,
    cspReturnPercent: (0.18 / 8.5) * 100
  });
});

test("selects CSP quotes using a supplied weekly return threshold", () => {
  assert.equal(
    selectCspQuote(10, [{ strike: 8, bid: 0.18 }], 0.03),
    null
  );

  assert.deepEqual(selectCspQuote(10, [{ strike: 8, bid: 0.24 }], 0.03), {
    cspStrike: 8,
    cspBid: 0.24,
    cspReturnPercent: 3
  });
});

test("ONDS cached quote chain preserves known-good CSP behavior", () => {
  const quotes = [
    { strike: 7.5, bid: 0.01 },
    { strike: 8, bid: 0.03 },
    { strike: 9.5, bid: 0.16 },
    { strike: 10, bid: 0.34 },
    { strike: 10.5, bid: 0.5 }
  ];

  const zeroPercent = selectCspQuote(10.23, quotes, 0);
  const twoPercent = selectCspQuote(10.23, quotes, 0.02);

  assert.equal(zeroPercent.cspStrike, 7.5);
  assert.equal(zeroPercent.cspBid, 0.01);
  assert.equal(zeroPercent.cspReturnPercent, (0.01 / 7.5) * 100);
  assert.equal(twoPercent.cspStrike, 10);
  assert.equal(twoPercent.cspBid, 0.34);
  assert.equal(twoPercent.cspReturnPercent, 3.4000000000000004);
});

test("CLSK-style cached chain selects a qualifying below-current sell put", () => {
  const selected = selectCspQuote(
    15.35,
    [
      { strike: 15, bid: 0.57 },
      { strike: 14.5, bid: 0.4 },
      { strike: 14, bid: 0.19 },
      { strike: 13.5, bid: 0.19 }
    ],
    0.02
  );

  assert.equal(selected.cspStrike, 14.5);
  assert.equal(selected.cspBid, 0.4);
  assert.equal(selected.cspReturnPercent, (0.4 / 14.5) * 100);
});

test("QUBT-style cached chain responds to return target changes", () => {
  const quotes = [
    { strike: 10, bid: 0.54 },
    { strike: 9.5, bid: 0.3 },
    { strike: 9, bid: 0.16 },
    { strike: 8.5, bid: 0.07 },
    { strike: 8, bid: 0.03 }
  ];

  assert.equal(selectCspQuote(9.91, quotes, 0).cspStrike, 8);
  assert.equal(selectCspQuote(9.91, quotes, 0.02).cspStrike, 9.5);
  assert.equal(selectCspQuote(9.91, quotes, 0.04), null);
});

test("rejects strikes equal to or above current price", () => {
  const selected = selectCspQuote(10, [
    { strike: 10, bid: 1 },
    { strike: 10.5, bid: 1 },
    { strike: 9.5, bid: 0.1 }
  ]);

  assert.equal(selected, null);
});

test("rejects missing, zero, and sub-2 percent bids", () => {
  const selected = selectCspQuote(6.61, [
    { strike: 5, bid: 0 },
    { strike: 5.5, bid: null },
    { strike: 6, bid: 0.11 }
  ]);

  assert.equal(selected, null);
});

test("marks TradingView eligible rows as SKIP when no option quote qualifies", () => {
  const rows = applyOptionSelections(
    [
      {
        symbol: "AAA",
        status: "ok",
        currentPrice: 10,
        minTarget: 12,
        forecastEligible: true,
        eligible: false
      }
    ],
    {
      AAA: [{ strike: 9, bid: 0.1 }]
    }
  );

  assert.equal(rows[0].status, "skip");
  assert.equal(rows[0].eligible, false);
  assert.equal(rows[0].cspStrike, null);
});

test("SKIP messaging reflects the selected return threshold", () => {
  const rows = applyOptionSelections(
    [
      {
        symbol: "AAA",
        status: "ok",
        currentPrice: 10,
        minTarget: 12,
        forecastEligible: true,
        eligible: false
      }
    ],
    {
      AAA: [{ strike: 9, bid: 0.1 }]
    },
    0.015
  );

  assert.equal(rows[0].status, "skip");
  assert.match(rows[0].error, /1\.5% bid\/strike/);
});

test("marks option-chain read failures as unavailable instead of SKIP", () => {
  const rows = applyOptionSelections(
    [
      {
        symbol: "AAA",
        status: "ok",
        currentPrice: 10,
        minTarget: 12,
        forecastEligible: true,
        eligible: false
      }
    ],
    {
      AAA: []
    },
    undefined,
    {
      AAA: { error: "Could not read Robinhood option chain." }
    }
  );

  assert.equal(rows[0].status, "unavailable");
  assert.equal(rows[0].eligible, false);
  assert.match(rows[0].error, /option chain/);
});

test("applies selected option quotes before allocation", () => {
  const rows = applyOptionSelections(
    [
      {
        symbol: "AAA",
        status: "ok",
        currentPrice: 10,
        minTarget: 12,
        forecastEligible: true,
        eligible: false
      },
      {
        symbol: "BBB",
        status: "ok",
        currentPrice: 20,
        minTarget: 25,
        forecastEligible: true,
        eligible: false
      }
    ],
    {
      AAA: [{ strike: 9, bid: 0.2 }],
      BBB: [{ strike: 18, bid: 0.36 }]
    }
  );

  const allocated = applyAllocations(rows, 10000);

  assert.equal(allocated[0].rank, 1);
  assert.equal(allocated[1].rank, 2);
  assert.equal(Math.round(allocated[0].allocationPercent * 100) / 100, 60);
  assert.equal(Math.round(allocated[1].allocationPercent * 100) / 100, 40);
  assert.equal(allocated[0].cspStrike, 9);
  assert.equal(allocated[0].cspBid, 0.2);
  assert.ok(allocated[0].contracts > 0);
});

test("SKIP rows are excluded from allocations", () => {
  const rows = applyAllocations(
    [
      { symbol: "AAA", eligible: true, cspStrike: 9, cspBid: 0.2, cspReturnPercent: 2.22 },
      { symbol: "BBB", eligible: false, status: "skip" },
      { symbol: "CCC", eligible: true, cspStrike: 14, cspBid: 0.3, cspReturnPercent: 2.14 }
    ],
    10000
  );

  assert.equal(rows[0].rank, 1);
  assert.equal(rows[1].rank, null);
  assert.equal(rows[2].rank, 2);
  assert.equal(rows[1].contracts, null);
  assert.equal(rows[0].allocationPercent > rows[2].allocationPercent, true);
});

test("rounds contracts close to allocation without exceeding portfolio value", () => {
  const allocations = calculateContractAllocations(
    [
      { allocationDollars: 28421.05, cspStrike: 9 },
      { allocationDollars: 18947.37, cspStrike: 16 },
      { allocationDollars: 12631.58, cspStrike: 14.5 }
    ],
    60000
  );

  assert.deepEqual(
    allocations.map((allocation) => allocation.contracts),
    [32, 12, 8]
  );
  assert.equal(
    allocations.reduce((sum, allocation) => sum + allocation.actualCollateralDollars, 0),
    59600
  );
});

test("removes zero-contract rows and recalculates allocation using only used rows", () => {
  const usedRows = calculateUsedEligibleRows(
    [
      { symbol: "ONDS", eligible: true, cspStrike: 9 },
      { symbol: "PATH", eligible: true, cspStrike: 10.5 },
      { symbol: "RGTI", eligible: true, cspStrike: 16 },
      { symbol: "QBTS", eligible: true, cspStrike: 18 },
      { symbol: "CIFR", eligible: true, cspStrike: 19 },
      { symbol: "CLSK", eligible: true, cspStrike: 15 },
      { symbol: "USAR", eligible: true, cspStrike: 21.5 },
      { symbol: "CORZ", eligible: true, cspStrike: 22 },
      { symbol: "BULL", eligible: true, cspStrike: 6 }
    ],
    10000
  );

  assert.deepEqual(
    usedRows.map((row) => row.symbol),
    ["ONDS", "PATH", "RGTI", "QBTS"]
  );
  assert.deepEqual(
    usedRows.map((row) => row.contracts),
    [5, 2, 1, 1]
  );
  assert.deepEqual(
    usedRows.map((row) => Math.round(row.allocationPercent * 100) / 100),
    [41.54, 27.69, 18.46, 12.31]
  );
  assert.equal(
    usedRows.reduce((sum, row) => sum + row.actualCollateralDollars, 0),
    10000
  );
});
