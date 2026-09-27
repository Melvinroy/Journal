import type { Session } from "@supabase/supabase-js";

/** Type-only boundary. The standalone route must not import a cloud client. */
export type AuthMode = "signin" | "signup" | "forgot" | "recovery";

export type CloudTradeRow = {
  id: string;
  symbol: string;
  side: "Long" | "Short";
  setup: string;
  trade_date: string;
  pnl: number | string;
  realized_r: number | string;
  dollar_risk: number | string;
  planned_r: number | string;
  grade: "A" | "B" | "C";
};

export type CloudResult<T> = { data: T | null; error: { message: string } | null };

export type CloudTradeGateway = {
  configured: boolean;
  subscribeSession: (onSession: (session: Session | null, recovering: boolean) => void) => () => void;
  loadTrades: (current: () => boolean) => Promise<CloudResult<CloudTradeRow[]>>;
  addTrade: (row: Omit<CloudTradeRow, "id">) => Promise<CloudResult<CloudTradeRow>>;
  importTrades: (rows: Omit<CloudTradeRow, "id">[]) => Promise<CloudResult<CloudTradeRow[]>>;
  signOut: () => Promise<void>;
};
