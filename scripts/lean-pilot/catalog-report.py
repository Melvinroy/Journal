"""Render the versioned metric catalog and enumerate every pinned LEAN statistic."""
import json
import re
from pathlib import Path

root = Path(__file__).resolve().parents[2]
catalog = json.loads((root/'services/eod/src/brontide_eod/research_metrics.json').read_text())
lines = ['# Research metric catalog', '', f"Version: `{catalog['version']}`.", '',
         'The JSON catalog is the API and UI source of truth. Read-only endpoints: `GET /v1/research/metrics`, `GET /v1/research/runs/{id}/analytics`, and enriched trade rows with `enriched=true`. Analytics use every matching ledger record before pagination. Source runs and original exports remain immutable.', '',
         'R is net per-share profit divided by the recorded setup ATR risk. Each independent trade receives equal weight; concurrent positions are not combined into a funded portfolio. Closed observations need a finite recorded outcome. Breakeven is exactly zero. Open/unresolved attempts are visible but never counted as completed winners. Missing metrics display an em dash and a reason.', '',
         'Drawdown and streak order is exit session followed by stable trade ID. Same-session intraday sequencing is unknown. Drawdown is a positive loss magnitude, starting cumulative R at zero. Conservative excursions omit unobservable exit-day extremes; these are not full intratrade path statistics. All costs are recorded modeled costs, not verified broker executions.', '']
for scope in ('run','trade'):
    lines += ['## '+scope.title()+' metrics', '', '| ID / label | Unit | Definition and basis | Inputs | Limitations / availability |', '|---|---|---|---|---|']
    for m in catalog['metrics']:
        if m['scope']!=scope:continue
        cells=[f"`{m['id']}` — {m['label']}",m['unit'],m['definition'],', '.join(m['inputs']),m['limitations']+' '+m['availability']]
        lines.append('| '+' | '.join(x.replace('|','/').replace('\n',' ') for x in cells)+' |')
    lines.append('')
mapping = {
    'TotalNumberOfTrades':'closed','NumberOfWinningTrades':'winners','NumberOfLosingTrades':'losers (LEAN includes zero P/L; we separate breakeven)',
    'TotalProfitLoss':'total_r','TotalProfit':'top-five contribution and average_win_r × winners; total positive R is derivable',
    'TotalLoss':'average_loss_r × losers; total negative R is derivable','LargestProfit':'best_r','LargestLoss':'worst_r',
    'AverageProfitLoss':'expectancy_r','AverageProfit':'average_win_r','AverageLoss':'average_loss_r; denominator excludes breakeven',
    'AverageTradeDuration':'average_hold_sessions; sessions rather than calendar TimeSpan',
    'MaxConsecutiveWinningTrades':'winning_streak','MaxConsecutiveLosingTrades':'losing_streak; breakeven resets',
    'ProfitLossRatio':'payoff_ratio','WinRate':'win_rate','LossRate':'losers / closed; derivable',
    'AverageMAE':'average_mae_r (conservative bar evidence)','AverageMFE':'average_mfe_r (conservative bar evidence)',
    'MaximumClosedTradeDrawdown':'closed_trade_drawdown_r; positive magnitude versus LEAN negative value',
    'ProfitFactor':'profit_factor_r; null when denominator is zero, unlike LEAN sentinel/cap',
    'TotalFees':'fees_per_share on each trade; currency total needs quantities',
    'StartDateTime':'recorded entry_date and exit_date bounds; display provenance instead of a headline',
    'EndDateTime':'recorded entry_date and exit_date bounds; display provenance instead of a headline',
    'WinLossRatio':'winners / losers is derivable; payoff ratio retained as the more useful default',
    'SharpeRatio':'Deferred trade-P/L mean/deviation ratio: not portfolio Sharpe. Add only under an explicit trade-statistic name with sample-size handling.',
    'SortinoRatio':'Deferred trade-P/L mean/downside-deviation ratio: not portfolio Sortino. Add only under an explicit trade-statistic name with sample-size handling.',
    'ProfitLossStandardDeviation':'Deferred optional dispersion measure; outcome histogram and median are included first.',
    'ProfitLossDownsideDeviation':'Deferred optional dispersion measure; outcome histogram and worst trade are included first.',
    'ProfitToMaxDrawdownRatio':'Deferred derived total-R / drawdown-R ratio; requires defined zero-drawdown handling.'}
lines += ['## Coverage against pinned LEAN', '',
          'Inventory extracted from LEAN revision `23b735d99a357807dc0df9f4c51d30f05fe0d277`. The R mapping is an intentional normalized trade comparison, not equality with account-currency P/L. [TradeStatistics source](https://github.com/QuantConnect/Lean/blob/23b735d99a357807dc0df9f4c51d30f05fe0d277/Common/Statistics/TradeStatistics.cs), [PortfolioStatistics source](https://github.com/QuantConnect/Lean/blob/23b735d99a357807dc0df9f4c51d30f05fe0d277/Common/Statistics/PortfolioStatistics.cs).', '']
for name in ('TradeStatistics','PortfolioStatistics'):
    source=(root/f'output/lean-pilot/Lean/Common/Statistics/{name}.cs').read_text(encoding='utf-8-sig')
    properties=re.findall(r'public\s+[\w?<>]+\s+(\w+)\s*\{\s*get;',source)
    lines += ['### '+name, '', '| LEAN property | Included mapping or deferral rationale |', '|---|---|']
    for p in properties:
        if name=='PortfolioStatistics':
            reason='Deferred: requires quantities, account cash/equity through time, concurrent-position allocation, mark-to-market valuation, costs and a matching benchmark/risk-free series as applicable. Independent R is not a substitute.'
        elif p in mapping:reason=mapping[p]
        elif 'Duration' in p:reason='Deferred calendar-duration statistic: ledger stores session dates/counts, without intraday execution timestamps; session holding count is exposed.'
        elif 'Drawdown' in p or 'MAE' in p or 'MFE' in p:reason='Deferred full-path statistic: daily OHLC cannot establish exit-day ordering/extremes. Conservative per-trade MFE/MAE and closed-trade drawdown are exposed.'
        else:raise ValueError('Unclassified statistic '+p)
        lines.append(f'| `{p}` | {reason} |')
    lines.append('')
lines += ['### Additional scope decisions', '',
          'Included beyond LEAN defaults: median R, open/unresolved/not-entered counts, missing coverage, histogram, ambiguity flags, five largest winners in R, and saved setup measurements. Five-largest-winner contribution is expressed in R because percentage of total can be misleading when total R is zero or negative.', '',
          'Exposure, turnover, benchmark-relative returns, capacity, VaR and probabilistic Sharpe remain unavailable without a portfolio and liquidity model. User-written formulas, full-universe benchmarks and longer validation are outside this pass. No metric is fabricated from visible rows or contemporary scan data.']
(root/'docs/RESEARCH_METRICS.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
print('Catalog report written:',len(catalog['metrics']),'metrics')
