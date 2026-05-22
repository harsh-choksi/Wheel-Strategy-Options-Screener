const assert = require("node:assert/strict");
const test = require("node:test");
const {
  roundToNearestHalf,
  calculateAllocationPercentages,
  calculateCspStrike,
  calculateContractAllocations,
  calculateUsedEligibleRows,
  applyAllocations
} = require("../src/lib/calculations");

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

test("rounds strikes to the nearest half dollar", () => {
  assert.equal(roundToNearestHalf(10.24), 10);
  assert.equal(roundToNearestHalf(10.25), 10.5);
  assert.equal(roundToNearestHalf(10.74), 10.5);
  assert.equal(roundToNearestHalf(10.75), 11);
});

test("calculates CSP strike using the opposite rank allocation", () => {
  assert.equal(calculateCspStrike(9.36, 12.31, 4), 9);
  assert.equal(calculateCspStrike(10, 40, 2), 9.5);
});

test("returns null for unavailable CSP strike inputs", () => {
  assert.equal(calculateCspStrike(null, 40, 2), null);
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

test("recalculates allocation using only rows that receive contracts", () => {
  const usedRows = calculateUsedEligibleRows(
    [
      { symbol: "ONDS", currentPrice: 9.36, eligible: true },
      { symbol: "PATH", currentPrice: 10.77, eligible: true },
      { symbol: "RGTI", currentPrice: 16.88, eligible: true },
      { symbol: "QBTS", currentPrice: 19.3, eligible: true },
      { symbol: "CIFR", currentPrice: 19.48, eligible: true },
      { symbol: "CLSK", currentPrice: 15.4, eligible: true },
      { symbol: "USAR", currentPrice: 22.57, eligible: true },
      { symbol: "CORZ", currentPrice: 23.18, eligible: true },
      { symbol: "BULL", currentPrice: 6.99, eligible: true }
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
  assert.deepEqual(
    usedRows.map((row) => row.cspStrike),
    [9, 10.5, 16, 18]
  );
  assert.equal(
    usedRows.reduce((sum, row) => sum + row.actualCollateralDollars, 0),
    10000
  );
});

test("applies allocations only to eligible rows", () => {
  const rows = applyAllocations(
    [
      { symbol: "AAA", currentPrice: 10, eligible: true },
      { symbol: "BBB", currentPrice: 20, eligible: false },
      { symbol: "CCC", currentPrice: 30, eligible: true }
    ],
    1000
  );

  assert.equal(rows[0].rank, 1);
  assert.equal(rows[1].rank, null);
  assert.equal(rows[2].rank, null);
  assert.equal(Math.round(rows[0].allocationDollars), 1000);
  assert.equal(rows[2].allocationDollars, null);
  assert.equal(rows[0].cspAllocationPercent, 100);
  assert.equal(rows[2].cspAllocationPercent, null);
  assert.equal(rows[0].cspStrike, 9.5);
  assert.equal(rows[2].cspStrike, null);
  assert.equal(rows[0].contracts, 1);
  assert.equal(rows[2].contracts, 0);
  assert.equal(rows[0].actualCollateralDollars, 950);
  assert.equal(rows[2].actualCollateralDollars, 0);
});
