const legacyDemoRSeries = [-1, -.85, .4, 1.25, -1, -.3, 3.4, .8, -1, 5.2, .2, -.7, 1.1, -1, .6, 8, -.9, .35, 2.2, -1, .95, 4.6, -1, 1.4, -.6, .5, 3.1, -1.2, 1.8, -1];
const legacyDemoSymbols = ["NVDA", "MDB", "PLTR", "MSTR", "COIN", "SNOW", "MU", "SHOP", "TGTX", "TOST"];
const legacyDemoSetups = ["Momentum breakout", "EP breakout", "Earnings gap", "10/20 pullback", "VWAP rejection"];

type LegacyTradeCandidate = {
  id?: unknown;
  symbol?: unknown;
  side?: unknown;
  setup?: unknown;
  pnl?: unknown;
  r?: unknown;
  risk?: unknown;
  plannedR?: unknown;
  grade?: unknown;
};

export const LOCAL_TRADE_STORAGE_KEY = "journal-trades-v2";

export function isLegacyDemoDataset(value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== legacyDemoRSeries.length) return false;

  return value.every((candidate, index) => {
    if (!candidate || typeof candidate !== "object") return false;
    const trade = candidate as LegacyTradeCandidate;
    const r = legacyDemoRSeries[index];
    const risk = [150, 200, 250, 300][index % 4];
    return Number(trade.id) === index + 1
      && trade.symbol === legacyDemoSymbols[index % legacyDemoSymbols.length]
      && trade.side === (index % 5 === 2 ? "Short" : "Long")
      && trade.setup === legacyDemoSetups[index % legacyDemoSetups.length]
      && Number(trade.pnl) === Math.round(r * risk)
      && Number(trade.r) === r
      && Number(trade.risk) === risk
      && Number(trade.plannedR) === [3, 4, 5][index % 3]
      && trade.grade === (r >= 2 ? "A" : r > 0 ? "B" : index % 4 === 0 ? "B" : "C");
  });
}
