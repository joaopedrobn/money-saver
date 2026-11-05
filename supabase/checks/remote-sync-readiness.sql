-- Read-only catalog inspection. Does not read financial rows or auth.users.
-- One result set: hosted db query returns only the final statement's result.
select jsonb_build_object(
  'postgres_version', current_setting('server_version'),
  'migrations', (select coalesce(jsonb_agg(version order by version),'[]'::jsonb) from supabase_migrations.schema_migrations),
  'tables', (select coalesce(jsonb_agg(to_jsonb(t) order by t.nspname,t.relname),'[]'::jsonb) from (
    select n.nspname,c.relname,c.relrowsecurity,c.relforcerowsecurity
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.relkind in ('r','p') and ((n.nspname='public' and c.relname like 'ms\_%' escape '\') or n.nspname='ms_sync_private')
  ) t),
  'functions', (select coalesce(jsonb_agg(to_jsonb(f) order by f.nspname,f.proname),'[]'::jsonb) from (
    select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) as arguments,
      pg_get_userbyid(p.proowner) as owner,p.prosecdef,p.proconfig,
      has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
      has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
      has_function_privilege('service_role',p.oid,'EXECUTE') as service_execute
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='public' and p.proname like 'ms\_%' escape '\') or n.nspname='ms_sync_private'
  ) f),
  'roles', (select coalesce(jsonb_agg(jsonb_build_object('name',rolname,'login',rolcanlogin,'bypassrls',rolbypassrls)),'[]'::jsonb)
    from pg_roles where rolname in ('money_saver_sync_executor','money_saver_sync_validator')),
  'direct_writes', (select coalesce(jsonb_agg(to_jsonb(w) order by w.relname),'[]'::jsonb) from (
    select c.relname,has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE') as unexpected_direct_writes
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' and c.relname like 'ms\_%' escape '\'
  ) w)
) as readiness;
