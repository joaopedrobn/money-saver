# Aplicação controlada da migração de sincronização — 05/11/2026

**Aplicada com sucesso**, exclusivamente no projeto Supabase `money-saver`, ref `iwzmsbkbuerleocismhj`, ambiente `production`. A sincronização permanece **desativada**, com allowlist **vazia**. Nenhum teste financeiro de escrita foi executado.

## Escopo autorizado e conferências anteriores

Arquivo: `supabase/remote-migrations/202611040001_controlled_financial_sync.sql`.

SHA-256 autorizado, recalculado antes da execução e idêntico na cópia empacotada:

```text
19b1508b5755e05d0c73b2f45c135d436600480b9aba7c0f51180ef057fb0889
```

- Vínculo local e respostas do CLI confirmaram o projeto `iwzmsbkbuerleocismhj`, nome `money-saver`, ambiente `production`.
- Consulta somente leitura confirmou histórico com `202611030001` e `202611030002`, 16 tabelas protegidas e ausência dos objetos candidatos antes da aplicação.
- Novo dry-run selecionou **apenas** `202611040001_controlled_financial_sync.sql`, sem seeds ou arquivo adicional de roles. Os dois papéis internos fazem parte do SQL expressamente autorizado.
- Pacote isolado continha somente as duas migrações base e a migração autorizada. Não houve regeneração ou alteração do arquivo aprovado nesta aplicação.
- Revisão confirmou controle inicialmente fechado e allowlist sem inserções. Não há reset, truncate, remoção de tabela financeira ou mudança dos dados existentes. As duas remoções de constraints pertencem à tabela privada de aprovações criada na própria migração e são seguidas pelas constraints definitivas. Os comandos financeiros dinâmicos pertencem aos corpos das RPCs; nenhuma RPC financeira foi invocada.
- Foram capturadas contagens e impressões SHA-256 dos registros das 16 tabelas, calculadas no banco sem exportar registros. Todas estavam vazias.

## Aplicação realizada

CLI Supabase **3.0.0**, a partir da cópia atual, usando o pacote isolado e a confirmação específica recebida:

```powershell
npx --yes supabase@3.0.0 db push --workdir .local/remote-release --remote=iwzmsbkbuerleocismhj --skip-vault --yes
```

O CLI confirmou uma migração aplicada, `dryRun=false`, arquivo exato autorizado, `seeds=[]`, `roles=[]`, sem erros. Não foram usados `--include-all`, `--include-seed`, `--include-roles`, reset, repair ou comandos de configuração remota.

## Verificações posteriores — somente leitura

Todas passaram por `db query --read-only`. Não foram executadas chamadas de escrita às RPCs.

| Verificação | Resultado |
| --- | --- |
| Histórico remoto | `202611030001`, `202611030002`, **`202611040001`** |
| Funções novas | **8**; hashes dos corpos armazenados iguais aos oito corpos do arquivo autorizado |
| RPCs públicas | `ms_import_initial`, `ms_apply_changes`, `ms_sync_view`, `ms_changes`, `ms_approve` |
| Helpers privados | `access_allowed`, `assert_bundle`, `capture_version` |
| Segurança das cinco RPCs | SECURITY DEFINER, proprietário restrito esperado, `search_path=''`, `row_security=on` |
| Helpers | SECURITY INVOKER e `search_path=''` |
| EXECUTE de authenticated | Somente as quatro RPCs de usuário; sem aprovação privilegiada |
| EXECUTE de anon/service_role | Bloqueado nas oito funções novas |
| Validador | Executa `ms_approve`, sem acesso direto às tabelas financeiras |
| Executor | DML interno nas 16 tabelas conforme a migração; sem aprovação privilegiada |
| Papéis internos | NOLOGIN, NOBYPASSRLS, sem superuser/CREATEROLE/CREATE no schema public |
| Escalada do cliente | authenticated não pode assumir os papéis internos |
| Tabelas financeiras | **16 com RLS/FORCE RLS** |
| Políticas existentes | **64 políticas de proprietário preservadas**, mais as 16 políticas internas previstas |
| Escritas financeiras genéricas | INSERT/UPDATE/DELETE de authenticated bloqueados nas 16 tabelas; anon sem acesso |
| Schema privado | Fechado para authenticated/anon/service_role; seis tabelas de proprietário com RLS/FORCE RLS |
| Trigger incremental | `sync_feed` presente em `record_versions` |
| Controle | `environment.enabled=false`, projeto fixo correto |
| Allowlist | **0 usuários** |
| Metadados de sincronização | heads, operations, approvals, record_versions e feed **vazios** |
| Dados financeiros | Contagens e hashes **idênticos antes/depois** nas 16 tabelas; **0 registros** antes e depois |

Nenhum registro pessoal foi alterado. Nenhuma conta foi adicionada à allowlist e nenhum dado foi importado.

Evidências locais, ignoradas pelo Git: `.local/approved-sync-application/`, contendo preflight, dry-run, resposta da aplicação e consultas posteriores verificadas. A consulta reutilizável de catálogo posterior está em `supabase/checks/controlled-sync-postflight.sql`.

## Pendências para disponibilização remota

1. Provisionar e revisar o token do validador mínimo, com expiração e rotação; sem service_role no Worker e sem secrets no frontend.
2. Autorizar a publicação do frontend/Worker na Cloudflare e a configuração dos retornos HTTPS do Auth, preservando desenvolvimento. Nenhuma dessas ações ocorreu nesta aplicação.
3. Autorizar separadamente o ensaio remoto com usuários fictícios isolados. Não foram validadas operações financeiras de escrita em produção nesta etapa; a aplicação do catálogo não substitui esses testes.
4. Somente após os testes, revisar e autorizar a ativação pessoal. Importação financeira real continua exigindo backup, prévia e confirmação própria.
5. Autorizar o push no GitHub para recuperar a entrega atualizada em outro PC. Nenhum push foi realizado.

Node.js **26.7.0**, aplicativo, Auth, Worker e cálculos financeiros não foram alterados nesta aplicação. Não houve necessidade de repetir testes de aplicação ou builds; as verificações foram do banco efetivamente migrado. Docker não foi necessário para a aplicação ou consultas remotas.
