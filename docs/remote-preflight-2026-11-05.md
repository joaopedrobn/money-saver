# Conferência remota e dry-run — 05/11/2026

**Resultado posterior:** a versão corrigida, SHA-256 `19b1508b5755e05d0c73b2f45c135d436600480b9aba7c0f51180ef057fb0889`, recebeu autorização específica e foi aplicada com sucesso. As verificações somente leitura confirmaram sincronização desativada, allowlist vazia e dados financeiros inalterados. Relatório: [supabase-sync-application-2026-11-05.md](supabase-sync-application-2026-11-05.md). As seções abaixo preservam o histórico da preparação e correção anterior à aplicação.

## Atualização: correção e execução local real

A aplicação autorizada anteriormente foi interrompida **antes de qualquer migração remota** por delimitadores inválidos em `access_allowed`. A autorização do hash antigo não se estende ao arquivo corrigido. Nesta correção, nenhum comando acessou o Supabase remoto.

Origem: `scripts/prepare-remote-sql.mjs`, helper `once`. `String.replace(from, to)` interpretava `$$` como substituição JavaScript, gerando `$`. Agora usa `String.replace(from, () => to)`, preservando literalmente os delimitadores PostgreSQL. A regeneração mudou somente os dois delimitadores da função, sem modificar o domínio financeiro ou as migrações base já aplicadas. As oito funções foram revisadas e compiladas pelo PostgreSQL.

**Novo SHA-256, pendente de nova autorização:**

```text
19b1508b5755e05d0c73b2f45c135d436600480b9aba7c0f51180ef057fb0889
```

Regenerações consecutivas produziram bytes idênticos. A cópia em `.local/remote-release/supabase/migrations` corresponde ao arquivo versionado corrigido.

Validação real: Docker Desktop local, contêiner Supabase `supabase_db_money-saver`, PostgreSQL **17.11**, conexão por Unix socket dentro do contêiner, Node **26.7.0**. Nenhuma URL/credencial remota foi utilizada e nenhum arquivo de ambiente do frontend foi carregado pelos testes.

- A migração corrigida **completa** foi executada em uma transação local. As oito funções e o trigger foram criados; seis grupos SQL novos passaram. A transação e todos os fixtures foram revertidos ao final.
- Confirmados proprietários e SECURITY DEFINER das RPCs, `search_path=''`, `row_security=on`, EXECUTE mínimo, papéis NOLOGIN/NOBYPASSRLS, ausência de escalada e ausência de acesso financeiro do validador.
- Confirmadas as **16 tabelas com RLS/FORCE RLS**, ausência de DML genérico para authenticated e proteção das tabelas privadas.
- Dois usuários fictícios demonstraram isolamento de leitura. RPCs fechadas rejeitaram operações repetidas, aprovação, acesso anônimo e tentativa de escrita na lista de acesso; nenhuma deixou revisão, recibo, aprovação ou evento parcial.
- `access_allowed` e o verificador de integridade foram executados. O controle permaneceu **desativado**, com **zero usuários autorizados durante toda a execução**. Não houve inclusão na allowlist nem ativação temporária.
- Os **oito grupos existentes de integração SQL** também passaram: isolamento CRUD/referências, importação atômica, idempotência com mesmo recibo, rejeição de conteúdo/revisão divergente, concorrência entre sessões, término de conexão com rollback e reconciliação pelo domínio existente. Essa suíte usa o **candidato-base de laboratório**, sem a allowlist de produção. Portanto, a gravação positiva/idempotência foi exercitada no candidato-base; na migração promovida foram exercitados seus bloqueios fechados. Não se declara execução financeira positiva da versão promovida com usuários autorizados.
- Lint, conferência determinística do SQL e `git diff --check` passaram. Nenhum código TypeScript do aplicativo ou cálculo financeiro foi alterado; não foi necessário repetir os testes de interface ou build.

Reprodução, com a stack local disponível:

```powershell
node scripts/test-supabase-local.mjs
node scripts/test-remote-migration-local.mjs
npm run check:remote-sql
```

Evidências locais ignoradas pelo Git: `.local/local-sync-validation/report.json`, `.local/remote-migration-validation/report.json` e `sql.log`. Os executores recusam destino não local ou base financeira não vazia e não fazem reset. A limpeza confirmou a base original sem dados fictícios nem objetos candidatos persistentes.

**Pendente exata:** `supabase/remote-migrations/202611040001_controlled_financial_sync.sql` (versão `202611040001`), com o novo hash acima. Não houve nova consulta/dry-run remoto nesta correção. Uma futura aplicação exige nova autorização e reconferência remota. Deploy, push, validador mínimo, teste remoto e ativação continuam pendentes. Produção permanece intacta.

## Histórico da conferência anterior — não autoriza o hash antigo

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

SHA-256 **antigo, inválido e descartado**, registrado no dry-run anterior (não utilizar como autorização):

```text
ed50e800a187252da57a5ba34fd534ed0c4ba8e3c90c3a9ef0558dbf29d6c759
```

Naquela etapa, o gerador normalizava LF/CRLF, mas ainda continha o erro de substituição de delimitadores descrito na atualização acima. O dry-run não executava o corpo SQL.

## Mudança que dependerá de aprovação

Aplicar **somente** a migração acima, usando o mesmo pacote e `--skip-vault`, criará:

- Dois papéis NOLOGIN/NOBYPASSRLS: executor transacional e validador de aprovação.
- Schema privado e sete tabelas: environment, allowed_users, heads, approvals, operations, record_versions e feed.
- RPCs `ms_import_initial`, `ms_apply_changes`, `ms_sync_view`, `ms_changes`, `ms_approve`, funções privadas e trigger de captura do feed.
- Permissões mínimas de EXECUTE e políticas por proprietário para o executor; nenhum DML genérico para authenticated, nenhum enfraquecimento de FORCE RLS.

O controle nasce **desativado**, a lista de usuários autorizados nasce **vazia** e nenhum dado financeiro é importado. Não haverá publicação Cloudflare, configuração de secrets, ativação pessoal ou push como consequência dessa aprovação SQL.

**O dry-run anterior confirmou o histórico e a seleção dos arquivos; não executou o corpo da migração nem validou as RPCs remotas.** A execução da versão corrigida em PostgreSQL local está registrada na atualização acima. Sincronização não está liberada. O token mínimo do validador e os testes remotos com contas fictícias também permanecem pendentes.

Nesta continuação não houve alteração do aplicativo ou do Worker: não foi necessário repetir TypeScript, testes ou builds. O lint do gerador e a conferência do SQL foram executados. A última validação do aplicativo permanece em **214 testes aprovados**.

Plano completo, incluindo publicação, Auth e testes condicionados às respectivas aprovações: [remote-release-plan.md](remote-release-plan.md). Uso no PC de casa: [home-setup.md](home-setup.md).
