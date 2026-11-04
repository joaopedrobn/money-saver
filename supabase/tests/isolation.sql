-- Run ONLY in a disposable Supabase test database after the versioned migrations.
-- Use scripts/test-supabase-isolation.ps1; direct execution without its marker is refused.
-- No credentials belong in this file. All fixtures and test-only grants roll back.
-- The guarded runner supplies this variable only after validating a disposable target.
\if :{?money_saver_disposable_project_ref}
\else
\echo 'Refusing to run: use scripts/test-supabase-isolation.ps1 with a disposable project.'
\quit 3
\endif
select (:'money_saver_disposable_project_ref' ~ '^[a-z]{20}$'
  and :'money_saver_disposable_project_ref' <> 'iwzmsbkbuerleocismhj') as disposable_target_allowed \gset
\if :disposable_target_allowed
\else
\echo 'Refusing to run against the production project or an invalid target.'
\quit 3
\endif
begin;
do $$
declare t record; n integer;
begin
  if not has_schema_privilege('authenticated','public','USAGE') then raise exception 'Missing explicit schema access'; end if;
  select count(*) into n from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
  where ns.nspname = 'public' and c.relname in ('ms_accounts','ms_categories','ms_cards','ms_recurring','ms_transactions','ms_transfers','ms_adjustments','ms_purchases','ms_invoices','ms_installments','ms_payments','ms_invoice_entries','ms_occurrences','ms_budgets','ms_settings','ms_audit') and c.relrowsecurity and c.relforcerowsecurity;
  if n <> 16 then raise exception 'Expected RLS and FORCE RLS on all 16 tables'; end if;
  for t in select tablename from pg_tables where schemaname = 'public' and tablename like 'ms\_%' escape '\' loop
    if has_table_privilege('anon','public.' || t.tablename,'SELECT') or has_table_privilege('authenticated','public.' || t.tablename,'INSERT,UPDATE,DELETE') then
      raise exception 'Unexpected phase 3.1 grants on %', t.tablename;
    end if;
    select count(*) into n from pg_policies where schemaname = 'public' and tablename = t.tablename and policyname in ('owner_select','owner_insert','owner_update','owner_delete');
    if n <> 4 then raise exception 'Missing owner policies on %', t.tablename; end if;
  end loop;
  if has_function_privilege('anon','public.ms_snapshot()','EXECUTE') then raise exception 'Anonymous RPC access'; end if;
end $$;

insert into auth.users(id,email) values
 ('11111111-1111-4111-8111-111111111111','phase31-a@example.invalid'),
 ('22222222-2222-4222-8222-222222222222','phase31-b@example.invalid');
insert into public.ms_accounts(user_id,id,created_at,updated_at,name,institution,type,opening_balance_cents,opening_date,color) values
 ('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',now(),now(),'A','Test','checking',10000,'2026-01-01','sage'),
 ('22222222-2222-4222-8222-222222222222','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',now(),now(),'B','Test','checking',20000,'2026-01-01','sage');
-- Stable category UUIDs may legitimately repeat for distinct owners.
insert into public.ms_categories(user_id,id,created_at,updated_at,name,direction,color,icon) values
 ('11111111-1111-4111-8111-111111111111','cccccccc-cccc-4ccc-8ccc-cccccccccccc',now(),now(),'Food','expense','rose','coffee'),
 ('22222222-2222-4222-8222-222222222222','cccccccc-cccc-4ccc-8ccc-cccccccccccc',now(),now(),'Food','expense','rose','coffee');

-- Test-only grants exercise the prepared write policies; never persist these grants.
grant insert,update,delete on public.ms_accounts, public.ms_transactions to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $$
declare affected integer; snapshot jsonb;
begin
  if (select count(*) from public.ms_accounts) <> 1 then raise exception 'Cross-owner read'; end if;
  snapshot := public.ms_snapshot();
  if jsonb_array_length(snapshot->'accounts') <> 1 or snapshot->'accounts'->0->>'name' <> 'A' then raise exception 'Snapshot isolation failed'; end if;
  update public.ms_accounts set name = 'HACK' where user_id = '22222222-2222-4222-8222-222222222222';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Cross-owner update'; end if;
  delete from public.ms_accounts where user_id = '22222222-2222-4222-8222-222222222222';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Cross-owner delete'; end if;
  begin
    insert into public.ms_accounts(user_id,id,created_at,updated_at,name,institution,type,opening_balance_cents,opening_date,color)
    values ('22222222-2222-4222-8222-222222222222','dddddddd-dddd-4ddd-8ddd-dddddddddddd',now(),now(),'Forged','Test','checking',0,'2026-01-01','sage');
    raise exception 'Forged insert accepted';
  exception when insufficient_privilege then null; end;
  begin
    update public.ms_accounts set user_id = '22222222-2222-4222-8222-222222222222';
    raise exception 'Ownership reassignment accepted';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.ms_transactions(user_id,id,created_at,updated_at,account_id,category_id,description,amount_cents,direction,method,date,status)
    values ('11111111-1111-4111-8111-111111111111','dddddddd-dddd-4ddd-8ddd-dddddddddddd',now(),now(),'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','cccccccc-cccc-4ccc-8ccc-cccccccccccc','Foreign account',100,'expense','pix','2026-01-02','settled');
    raise exception 'Cross-owner FK accepted';
  exception when foreign_key_violation then null; end;
  insert into public.ms_accounts(user_id,id,created_at,updated_at,name,institution,type,opening_balance_cents,opening_date,color)
  values ('11111111-1111-4111-8111-111111111111','dddddddd-dddd-4ddd-8ddd-dddddddddddd',now(),now(),'Own','Test','checking',0,'2026-01-01','sage');
  update public.ms_accounts set name = 'Updated' where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Own update denied'; end if;
  delete from public.ms_accounts where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Own delete denied'; end if;
end $$;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
do $$ begin
  if (select count(*) from public.ms_accounts) <> 1 or (select name from public.ms_accounts) <> 'B' then raise exception 'User B isolation failed'; end if;
end $$;
set local role anon;
select set_config('request.jwt.claim.sub','',true);
do $$ begin
  begin perform 1 from public.ms_accounts; raise exception 'Anonymous select accepted';
  exception when insufficient_privilege then null; end;
  begin perform public.ms_snapshot(); raise exception 'Anonymous snapshot accepted';
  exception when insufficient_privilege then null; end;
end $$;
rollback;
\echo 'Phase 3.1 isolation checks passed; all fixtures rolled back.'
