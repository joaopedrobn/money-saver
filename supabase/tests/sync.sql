-- Disposable Supabase only. All roles, policies, fixtures and grants roll back.
\ir ../checks/disposable-guard.sql
-- Exercise the existing two-user CRUD/RLS/FK suite first (its own rollback).
\ir isolation.sql
begin;
\ir ../phase32a/prepare.sql
\ir fixtures/initial-import.sql
insert into auth.users(id,email) values
 ('11111111-1111-4111-8111-111111111111','phase32-a@example.invalid'),
 ('22222222-2222-4222-8222-222222222222','phase32-b@example.invalid');

do $$ declare t text; begin
  if has_function_privilege('authenticated','public.ms_import_initial(uuid,bigint,text)','EXECUTE') or has_function_privilege('anon','public.ms_import_initial(uuid,bigint,text)','EXECUTE') then raise exception 'RPC must be closed by default'; end if;
  if exists(select 1 from pg_roles where rolname='money_saver_sync_executor' and (rolsuper or rolbypassrls or rolcanlogin or rolcreaterole)) then raise exception 'Unsafe executor role'; end if;
  if not has_schema_privilege('money_saver_sync_executor','auth','USAGE') or not has_schema_privilege('money_saver_sync_validator','auth','USAGE') then raise exception 'Internal roles lack auth schema access'; end if;
  if not has_function_privilege('money_saver_sync_executor','auth.uid()','EXECUTE') or not has_function_privilege('money_saver_sync_validator','auth.uid()','EXECUTE') then raise exception 'Internal roles lack auth.uid access'; end if;
  if pg_has_role('money_saver_sync_executor','authenticated','SET') or pg_has_role('money_saver_sync_validator','anon','SET') then raise exception 'Internal roles must not SET ROLE into API roles'; end if;
  if has_function_privilege('service_role','public.ms_import_initial(uuid,bigint,text)','EXECUTE') then raise exception 'Service role must not execute candidate RPC'; end if;
  if not exists(select 1 from pg_proc p join pg_roles r on r.oid=p.proowner where p.oid='public.ms_import_initial(uuid,bigint,text)'::regprocedure
    and p.prosecdef and r.rolname='money_saver_sync_executor' and p.proconfig @> array['row_security=on']
    and exists(select 1 from unnest(p.proconfig) value where split_part(value,'=',1)='search_path' and replace(split_part(value,'=',2),'"','')='')) then raise exception 'Unsafe RPC owner, search_path or RLS setting'; end if;
  if (select prosecdef from pg_proc where oid='ms_sync_private.assert_bundle()'::regprocedure) then raise exception 'Bundle checker must remain security invoker'; end if;
  if pg_has_role('authenticated','money_saver_sync_executor','MEMBER') or pg_has_role('authenticated','money_saver_sync_validator','MEMBER') then raise exception 'Client role escalation'; end if;
  foreach t in array array['accounts','categories','cards','recurring','transactions','transfers','adjustments','purchases','invoices','installments','payments','invoice_entries','occurrences','budgets','settings','audit'] loop
    if has_table_privilege('authenticated','public.ms_'||t,'INSERT,UPDATE,DELETE') then raise exception 'Direct client write enabled'; end if;
    if has_table_privilege('money_saver_sync_executor','public.ms_'||t,'UPDATE,DELETE') or has_table_privilege('money_saver_sync_validator','public.ms_'||t,'SELECT,INSERT,UPDATE,DELETE') then raise exception 'Internal financial grants too broad'; end if;
  end loop;
end $$;
-- Fixture approvals stand in for a FUTURE trusted worker; this does not test its deployment/auth boundary.
grant money_saver_sync_executor,money_saver_sync_validator to postgres;
set local role money_saver_sync_executor;
grant execute on function public.ms_import_initial(uuid,bigint,text) to authenticated;
reset role;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
set local role money_saver_sync_validator;
insert into ms_sync_private.approvals(user_id,operation_id,expected_revision,payload_hash,reconciliation_hash,validator_version,expires_at)
values(auth.uid(),'99999999-9999-4999-8999-999999999999',0,
 encode(sha256(convert_to(current_setting('money_saver.test_payload'),'UTF8')),'hex'),
 repeat('0',64),'money-saver-domain-v1',clock_timestamp()+interval '10 minutes');
reset role;
set local role authenticated;
do $$ declare result jsonb; repeated jsonb; payload text:=current_setting('money_saver.test_payload'); begin
  -- Client cannot mint approvals or bypass the RPC with generic writes.
  begin insert into ms_sync_private.approvals(user_id,operation_id,expected_revision,payload_hash,reconciliation_hash,validator_version,expires_at)
    values(auth.uid(),gen_random_uuid(),0,repeat('0',64),repeat('0',64),'money-saver-domain-v1',clock_timestamp()+interval '1 minute');
    raise exception 'Client minted approval'; exception when insufficient_privilege then null; end;
  begin update public.ms_accounts set name='forged'; raise exception 'Direct update accepted'; exception when insufficient_privilege then null; end;
  begin delete from public.ms_accounts; raise exception 'Direct deletion accepted'; exception when insufficient_privilege then null; end;
  begin insert into public.ms_accounts select * from jsonb_populate_recordset(null::public.ms_accounts,(payload::jsonb)->'data'->'accounts');
    raise exception 'Direct insert accepted'; exception when insufficient_privilege then null; end;
  result:=public.ms_import_initial('99999999-9999-4999-8999-999999999999',0,payload);
  repeated:=public.ms_import_initial('99999999-9999-4999-8999-999999999999',0,payload);
  if result<>repeated or (result->>'revision')::int<>1 then raise exception 'Idempotency failed'; end if;
  if (select count(*) from public.ms_accounts)<>1 or (select count(*) from public.ms_installments)<>2 or (select count(*) from public.ms_payments)<>1 then raise exception 'Partial/duplicated import'; end if;
  begin perform public.ms_import_initial('99999999-9999-4999-8999-999999999999',0,payload||' ');
    raise exception 'Operation ID accepted different bytes'; exception when unique_violation then null; end;
  begin perform public.ms_import_initial('99999999-9999-4999-8999-999999999998',0,payload);
    raise exception 'Revision conflict not detected'; exception when serialization_failure then null; end;
end $$;
reset role;
do $$ begin
  if (select revision from ms_sync_private.heads where user_id='11111111-1111-4111-8111-111111111111')<>1
     or (select count(*) from ms_sync_private.operations)<>1
     or (select count(*) from ms_sync_private.record_versions)<>10 then raise exception 'Receipt/version atomicity failed'; end if;
end $$;

-- B: a deliberately faulty validator approval tests DB constraints independently of the TS validator.
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
select set_config('money_saver.test_payload_b',replace(current_setting('money_saver.test_payload'),'11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'),true);
select set_config('money_saver.test_partial',jsonb_set(current_setting('money_saver.test_payload_b')::jsonb,'{data,installments}',(current_setting('money_saver.test_payload_b')::jsonb->'data'->'installments')-1)::text,true);
select set_config('money_saver.test_foreign',jsonb_set(current_setting('money_saver.test_payload_b')::jsonb,'{data,accounts,0,user_id}','"11111111-1111-4111-8111-111111111111"')::text,true);
select set_config('money_saver.test_crossref',jsonb_set(current_setting('money_saver.test_payload_b')::jsonb,'{data,accounts}','[]')::text,true);
set local role money_saver_sync_validator;
insert into ms_sync_private.approvals(user_id,operation_id,expected_revision,payload_hash,reconciliation_hash,validator_version,expires_at)
select auth.uid(),id::uuid,0,encode(sha256(convert_to(current_setting(setting),'UTF8')),'hex'),repeat('0',64),'money-saver-domain-v1',clock_timestamp()+interval '10 minutes'
from (values
 ('99999999-9999-4999-8999-999999999991','money_saver.test_partial'),
 ('99999999-9999-4999-8999-999999999992','money_saver.test_foreign'),
 ('99999999-9999-4999-8999-999999999993','money_saver.test_crossref'),
 ('99999999-9999-4999-8999-999999999999','money_saver.test_payload_b')) fixtures(id,setting);
reset role;
set local role authenticated;
do $$ begin
  if (select count(*) from public.ms_accounts)<>0 then raise exception 'B saw A'; end if;
  begin perform public.ms_import_initial('99999999-9999-4999-8999-999999999990',0,current_setting('money_saver.test_payload_b'));
    raise exception 'Missing approval accepted'; exception when insufficient_privilege then null; end;
  begin perform public.ms_import_initial('99999999-9999-4999-8999-999999999991',0,current_setting('money_saver.test_partial'));
    raise exception 'Partial credit accepted'; exception when raise_exception then
      if sqlerrm<>'Inconsistent purchase installments' then raise; end if; end;
  begin perform public.ms_import_initial('99999999-9999-4999-8999-999999999992',0,current_setting('money_saver.test_foreign'));
    raise exception 'Foreign owner accepted'; exception when insufficient_privilege then null; end;
  begin perform public.ms_import_initial('99999999-9999-4999-8999-999999999993',0,current_setting('money_saver.test_crossref'));
    raise exception 'Cross-owner FK accepted'; exception when foreign_key_violation then null; end;
  if (select count(*) from public.ms_accounts)<>0 or (select count(*) from public.ms_purchases)<>0 then raise exception 'Rollback left partial finance'; end if;
end $$;
reset role;
do $$ begin
  if exists(select 1 from ms_sync_private.heads where user_id='22222222-2222-4222-8222-222222222222')
     or exists(select 1 from ms_sync_private.operations where user_id='22222222-2222-4222-8222-222222222222')
     or exists(select 1 from ms_sync_private.record_versions where user_id='22222222-2222-4222-8222-222222222222') then raise exception 'Rollback left metadata'; end if;
end $$;
set local role authenticated;
select public.ms_import_initial('99999999-9999-4999-8999-999999999999',0,current_setting('money_saver.test_payload_b')) is not null as user_b_imported;
do $$ declare snapshot jsonb:=public.ms_snapshot(); begin
  if jsonb_array_length(snapshot->'accounts')<>1 or snapshot->'accounts'->0->>'user_id'<>auth.uid()::text then raise exception 'B snapshot isolation failed'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
set local role authenticated;
do $$ declare snapshot jsonb:=public.ms_snapshot(); begin
  if jsonb_array_length(snapshot->'accounts')<>1 or snapshot->'accounts'->0->>'user_id'<>auth.uid()::text then raise exception 'A snapshot isolation failed'; end if;
end $$;
set local role anon;
select set_config('request.jwt.claim.sub','',true);
do $$ begin
  begin perform public.ms_import_initial('99999999-9999-4999-8999-999999999999',0,current_setting('money_saver.test_payload'));
    raise exception 'Anonymous import accepted'; exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
\echo 'Candidate sync SQL checks passed in disposable DB; all artifacts rolled back. Multi-session concurrency is a separate pending gate.'
