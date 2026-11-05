-- Business revision conflicts are terminal HTTP 409 responses, not serialization retries.
-- PostgREST 14 retries SQLSTATE 40001 indefinitely. Preserve all other function text,
-- owners, ACLs, security settings, locking, approvals, receipts and financial logic.
begin;
do $$
begin
  if not pg_has_role('postgres','money_saver_sync_executor','MEMBER')
     or pg_has_role('postgres','money_saver_sync_executor','SET')
     or has_schema_privilege('money_saver_sync_executor','public','CREATE') then
    raise exception 'Unexpected pre-existing deployment privileges';
  end if;
end $$;
grant money_saver_sync_executor to postgres with set true;
grant create on schema public to money_saver_sync_executor;
set local role money_saver_sync_executor;
do $$
declare target record; definition text;
begin
  for target in select * from (values
    ('ms_apply_changes(uuid,bigint,text)','5c5026462fd0e244b2c7ccef7154d69f5127a7f1e007c88e10e0449b7a389f4d'),
    ('ms_import_initial(uuid,bigint,text)','4a905fcfc59fbbab8430724019db12a2d84edb148a5cc302bbf886d7d99883fb')
  ) as expected(signature,sha256) loop
    select pg_get_functiondef(target.signature::regprocedure) into definition;
    if encode(sha256(convert_to(definition,'UTF8')),'hex')<>target.sha256
       or (length(definition)-length(replace(definition,'40001','')))/5<>1 then
      raise exception 'Unexpected function definition: %',target.signature;
    end if;
    execute replace(definition,'errcode=''40001''','errcode=''PT409''');
  end loop;
end $$;
reset role;
revoke create on schema public from money_saver_sync_executor;
grant money_saver_sync_executor to postgres with set false;
commit;
