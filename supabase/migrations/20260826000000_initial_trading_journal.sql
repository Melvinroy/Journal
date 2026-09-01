-- Brontide initial cloud schema.
-- Designed for one Supabase project per self-hosted installation.

create extension if not exists pgcrypto;

create table if not exists public.trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  symbol text not null,
  side text not null check (side in ('Long', 'Short')),
  setup text not null,
  trade_date date not null,
  pnl numeric(14, 2) not null,
  realized_r numeric(10, 4) not null,
  dollar_risk numeric(14, 2) not null check (dollar_risk > 0),
  planned_r numeric(10, 2) not null check (planned_r > 0),
  grade text not null check (grade in ('A', 'B', 'C')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists trades_user_date_idx
  on public.trades (user_id, trade_date desc, created_at desc);

alter table public.trades enable row level security;

drop policy if exists "Users can read their own trades" on public.trades;
create policy "Users can read their own trades"
  on public.trades for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their own trades" on public.trades;
create policy "Users can create their own trades"
  on public.trades for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own trades" on public.trades;
create policy "Users can update their own trades"
  on public.trades for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own trades" on public.trades;
create policy "Users can delete their own trades"
  on public.trades for delete
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.trades from anon;
grant usage on schema public to authenticated;
grant select, insert, update, delete on table public.trades to authenticated;

create or replace function public.set_trades_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trades_set_updated_at on public.trades;
create trigger trades_set_updated_at
before update on public.trades
for each row execute function public.set_trades_updated_at();
