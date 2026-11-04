-- CANDIDATE ONLY. Not in migrations; never applied to production by this phase.
-- Install inside the test transaction in supabase/tests/sync.sql.
\ir ../checks/disposable-guard.sql
do $$ begin
  if exists(select 1 from pg_roles where rolname in ('money_saver_sync_executor','money_saver_sync_validator'))
     or exists(select 1 from pg_namespace where nspname='ms_sync_private') then
    raise exception 'A fresh disposable environment is required';
  end if;
end $$;
create role money_saver_sync_executor nologin noinherit nobypassrls;
create role money_saver_sync_validator nologin noinherit nobypassrls;
-- Managed Supabase owns auth/uid outside postgres. Do not grant on those objects
-- from postgres (it has USAGE but no grant option). Inherit the API role's
-- existing auth access, without permission to SET ROLE or any generic financial writes.
grant authenticated to money_saver_sync_executor with inherit true,set false;
grant anon to money_saver_sync_validator with inherit true,set false;
create schema ms_sync_private;
revoke all on schema ms_sync_private from public, anon, authenticated, service_role;
grant usage on schema ms_sync_private, public to money_saver_sync_executor;
grant usage on schema ms_sync_private to money_saver_sync_validator;

create table ms_sync_private.environment (
  singleton boolean primary key default true check(singleton),
  project_ref text not null check(project_ref ~ '^[a-z]{20}$' and project_ref <> 'iwzmsbkbuerleocismhj'),
  testing_only boolean not null check(testing_only)
);
insert into ms_sync_private.environment values(true, :'money_saver_disposable_project_ref', true);
revoke all on ms_sync_private.environment from public, anon, authenticated, service_role;
grant select on ms_sync_private.environment to money_saver_sync_executor;
create table ms_sync_private.heads (
  user_id uuid primary key references auth.users(id), revision bigint not null check(revision>=0)
);
create table ms_sync_private.approvals (
  user_id uuid not null references auth.users(id), operation_id uuid not null,
  expected_revision bigint not null check(expected_revision=0), payload_hash text not null check(payload_hash ~ '^[0-9a-f]{64}$'),
  reconciliation_hash text not null check(reconciliation_hash ~ '^[0-9a-f]{64}$'),
  validator_version text not null check(validator_version='money-saver-domain-v1'),
  created_at timestamptz not null default clock_timestamp(), expires_at timestamptz not null,
  check(expires_at>created_at and expires_at<=created_at+interval '15 minutes'),
  primary key(user_id,operation_id)
);
create table ms_sync_private.operations (
  user_id uuid not null references auth.users(id), operation_id uuid not null,
  expected_revision bigint not null, payload_hash text not null, result jsonb not null,
  primary key(user_id,operation_id)
);
create table ms_sync_private.record_versions (
  user_id uuid not null references auth.users(id), entity text not null, id uuid not null,
  revision bigint not null check(revision>0), deleted boolean not null default false,
  operation_id uuid not null,
  primary key(user_id,entity,id),
  foreign key(user_id,operation_id) references ms_sync_private.operations(user_id,operation_id) deferrable initially deferred
);
do $$ declare t text; begin
  foreach t in array array['heads','approvals','operations','record_versions'] loop
    execute format('alter table ms_sync_private.%I enable row level security',t);
    execute format('alter table ms_sync_private.%I force row level security',t);
    execute format('revoke all on ms_sync_private.%I from public,anon,authenticated,service_role',t);
    execute format('create policy sync_owner on ms_sync_private.%I to money_saver_sync_executor using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()))',t);
  end loop;
  foreach t in array array['accounts','categories','cards','recurring','transactions','transfers','adjustments','purchases','invoices','installments','payments','invoice_entries','occurrences','budgets','settings','audit'] loop
    if has_table_privilege('authenticated','public.ms_'||t,'INSERT,UPDATE,DELETE') then raise exception 'Unexpected direct client write grant'; end if;
    execute format('create policy sync_executor on public.ms_%I to money_saver_sync_executor using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()))',t);
    -- The executor can only import. No generic UPDATE/DELETE, even for its definer role.
    execute format('grant select,insert on public.ms_%I to money_saver_sync_executor',t);
  end loop;
end $$;
grant select,insert,update on ms_sync_private.heads to money_saver_sync_executor;
grant select on ms_sync_private.approvals to money_saver_sync_executor;
grant select,insert on ms_sync_private.operations,ms_sync_private.record_versions to money_saver_sync_executor;
grant insert on ms_sync_private.approvals to money_saver_sync_validator;
create policy validator_owner on ms_sync_private.approvals for insert to money_saver_sync_validator with check(user_id=(select auth.uid()));
grant execute on function public.ms_snapshot() to money_saver_sync_executor;

-- Structural constraints, not a second implementation of balances/reports/payment history.
-- Full domain validation and reconciliation require the exact-content trusted approval above.
create function ms_sync_private.assert_bundle() returns void
language plpgsql security invoker set search_path='' as $$
declare u uuid := auth.uid();
begin
  if exists (
    select 1 from public.ms_purchases p left join public.ms_installments i on(i.user_id=p.user_id and i.purchase_id=p.id)
    where p.user_id=u group by p.id,p.installment_count,p.amount_cents,p.fee_cents
    having count(i.id)<>p.installment_count or coalesce(sum(i.amount_cents),0)<>p.amount_cents+coalesce(p.fee_cents,0)
      or coalesce(sum(coalesce(i.principal_cents,i.amount_cents)),0)<>p.amount_cents
      or min(i.number)<>1 or max(i.number)<>p.installment_count
  ) then raise exception 'Inconsistent purchase installments'; end if;
  if exists (
    select 1 from public.ms_installments i join public.ms_purchases p on(p.user_id=i.user_id and p.id=i.purchase_id)
    join public.ms_invoices f on(f.user_id=i.user_id and f.id=i.invoice_id)
    where i.user_id=u and (f.card_id<>p.card_id or p.date>=f.closing_date or (i.number=1 and p.date<f.start_date))
  ) then raise exception 'Inconsistent purchase/invoice relationship'; end if;
  if exists(select 1 from public.ms_invoices f where f.user_id=u and (f.due_date<=f.closing_date or to_char(f.closing_date,'YYYY-MM')<>f.period))
    then raise exception 'Inconsistent invoice dates'; end if;
  if exists (
    select 1 from public.ms_installments a join public.ms_installments b on(b.user_id=a.user_id and b.purchase_id=a.purchase_id and b.number=a.number+1)
    join public.ms_invoices fa on(fa.user_id=a.user_id and fa.id=a.invoice_id)
    join public.ms_invoices fb on(fb.user_id=b.user_id and fb.id=b.invoice_id)
    where a.user_id=u and fb.period<>to_char(to_date(fa.period||'-01','YYYY-MM-DD')+interval '1 month','YYYY-MM')
  ) then raise exception 'Nonconsecutive installments'; end if;
  if exists (
    select 1 from public.ms_invoice_entries e join public.ms_invoices f on(f.user_id=e.user_id and f.id=e.invoice_id)
    where e.user_id=u and e.transfer_id is not null group by e.transfer_id
    having count(*)<>2 or count(*) filter(where e.kind='credit-in')<>1 or count(*) filter(where e.kind='credit-out')<>1
      or min(e.amount_cents)<>max(e.amount_cents) or min(e.date)<>max(e.date) or count(distinct e.invoice_id)<>2 or count(distinct f.card_id)<>1
  ) then raise exception 'Inconsistent credit pair'; end if;
end $$;
revoke all on function ms_sync_private.assert_bundle() from public,anon,authenticated,service_role;
grant execute on function ms_sync_private.assert_bundle() to money_saver_sync_executor;

create function public.ms_import_initial(p_operation_id uuid,p_expected_revision bigint,p_payload_text text) returns jsonb
language plpgsql security definer set search_path='' set row_security=on set lock_timeout='5s' as $$
declare
  u uuid:=auth.uid(); body jsonb; data jsonb; e text; t text; r jsonb; kv record;
  digest text; prior ms_sync_private.operations%rowtype; approval ms_sync_private.approvals%rowtype;
  revision bigint; snapshot jsonb; result jsonb; counts jsonb:='{}'; rows_total bigint:=0;
  tables constant jsonb:='{"accounts":"ms_accounts","categories":"ms_categories","cards":"ms_cards","settings":"ms_settings","recurring":"ms_recurring","transactions":"ms_transactions","transfers":"ms_transfers","adjustments":"ms_adjustments","purchases":"ms_purchases","invoices":"ms_invoices","installments":"ms_installments","payments":"ms_payments","invoiceEntries":"ms_invoice_entries","occurrences":"ms_occurrences","budgets":"ms_budgets","audit":"ms_audit"}';
begin
  if u is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if not exists(select 1 from ms_sync_private.environment where singleton and testing_only and project_ref<>'iwzmsbkbuerleocismhj') then raise exception 'Sandbox gate closed' using errcode='42501'; end if;
  if p_operation_id is null or p_expected_revision is distinct from 0 or p_payload_text is null or octet_length(p_payload_text)>10485760 then raise exception 'Invalid initial import request'; end if;
  digest:=encode(sha256(convert_to(p_payload_text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended('money-saver:'||u::text,0));
  select * into prior from ms_sync_private.operations where user_id=u and operation_id=p_operation_id;
  if found then
    if prior.payload_hash<>digest or prior.expected_revision<>p_expected_revision then raise exception 'Operation identifier reused with different content' using errcode='23505'; end if;
    return prior.result;
  end if;
  insert into ms_sync_private.heads values(u,0) on conflict do nothing;
  select h.revision into revision from ms_sync_private.heads h where user_id=u for update;
  if revision<>p_expected_revision then raise exception 'Revision conflict; explicit reconciliation required' using errcode='40001'; end if;
  select * into approval from ms_sync_private.approvals where user_id=u and operation_id=p_operation_id and expected_revision=p_expected_revision and payload_hash=digest
    and validator_version='money-saver-domain-v1' and expires_at>clock_timestamp();
  if not found then raise exception 'Exact-content trusted validation required' using errcode='42501'; end if;
  body:=p_payload_text::jsonb; data:=body->'data';
  if body->'protocol' is distinct from '1'::jsonb or jsonb_typeof(data) is distinct from 'object' or (select count(*) from jsonb_object_keys(data))<>16 then raise exception 'Invalid bundle'; end if;
  if exists(select 1 from jsonb_object_keys(data) key where not tables ? key) then raise exception 'Unexpected entity'; end if;
  snapshot:=public.ms_snapshot();
  foreach e in array array['accounts','categories','cards','settings','recurring','transactions','transfers','adjustments','purchases','invoices','installments','payments','invoiceEntries','occurrences','budgets','audit'] loop
    if jsonb_typeof(data->e) is distinct from 'array' or jsonb_array_length(snapshot->e)<>0 then raise exception 'Destination must be completely empty'; end if;
    rows_total:=rows_total+jsonb_array_length(data->e);
    if rows_total>10000 then raise exception 'Bundle row limit exceeded'; end if;
    t:=tables->>e;
    for r in select value from jsonb_array_elements(data->e) loop
      if jsonb_typeof(r) is distinct from 'object' or r->>'user_id' is distinct from u::text then raise exception 'Foreign owner rejected' using errcode='42501'; end if;
      for kv in select key,value from jsonb_each(r) loop
        if not exists(select 1 from pg_catalog.pg_attribute a join pg_catalog.pg_class c on(c.oid=a.attrelid) join pg_catalog.pg_namespace n on(n.oid=c.relnamespace)
          where n.nspname='public' and c.relname=t and a.attname=kv.key and a.attnum>0 and not a.attisdropped) then raise exception 'Unknown field'; end if;
        if jsonb_typeof(kv.value)='number' and (kv.value::text)::numeric<>trunc((kv.value::text)::numeric) then raise exception 'Fractional financial integer rejected'; end if;
      end loop;
    end loop;
    -- Only allowlisted identifiers enter dynamic SQL. No client-supplied SQL/table/column names.
    execute format('insert into public.%I select * from jsonb_populate_recordset(null::public.%I,$1)',t,t) using data->e;
    insert into ms_sync_private.record_versions(user_id,entity,id,revision,deleted,operation_id)
      select u,e,(value->>'id')::uuid,1,false,p_operation_id from jsonb_array_elements(data->e);
    counts:=counts||jsonb_build_object(e,jsonb_array_length(data->e));
  end loop;
  perform ms_sync_private.assert_bundle();
  update ms_sync_private.heads set revision=1 where user_id=u;
  result:=jsonb_build_object('operationId',p_operation_id,'revision',1,'payloadHash',digest,'reconciliationHash',approval.reconciliation_hash,'counts',counts,'committedAt',clock_timestamp());
  insert into ms_sync_private.operations values(u,p_operation_id,p_expected_revision,digest,result);
  return result;
  -- Exceptions propagate: finance, versions, head and operation receipt roll back together.
end $$;
revoke all on function public.ms_import_initial(uuid,bigint,text) from public,anon,authenticated,service_role;
-- Ownership transfer requires membership and schema CREATE, removed immediately afterwards.
grant money_saver_sync_executor to postgres;
grant create on schema public to money_saver_sync_executor;
alter function public.ms_import_initial(uuid,bigint,text) owner to money_saver_sync_executor;
revoke create on schema public from money_saver_sync_executor;
revoke money_saver_sync_executor from postgres;
-- No EXECUTE grant to application roles. Test suite grants it transaction-locally, then rolls back.
