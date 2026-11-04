# Aplicação controlada Supabase — 04/11/2026

## Resultado

**Aplicação concluída e verificações de catálogo aprovadas.** Projeto: `money-saver`, ref `iwzmsbkbuerleocismhj`, ambiente `production`. CLI 3.0.0 via npx; Node permaneceu 26.7.0. Autorização explícita do usuário limitada às duas migrações anteriormente revisadas.

## Conferência antes da execução

- Vínculo confirmado no arquivo local ignorado `.temp/project-ref` e nas respostas do CLI.
- Histórico remoto sem as duas versões; novo dry-run confirmou exatamente os dois arquivos, sem seeds/roles.
- Catálogos remotos sem relações, tipos ou funções `ms_*`, igual à prévia anterior.
- Nenhuma instrução de exclusão, substituição de objetos ou carga financeira identificada. SQLs aprovados não foram editados.
- Hashes SHA-256 conferidos antes da aplicação:

| Migração | SHA-256 |
| --- | --- |
| `202611030001_financial_schema.sql` | `4D257B72BEAD5C53AA1A30B885D1C6FDBF2CAB432F4691DFF69B14996478C65E` |
| `202611030002_rls_and_snapshot.sql` | `B08D4EF6CEBF3C6F0EA545FE1E018FFB820B39C507A345B62C2016C1178DDE69` |

## Execução e ocorrência operacional

O comando autorizado `npx supabase@3.0.0 db push --remote --skip-vault` inicialmente retornou `HostedMutationConsentRequiredError`, sem alterar o banco, pois o CLI em modo agente não apresenta confirmação interativa. Não houve falha de SQL.

Como o usuário já havia autorizado especificamente o projeto e os dois arquivos, a execução foi feita com o mecanismo interativo documentado do CLI:

```powershell
npx supabase@3.0.0 db push --remote --skip-vault --agent no
```

O prompt exibiu exatamente as duas migrações e o projeto aprovado, e recebeu confirmação interativa. Não foi usado `--yes` nem `SUPABASE_YES`. O CLI aplicou ambos os arquivos e terminou com código 0. `--skip-vault` foi mantido. Nenhum `config push`, reset, SQL corretivo ou alteração de Auth foi executado.

## Verificações posteriores — somente leitura

`migration list --remote` confirmou as versões **202611030001** e **202611030002** nas colunas local e remota.

O arquivo [phase31-postflight.sql](../supabase/checks/phase31-postflight.sql) foi executado com `db query --remote --read-only`. Consultou exclusivamente catálogos PostgreSQL e permissões; não leu linhas financeiras ou credenciais. Os resultados foram validados localmente, inclusive os predicados e roles de cada política.

| Verificação | Resultado |
| --- | --- |
| Entidades financeiras | 16 tabelas confirmadas |
| RLS + FORCE RLS | Ativos em 16/16 |
| Chave primária | `(user_id, id)` em 16/16 |
| Políticas | 64: SELECT/INSERT/UPDATE/DELETE por tabela, somente role `authenticated` |
| Predicados | `auth.uid() = user_id`; UPDATE verifica proprietário antigo e novo |
| FKs | 42; 16 para `auth.users(id)` e 26 compostas incluindo `user_id` |
| Schema `public` | USAGE para `authenticated` |
| Tabelas: `authenticated` | SELECT permitido; INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER/MAINTAIN negados |
| Tabelas: `anon`/PUBLIC | Sem privilégios financeiros |
| `ms_snapshot()` | SECURITY INVOKER, STABLE, `search_path` vazio |
| EXECUTE do snapshot | Permitido para `authenticated`; negado para `anon`/PUBLIC |

Tabelas conferidas: `ms_accounts`, `ms_adjustments`, `ms_audit`, `ms_budgets`, `ms_cards`, `ms_categories`, `ms_installments`, `ms_invoice_entries`, `ms_invoices`, `ms_occurrences`, `ms_payments`, `ms_purchases`, `ms_recurring`, `ms_settings`, `ms_transactions` e `ms_transfers`.

Evidência detalhada de catálogo foi guardada localmente em `.local/supabase-postflight-2026-11-04.json`, ignorada pelo Git, sem tokens ou dados financeiros. Os hashes dos arquivos aprovados foram novamente conferidos ao encerrar.

## Limites e pendências

- Políticas, grants e vínculos foram verificados no catálogo real; testes com dois usuários/fixtures não foram executados em produção, pois exigiriam escritas. O script `supabase/tests/isolation.sql` continua reservado a ambiente descartável.
- As diferenças de Auth registradas no [relatório da conexão](supabase-connection.md) não foram corrigidas. Site URL/retornos e senha mínima dependem de autorização específica antes de validar Auth real.
- Escritas financeiras remotas e sincronização continuam bloqueadas. Nenhum dado financeiro pessoal foi migrado, exportado ou importado. IndexedDB não foi aberto ou alterado por este procedimento.
- Nenhuma alteração no aplicativo ou dependências nesta execução; não houve necessidade de repetir os testes da aplicação. Não houve push GitHub ou deploy.
