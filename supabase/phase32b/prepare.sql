-- LOCAL LAB ONLY. Not a migration. Requires phase32a/prepare.sql and disposable guard.
\ir ../checks/disposable-guard.sql
alter table ms_sync_private.approvals drop constraint approvals_expected_revision_check;
alter table ms_sync_private.approvals add check(expected_revision>=0);
alter table ms_sync_private.approvals drop constraint approvals_validator_version_check;
alter table ms_sync_private.approvals add check(validator_version in ('money-saver-domain-v1','money-saver-domain-v2'));
grant usage on schema public to money_saver_sync_validator;
grant select on ms_sync_private.environment to money_saver_sync_validator;
grant select,update(created_at,expires_at) on ms_sync_private.approvals to money_saver_sync_validator;
create policy validator_read on ms_sync_private.approvals for select to money_saver_sync_validator using(user_id=(select auth.uid()));
create policy validator_renew on ms_sync_private.approvals for update to money_saver_sync_validator using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
grant update on ms_sync_private.record_versions to money_saver_sync_executor;
do $$ declare t text; begin
  foreach t in array array['accounts','categories','cards','recurring','transactions','transfers','adjustments','purchases','invoices','installments','payments','invoice_entries','occurrences','budgets','settings','audit'] loop
    execute format('grant update,delete on public.ms_%I to money_saver_sync_executor',t);
  end loop;
end $$;
create table ms_sync_private.feed (
  user_id uuid not null, revision bigint not null, entity text collate "C" not null,
  id uuid not null, row_data jsonb, operation_id uuid not null,
  primary key(user_id,revision,entity,id),
  foreign key(user_id,operation_id) references ms_sync_private.operations(user_id,operation_id) deferrable initially deferred
);
alter table ms_sync_private.feed enable row level security;
alter table ms_sync_private.feed force row level security;
revoke all on ms_sync_private.feed from public,anon,authenticated,service_role;
create policy sync_owner on ms_sync_private.feed to money_saver_sync_executor
  using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
grant select,insert on ms_sync_private.feed to money_saver_sync_executor;

create function ms_sync_private.capture_version() returns trigger language plpgsql security invoker set search_path='' as $$
declare t text; r jsonb;
begin
  t:='ms_'||regexp_replace(new.entity,'([A-Z])','_\1','g'); t:=lower(t);
  if not new.deleted then execute format('select to_jsonb(t) from public.%I t where user_id=$1 and id=$2',t) into r using new.user_id,new.id; end if;
  insert into ms_sync_private.feed values(new.user_id,new.revision,new.entity,new.id,r,new.operation_id);
  return new;
end $$;
revoke all on function ms_sync_private.capture_version() from public,anon,authenticated,service_role;
grant execute on function ms_sync_private.capture_version() to money_saver_sync_executor;
create trigger sync_feed after insert or update on ms_sync_private.record_versions for each row execute function ms_sync_private.capture_version();

-- Only the server's dedicated validator role can approve verified identities.
-- The user never receives this role's JWT. No service_role is needed by the Worker.
create function public.ms_approve(p_user uuid,p_operation uuid,p_revision bigint,p_hash text,p_manifest text,p_version text) returns void
language plpgsql security definer set search_path='' set row_security=on as $$
begin
  if not exists(select 1 from ms_sync_private.environment where singleton and testing_only) then raise exception 'Lab gate closed'; end if;
  perform set_config('request.jwt.claim.sub',p_user::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',p_user)::text,true);
  insert into ms_sync_private.approvals(user_id,operation_id,expected_revision,payload_hash,reconciliation_hash,validator_version,expires_at)
    values(p_user,p_operation,p_revision,p_hash,p_manifest,p_version,clock_timestamp()+interval '10 minutes')
    on conflict(user_id,operation_id) do update set created_at=clock_timestamp(),expires_at=clock_timestamp()+interval '10 minutes'
    where approvals.expected_revision=excluded.expected_revision and approvals.payload_hash=excluded.payload_hash
      and approvals.reconciliation_hash=excluded.reconciliation_hash and approvals.validator_version=excluded.validator_version;
  if not found then raise exception 'Approval content cannot change' using errcode='23505'; end if;
end $$;
revoke all on function public.ms_approve(uuid,uuid,bigint,text,text,text) from public,anon,authenticated,service_role;

create function public.ms_sync_view(p_operation uuid default null) returns jsonb
language sql stable security definer set search_path='' set row_security=on as $$
  select jsonb_build_object('revision',coalesce((select revision from ms_sync_private.heads where user_id=auth.uid()),0),
    'data',public.ms_snapshot(),'receipt',(select result from ms_sync_private.operations where user_id=auth.uid() and operation_id=p_operation));
$$;
revoke all on function public.ms_sync_view(uuid) from public,anon,authenticated,service_role;

create function public.ms_changes(p_after bigint default 0,p_until bigint default null,p_revision bigint default 0,p_entity text default '',p_id uuid default '00000000-0000-0000-0000-000000000000',p_limit integer default 100) returns jsonb
language plpgsql stable security definer set search_path='' set row_security=on as $$
declare watermark bigint; result jsonb;
begin
  if auth.uid() is null or p_after<0 or p_revision<0 or p_limit<1 or p_limit>100 then raise exception 'Invalid cursor'; end if;
  select coalesce((select revision from ms_sync_private.heads where user_id=auth.uid()),0) into watermark;
  if p_after>watermark then raise exception 'Cursor ahead of server'; end if;
  if p_until is not null and (p_until<p_after or p_until>watermark) then raise exception 'Invalid watermark'; end if;
  watermark:=coalesce(p_until,watermark);
  select coalesce(jsonb_agg(to_jsonb(f) - 'user_id'),'[]') into result from (
    select * from ms_sync_private.feed where user_id=auth.uid() and revision>p_after and revision<=watermark
      and (revision,entity,id)>(p_revision,p_entity collate "C",p_id)
    order by revision,entity,id limit p_limit
  ) f;
  return jsonb_build_object('until',watermark,'events',result);
end $$;
revoke all on function public.ms_changes(bigint,bigint,bigint,text,uuid,integer) from public,anon,authenticated,service_role;

create function public.ms_apply_changes(p_operation_id uuid,p_expected_revision bigint,p_payload_text text) returns jsonb
language plpgsql security definer set search_path='' set row_security=on set lock_timeout='5s' as $$
declare u uuid:=auth.uid(); digest text; prior ms_sync_private.operations%rowtype; a ms_sync_private.approvals%rowtype;
  rev bigint; body jsonb; c jsonb; t text; cols text; r jsonb; receipt jsonb;
  tables constant jsonb:='{"accounts":"ms_accounts","categories":"ms_categories","cards":"ms_cards","settings":"ms_settings","recurring":"ms_recurring","transactions":"ms_transactions","transfers":"ms_transfers","adjustments":"ms_adjustments","purchases":"ms_purchases","invoices":"ms_invoices","installments":"ms_installments","payments":"ms_payments","invoiceEntries":"ms_invoice_entries","occurrences":"ms_occurrences","budgets":"ms_budgets","audit":"ms_audit"}';
begin
  if u is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if not exists(select 1 from ms_sync_private.environment where singleton and testing_only) then raise exception 'Lab gate closed'; end if;
  if p_operation_id is null or p_expected_revision<0 or p_payload_text is null or octet_length(p_payload_text)>1048576 then raise exception 'Invalid request'; end if;
  digest:=encode(sha256(convert_to(p_payload_text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended('money-saver:'||u::text,0));
  select * into prior from ms_sync_private.operations where user_id=u and operation_id=p_operation_id;
  if found then
    if prior.payload_hash<>digest or prior.expected_revision<>p_expected_revision then raise exception 'Operation reused' using errcode='23505'; end if;
    return prior.result;
  end if;
  insert into ms_sync_private.heads values(u,0) on conflict do nothing;
  select revision into rev from ms_sync_private.heads where user_id=u for update;
  if rev<>p_expected_revision then raise exception 'Revision conflict' using errcode='40001'; end if;
  select * into a from ms_sync_private.approvals where user_id=u and operation_id=p_operation_id and expected_revision=rev and payload_hash=digest
    and validator_version='money-saver-domain-v2' and expires_at>clock_timestamp();
  if not found then raise exception 'Trusted validation required' using errcode='42501'; end if;
  body:=p_payload_text::jsonb;
  if body->>'protocol'<>'2' or jsonb_typeof(body->'changes')<>'array' or jsonb_array_length(body->'changes') not between 1 and 1000 then raise exception 'Invalid delta'; end if;
  set constraints all deferred;
  -- Delete dependent rows first; the financial UNIQUE constraints are immediate.
  -- Domain-generated replacement installments have new UUIDs and reuse ordinal numbers.
  for c in select value from jsonb_array_elements(body->'changes') with ordinality x(value,ordinal)
    order by case when value->'row'='null'::jsonb then 0 else 1 end,
      (case when value->'row'='null'::jsonb then -1 else 1 end) * array_position(array['accounts','categories','cards','settings','recurring','transactions','transfers','adjustments','purchases','invoices','installments','payments','invoiceEntries','occurrences','budgets','audit'],value->>'entity'), ordinal loop
    t:=tables->>(c->>'entity'); r:=c->'row';
    if t is null then raise exception 'Unknown entity'; end if;
    if r='null'::jsonb then
      if c->>'entity' in ('payments','invoiceEntries','purchases','audit') then raise exception 'History deletion forbidden'; end if;
      if c->>'entity'='installments' and exists(
        select 1 from public.ms_installments i where i.user_id=u and i.id=(c->>'id')::uuid and (
          exists(select 1 from public.ms_payments p where p.user_id=u and p.invoice_id=i.invoice_id) or
          exists(select 1 from public.ms_invoice_entries e where e.user_id=u and e.purchase_id=i.purchase_id)
        )
      ) then raise exception 'Settled purchase history cannot be replaced'; end if;
      execute format('delete from public.%I where user_id=$1 and id=$2',t) using u,(c->>'id')::uuid;
    else
      if r->>'user_id' is distinct from u::text or r->>'id' is distinct from c->>'id' then raise exception 'Foreign owner' using errcode='42501'; end if;
      if exists(select 1 from ms_sync_private.record_versions where user_id=u and entity=c->>'entity' and id=(c->>'id')::uuid and deleted) then raise exception 'Deleted UUID cannot be reused'; end if;
      if exists(select 1 from jsonb_object_keys(r) k where not exists(select 1 from pg_catalog.pg_attribute where attrelid=('public.'||t)::regclass and attname=k and attnum>0 and not attisdropped)) then raise exception 'Unknown column'; end if;
      select string_agg(format('%I=excluded.%I',attname,attname),',') into cols from pg_catalog.pg_attribute where attrelid=('public.'||t)::regclass and attnum>0 and not attisdropped and attname not in ('id','user_id');
      execute format('insert into public.%I select * from jsonb_populate_record(null::public.%I,$1) on conflict(user_id,id) do update set %s',t,t,cols) using r;
    end if;
    insert into ms_sync_private.record_versions values(u,c->>'entity',(c->>'id')::uuid,rev+1,r='null'::jsonb,p_operation_id)
      on conflict(user_id,entity,id) do update set revision=excluded.revision,deleted=excluded.deleted,operation_id=excluded.operation_id;
  end loop;
  perform ms_sync_private.assert_bundle();
  update ms_sync_private.heads set revision=rev+1 where user_id=u;
  receipt:=jsonb_build_object('operationId',p_operation_id,'revision',rev+1,'payloadHash',digest,'reconciliationHash',a.reconciliation_hash,'committedAt',clock_timestamp());
  insert into ms_sync_private.operations values(u,p_operation_id,rev,digest,receipt);
  set constraints all immediate;
  return receipt;
end $$;
revoke all on function public.ms_apply_changes(uuid,bigint,text) from public,anon,authenticated,service_role;

-- Temporary ownership membership, then narrow API grants in this LOCAL LAB only.
grant money_saver_sync_executor,money_saver_sync_validator to postgres;
grant create on schema public to money_saver_sync_executor,money_saver_sync_validator;
alter function public.ms_approve(uuid,uuid,bigint,text,text,text) owner to money_saver_sync_validator;
alter function public.ms_sync_view(uuid) owner to money_saver_sync_executor;
alter function public.ms_changes(bigint,bigint,bigint,text,uuid,integer) owner to money_saver_sync_executor;
alter function public.ms_apply_changes(uuid,bigint,text) owner to money_saver_sync_executor;
set role money_saver_sync_validator;
grant execute on function public.ms_approve(uuid,uuid,bigint,text,text,text) to money_saver_sync_validator;
reset role;
set role money_saver_sync_executor;
grant execute on function public.ms_sync_view(uuid),public.ms_changes(bigint,bigint,bigint,text,uuid,integer),public.ms_apply_changes(uuid,bigint,text),public.ms_import_initial(uuid,bigint,text) to authenticated;
reset role;
revoke create on schema public from money_saver_sync_executor,money_saver_sync_validator;
revoke money_saver_sync_executor,money_saver_sync_validator from postgres;
grant money_saver_sync_validator to authenticator with inherit false;
notify pgrst,'reload schema';
