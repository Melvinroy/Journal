import { supabase, supabaseConfig } from "./supabase";
import { readWithClockRetry, withAuthTimeout } from "./auth-ready";
import type { CloudResult, CloudTradeGateway, CloudTradeRow } from "./cloud-trade-contract";

const unavailable = <T>(): CloudResult<T> => ({
  data: null,
  error: { message: "Cloud connection is not configured." },
});

/** Cloud route only. No standalone source may import this module at runtime. */
export const cloudTradeGateway: CloudTradeGateway = {
  configured: supabaseConfig.isConfigured,
  subscribeSession(onSession) {
    if (!supabase) { onSession(null, false); return () => {}; }
    let active = true;
    let eventSeen = false;
    withAuthTimeout(supabase.auth.getSession(), 5000, {
      data: { session: null }, error: null,
    }).then(({ data }) => {
      if (active && !eventSeen) onSession(data.session, false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      eventSeen = true;
      if (active) onSession(session, event === "PASSWORD_RECOVERY");
    });
    return () => { active = false; listener.subscription.unsubscribe(); };
  },
  async loadTrades(current) {
    const client = supabase;
    if (!client) return unavailable<CloudTradeRow[]>();
    const result = await readWithClockRetry(() => client
      .from("trades")
      .select("*")
      .order("trade_date", { ascending: false })
      .order("created_at", { ascending: false }), current);
    return result as CloudResult<CloudTradeRow[]>;
  },
  async addTrade(row) {
    if (!supabase) return unavailable<CloudTradeRow>();
    const result = await supabase.from("trades").insert(row).select().single();
    return result as CloudResult<CloudTradeRow>;
  },
  async importTrades(rows) {
    if (!supabase) return unavailable<CloudTradeRow[]>();
    const result = await supabase.from("trades").insert(rows).select();
    return result as CloudResult<CloudTradeRow[]>;
  },
  async signOut() { await supabase?.auth.signOut(); },
};
