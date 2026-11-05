-- Read-only catalog checks after the exact authorized controlled-sync migration.
-- No financial RPC invocation, fixtures, DML or activation.
select jsonb_build_object(
  'function_bodies', (select jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,
    'sha256',encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')) order by n.nspname,p.proname)
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='ms_sync_private' and p.proname in ('access_allowed','assert_bundle','capture_version'))
      or (n.nspname='public' and p.proname in ('ms_import_initial','ms_apply_changes','ms_sync_view','ms_changes','ms_approve'))),
  'financial_grants', (select jsonb_agg(jsonb_build_object('table',c.relname,
    'authenticated_select',has_table_privilege('authenticated',c.oid,'SELECT'),
    'authenticated_write',has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE'),
    'anon_access',has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE'),
    'validator_access',has_table_privilege('money_saver_sync_validator',c.oid,'SELECT,INSERT,UPDATE,DELETE'),
    'executor_select',has_table_privilege('money_saver_sync_executor',c.oid,'SELECT'),
    'executor_insert',has_table_privilege('money_saver_sync_executor',c.oid,'INSERT'),
    'executor_update',has_table_privilege('money_saver_sync_executor',c.oid,'UPDATE'),
    'executor_delete',has_table_privilege('money_saver_sync_executor',c.oid,'DELETE'),
    'owner_policies',(select count(*) from pg_policies q where q.schemaname='public' and q.tablename=c.relname
      and q.policyname in ('owner_select','owner_insert','owner_update','owner_delete')),
    'executor_policy',(select count(*) from pg_policies q where q.schemaname='public' and q.tablename=c.relname and q.policyname='sync_executor')) order by c.relname)
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' and c.relname like 'ms\_%' escape '\'),
  'private_rls', (select jsonb_agg(jsonb_build_object('table',c.relname,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity) order by c.relname)
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='ms_sync_private' and c.relkind='r'),
  'roles', (select jsonb_agg(jsonb_build_object('name',rolname,'superuser',rolsuper,'login',rolcanlogin,'bypassrls',rolbypassrls,'createrole',rolcreaterole,
    'public_create',has_schema_privilege(rolname,'public','CREATE')) order by rolname)
    from pg_roles where rolname in ('money_saver_sync_executor','money_saver_sync_validator')),
  'validator_execute',has_function_privilege('money_saver_sync_validator','public.ms_approve(uuid,uuid,bigint,text,text,text)','EXECUTE'),
  'executor_cannot_approve',not has_function_privilege('money_saver_sync_executor','public.ms_approve(uuid,uuid,bigint,text,text,text)','EXECUTE'),
  'client_cannot_assume_executor',not pg_has_role('authenticated','money_saver_sync_executor','MEMBER'),
  'client_cannot_assume_validator',not pg_has_role('authenticated','money_saver_sync_validator','MEMBER'),
  'private_schema_closed',not has_schema_privilege('authenticated','ms_sync_private','USAGE')
    and not has_schema_privilege('anon','ms_sync_private','USAGE') and not has_schema_privilege('service_role','ms_sync_private','USAGE')
) as postflight;
