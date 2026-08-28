-- The Catalyst dashboard is read-only and available only to signed-in users.
-- security_invoker on the view keeps the underlying catalyst table RLS policies active.
do $$
begin
  if to_regclass('public.catalyst_dashboard_rows') is not null then
    grant select on table public.catalyst_dashboard_rows to authenticated;
  end if;
end
$$;
