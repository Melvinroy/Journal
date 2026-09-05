"use client";
import { useState } from "react";
import { useBrowserStore } from "../lib/use-browser-store";
import { WATCH_KEY, updateWatchlist, validWatchlist, type WatchItem } from "../lib/workspace-state";

export function Watchlist({ symbol, onSelect, sample }: { symbol:string; onSelect:(symbol:string)=>void; sample:boolean }) {
  const store = useBrowserStore<WatchItem[]>(WATCH_KEY, [],validWatchlist);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const change = (ticker: string, action: "add" | "remove" | "up") => {
    try { store.save(updateWatchlist(store.value, ticker, action)); setQuery(""); setMessage(""); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Invalid ticker"); }
  };
  return <aside className="watchlist-panel" aria-label="Watchlist"><details open><summary>Watchlist <small>{store.value.length}</small></summary>
    <p>{sample ? "Demo charts: NVDA, MRNA, CRCL. Other tickers need local data." : "Local EOD · quotes appear on the chart."}</p>
    <form onSubmit={event => {event.preventDefault(); change(query, "add");}}><input aria-label="Add watchlist ticker" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Add ticker" maxLength={32}/><button disabled={!store.ready}>Add</button></form>
    {(message || store.error) && <p role="alert">{message || store.error}</p>}
    {!store.value.length && <p>No saved instruments. Add a ticker to start.</p>}
    {store.value.map((item,index)=><div className="watchlist-item" key={item.symbol}><div><button className={symbol===item.symbol?"active":""} disabled={sample && !["NVDA","MRNA","CRCL"].includes(item.symbol)} onClick={()=>onSelect(item.symbol)}>{item.symbol}</button><button disabled={index===0} aria-label={`Move ${item.symbol} up`} onClick={()=>change(item.symbol,"up")}>↑</button><button aria-label={`Remove ${item.symbol}`} onClick={()=>change(item.symbol,"remove")}>×</button></div><input aria-label={`Note for ${item.symbol}`} placeholder="Note" maxLength={200} value={item.note} onChange={event=>store.save(store.value.map(row=>row.symbol===item.symbol?{...row,note:event.target.value}:row))}/></div>)}
  </details></aside>;
}
