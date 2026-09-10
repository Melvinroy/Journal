-- Brontide Trading domain v1. Additive only: the legacy public.trades rows remain untouched.
-- Recovery: take a database backup before applying. Roll back by dropping only the seven
-- tables introduced here in reverse dependency order; never drop or rewrite public.trades.

create table if not exists public.trade_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  plan_key text not null,
  revision integer not null check (revision > 0),
  schema_version integer not null default 1 check (schema_version = 1),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, plan_key, revision)
);

create table if not exists public.trade_campaigns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  campaign_key text not null,
  plan_id uuid references public.trade_plans(id) on delete set null,
  journal_trade_id uuid references public.trades(id) on delete set null,
  account_scope text not null,
  symbol text not null,
  direction text not null check (direction in ('Long', 'Short')),
  lifecycle text not null check (lifecycle in ('Draft','Saved','Pending entry','Partially filled','Open','Unprotected','Closing','Closed','Cancelled','Expired','Rejected','Sync pending','Needs Review')),
  schema_version integer not null default 1 check (schema_version = 1),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, account_scope, campaign_key)
);

create table if not exists public.broker_order_intents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  campaign_id uuid references public.trade_campaigns(id) on delete cascade,
  account_scope text not null,
  session_scope text not null,
  idempotency_key text not null,
  role text not null check (role in ('entry','protection','target','runner','close')),
  state text not null,
  schema_version integer not null default 1 check (schema_version = 1),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, account_scope, session_scope, idempotency_key)
);

create table if not exists public.trade_executions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  campaign_id uuid not null references public.trade_campaigns(id) on delete cascade,
  account_scope text not null,
  session_scope text not null,
  broker_execution_id text not null,
  broker_order_id text not null,
  occurred_at timestamptz not null,
  schema_version integer not null default 1 check (schema_version = 1),
  payload jsonb not null,
  unique (user_id, account_scope, session_scope, broker_execution_id)
);

create table if not exists public.exit_allocations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  campaign_id uuid not null references public.trade_campaigns(id) on delete cascade,
  allocation_key text not null,
  role text not null check (role in ('target','protection','runner')),
  intended_quantity integer not null check (intended_quantity >= 0),
  working_quantity integer not null check (working_quantity >= 0),
  filled_quantity integer not null check (filled_quantity >= 0),
  remaining_quantity integer not null check (remaining_quantity >= 0),
  schema_version integer not null default 1 check (schema_version = 1),
  payload jsonb not null default '{}'::jsonb,
  unique (campaign_id, allocation_key),
  check (filled_quantity + remaining_quantity = intended_quantity),
  check (working_quantity <= remaining_quantity)
);

create table if not exists public.journal_reviews (
  campaign_id uuid primary key references public.trade_campaigns(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  schema_version integer not null default 1 check (schema_version = 1),
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.reconciliation_checkpoints (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  account_scope text not null,
  session_scope text not null,
  checkpoint_key text not null,
  reconciled_at timestamptz not null,
  schema_version integer not null default 1 check (schema_version = 1),
  payload jsonb not null,
  unique (user_id, account_scope, session_scope, checkpoint_key)
);

do $$
declare table_name text;
begin
  foreach table_name in array array['trade_plans','trade_campaigns','broker_order_intents','trade_executions','exit_allocations','journal_reviews','reconciliation_checkpoints']
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on table public.%I from anon', table_name);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', table_name);
    execute format('drop policy if exists "Users own %s" on public.%I', table_name, table_name);
    execute format('create policy "Users own %s" on public.%I for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', table_name, table_name);
  end loop;
end $$;
