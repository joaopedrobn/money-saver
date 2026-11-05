-- Local-only runner verifies Docker named pipe/container before executing this file.
-- No synchronization flag or allowlist is changed, even temporarily.
begin;
\ir ../remote-migrations/202611040001_controlled_financial_sync.sql

do $$ declare n integer; begin
  if (select enabled from ms_sync_private.environment where singleton) is distinct from false
    or (select project_ref from ms_sync_private.environment where singleton)<>'iwzmsbkbuerleocismhj'
    or exists(select 1 from ms_sync_private.allowed_users) then raise exception 'Gate must remain closed and empty'; end if;
  select count(*) into n from pg_proc p join pg_namespace s on s.oid=p.pronamespace
    where (s.nspname='ms_sync_private' and p.proname in ('access_allowed','assert_bundle','capture_version'))
       or (s.nspname='public' and p.proname in ('ms_import_initial','ms_apply_changes','ms_sync_view','ms_changes','ms_approve'));
  if n<>8 then raise exception 'Missing compiled functions'; end if;
  if not exists(select 1 from pg_trigger where tgname='sync_feed' and not tgisinternal) then raise exception 'Missing feed trigger'; end if;
end $$;
\echo 'PASS complete exact migration, eight compiled functions, feed trigger, closed environment'

do $$ declare f record; expected_owner text; begin
  for f in select p.*,r.rolname from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner
    where n.nspname='public' and p.proname in ('ms_import_initial','ms_apply_changes','ms_sync_view','ms_changes','ms_approve') loop
    expected_owner:=case when f.proname='ms_approve' then 'money_saver_sync_validator' else 'money_saver_sync_executor' end;
    if f.rolname<>expected_owner or not f.prosecdef or not f.proconfig @> array['row_security=on']
      or not exists(select 1 from unnest(f.proconfig) c where c='search_path=""') then raise exception 'Unsafe function %',f.proname; end if;
    if has_function_privilege('anon',f.oid,'EXECUTE') or has_function_privilege('service_role',f.oid,'EXECUTE') then raise exception 'Unexpected RPC access'; end if;
    if has_function_privilege('authenticated',f.oid,'EXECUTE') is distinct from (f.proname<>'ms_approve') then raise exception 'Wrong client EXECUTE grant'; end if;
  end loop;
  if not has_function_privilege('money_saver_sync_validator','public.ms_approve(uuid,uuid,bigint,text,text,text)','EXECUTE') then raise exception 'Validator cannot approve'; end if;
  if exists(select 1 from pg_roles where rolname in ('money_saver_sync_executor','money_saver_sync_validator') and (rolsuper or rolbypassrls or rolcanlogin or rolcreaterole)) then raise exception 'Unsafe role'; end if;
  if pg_has_role('authenticated','money_saver_sync_executor','MEMBER') or pg_has_role('authenticated','money_saver_sync_validator','MEMBER') then raise exception 'Role escalation'; end if;
end $$;
\echo 'PASS RPC owners, SECURITY DEFINER, empty search_path, row_security, least EXECUTE privileges'

-- Local test transaction only: allow the test administrator to inspect invoker helpers.
grant money_saver_sync_executor,money_saver_sync_validator to postgres;

do $$ declare t record; n integer:=0; begin
  for t in select c.* from pg_class c join pg_namespace ns on ns.oid=c.relnamespace
    where ns.nspname='public' and c.relkind='r' and c.relname like 'ms\_%' escape '\' loop
    n:=n+1;
    if not t.relrowsecurity or not t.relforcerowsecurity then raise exception 'RLS weakened on %',t.relname; end if;
    if has_table_privilege('authenticated',t.oid,'INSERT,UPDATE,DELETE') or has_table_privilege('anon',t.oid,'SELECT,INSERT,UPDATE,DELETE') then raise exception 'Generic writes or anonymous reads enabled'; end if;
    if has_table_privilege('money_saver_sync_validator',t.oid,'SELECT,INSERT,UPDATE,DELETE') then raise exception 'Validator financial access'; end if;
  end loop;
  if n<>16 then raise exception 'Expected sixteen financial tables'; end if;
  select count(*) into n from pg_class c join pg_namespace ns on ns.oid=c.relnamespace
    where ns.nspname='ms_sync_private' and c.relkind='r' and c.relname<>'environment' and c.relrowsecurity and c.relforcerowsecurity;
  if n<>6 then raise exception 'Private owner RLS missing'; end if;
end $$;
\echo 'PASS sixteen FORCE RLS tables, private RLS, generic financial writes blocked'

insert into auth.users(id,email) values
 ('11111111-1111-4111-8111-111111111111','closed-a@example.invalid'),
 ('22222222-2222-4222-8222-222222222222','closed-b@example.invalid');
insert into public.ms_accounts(user_id,id,created_at,updated_at,name,institution,type,opening_balance_cents,opening_date,color) values
 ('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',now(),now(),'Fake A','Test','checking',100,'2026-01-01','sage'),
 ('22222222-2222-4222-8222-222222222222','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',now(),now(),'Fake B','Test','checking',200,'2026-01-01','sage');
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $$ declare i integer; begin
  if (select count(*) from public.ms_accounts)<>1 or jsonb_array_length(public.ms_snapshot()->'accounts')<>1 then raise exception 'Owner A read isolation failed'; end if;
  if public.ms_sync_view() is not null then raise exception 'Closed sync view leaked data'; end if;
  for i in 1..2 loop
    begin perform public.ms_import_initial('99999999-9999-4999-8999-999999999999',0,'{}'); raise exception 'Closed import accepted'; exception when insufficient_privilege then null; end;
    begin perform public.ms_apply_changes('99999999-9999-4999-8999-999999999999',0,'{}'); raise exception 'Closed delta accepted'; exception when insufficient_privilege then null; end;
  end loop;
  begin perform public.ms_changes(); raise exception 'Closed feed accepted'; exception when insufficient_privilege then null; end;
  begin update public.ms_accounts set name='forged'; raise exception 'Direct update accepted'; exception when insufficient_privilege then null; end;
  begin delete from public.ms_accounts; raise exception 'Direct delete accepted'; exception when insufficient_privilege then null; end;
  begin insert into ms_sync_private.allowed_users values(auth.uid()); raise exception 'Client joined allowlist'; exception when insufficient_privilege then null; end;
  begin perform public.ms_approve(auth.uid(),gen_random_uuid(),0,repeat('0',64),repeat('0',64),'money-saver-domain-v1'); raise exception 'Client approval accepted'; exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
do $$ begin
  if (select count(*) from public.ms_accounts)<>1 or (select name from public.ms_accounts)<>'Fake B' then raise exception 'Owner B isolation failed'; end if;
  if public.ms_sync_view() is not null then raise exception 'Closed view B leaked data'; end if;
end $$;
reset role;
\echo 'PASS two-owner reads, closed RPCs reject repeated operations, no client approval or allowlist writes'

set local role money_saver_sync_validator;
do $$ begin
  begin perform public.ms_approve('11111111-1111-4111-8111-111111111111',gen_random_uuid(),0,repeat('0',64),repeat('0',64),'money-saver-domain-v1');
    raise exception 'Closed validator approved operation'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role anon;
do $$ begin
  begin perform public.ms_sync_view(); raise exception 'Anonymous RPC accepted'; exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
  if exists(select 1 from ms_sync_private.heads) or exists(select 1 from ms_sync_private.operations)
    or exists(select 1 from ms_sync_private.approvals) or exists(select 1 from ms_sync_private.feed)
    or exists(select 1 from ms_sync_private.record_versions) then raise exception 'Denied RPC left metadata'; end if;
  if (select enabled from ms_sync_private.environment where singleton) or exists(select 1 from ms_sync_private.allowed_users) then raise exception 'Gate changed'; end if;
end $$;
\echo 'PASS validator and anon denied, zero receipts/revisions/approvals/feed, synchronization still disabled'

set local role money_saver_sync_executor;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
select ms_sync_private.assert_bundle();
do $$ begin
  if ms_sync_private.access_allowed(auth.uid()) then raise exception 'Closed access_allowed returned true'; end if;
end $$;
reset role;
rollback;
\echo 'PASS integrity checker and access_allowed execute; all migration objects and fictitious fixtures rolled back'
