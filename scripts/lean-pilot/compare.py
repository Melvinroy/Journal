"""Assert the bounded comparison; retain classified native execution differences."""
import argparse
import json
from math import isclose
from pathlib import Path

parser=argparse.ArgumentParser();parser.add_argument('evidence',type=Path);args=parser.parse_args()
root=args.evidence;expected=json.loads((root/'expected.json').read_text())
classifications={
    'real':'No real qualifying setups; signal parity is empty and gives no execution validation.',
    'stop':'Native cent tick rounding and security-price-based fee versus unrounded stop and fill-price fee.',
    'gap':'Same gap price and net R within floating-point tolerance. Reason text differs: generic native stop versus explicit gap-through-stop.',
    'target':'Native cent tick rounding and security-price-based fee versus unrounded target and fill-price fee.',
    'ambiguous':'Both choose stop in this run; Brontide explicitly guarantees conservative stop-first and records ambiguity. Native ticket processing plus OCO cancellation is not evidence of intrabar order.',
    'missingentry':'Both decline delayed entry. Missing prices are null in Brontide and zero-valued unused fields in the pilot adapter.',
    'missingholding':'Both label unresolved. Brontide leaves final cost/outcome unavailable; native ledger retains its entry fee and funded holding. No liquidation is synthesized.',
    'incomplete':'Both keep trade open and exclude it from closed statistics. Brontide final cost is unavailable; native ledger records the entry fee. No forced exit.',
    'maxhold':'Brontide defines exit at session 60 close. A native market order submitted after observing that close executes next session open; fee and holding date change. This is an execution-time convention, not a signal disagreement.',
    'futureperturbed':'Future-only OHLC perturbation preserves the preceding checkpoint and setup. Subsequent native maximum-hold exit executes next open, with security-price fee and close/open price differences, as in maxhold.'}
results=[];native={}
for case,ours in expected.items():
    lean=json.loads((root/f'lean-{case}.json').read_text());native[case]=lean
    keys=lambda rows:sorted((x['symbol'],x['ep_date'],x['setup_date']) for x in rows)
    assert keys(ours['signals'])==keys(lean['signals']),(case,'signal identity disagreement')
    for a,b in zip(ours['signals'],lean['signals']):
        assert isclose(a['measurements']['atr14'],b['atr'],rel_tol=1e-10),(case,'ATR mismatch')
    assert len(ours['trades'])==len(lean['trades']),(case,'trade count')
    comparisons=[]
    for a,b in zip(ours['trades'],lean['trades']):
        assert a['status']==b['status'],(case,'status mismatch')
        assert a.get('entry_date')==b.get('entry_date'),(case,'entry timing mismatch')
        if case not in ('maxhold','futureperturbed'):assert a.get('exit_date')==b.get('exit_date'),(case,'unclassified exit timing')
        else:
            assert a['hold_sessions']==60 and a['exit_date']=='2025-07-08' and b['exit_date']=='2025-07-09'
        if a['status']=='Closed':
            assert isclose(b['net_r'],(b['exit']-b['entry']-b['fees'])/b['atr'],abs_tol=1e-10)
            assert isclose(b['net_r']-a['outcome_r'],((b['exit']-a['exit'])-(b['entry']-a['entry'])-(b['fees']-a['fees_per_share']))/b['atr'],abs_tol=1e-10)
        comparisons.append({'ours':{k:a.get(k) for k in ('status','entry_date','exit_date','entry','exit','outcome_r','fees_per_share','hold_sessions','ambiguous')},
                            'lean':{k:b.get(k) for k in ('status','entry_date','exit_date','entry','exit','net_r','fees')}})
    assert lean['closes']>0,(case,'no bars processed')
    results.append({'case':case,'signals':len(ours['signals']),'classification':classifications[case],'trades':comparisons,
                    'native_cpu_seconds':lean['cpu_seconds'],'native_peak_working_set_bytes':lean['peak_working_set_bytes'],
                    **json.loads((root/f'native-{case}/timing.json').read_text())})
assert native['futureperturbed']['checkpoints']==native['maxhold']['checkpoints']
assert native['futureperturbed']['signals'][0]==native['maxhold']['signals'][0]
fixture=native['stop']['fixture']
for key,want in {'TotalNumberOfTrades':6,'NumberOfWinningTrades':2,'NumberOfLosingTrades':4,'TotalProfitLoss':2,'TotalProfit':6,'TotalLoss':-4,'LargestProfit':4,'LargestLoss':-2,'AverageProfitLoss':.3333,'AverageProfit':3,'AverageLoss':-1,'ProfitFactor':1.5,'MaximumClosedTradeDrawdown':-3,'MaxConsecutiveWinningTrades':1,'MaxConsecutiveLosingTrades':2}.items():
    assert isclose(float(fixture[key]),want,abs_tol=1e-4),(key,fixture[key],want)
report={'passed':True,'cases':results,'causality':'Future-only OHLC perturbation leaves the score-start feature checkpoint and preceding signal unchanged.',
        'formula_fixture':{'outcomes':[2,-1,0,4,-2,-1],'ours':{'closed':6,'winners':2,'losers':3,'breakeven':1,'total_r':2,'expectancy_r':1/3,'median_r':-.5,'average_win_r':3,'average_loss_r':-4/3,'payoff_ratio':2.25,'profit_factor_r':1.5,'drawdown_r':3},
                           'lean':fixture,'classification':'LEAN groups zero-P/L as loss, changing losing count, average loss, payoff and win/loss ratio. LEAN drawdown has opposite sign and decimal output rounds to four places. Its trade Sharpe/Sortino are not account ratios.'}}
(root/'comparison.json').write_text(json.dumps(report,indent=2));print('PASS:',len(results),'cases; independent signals/ATR, native accounting identities, hand statistics, future causality; every difference classified.')
