export type TradeSide = "Long" | "Short";

export type TradePlanInputs = {
  accountEquity: number;
  riskPercent: number;
  maxAllocationPercent: number;
  entryPrice: number;
  stopPrice: number;
  side: TradeSide;
};

export type TradePlanResult = {
  valid: boolean;
  error: string;
  riskBudget: number;
  riskPerShare: number;
  sharesByRisk: number;
  sharesByAllocation: number;
  shares: number;
  positionValue: number;
  plannedRisk: number;
  accountUsePercent: number;
  actualRiskPercent: number;
  oneRPrice: number;
  twoRPrice: number;
};

export function calculateTradePlan(inputs: TradePlanInputs): TradePlanResult {
  const { accountEquity, riskPercent, maxAllocationPercent, entryPrice, stopPrice, side } = inputs;
  const empty = {
    valid: false,
    error: "Enter the account, entry and stop values to calculate the trade.",
    riskBudget: 0,
    riskPerShare: 0,
    sharesByRisk: 0,
    sharesByAllocation: 0,
    shares: 0,
    positionValue: 0,
    plannedRisk: 0,
    accountUsePercent: 0,
    actualRiskPercent: 0,
    oneRPrice: 0,
    twoRPrice: 0,
  };

  if (![accountEquity, riskPercent, maxAllocationPercent, entryPrice, stopPrice].every((value) => Number.isFinite(value) && value > 0)) {
    return empty;
  }
  if (side === "Long" && stopPrice >= entryPrice) {
    return { ...empty, error: "For a long trade, the stop must be below the entry." };
  }
  if (side === "Short" && stopPrice <= entryPrice) {
    return { ...empty, error: "For a short trade, the stop must be above the entry." };
  }

  const riskBudget = accountEquity * riskPercent / 100;
  const riskPerShare = Math.abs(entryPrice - stopPrice);
  const sharesByRisk = Math.floor(riskBudget / riskPerShare);
  const sharesByAllocation = Math.floor((accountEquity * maxAllocationPercent / 100) / entryPrice);
  const shares = Math.max(0, Math.min(sharesByRisk, sharesByAllocation));
  const positionValue = shares * entryPrice;
  const plannedRisk = shares * riskPerShare;
  const direction = side === "Long" ? 1 : -1;

  return {
    valid: shares > 0,
    error: shares > 0 ? "" : "The current limits do not allow at least one share.",
    riskBudget,
    riskPerShare,
    sharesByRisk,
    sharesByAllocation,
    shares,
    positionValue,
    plannedRisk,
    accountUsePercent: positionValue / accountEquity * 100,
    actualRiskPercent: plannedRisk / accountEquity * 100,
    oneRPrice: entryPrice + direction * riskPerShare,
    twoRPrice: entryPrice + direction * riskPerShare * 2,
  };
}

export function splitShares(total: number) {
  const first = Math.floor(total * .33);
  const second = Math.floor(total * .33);
  return [first, second, Math.max(0, total - first - second)];
}
