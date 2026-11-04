# Conexão ao projeto Supabase

**Atualização de 04/11/2026:** as duas migrações foram posteriormente autorizadas, aplicadas e verificadas. Resultado e evidências em [supabase-application-2026-11-04.md](supabase-application-2026-11-04.md). As seções de prévia abaixo registram a preparação anterior; não reaplicar os arquivos.

## Configuração local preparada

Projeto informado pelo usuário: `iwzmsbkbuerleocismhj` — `https://iwzmsbkbuerleocismhj.supabase.co`.

O `.env.local`, ignorado pelo Git, utiliza exatamente as variáveis lidas pelo cliente:

- `VITE_SUPABASE_AUTH_ENABLED=true`: habilita somente o cliente e a interface de Auth opcionais.
- `VITE_SUPABASE_URL`: URL do projeto informado.
- `VITE_SUPABASE_PUBLISHABLE_KEY`: chave pública informada; não é credencial administrativa.
- `VITE_SUPABASE_AUTH_REDIRECT_URL=http://127.0.0.1:5173/`: endereço padrão local, validado contra a origem e o pathname da aplicação.

Reiniciar o Vite para carregar o arquivo. Configurar manualmente Site URL/Redirect URLs correspondentes no Supabase Auth, mediante aprovação das alterações remotas. Se o navegador utiliza outra origem/porta, usar essa origem exata no retorno e no Auth, sem mudar a origem dos dados IndexedDB existentes. Nesta etapa foram feitas apenas autenticação/vinculação do CLI, comparação de configuração, histórico, dry-run e leitura dos catálogos PostgreSQL; não houve cadastro de usuários do aplicativo, envio de dados financeiros ou alteração do Dashboard.

O backend financeiro ativo continua Dexie/IndexedDB. Auth não instancia o adaptador remoto nem envia o snapshot. Todas as escritas desse adaptador e a restauração remota continuam bloqueadas. Nenhum dado pessoal foi migrado. Node permanece 26.7.0, npm 11.19.0.

Verificações locais aprovadas: carregamento do `.env.local` pelo Vite e validação do cliente sem rede; arquivo ignorado e não rastreado pelo Git; TypeScript; lint; 155 testes; build; revisão de whitespace do diff. O build mantém os avisos anteriores de anotações do Zod. SQL e políticas RLS foram revisados localmente, mas não executados em PostgreSQL nesta etapa.

## Revisão das migrações e permissões

Aplicar somente os arquivos versionados abaixo, nesta ordem, depois de revisar o histórico remoto:

1. `202611030001_financial_schema.sql`: cria três domínios e 16 tabelas, índices, unicidades e FKs compostas por usuário. Habilita RLS/FORCE RLS e revoga acesso de `PUBLIC`, `anon` e `authenticated` na mesma transação. Não insere dados, não remove objetos existentes e não altera IndexedDB.
2. `202611030002_rls_and_snapshot.sql`: concede USAGE no schema `public` e apenas SELECT nas 16 tabelas para `authenticated`. Revoga privilégios anteriores nas tabelas antes desse GRANT explícito. As quatro políticas de propriedade por tabela usam `auth.uid()`; UPDATE verifica proprietário antigo e novo. A função `ms_snapshot()` é STABLE/SECURITY INVOKER e tem EXECUTE somente para `authenticated` após revogação de PUBLIC/anon. Nenhum GRANT de INSERT/UPDATE/DELETE/TRUNCATE é concedido.

Assim, a opção **Automatically expose new tables** pode continuar desativada: o acesso de leitura pretendido é opt-in pelos GRANTs explícitos, limitado por RLS. Isso não altera globalmente `ALTER DEFAULT PRIVILEGES`. O schema `public` precisa estar entre os schemas expostos se/quando a Data API for usada; não modificamos essa configuração remota. Desabilitar a exposição automática não é o mesmo que desabilitar toda a Data API ou retirar `public` da lista de schemas expostos.

As políticas de escrita preparam isolamento futuro, mas não concedem privilégios de escrita. Não ampliar grants para contornar erros de permissão. Os limites de integridade agregada e o plano de migração continuam no [guia da fundação](supabase-foundation.md).

Estes arquivos não são idempotentes. Se houver `ms_*` ou migrações já aplicadas no destino, interromper e comparar o estado; não usar DROP, reset, `--include-all`, `migration repair` ou sobrescrita para forçar a aplicação. Se algum arquivo já tiver sido aplicado, preparar uma migração incremental separada para mudanças posteriores; nunca reaplicar a primeira sobre tabelas existentes.

## CLI e sequência de aplicação — preparação local executada

O CLI 3.0.0 foi obtido pelo cache do npx e sua versão foi confirmada, sem alterar Node, package.json ou lockfile. `init` foi executado porque não havia `config.toml`; os hashes SHA-256 das duas migrações permaneceram iguais antes/depois. O help do CLI instalado confirma que **3.0.0 usa `--remote`, não `--linked`**, para selecionar o projeto vinculado em `migration list` e `db push`. `--skip-vault` exclui atualizações de segredos do Vault.

O `config.toml` local agora desativa exposição automática de novas tabelas e seeds, usa retorno Auth em `http://127.0.0.1:5173/`, senha mínima de 12 caracteres e confirmação de e-mail. `project_id = "money-saver"` identifica o ambiente local; não é prova de vínculo remoto. A versão PostgreSQL 17 do template foi confrontada com a remota, **17.11**, e coincide na versão principal. Nenhum PostgreSQL/Docker foi instalado ou iniciado. Nenhuma configuração local foi enviada ao Supabase.

`login --no-browser` inicialmente retornou `LoginMissingTokenError` sem TTY. O usuário concluiu o login interativo no VS Code e confirmou a conclusão, sem compartilhar credenciais. Em seguida, `link --project-ref iwzmsbkbuerleocismhj` concluiu com código 0. O arquivo local ignorado `.temp/project-ref` e os comandos remotos confirmaram exclusivamente **money-saver / iwzmsbkbuerleocismhj / production**.

Na raiz do repositório, preparar somente o CLI local e autenticar manualmente:

```powershell
npx supabase@3.0.0 --version
npx supabase@3.0.0 init
npx supabase@3.0.0 login
npx supabase@3.0.0 link --project-ref iwzmsbkbuerleocismhj
```

`init` cria configuração local; não usar `--force`, nem executar caso `supabase/config.toml` já exista. Revisar os arquivos gerados. `.temp/` e `.branches/` do Supabase ficam ignorados pelo Git. `login` requer autenticação da conta Supabase; `link` vincula o diretório ao projeto e pode pedir a senha do PostgreSQL. Usar os prompts seguros do CLI: não colocar token ou senha em argumentos, arquivos versionados, `VITE_*` ou no chat. A publishable key não substitui o login do CLI nem a senha do banco. Não foi presumida nenhuma credencial administrativa.

Depois de conferir a identidade/projeto, revisar o histórico e a prévia **antes de aplicar**:

```powershell
npx supabase@3.0.0 migration list --remote
npx supabase@3.0.0 db push --remote --dry-run --skip-vault
```

Os comandos de histórico, comparação e dry-run acima foram executados com sucesso (código 0). O dry-run lista migrações propostas; não comprova execução do DDL nem isolamento RLS. Nenhum `config pull`, `config push`, reset ou aplicação real foi executado. A aplicação real continua exigindo aprovação explícita.

**Somente após a aprovação explícita**, o comando de aplicação será:

```powershell
npx supabase@3.0.0 db push --remote --skip-vault
```

Não acrescentar `--include-seed`, `--include-roles`, `--include-all` ou `--yes` ao comando de aplicação. Nenhuma aprovação automática de alteração remota foi utilizada. O comando real acima está apenas documentado e não foi executado.

### Resultado do vínculo e dry-run

O histórico remoto não registra as duas versões locais, e o dry-run listou exatamente:

- `202611030001_financial_schema.sql` — domínios, 16 tabelas, FKs, índices e RLS/FORCE RLS.
- `202611030002_rls_and_snapshot.sql` — quatro políticas de proprietário por tabela, GRANTs explícitos de leitura e função de snapshot SECURITY INVOKER.

O resultado do CLI confirmou `dryRun: true`, `seeds: []` e `roles: []`. Não foi usado `--yes` nem `SUPABASE_YES` para aprovar operações remotas.

Uma consulta adicional com `db query --remote --read-only` inspecionou somente catálogos do schema `public`: não existem relações, tipos ou funções com prefixo `ms_`. Assim, não foi identificado conflito de nomes com os objetos destas migrações no momento da consulta. Nenhuma tabela financeira foi lida. PostgreSQL remoto: 17.11.

Não há DROP, TRUNCATE, exclusão de registros, CREATE OR REPLACE ou carga de dados nos arquivos. CREATE falhará se surgirem objetos com os mesmos nomes antes da aplicação, em vez de apagá-los/substituí-los. As alterações de tabelas referem-se às tabelas criadas pela primeira migração. Grants de INSERT/UPDATE/DELETE/TRUNCATE permanecem ausentes; as políticas de escrita não os concedem. PUBLIC/anon não recebem acesso financeiro, e autenticados recebem somente USAGE/SELECT/EXECUTE conforme descrito anteriormente. As políticas ainda não foram criadas ou testadas no remoto; o dry-run não executa o SQL.

### Diferenças de configuração observadas — não aplicadas

`config diff` comparou API, Auth, banco, pooler, Realtime e Storage: **14 diferenças**, sendo 11 atualizações e 3 propriedades apenas locais.

| Configuração | Local | Remoto |
| --- | --- | --- |
| Auth Site URL | `http://127.0.0.1:5173/` | `http://localhost:3000` |
| Retornos adicionais | `http://127.0.0.1:5173/` | lista vazia |
| Senha mínima | 12 | 6 |
| Intervalo mínimo entre e-mails | 1 segundo | 1 minuto |
| Tamanho do OTP | 6 | 8 |
| TOTP: cadastro e verificação (2 diferenças) | desativados | ativados |
| Requisitos adicionais de senha | vazio | não declarado |
| Confirmação SMS | desativada | ativada |
| Pooler: tamanho padrão | 20 | 15 |
| Pooler: máximo de clientes | 100 | 200 |
| Storage vetorial | ativado pelo template | desativado |
| Storage vetorial: máximo de buckets | 10 | não declarado |
| Storage vetorial: máximo de índices | 5 | não declarado |

Não houve diferença reportada para exposição automática de novas tabelas ou para a versão principal PostgreSQL. Duas credenciais vieram mascaradas pela API e não foram comparadas; 12 propriedades declaradas ficaram fora do escopo de comparação do CLI. Não foi feito acesso a valores secretos nem publicação de credenciais.

Site URL/retornos e senha mínima precisam de decisão específica antes de validar Auth real. As demais diferenças de template não justificam enviar toda a configuração local: isso poderia reduzir MFA/OTP, alterar limites e habilitar recursos desnecessários. Manter o remoto como está até haver aprovação específica. A aplicação de migrations não exige `config push` e não corrigirá automaticamente essas diferenças de Auth.

Após aplicar, conferir o histórico, as 16 tabelas com RLS/FORCE RLS e os grants reais. O arquivo `supabase/tests/isolation.sql` cria fixtures e concede permissões temporárias dentro de uma transação de teste: deve ser executado exclusivamente em banco Supabase descartável, nunca no projeto remoto pessoal. Testes de Auth/e-mail também dependem de configuração e autorização próprias. Não iniciar sincronização ou importação financeira.

Referências: [CLI e vínculo de projetos](https://supabase.com/docs/reference/cli/supabase-link), [prévia/aplicação de migrations](https://supabase.com/docs/reference/cli/supabase-db-push), [GRANTs e RLS na Data API](https://supabase.com/docs/guides/api/securing-your-api).
