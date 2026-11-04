begin;
-- Explicit opt-in access, including when automatic exposure of new tables is disabled.
-- Schema USAGE grants no table reads or writes by itself. Do not change default privileges.
grant usage on schema public to authenticated;
do $$
declare t text;
begin
  foreach t in array array['accounts','categories','cards','recurring','transactions','transfers','adjustments','purchases','invoices','installments','payments','invoice_entries','occurrences','budgets','settings','audit'] loop
    execute format('create policy owner_select on public.ms_%I for select to authenticated using ((select auth.uid()) = user_id)', t);
    execute format('create policy owner_insert on public.ms_%I for insert to authenticated with check ((select auth.uid()) = user_id)', t);
    execute format('create policy owner_update on public.ms_%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', t);
    execute format('create policy owner_delete on public.ms_%I for delete to authenticated using ((select auth.uid()) = user_id)', t);
    -- RLS prepares CRUD isolation, but ordinary financial writes remain unavailable until phase 3.2 RPCs.
    execute format('revoke all on public.ms_%I from public, anon, authenticated', t);
    execute format('grant select on public.ms_%I to authenticated', t);
  end loop;
end $$;

-- One MVCC snapshot, RLS enforced as the caller. No user-id argument and no SECURITY DEFINER.
create function public.ms_snapshot() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'accounts', (select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from public.ms_accounts t where user_id = (select auth.uid())),
    'categories', (select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from public.ms_categories t where user_id = (select auth.uid())),
    'cards', (select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from public.ms_cards t where user_id = (select auth.uid())),
    'recurring', (select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from public.ms_recurring t where user_id = (select auth.uid())),
    'transactions', (select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from public.ms_transactions t where user_id = (select auth.uid())),
    'transfers', (select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from public.ms_transfers t where user_id = (select auth.uid())),
    'adjustments', (select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from public.ms_adjustments t where user_id = (select auth.uid())),
    'purchases', (select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from public.ms_purchases t where user_id = (select auth.uid())),
    'invoices', (select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from public.ms_invoices t where user_id = (select auth.uid())),
    'installments', (select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from public.ms_installments t where user_id = (select auth.uid())),
    'payments', (select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from public.ms_payments t where user_id = (select auth.uid())),
    'invoiceEntries', (select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from public.ms_invoice_entries t where user_id = (select auth.uid())),
    'occurrences', (select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from public.ms_occurrences t where user_id = (select auth.uid())),
    'budgets', (select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from public.ms_budgets t where user_id = (select auth.uid())),
    'settings', (select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from public.ms_settings t where user_id = (select auth.uid())),
    'audit', (select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from public.ms_audit t where user_id = (select auth.uid()))
  );
$$;
revoke all on function public.ms_snapshot() from public, anon, authenticated;
grant execute on function public.ms_snapshot() to authenticated;
commit;
