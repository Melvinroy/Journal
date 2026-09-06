// Independent streaming EP implementation. No Brontide feature or fill code is imported.
using System.Globalization;
using Newtonsoft.Json;
using QuantConnect;
using QuantConnect.Algorithm;
using QuantConnect.Configuration;
using QuantConnect.Data;
using QuantConnect.Data.Market;
using QuantConnect.Orders;
using QuantConnect.Orders.Fees;
using QuantConnect.Statistics;
using QuantConnect.Securities;
using System.Diagnostics;

namespace Brontide.Pilot;

public class PilotBar : TradeBar
{
    public bool Opening;
    public int Ordinal;
    public override SubscriptionDataSource GetSource(SubscriptionDataConfig config, DateTime date, bool live)
        => new(Path.Combine(Config.Get("pilot-input"),config.Symbol.Value+".csv"),SubscriptionTransportMedium.LocalFile);
    public override BaseData Reader(SubscriptionDataConfig config,string line,DateTime date,bool live)
    {
        if(string.IsNullOrWhiteSpace(line))return null;
        var p=line.Split(',');var day=DateTime.ParseExact(p[0],"yyyy-MM-dd",CultureInfo.InvariantCulture);
        var opening=p[1]=="open";
        decimal D(int i)=>decimal.Parse(p[i],CultureInfo.InvariantCulture);
        return new PilotBar{Symbol=config.Symbol,Time=day.AddHours(9.5),Period=opening?TimeSpan.Zero:TimeSpan.FromHours(6.5),
            Opening=opening,Ordinal=int.Parse(p[7]),Open=D(2),High=D(3),Low=D(4),Close=D(5),Volume=D(6)};
    }
}
public class BpsFee : FeeModel
{
    public override OrderFee GetOrderFee(OrderFeeParameters p)=>new(new CashAmount(Math.Abs(p.Order.Quantity)*p.Security.Price*.001m,"USD"));
}
public class SignalRecord
{
    public string symbol,ep_date,setup_date;public decimal atr;public int ordinal;
}
public class NativeRecord
{
    public string id,symbol,setup_date,entry_date,exit_date,status="Not entered",reason;
    public decimal atr,entry,exit,fees,stop,target;public decimal? net_r;public int entryOrdinal,stopId,limitId;
}
public class InstrumentState
{
    public List<PilotBar> history=new();public Queue<decimal> ranges=new();public decimal? atr;
    public int last=-2,eventOrdinal=-1;public PilotBar episode;public decimal postHigh;public bool distribution,qualified;
    public SignalRecord pending;
}
public class PilotAlgorithm : QCAlgorithm
{
    readonly Dictionary<Symbol,InstrumentState> states=new();
    readonly Dictionary<string,NativeRecord> records=new();
    readonly List<SignalRecord> signals=new();
    readonly List<object> nativeEvents=new();
    readonly List<object> checkpoints=new();
    string scoreStart,scoreEnd,executeOnly;int maxHold;decimal targetR;int gaps,opens,closes,episodes;
    public override void Initialize()
    {
        var setup=JsonConvert.DeserializeObject<Dictionary<string,string>>(File.ReadAllText(Path.Combine(Config.Get("pilot-input"),"settings.json")));
        scoreStart=setup["start"];scoreEnd=setup["end"];maxHold=int.Parse(setup["max_hold"]);targetR=decimal.Parse(setup["target_r"],CultureInfo.InvariantCulture);
        executeOnly=setup.GetValueOrDefault("execute_only", "*");
        SetStartDate(DateTime.Parse(setup["warmup_start"]));SetEndDate(DateTime.Parse(scoreEnd));SetCash(10000000);
        SetTimeZone(TimeZones.NewYork);
        foreach(var name in setup["symbols"].Split(',')){
            var security=AddData<PilotBar>(name,Resolution.Minute,TimeZones.NewYork,false,1m);
            security.SetFeeModel(new BpsFee());states[security.Symbol]=new();
        }
        SetBenchmark(t=>1m);
    }
    public override void OnData(Slice data)
    {
        foreach(var pair in data.Bars){
            if(pair.Value is not PilotBar b || !states.TryGetValue(pair.Key,out var s))continue;
            var day=b.Time.ToString("yyyy-MM-dd");
            if(b.Opening){
                opens++;
                // Missing next session never becomes a delayed entry.
                if(s.pending!=null){
                    var signal=s.pending;s.pending=null;var id=signal.symbol+"/"+signal.setup_date;
                    var r=new NativeRecord{id=id,symbol=signal.symbol,setup_date=signal.setup_date,atr=signal.atr,entryOrdinal=b.Ordinal};records[id]=r;
                    if(b.Ordinal!=signal.ordinal+1){r.reason="Missing next-open bar";continue;}
                    if(b.Open-r.atr<=0){r.reason="Non-positive protective stop";continue;}
                    MarketOrder(pair.Key,1,false,"entry:"+id);
                }
                continue;
            }
            // Native orders and fill models handle stop, target and gap prices.
            closes++;
            foreach(var r in records.Values.Where(r=>r.symbol==pair.Key.Value&&r.status=="Open").ToList()){
                if(s.last>=0&&b.Ordinal>s.last+1){r.status="Unresolved";r.reason="Missing holding-period bar";Transactions.CancelOrder(r.stopId);Transactions.CancelOrder(r.limitId);gaps++;}
                else if(b.Ordinal-r.entryOrdinal+1>=maxHold){Transactions.CancelOrder(r.stopId);Transactions.CancelOrder(r.limitId);MarketOrder(pair.Key,-1,false,"hold:"+r.id);}
            }
            var previous=s.last==b.Ordinal-1&&s.history.Count>0?s.history[^1]:null;
            var priorAtr=s.atr;
            if(previous==null){s.history.Clear();s.ranges.Clear();s.atr=null;s.episode=null;priorAtr=null;}
            else{
                var tr=Math.Max(b.High-b.Low,Math.Max(Math.Abs(b.High-previous.Close),Math.Abs(b.Low-previous.Close)));
                s.ranges.Enqueue(tr);if(s.ranges.Count>14)s.ranges.Dequeue();
                s.atr=s.atr.HasValue?(13*s.atr.Value+tr)/14:s.ranges.Count==14?s.ranges.Average():null;
            }
            var priorAdv=s.history.Count>=20?s.history.TakeLast(20).Average(x=>x.Volume):(decimal?)null;
            s.history.Add(b);s.last=b.Ordinal;
            var inclusive=s.history.Count>=20?s.history.TakeLast(20).Average(x=>x.Volume):(decimal?)null;
            if(day==scoreStart)checkpoints.Add(new{symbol=pair.Key.Value,day,atr=s.atr,priorAdv,sma10=s.history.TakeLast(10).Average(x=>x.Close),sma20=s.history.TakeLast(20).Average(x=>x.Close)});
            var ep=previous!=null&&b.Close/previous.Close>=1.04m&&b.Volume>=8900000&&inclusive>0&&b.Volume>=2*inclusive&&b.Volume>previous.Volume&&b.Close>3;
            if(ep){episodes++;s.episode=b;s.eventOrdinal=b.Ordinal;s.postHigh=b.High;s.distribution=false;s.qualified=false;continue;}
            if(s.episode==null||s.qualified)continue;
            var age=b.Ordinal-s.eventOrdinal;
            s.postHigh=Math.Max(s.postHigh,b.High);
            if(previous!=null&&priorAtr.HasValue&&previous.Close-b.Close>=.75m*priorAtr.Value&&b.Volume>previous.Volume)s.distribution=true;
            if(age<3||age>15||s.distribution||!s.atr.HasValue||priorAdv==null||s.history.Count<20)continue;
            var atr=s.atr.Value;var sma10=s.history.TakeLast(10).Average(x=>x.Close);var sma20=s.history.TakeLast(20).Average(x=>x.Close);
            if(b.Close>3&&b.Close>sma10&&sma10>sma20&&Math.Abs(b.Close-b.Open)<.25m*atr&&b.High-b.Low<.75m*atr&&b.Volume<.95m*priorAdv&&b.Volume<.5m*s.episode.Volume&&s.postHigh-b.Close<=atr){
                s.qualified=true;
                if(string.CompareOrdinal(day,scoreStart)>=0&&string.CompareOrdinal(day,scoreEnd)<=0){var signal=new SignalRecord{symbol=pair.Key.Value,ep_date=s.episode.Time.ToString("yyyy-MM-dd"),setup_date=day,atr=atr,ordinal=b.Ordinal};signals.Add(signal);if(executeOnly=="*"||executeOnly==signal.symbol+"/"+day)s.pending=signal;}
            }
        }
    }
    public override void OnOrderEvent(OrderEvent e)
    {
        if(e.Status!=OrderStatus.Filled)return;
        var order=Transactions.GetOrderById(e.OrderId);var pieces=order.Tag.Split(':',2);if(pieces.Length!=2||!records.TryGetValue(pieces[1],out var r))return;
        nativeEvents.Add(new{e.OrderId,e.FillPrice,e.FillQuantity,time=Time,tag=order.Tag,fee=e.OrderFee.Value.Amount});
        r.fees+=e.OrderFee.Value.Amount;
        if(pieces[0]=="entry"){
            r.entry=e.FillPrice;r.entry_date=Time.ToString("yyyy-MM-dd");r.status="Open";r.stop=r.entry-r.atr;r.target=r.entry+targetR*r.atr;
            r.stopId=StopMarketOrder(e.Symbol,-1,r.stop,tag:"stop:"+r.id).OrderId;
            r.limitId=LimitOrder(e.Symbol,-1,r.target,tag:"target:"+r.id).OrderId;
        }else if(r.status=="Open"){
            r.exit=e.FillPrice;r.exit_date=Time.ToString("yyyy-MM-dd");r.status="Closed";r.reason=pieces[0];r.net_r=(r.exit-r.entry-r.fees)/r.atr;
            if(e.OrderId!=r.stopId)Transactions.CancelOrder(r.stopId);
            if(e.OrderId!=r.limitId)Transactions.CancelOrder(r.limitId);
        }
    }
    public override void OnEndOfAlgorithm()
    {
        foreach(var s in states.Values)if(s.pending!=null){var q=s.pending;var id=q.symbol+"/"+q.setup_date;records[id]=new NativeRecord{id=id,symbol=q.symbol,setup_date=q.setup_date,atr=q.atr,reason="Next session unavailable"};}
        var closed=records.Values.Where(r=>r.status=="Closed").OrderBy(r=>r.exit_date).ThenBy(r=>r.id).ToList();
        // Feed net-R observations as unit-normalized P/L to LEAN's statistics class.
        // This is a formula comparison, explicitly not a portfolio currency report.
        var statistics=new TradeStatistics(closed.Select(r=>new Trade{EntryTime=DateTime.Parse(r.entry_date),ExitTime=DateTime.Parse(r.exit_date),ProfitLoss=r.net_r.Value,IsWin=r.net_r>0,TotalFees=0}));
        var fixture=new TradeStatistics(new decimal[]{2,-1,0,4,-2,-1}.Select((x,i)=>new Trade{EntryTime=new DateTime(2026,8,5),ExitTime=new DateTime(2026,8,6),ProfitLoss=x,IsWin=x>0,TotalFees=0}));
        var process=Process.GetCurrentProcess();
        File.WriteAllText(Config.Get("pilot-output"),JsonConvert.SerializeObject(new{signals,trades=records.Values,nativeEvents,checkpoints,statistics,fixture,gaps,opens,closes,episodes,cpu_seconds=process.TotalProcessorTime.TotalSeconds,peak_working_set_bytes=process.PeakWorkingSet64,engine="LEAN",basis="Independent order-ledger net R; unit-normalized statistics; custom OHLC data, no corporate-action verification"},Formatting.Indented));
    }
}
