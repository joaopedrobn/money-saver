-- Read-only catalog inspection. Does not read financial rows or auth.users.
select current_setting('server_version') as postgres_version;
select version from supabase_migrations.schema_migrations order by version;
select n.nspname,c.relname,c.relrowsecurity,c.relforcerowsecurity
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where (n.nspname='public' and c.relname like 'ms\_%' escape '\') or n.nspname='ms_sync_private'
order by n.nspname,c.relname;
select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) as arguments,
  pg_get_userbyid(p.proowner) as owner,p.prosecdef,p.proconfig,
  has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
  has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
  has_function_privilege('service_role',p.oid,'EXECUTE') as service_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where (n.nspname='public' and p.proname like 'ms\_%' escape '\') or n.nspname='ms_sync_private'
order by n.nspname,p.proname;
select c.relname,
  has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE') as unexpected_direct_writes
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind='r' and c.relname like 'ms\_%' escape '\'
order by c.relname;
