# Preparação da infraestrutura remota

04/11/2026. Node **26.7.0**. Nenhuma aplicação SQL remota, publicação, ativação, importação pessoal ou push foi executado.

## Estado conferido

- Cópia: `C:\Users\Soluções SIG\Desktop\projetos\money-saver`, branch `main`, remoto `https://github.com/joaopedrobn/money-saver.git`.
- Início desta entrega sem alterações pendentes. HEAD e `refs/heads/main` remoto eram `2c6e5f07b093b69c6d2673e93ccd95d862b77be7`. Os arquivos das fases anteriores já estavam nesse commit, incluindo skill/MCP PanelUI.
- Cloudflare OAuth válido; conta `8640e4b83ec3bcfaf338412bc5345897`; subdomínio Workers existente `quem-votar-jp`, consultado pela API somente leitura. Worker `money-saver` ainda não existe. Endereço proposto sobre esse subdomínio: `https://money-saver.quem-votar-jp.workers.dev/`, **ainda não publicado**.
- Supabase CLI 3.0.0 sem login e sem vínculo persistido disponível. `projects list` e consulta de catálogo somente leitura recusadas por falta de access token. `migration list --remote=iwzmsbkbuerleocismhj` e `db push --remote=iwzmsbkbuerleocismhj --dry-run --skip-vault` falharam com `DbConfigIpv6Error`. **Dry-run SQL não concluído**.
- O último relatório `supabase-application-2026-11-04.md` registra as duas migrações base aplicadas. Isso é evidência histórica; o catálogo atual não foi confirmado nesta entrega. Não se presume ausência das RPCs sem inspeção autenticada.

## Alteração SQL exata para revisão

Arquivo: `supabase/remote-migrations/202611040001_controlled_financial_sync.sql`. Gerado de `phase32a/prepare.sql` + `phase32b/prepare.sql`; os candidatos originais permanecem intactos. Cabeçalho registra SHA256 de ambos. `npm run check:remote-sql` detecta qualquer divergência. A publicação usa um pacote CLI isolado em .local/remote-release, com as duas bases e a nova migração; não altera a pasta ativa de migrações do laboratório nem instala a infraestrutura de produção ao iniciar testes locais. Inclui as correções já testadas localmente: renovação da aprovação sem mudar conteúdo, ordem de exclusão/inserção das parcelas, watermarks/paginação, tombstones e proteção do histórico.

Adições: papéis NOLOGIN/NOBYPASSRLS `money_saver_sync_executor` e `money_saver_sync_validator`; schema privado `ms_sync_private`; tabelas `environment`, `allowed_users`, `heads`, `approvals`, `operations`, `record_versions`, `feed`; funções privadas de integridade/acesso/captura e trigger do feed. RPCs públicas: `ms_import_initial`, `ms_apply_changes`, `ms_sync_view`, `ms_changes`, `ms_approve`.

`environment.enabled=false`; `allowed_users` nasce vazia. A aprovação e as quatro operações verificam esse controle; reads desautorizados não retornam snapshot. A autorização é por `auth.uid()` e lista privada, independente do frontend. Nenhum dado financeiro é inserido pela migração.

As 16 tabelas financeiras conservam FORCE RLS e referências compostas por proprietário. DML é concedido apenas ao executor NOLOGIN das funções, com políticas por proprietário. `authenticated` recebe EXECUTE nas quatro RPCs de usuário, **sem INSERT/UPDATE/DELETE genéricos**. `ms_approve` fica restrita ao validador; sem EXECUTE para authenticated/anon/service_role. Funções privilegiadas usam `search_path=''` e `row_security=on`; concorrência por advisory lock, revisão CAS, recibo por operação/hash e aprovação de conteúdo exato. Erros propagam rollback financeiro/feed/recibo. Não há reset, reparo de histórico nem remoção de tabela financeira.

Diferenças em relação aos candidatos: substituição explícita dos bloqueios de laboratório por projeto fixo + flag fechado + lista de proprietários. A nova migração **não foi executada contra PostgreSQL nem no remoto nesta entrega**; a validação das versões locais anteriores (24 grupos e oito SQL) não substitui essa pendência. Não a tratar como pronta para ativação.

Próximos comandos, após `npx supabase login` e conexão IPv4/pooler verificada, sem credenciais no chat:

```powershell
npx supabase db query --remote=iwzmsbkbuerleocismhj --read-only --file supabase/checks/remote-sync-readiness.sql
npm run prepare:remote-release
npx supabase migration list --workdir .local/remote-release --remote=iwzmsbkbuerleocismhj
npm run dry-run:supabase
```

Se necessário, obtenha o endereço IPv4 de Session Pooler em Supabase → Connect; configure a conexão privadamente e repita com `--remote=<pooler db-url>`. Não registre senha em arquivo versionado, argumento exibido ou relatório. Não deduza região/hostname. O resultado deve listar **somente** a nova migração; qualquer divergência exige revisão, sem `--include-all`, reset ou repair. A aplicação aprovada deve usar o mesmo --workdir .local/remote-release, os mesmos hashes e --skip-vault, removendo somente --dry-run. Guardar saída sem segredos e SHA256 antes de pedir aplicação.

## Worker e frontend

`worker/wrangler.production.jsonc` prepara um Worker com Static Assets, fallback SPA e `run_worker_first` somente em `/sync-api/*`. API reutiliza o Worker financeiro existente por `src/worker/cloudflare.ts`; sem segundo domínio financeiro ou motor de cálculos. JWT do usuário é validado por `/auth/v1/user` antes das RPCs, que recebem seu JWT e aplicam RLS. Worker também tem allowlist por UUID.

Configuração inicial: `LAB_ONLY=false`, projeto Supabase fixo, `REMOTE_SYNC_ENABLED=false`, UUIDs vazios. CORS permite apenas o HTTPS proposto e `http://localhost:5173`, `http://127.0.0.1:5173`; sem wildcard. Pedido sem Origin ainda exige JWT verificado e autorização. Static Assets não exige sessão; dados financeiros passam pela API.

Publicação inicial não precisa de credencial financeira. Para o ensaio posterior: configurar `SUPABASE_PUBLIC_KEY` com a publishable key e `SYNC_VALIDATOR_TOKEN` como secret exclusivo do Worker. Este JWT deve ser **assinado por chave aceita pelo projeto**, `role=money_saver_sync_validator`, validade limitada, renovação/rotação documentada. Worker rejeita role administrativa e token expirado antes de chamar o banco. Não é um token comum de usuário nem publishable key. Não usar service_role ou colocar chave de assinatura/secret no frontend.

**Provisionamento do JWT mínimo está pendente.** Não foi encontrado/inventado um token. Como o Supabase não permite extrair chaves privadas gerenciadas, confirmar um emissor seguro já disponível; se for necessário importar uma chave de assinatura, apresentar essa mudança e obter autorização específica antes. Não criar/rotacionar chaves de Auth nesta entrega. Sem esse provisionamento, API financeira permanece fechada. Referência: [JWTs Supabase](https://supabase.com/docs/guides/auth/jwts), [signing keys](https://supabase.com/docs/guides/auth/signing-keys).

`npm run build:cloudflare` fixa retorno Auth no HTTPS real proposto e mantém sync desligado. Vite normal usa a configuração local; sem override de retorno, acompanha a origem. Após aprovação do deploy, o Auth deve preservar confirmação obrigatória e os retornos de desenvolvimento, adicionando `https://money-saver.quem-votar-jp.workers.dev/` e ajustando Site URL para o HTTPS. Recuperação continua no observador existente, com seu fluxo protegido.

Build controlado posterior: configurar lista pública de UUIDs e executar `node scripts/build-cloudflare.mjs --controlled-sync` após typecheck. Esse comando continua sem publicar. Flags frontend não são autorização. Referência de Static Assets: [Cloudflare SPA](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/).

## Réplica e importação

`RemoteFinanceProvider` oferece abertura explícita somente quando build, projeto, HTTPS e UUID estiverem habilitados. Usa os repositórios/outbox existentes e namespace `money-saver-sync-remote:<projeto codificado>:<UUID>`, separado dos espaços anônimo e account-local v4. Não lê/copia dados antigos. O consentimento é por conta/navegador. Bootstrap de uma réplica nova falha fechado se servidor indisponível; réplica inicializada mantém dados e outbox offline. A sessão/token vem do observador Auth existente; renovação é fornecida ao cliente sem outra lógica de login. Logout/troca desmonta e interrompe requisições, sem apagar bancos. StrictMode cria um cliente por efeito e encerra cada execução.

Importação exige escolha de backup, destino/réplica vazios, validação de relacionamentos e totais, prévia, download e confirmação específica. Preparação não envia dados; bloqueia edição e pull que sobrescreveriam o conjunto pendente. O IndexedDB de origem e o arquivo original são preservados. Importações acima de 10 MB/10 mil registros, histórico acima dos limites do manifesto, restauração genérica na réplica e resolução automática de conflitos permanecem bloqueados. Nenhuma operação financeira nova foi criada; mantém as proteções de compras liquidadas/histórico.

Correção adicional: confirmação de operação persistida usa o `asOf` do payload original, permitindo reabrir a outbox em outro dia sem falsa divergência de manifesto.

## Validação desta entrega

- TypeScript e lint aprovados.
- **214 testes aprovados**, incluindo os 204 anteriores. Novos: gates remotos, namespace/abertura explícita, preparação de importação sem envio, proteção de pull/edição, reconciliação com data original, callbacks HTTPS, renovação do token pelo observador existente, Static Assets/API fechada, CORS, usuário não autorizado e token mínimo/expiração.
- Build Vite, Worker/Cloudflare e dry-run Wrangler executados. Avisos de chunk >500 KB e anotações Zod são não bloqueantes. **Não houve deploy**.
- SQL gerado conferido deterministicamente, mas não executado. Nenhum teste remoto foi iniciado. Não declarar sincronização pronta.

## Aprovações agrupadas e ordem de liberação

1. **Após concluir catálogo/dry-run SQL**, aprovar exatamente a migração nova acima, fechada e sem usuários/dados, e a configuração Auth HTTPS preservando desenvolvimento. Não aplicar antes dessa revisão.
2. Aprovar criação/publicação do Worker `money-saver` na conta identificada, Static Assets `dist`, rotas e variáveis acima, inicialmente **sem sincronização financeira**. Cadastrar apenas o secret mínimo depois de provisionado e revisado.
3. Aprovar ensaio remoto **somente com duas contas fictícias novas identificadas**, allowlist restrita a elas no banco/Worker/build e flag habilitado apenas para esse ensaio. Testar HTTPS/login, JWT, operações/segunda sessão, idempotência, desconexão/outbox, reconciliação, isolamento e refresh/recovery. Nenhum fixture na conta pessoal. Limpeza apenas de IDs/contas criados pelo ensaio e confirmados sem dependências; sem truncate/reset. Falha mantém flag fechado para uso normal.
4. **Só após passar o ensaio**, pedir liberação para UUID pessoal. Importar dados reais exige confirmação separada por backup/prévia, não faz parte de aprovar infraestrutura.
5. Aprovar push do commit local preparado para `origin/main`, sem force e após nova conferência do HEAD remoto. Essa ação permite recuperar a entrega em casa mesmo enquanto a infraestrutura financeira estiver pendente.

As etapas dependentes ficam bloqueadas pelos resultados anteriores. Nenhuma autorização é presumida por este documento. O guia independente de Docker está em `home-setup.md`.
