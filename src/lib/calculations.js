function roundToNearestHalf(value) {
  if (!Number.isFinite(value)) {
    return null;
  }

  return Math.round(value * 2) / 2;
}

function calculateAllocationPercentages(count) {
  if (!Number.isInteger(count) || count <= 0) {
    return [];
  }

  const weights = Array.from({ length: count }, (_, index) => 1.5 ** (count - index - 1));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

  return weights.map((weight) => (weight / totalWeight) * 100);
}

function calculateCspStrike(currentPrice, oppositeAllocationPercent, eligibleCount) {
  if (
    !Number.isFinite(currentPrice) ||
    !Number.isFinite(oppositeAllocationPercent) ||
    !Number.isInteger(eligibleCount) ||
    eligibleCount <= 0
  ) {
    return null;
  }

  const bufferFactor = eligibleCount * (2 / 3) * (oppositeAllocationPercent / 100);
  return roundToNearestHalf(currentPrice - bufferFactor);
}

function calculateContractAllocations(eligibleRows, portfolioValue) {
  if (!Number.isFinite(portfolioValue) || portfolioValue <= 0) {
    return eligibleRows.map(() => ({
      contracts: 0,
      collateralPerContract: null,
      actualCollateralDollars: 0
    }));
  }

  const baseAllocations = eligibleRows.map((row) => {
    const collateralPerContract =
      Number.isFinite(row.cspStrike) && row.cspStrike > 0 ? row.cspStrike * 100 : null;

    if (!collateralPerContract || !Number.isFinite(row.allocationDollars)) {
      return {
        contracts: 0,
        collateralPerContract,
        actualCollateralDollars: 0,
        targetDollars: row.allocationDollars,
        canRoundUp: false
      };
    }

    const targetContracts = row.allocationDollars / collateralPerContract;
    const floorContracts = Math.floor(targetContracts);
    const ceilContracts = Math.ceil(targetContracts);
    const floorActual = floorContracts * collateralPerContract;
    const ceilActual = ceilContracts * collateralPerContract;
    const floorError = Math.abs(row.allocationDollars - floorActual);
    const ceilError = Math.abs(ceilActual - row.allocationDollars);

    return {
      contracts: floorContracts,
      collateralPerContract,
      actualCollateralDollars: floorActual,
      targetDollars: row.allocationDollars,
      canRoundUp: ceilContracts > floorContracts && ceilError < floorError,
      roundUpCost: ceilActual - floorActual,
      roundUpBenefit: floorError - ceilError
    };
  });

  const floorTotal = baseAllocations.reduce(
    (sum, allocation) => sum + allocation.actualCollateralDollars,
    0
  );
  const remainingBudget = Math.max(0, portfolioValue - floorTotal);
  const candidates = baseAllocations
    .map((allocation, index) => ({ ...allocation, index }))
    .filter(
      (allocation) =>
        allocation.canRoundUp &&
        allocation.roundUpCost > 0 &&
        allocation.roundUpBenefit > 0
    );

  const unit = 50;
  const capacity = Math.floor(remainingBudget / unit);
  const best = Array(capacity + 1).fill(Number.NEGATIVE_INFINITY);
  const picks = Array(capacity + 1).fill(null);
  best[0] = 0;
  picks[0] = [];

  for (const candidate of candidates) {
    const weight = Math.round(candidate.roundUpCost / unit);

    for (let amount = capacity; amount >= weight; amount -= 1) {
      const previous = best[amount - weight];
      if (previous === Number.NEGATIVE_INFINITY) {
        continue;
      }

      const nextBenefit = previous + candidate.roundUpBenefit;
      if (nextBenefit > best[amount]) {
        best[amount] = nextBenefit;
        picks[amount] = [...picks[amount - weight], candidate.index];
      }
    }
  }

  const selectedAmount = best.reduce((bestIndex, benefit, index) => {
    if (benefit > best[bestIndex]) {
      return index;
    }

    if (benefit === best[bestIndex] && index > bestIndex) {
      return index;
    }

    return bestIndex;
  }, 0);
  const selectedIndexes = new Set(picks[selectedAmount] || []);

  return baseAllocations.map((allocation, index) => {
    if (!selectedIndexes.has(index)) {
      return {
        contracts: allocation.contracts,
        collateralPerContract: allocation.collateralPerContract,
        actualCollateralDollars: allocation.actualCollateralDollars
      };
    }

    const contracts = allocation.contracts + 1;
    return {
      contracts,
      collateralPerContract: allocation.collateralPerContract,
      actualCollateralDollars: contracts * allocation.collateralPerContract
    };
  });
}

function prepareAllocatedRows(candidateRows, portfolioValue) {
  const percentages = calculateAllocationPercentages(candidateRows.length);

  const allocatedRows = candidateRows.map((row, index) => {
    const rank = index + 1;
    const allocationPercent = percentages[index];
    const cspAllocationPercent = percentages[percentages.length - index - 1];
    const allocationDollars = Number.isFinite(portfolioValue)
      ? (portfolioValue * allocationPercent) / 100
      : null;
    const cspStrike = calculateCspStrike(
      row.currentPrice,
      cspAllocationPercent,
      candidateRows.length
    );

    return {
      ...row,
      used: true,
      rank,
      allocationPercent,
      allocationDollars,
      cspAllocationPercent,
      cspStrike
    };
  });

  const contractAllocations = calculateContractAllocations(allocatedRows, portfolioValue);

  return allocatedRows.map((row, index) => ({
    ...row,
    ...contractAllocations[index]
  }));
}

function calculateUsedEligibleRows(eligibleRows, portfolioValue) {
  let candidates = eligibleRows;

  for (let round = 0; round <= eligibleRows.length; round += 1) {
    if (candidates.length === 0) {
      return [];
    }

    const allocatedRows = prepareAllocatedRows(candidates, portfolioValue);
    const usedRows = allocatedRows.filter((row) => row.contracts > 0);

    if (usedRows.length === allocatedRows.length) {
      return allocatedRows;
    }

    if (usedRows.length === 0) {
      return [];
    }

    candidates = usedRows;
  }

  return prepareAllocatedRows(candidates, portfolioValue).filter((row) => row.contracts > 0);
}

function applyAllocations(rows, portfolioValue) {
  const eligibleRows = rows.filter((row) => row.eligible);
  const usedEligibleRows = calculateUsedEligibleRows(eligibleRows, portfolioValue);
  const usedBySymbol = new Map(usedEligibleRows.map((row) => [row.symbol, row]));

  return rows.map((row) => {
    if (!row.eligible) {
      return {
        ...row,
        used: false,
        rank: null,
        allocationPercent: null,
        allocationDollars: null,
        cspAllocationPercent: null,
        cspStrike: null,
        contracts: null,
        collateralPerContract: null,
        actualCollateralDollars: null
      };
    }

    const usedRow = usedBySymbol.get(row.symbol);
    if (usedRow) {
      return usedRow;
    }

    return {
      ...row,
      used: false,
      rank: null,
      allocationPercent: null,
      allocationDollars: null,
      cspAllocationPercent: null,
      cspStrike: null,
      contracts: 0,
      collateralPerContract: null,
      actualCollateralDollars: 0
    };
  });
}

module.exports = {
  roundToNearestHalf,
  calculateAllocationPercentages,
  calculateCspStrike,
  calculateContractAllocations,
  calculateUsedEligibleRows,
  applyAllocations
};
