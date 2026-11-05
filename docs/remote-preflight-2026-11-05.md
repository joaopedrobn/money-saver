# Conferência remota e dry-run — 05/11/2026

**Concluídos sem aplicar migrações.** Projeto confirmado pela API/CLI: `money-saver`, ref `iwzmsbkbuerleocismhj`, ambiente `production`, região `us-east-2`, PostgreSQL **17.11**.

## Vínculo e histórico

O CLI 3.0.0 autenticou e vinculou o pacote isolado `.local/remote-release` ao projeto correto. Os arquivos temporários permanecem ignorados pelo Git. A configuração e as migrações ativas do laboratório não foram sobrescritas. Não foi necessário fornecer senha do banco nem iniciar Docker.

Histórico remoto confirmado por consulta somente leitura e por `migration list`:

| Versão | Local no pacote | Remoto |
| --- | --- | --- |
| `202611030001` | presente | aplicada |
| `202611030002` | presente | aplicada |
| `202611040001` | presente | **não aplicada** |

Uma tentativa inicial de `migration list`, em paralelo ao dry-run, falhou na autenticação da role temporária do CLI. A repetição sequencial passou. Execute estes comandos sequencialmente; não foi feito repair, reset ou alteração do histórico.

## Catálogo efetivamente consultado

`supabase/checks/remote-sync-readiness.sql`, executado com `--read-only`, confirmou:

- As **16 tabelas financeiras** existem, todas com RLS e FORCE RLS.
- `authenticated` não possui INSERT/UPDATE/DELETE genéricos nessas tabelas.
- A única função `ms_*` existente é `ms_snapshot`: SECURITY INVOKER, `search_path=''`, EXECUTE para authenticated, sem EXECUTE para anon/service_role.
- Não existem os papéis `money_saver_sync_executor`/`money_saver_sync_validator`, tabelas do schema `ms_sync_private` ou as cinco novas RPCs de sincronização.
- Nenhuma linha financeira ou de `auth.users` foi consultada.

A consulta foi ajustada para retornar um único resultado JSON: o comando hospedado devolve apenas o último resultado quando o arquivo tem vários SELECTs. Essa alteração permite conferir todo o catálogo, não apenas as permissões da última consulta.

## Dry-run aprovado na seleção de migrações

```powershell
npm run dry-run:supabase
```

Resultado real do CLI:

```json
{
  "upToDate": false,
  "dryRun": true,
  "migrations": ["202611040001_controlled_financial_sync.sql"],
  "seeds": [],
  "roles": []
}
```

`roles: []` significa que não há arquivo adicional `roles.sql` selecionado. A própria migração contém a criação dos dois papéis restritos descritos abaixo.

Arquivo revisável: `supabase/remote-migrations/202611040001_controlled_financial_sync.sql`. SHA-256 do arquivo e da cópia empacotada, que são idênticos:

```text
ed50e800a187252da57a5ba34fd534ed0c4ba8e3c90c3a9ef0558dbf29d6c759
```

O gerador agora normaliza LF/CRLF ao comparar fontes e saída, evitando divergências causadas pelo checkout em outro PC. A migração resultante manteve o mesmo conteúdo e hash desta máquina; `prepare:remote-release` e `check:remote-sql` passaram.

## Mudança que dependerá de aprovação

Aplicar **somente** a migração acima, usando o mesmo pacote e `--skip-vault`, criará:

- Dois papéis NOLOGIN/NOBYPASSRLS: executor transacional e validador de aprovação.
- Schema privado e sete tabelas: environment, allowed_users, heads, approvals, operations, record_versions e feed.
- RPCs `ms_import_initial`, `ms_apply_changes`, `ms_sync_view`, `ms_changes`, `ms_approve`, funções privadas e trigger de captura do feed.
- Permissões mínimas de EXECUTE e políticas por proprietário para o executor; nenhum DML genérico para authenticated, nenhum enfraquecimento de FORCE RLS.

O controle nasce **desativado**, a lista de usuários autorizados nasce **vazia** e nenhum dado financeiro é importado. Não haverá publicação Cloudflare, configuração de secrets, ativação pessoal ou push como consequência dessa aprovação SQL.

**O dry-run confirma o histórico e a seleção dos arquivos; não executa o corpo da migração nem valida as RPCs remotas.** Essa versão promovida continua sem ensaio de execução PostgreSQL; os testes anteriores das versões de laboratório não substituem essa pendência. Sincronização não está liberada. O token mínimo do validador e os testes remotos com contas fictícias também permanecem pendentes.

Nesta continuação não houve alteração do aplicativo ou do Worker: não foi necessário repetir TypeScript, testes ou builds. O lint do gerador e a conferência do SQL foram executados. A última validação do aplicativo permanece em **214 testes aprovados**.

Plano completo, incluindo publicação, Auth e testes condicionados às respectivas aprovações: [remote-release-plan.md](remote-release-plan.md). Uso no PC de casa: [home-setup.md](home-setup.md).
