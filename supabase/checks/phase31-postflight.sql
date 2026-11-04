-- Catalog-only inspection. Execute exclusively with db query --remote --read-only.
-- Does not read financial rows, change permissions, or create fixtures.
with financial_tables as (
  select c.oid, c.relname, c.relrowsecurity, c.relforcerowsecurity, c.relacl, c.relowner
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relname in (
    'ms_accounts','ms_categories','ms_cards','ms_recurring','ms_transactions','ms_transfers',
    'ms_adjustments','ms_purchases','ms_invoices','ms_installments','ms_payments',
    'ms_invoice_entries','ms_occurrences','ms_budgets','ms_settings','ms_audit'
  )
)
select jsonb_build_object(
  'table_count', (select count(*) from financial_tables),
  'tables', (select jsonb_agg(jsonb_build_object(
    'name', t.relname,
    'rls', t.relrowsecurity,
    'force_rls', t.relforcerowsecurity,
    'authenticated_select', has_table_privilege('authenticated', t.oid, 'SELECT'),
    'authenticated_extra_privileges', has_table_privilege('authenticated', t.oid, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'),
    'anon_access', has_table_privilege('anon', t.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'),
    'public_access', exists(select 1 from aclexplode(coalesce(t.relacl, acldefault('r', t.relowner))) a where a.grantee = 0),
    'primary_key', (select pg_get_constraintdef(k.oid) from pg_constraint k where k.conrelid = t.oid and k.contype = 'p'),
    'policies', (select jsonb_agg(jsonb_build_object('name',p.policyname,'command',p.cmd,'roles',p.roles,'using',p.qual,'with_check',p.with_check) order by p.policyname)
      from pg_policies p where p.schemaname = 'public' and p.tablename = t.relname)
  ) order by t.relname) from financial_tables t),
  'foreign_keys', (select jsonb_agg(jsonb_build_object('table',t.relname,'definition',pg_get_constraintdef(k.oid)) order by t.relname,k.conname)
    from financial_tables t join pg_constraint k on k.conrelid = t.oid where k.contype = 'f'),
  'authenticated_schema_usage', has_schema_privilege('authenticated','public','USAGE'),
  'snapshot', (select jsonb_build_object(
    'security_definer', p.prosecdef,
    'volatility', p.provolatile,
    'configuration', p.proconfig,
    'authenticated_execute', has_function_privilege('authenticated',p.oid,'EXECUTE'),
    'anon_execute', has_function_privilege('anon',p.oid,'EXECUTE'),
    'public_execute', exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee = 0)
  ) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'ms_snapshot' and p.pronargs = 0)
) as security_verification;
