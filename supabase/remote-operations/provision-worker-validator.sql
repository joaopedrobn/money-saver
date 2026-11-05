-- Server-only infrastructure, executed after explicit authorization to provision validation.
-- Supply an unguessable password via a private execution file, never version the substituted SQL.
begin;
create role money_saver_worker_validator login noinherit nosuperuser nocreatedb nocreaterole nobypassrls noreplication
  password :'worker_validator_password' connection limit 10;
grant money_saver_sync_validator to money_saver_worker_validator with inherit true,set false;
grant connect on database postgres to money_saver_worker_validator;
alter role money_saver_worker_validator set statement_timeout='10s';
alter role money_saver_worker_validator set idle_in_transaction_session_timeout='10s';
commit;
