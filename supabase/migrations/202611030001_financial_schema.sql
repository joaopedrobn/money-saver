-- Phase 3.1 foundation only. No seed data or personal-data import.
begin;
create domain public.ms_cents as bigint check (value between -999999999999 and 999999999999);
create domain public.ms_period as text check (value ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');
create domain public.ms_status as text check (value in ('planned','pending','settled','cancelled'));

create table public.ms_accounts (
  user_id uuid not null, id uuid not null, primary key (user_id,id),
  created_at timestamptz not null, updated_at timestamptz not null,
  name text not null, institution text not null,
  type text not null check (type in ('checking','savings','cash','investment')),
  opening_balance_cents public.ms_cents not null, opening_date date not null, color text not null
);
create table public.ms_categories (
  user_id uuid not null, id uuid not null, primary key (user_id,id),
  created_at timestamptz not null, updated_at timestamptz not null,
  name text not null, direction text not null check (direction in ('income','expense')),
  color text not null, icon text not null, archived boolean
);
create table public.ms_cards (
  user_id uuid not null, id uuid not null, primary key (user_id,id),
  created_at timestamptz not null, updated_at timestamptz not null,
  account_id uuid not null, name text not null, limit_cents public.ms_cents not null check (limit_cents >= 0),
  closing_day smallint not null check (closing_day between 1 and 31),
  due_day smallint not null check (due_day between 1 and 31), institution text,
  nickname text, brand text, last_four text check (last_four ~ '^([0-9]{4})?$'), color text, archived boolean,
  foreign key (user_id,account_id) references public.ms_accounts(user_id,id)
);
create table public.ms_recurring (
  user_id uuid not null, id uuid not null, primary key (user_id,id),
  created_at timestamptz not null, updated_at timestamptz not null,
  account_id uuid not null, category_id uuid not null, card_id uuid,
  description text not null, direction text not null check (direction in ('income','expense')),
  amount_cents public.ms_cents not null check (amount_cents > 0),
  start_date date not null, end_date date check (end_date >= start_date),
  day_of_month smallint not null check (day_of_month between 1 and 31),
  frequency text not null check (frequency in ('monthly','weekly','yearly')),
  active boolean not null, ended boolean,
  check (frequency <> 'weekly' or day_of_month <= 7),
  check (card_id is null or direction = 'expense'),
  check (not coalesce(ended,false) or not active),
  foreign key (user_id,account_id) references public.ms_accounts(user_id,id),
  foreign key (user_id,category_id) references public.ms_categories(user_id,id),
  foreign key (user_id,card_id) references public.ms_cards(user_id,id)
);
create table public.ms_transactions (
  user_id uuid not null, id uuid not null, primary key (user_id,id),
  created_at timestamptz not null, updated_at timestamptz not null,
  account_id uuid not null, category_id uuid not null, recurring_id uuid,
  description text not null, amount_cents public.ms_cents not null check (amount_cents > 0),
  direction text not null check (direction in ('income','expense')),
  method text not null check (method in ('pix','debit','cash','other')),
  date date not null, status public.ms_status not null, settled_date date, notes text,
  check (status = 'settled' or settled_date is null),
  foreign key (user_id,account_id) references public.ms_accounts(user_id,id),
  foreign key (user_id,category_id) references public.ms_categories(user_id,id),
  foreign key (user_id,recurring_id) references public.ms_recurring(user_id,id)
);
create table public.ms_transfers (
  user_id uuid not null, id uuid not null, primary key (user_id,id),
  created_at timestamptz not null, updated_at timestamptz not null,
  source_account_id uuid not null, destination_account_id uuid not null,
  amount_cents public.ms_cents not null check (amount_cents > 0),
  date date not null, description text not null, status public.ms_status, settled_date date, notes text,
  check (source_account_id <> destination_account_id),
  check (status is null or status = 'settled' or settled_date is null),
  foreign key (user_id,source_account_id) references public.ms_accounts(user_id,id),
  foreign key (user_id,destination_account_id) references public.ms_accounts(user_id,id)
);
create table public.ms_adjustments (
  user_id uuid not null, id uuid not null, primary key (user_id,id),
  created_at timestamptz not null, updated_at timestamptz not null,
  account_id uuid not null, category_id uuid,
  delta_cents public.ms_cents not null check (delta_cents <> 0), date date not null, reason text not null,
  status public.ms_status, settled_date date, notes text,
  check (status is null or status = 'settled' or settled_date is null),
  foreign key (user_id,account_id) references public.ms_accounts(user_id,id),
  foreign key (user_id,category_id) references public.ms_categories(user_id,id)
);
create table public.ms_purchases (
  user_id uuid not null, id uuid not null, primary key (user_id,id),
  created_at timestamptz not null, updated_at timestamptz not null,
  card_id uuid not null, category_id uuid not null, description text not null,
  amount_cents public.ms_cents not null check (amount_cents > 0), date date not null,
  installment_count smallint not null check (installment_count between 1 and 360),
  fee_cents public.ms_cents check (fee_cents >= 0), notes text,
  status text check (status in ('active','cancelled')), cancellation_reason text,
  check (installment_count <= amount_cents + coalesce(fee_cents,0)),
  foreign key (user_id,card_id) references public.ms_cards(user_id,id),
  foreign key (user_id,category_id) references public.ms_categories(user_id,id)
);
create table public.ms_invoices (
  user_id uuid not null, id uuid not null, primary key (user_id,id),
  created_at timestamptz not null, updated_at timestamptz not null,
  card_id uuid not null, period public.ms_period not null, closing_date date not null, due_date date not null,
  start_date date, closing_day_snapshot smallint check (closing_day_snapshot between 1 and 31),
  due_day_snapshot smallint check (due_day_snapshot between 1 and 31),
  unique (user_id,card_id,period), check (due_date >= closing_date), check (start_date < closing_date),
  foreign key (user_id,card_id) references public.ms_cards(user_id,id)
);
create table public.ms_installments (
  user_id uuid not null, id uuid not null, primary key (user_id,id),
  created_at timestamptz not null, updated_at timestamptz not null,
  purchase_id uuid not null, invoice_id uuid not null, number smallint not null check (number between 1 and 360),
  amount_cents public.ms_cents not null check (amount_cents > 0),
  principal_cents public.ms_cents check (principal_cents between 0 and amount_cents),
  unique (user_id,purchase_id,number),
  foreign key (user_id,purchase_id) references public.ms_purchases(user_id,id),
  foreign key (user_id,invoice_id) references public.ms_invoices(user_id,id)
);
create table public.ms_payments (
  user_id uuid not null, id uuid not null, primary key (user_id,id),
  created_at timestamptz not null, updated_at timestamptz not null,
  invoice_id uuid not null, account_id uuid not null,
  amount_cents public.ms_cents not null check (amount_cents > 0), date date not null,
  reversal_date date check (reversal_date >= date), reversal_reason text, reversed_at timestamptz, notes text,
  foreign key (user_id,invoice_id) references public.ms_invoices(user_id,id),
  foreign key (user_id,account_id) references public.ms_accounts(user_id,id)
);
create table public.ms_invoice_entries (
  user_id uuid not null, id uuid not null, primary key (user_id,id),
  created_at timestamptz not null, updated_at timestamptz not null,
  invoice_id uuid not null, purchase_id uuid, category_id uuid, transfer_id uuid, original_entry_id uuid,
  kind text not null check (kind in ('charge','refund','credit-in','credit-out','charge-reversal')),
  amount_cents public.ms_cents not null check (amount_cents > 0), date date not null, description text not null,
  check (kind <> 'refund' or purchase_id is not null),
  check (kind not in ('charge','charge-reversal') or category_id is not null),
  check (kind <> 'charge-reversal' or original_entry_id is not null),
  check (kind not in ('credit-in','credit-out') or transfer_id is not null),
  foreign key (user_id,invoice_id) references public.ms_invoices(user_id,id),
  foreign key (user_id,purchase_id) references public.ms_purchases(user_id,id),
  foreign key (user_id,category_id) references public.ms_categories(user_id,id),
  foreign key (user_id,original_entry_id) references public.ms_invoice_entries(user_id,id)
);
create table public.ms_occurrences (
  user_id uuid not null, id uuid not null, primary key (user_id,id),
  created_at timestamptz not null, updated_at timestamptz not null,
  recurring_id uuid not null, date date not null, transaction_id uuid, purchase_id uuid,
  unique (user_id,recurring_id,date), unique (user_id,transaction_id), unique (user_id,purchase_id),
  check ((transaction_id is null) <> (purchase_id is null)),
  foreign key (user_id,recurring_id) references public.ms_recurring(user_id,id),
  foreign key (user_id,transaction_id) references public.ms_transactions(user_id,id),
  foreign key (user_id,purchase_id) references public.ms_purchases(user_id,id)
);
create table public.ms_budgets (
  user_id uuid not null, id uuid not null, primary key (user_id,id),
  created_at timestamptz not null, updated_at timestamptz not null,
  month public.ms_period not null, category_id uuid not null, amount_cents public.ms_cents not null check (amount_cents > 0),
  unique (user_id,month,category_id),
  foreign key (user_id,category_id) references public.ms_categories(user_id,id)
);
create table public.ms_settings (
  user_id uuid not null, id uuid not null, primary key (user_id,id),
  created_at timestamptz not null, updated_at timestamptz not null,
  currency text not null check (currency = 'BRL'), locale text not null check (locale = 'pt-BR'),
  theme text not null check (theme = 'dark'), week_starts_on smallint not null check (week_starts_on in (0,1)),
  credit_regime text check (credit_regime in ('purchase','installment')), unique (user_id)
);
create table public.ms_audit (
  user_id uuid not null, id uuid not null, primary key (user_id,id),
  entity_id uuid not null, entity_type text not null check (entity_type in ('account','transaction','transfer','adjustment','category','backup','card','purchase','payment','invoice-entry','settings','recurring','budget')),
  action text not null check (action in ('create','update','delete')), at timestamptz not null,
  before_data jsonb, after_data jsonb,
  check (before_data is null or jsonb_typeof(before_data) = 'object'),
  check (after_data is null or jsonb_typeof(after_data) = 'object')
);

-- Every owner and reference is constrained. RESTRICT is deliberate: never cascade financial history.
do $$
declare t text; col record;
begin
  foreach t in array array['accounts','categories','cards','recurring','transactions','transfers','adjustments','purchases','invoices','installments','payments','invoice_entries','occurrences','budgets','settings','audit'] loop
    execute format('alter table public.ms_%I add foreign key (user_id) references auth.users(id)', t);
    -- No table is left accessible between the schema and security migrations.
    execute format('alter table public.ms_%I enable row level security', t);
    execute format('alter table public.ms_%I force row level security', t);
    execute format('revoke all on public.ms_%I from public, anon, authenticated', t);
    for col in select column_name from information_schema.columns where table_schema = 'public' and table_name = 'ms_' || t and column_name like '%\_id' escape '\' and column_name <> 'user_id' loop
      execute format('create index on public.ms_%I (user_id,%I)', t, col.column_name);
    end loop;
  end loop;
end $$;
create index on public.ms_transactions(user_id,date);
create index on public.ms_transfers(user_id,date);
create index on public.ms_adjustments(user_id,date);
create index on public.ms_purchases(user_id,date);
create index on public.ms_payments(user_id,date);
create index on public.ms_invoice_entries(user_id,date);
create index on public.ms_invoices(user_id,due_date);
create index on public.ms_audit(user_id,at);
-- Derived balances, invoice totals, limits used and report totals are intentionally absent.
commit;
