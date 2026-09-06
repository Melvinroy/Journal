"""Native regression: overlapping same-symbol signals execute in separate accounts."""
import json
from pathlib import Path
from brontide_eod.research_engines import FrozenInput, LeanEngine
from brontide_eod.research_pilot import fixtures

root=Path("output/lean-pilot/dual-engine-overlap").resolve()
root.mkdir(parents=True,exist_ok=True)
days,bars=fixtures()["maxhold"]
bars=bars[:95];days=days[:95]
ep=bars[79]["close"]*1.05
bars[80].update(open=bars[79]["close"],close=ep,high=ep+.3,low=bars[79]["close"]-.5,volume=100000000)
for b in bars[81:]:b.update(open=ep+.01,close=ep+.02,high=ep+.1,low=ep-.1,volume=100000)
spec=FrozenInput({"start":days[73],"end":days[-1]},days,{"FIXTURE":bars},[])
result=LeanEngine().run(spec,root)
assert len(result["signals"])==len(result["trades"])==2
assert all(t["status"]=="Open" for t in result["trades"])
assert result["native"]["discovery"]["trades"]==[]
for replay in result["native"]["independent_replays"]:
    assert len(replay["trades"])==1
    assert len(replay["nativeEvents"])==1
    assert replay["nativeEvents"][0]["FillQuantity"]==1
(root/"result.json").write_text(json.dumps(result,indent=2))
print("PASS: two overlapping same-symbol signals; two separate one-share accounts; both remain open.")
