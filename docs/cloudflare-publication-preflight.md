# Publicação Cloudflare — preparação final

05/11/2026. **Preparado e validado localmente; não publicado.** Node.js **26.7.0**. A migração Supabase já aplicada não foi modificada nesta etapa.

## Destino e escopo da primeira publicação

URL planejada: **https://money-saver.quem-votar-jp.workers.dev/**.

Conta Cloudflare autenticada: `8640e4b83ec3bcfaf338412bc5345897`. O subdomínio existente `quem-votar-jp` foi reconfirmado por consulta somente leitura. A API confirmou que o Worker `money-saver` ainda não existe. A primeira publicação criará esse Worker e seus Static Assets, sem banco Cloudflare, KV, filas, domínio comprado ou dependência de Docker.

Configuração: `worker/wrangler.production.jsonc`. Entrypoint compilado: `.local/cloudflare-worker/index.js`; frontend: `dist/**`. Esses artefatos são enviados à Cloudflare, mas não ao GitHub. O arquivo de configuração e os scripts de build são versionados para reconstruí-los no PC de casa.

Rotas: `/sync-api/view` GET, `/sync-api/changes` POST e `/sync-api/operations` POST passam pelo Worker; as demais usam Static Assets com fallback SPA. Login, cadastro, recuperação e redefinição retornam `index.html` em navegação direta. Configuração conforme [Cloudflare Static Assets/SPA](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/).

Primeiro deploy: `REMOTE_SYNC_ENABLED=false`, `SYNC_ALLOWED_USER_IDS=""`, `LAB_ONLY=false`, projeto Supabase fixo. Frontend também é compilado com sync desativada e lista vazia. O banco já está fechado e não será alterado. **Nenhum secret financeiro é necessário para essa publicação inicial.** O usuário poderá acessar a interface e usar Auth/IndexedDB; dados financeiros ainda não aparecerão em outro dispositivo.

## Identidade e validação financeira

O Worker reutiliza `validateImportForApproval`, `validateDelta` e o domínio existente. Não há segundo motor financeiro. O Bearer do usuário é validado no endpoint Supabase `/auth/v1/user`; o ID usado na autorização vem dessa resposta, nunca do payload. E-mail não confirmado/sessão rejeitada não alcançam as RPCs. RPCs de usuário recebem o próprio JWT do usuário e continuam sob RLS.

RPCs existentes usadas: `ms_sync_view`, `ms_changes`, `ms_import_initial`, `ms_apply_changes`. Somente `ms_approve` usa a credencial restrita do validador, depois da validação financeira e reconciliação do conteúdo exato. O SQL remoto já aplicado protege propriedade, revisão, operação/hash e atomicidade.

Decodificar role/expiração do token do validador é uma conferência de configuração; a validação da assinatura desse token ocorre no PostgREST. A identidade do usuário não é aceita a partir de JWT apenas decodificado.

## Validador mínimo preparado

Papel existente: `money_saver_sync_validator`, NOLOGIN/NOBYPASSRLS, EXECUTE em `ms_approve` e sem acesso direto às tabelas financeiras. Worker não recebe service_role, senha PostgreSQL ou chave de assinatura.

Utilitário offline preparado: `scripts/prepare-sync-validator-token.mjs`. Aceita somente chave privada ES256/P-256 **já existente e cujo kid/assinatura sejam aceitos pelo Supabase**, fixa role `money_saver_sync_validator`, issuer do projeto, aud `authenticated` e validade de **uma hora**. Não aceita override de papel/proprietário/validade, não cria/importa chaves, não faz rede e escreve somente em arquivo novo sob `.local/`. Não imprime token no terminal.

```powershell
node scripts/prepare-sync-validator-token.mjs --jwk-file <arquivo-privado-existente> --output .local/validator/token.txt
```

**Nenhum token real foi emitido nem instalado.** Os testes geraram apenas chaves efêmeras em memória, sem exportá-las para arquivo. Não há chave privada de produção disponível para esse procedimento nesta entrega. A emissão offline não comprova que um projeto aceitará uma chave: verificar kid/assinatura contra as chaves aceitas e preparar rotação antes de qualquer liberação financeira. Chaves privadas gerenciadas Supabase não são exportáveis; importar/rotacionar uma chave exigirá autorização própria, caso necessário. Referências: [Supabase signing keys](https://supabase.com/docs/guides/auth/signing-keys), [JWTs externos](https://supabase.com/docs/guides/auth/jwts).

Em etapa futura autorizada, o único secret financeiro do Worker será `SYNC_VALIDATOR_TOKEN`; `SUPABASE_PUBLIC_KEY` é uma variável pública. O emissor privado permanece fora do Worker/frontend/GitHub. Token expirado ou mal configurado fecha a API. Não ativar sync antes de resolver emissão/renovação e testar o ambiente remoto. Esse bloqueio **não impede a hospedagem inicial com API desativada**.

## Variáveis, CORS e Auth

- Frontend: Auth habilitado, URL do projeto e publishable key pública; callback HTTPS planejado; API relativa `/sync-api`; sync `false`, UUIDs vazios. O build usa allowlist explícita de variáveis públicas.
- Worker: URL Supabase fixa e flags fechados descritos acima. Na publicação inicial não cadastrar token de validador nem credencial administrativa.
- CORS restrito a `https://money-saver.quem-votar-jp.workers.dev`, `http://127.0.0.1:5173` e `http://localhost:5173`, métodos GET/POST/OPTIONS e headers Authorization/Content-Type. Sem wildcard. Origem desconhecida é rejeitada.

O Auth remoto foi consultado **somente com `config pull --dry-run`**, em pasta isolada. Estado observado: Site URL `http://127.0.0.1:5173/`; Redirect URLs `http://127.0.0.1:5173/**` e `http://localhost:5173/**`; confirmação por e-mail habilitada; senha mínima 12, com maiúsculas/minúsculas/dígitos/símbolos.

Alteração exata proposta, **não aplicada**, em `worker/auth-redirects.proposed.json`:

```json
{
  "site_url": "https://money-saver.quem-votar-jp.workers.dev/",
  "uri_allow_list": "http://127.0.0.1:5173/**,http://localhost:5173/**,https://money-saver.quem-votar-jp.workers.dev/"
}
```

Após aprovação, aplicar somente esses dois campos no projeto correto, preservando a política de senha e confirmação. [Endpoint oficial de atualização parcial do Auth](https://supabase.com/docs/reference/api/v1-update-auth-service-config). Reconferir os valores antes de alterar e preservar URLs novas se existirem. Essa configuração deve acompanhar a primeira publicação: enquanto o HTTPS não estiver autorizado, confirmação/recuperação pode cair no Site URL antigo do PC. O fluxo PKCE/PASSWORD_RECOVERY e a prioridade da redefinição de senha permanecem os existentes.

## Verificações concluídas

- TypeScript e lint aprovados; **216 testes Vitest**, preservando os 214 anteriores, mais **dois testes Node** do emissor: assinatura ES256 real/expiração/role fixa, adulteração rejeitada e chaves inadequadas recusadas.
- Build Vite normal, Worker de laboratório, build Cloudflare e `wrangler deploy --dry-run` aprovados. Sem atualização de dependências/Node. Avisos conhecidos de anotação Zod e chunk >500 KB são não bloqueantes.
- **Smoke HTTP em workerd local, sem Docker**: `/`, `/login`, `/cadastro`, `/recuperar-senha`, `/redefinir-senha` servem SPA; `/sync-api/view` retorna **503 SYNC_DISABLED**, inclusive em navegação; origem desconhecida retorna **403**. Processo local encerrado ao fim. Não é teste visual nem ensaio financeiro remoto.
- Bundle HTTPS confirma flag fechado, lista vazia, callback correto, ausência do callback antigo, do endpoint de sessão do harness, do emissor offline e do binding secreto do validador no frontend.
- Revisão de arquivos candidatos ao GitHub sem padrões de credenciais reais, chave privada/JWK, JWT literal ou banco SQLite. `.env.local`, `.dev.vars*`, `.local/`, `.wrangler/` e `dist/` permanecem ignorados. Artefatos e hashes de publicação estão em `.local/cloudflare-release-review.json`; evidências do smoke em `.local/cloudflare-smoke-report.json`.

## GitHub e pacote de publicação

Remoto: `https://github.com/joaopedrobn/money-saver.git`, branch `main`. Na inspeção, GitHub estava em `2c6e5f07b093b69c6d2673e93ccd95d862b77be7`; os commits locais `3f65f05` e `2681fd8` ainda não haviam sido enviados. As alterações seguintes de correção SQL, testes, relatório de aplicação e preparação final serão incluídas no commit local desta entrega, sem apagar alterações existentes.

Ao GitHub: fontes React/Worker, SQL corrigido e verificações, scripts de build/teste/emissão offline, proposta pública de retornos Auth, package/lockfile existentes, documentação, skill PanelUI/registro/MCP já versionados. Não enviar bundles, logs, fixtures gerados em `.local`, tokens/chaves privadas, `.env.local`, backups pessoais, bancos ou volumes.

## Ações exatas que exigem aprovação

1. **Publicar** `money-saver` na conta Cloudflare identificada, com `worker/wrangler.production.jsonc`, `dist/**` e `.local/cloudflare-worker/index.js`, executando o build padrão fechado e depois `npx --yes wrangler@4.157.0 deploy --config worker/wrangler.production.jsonc`. Criará a URL HTTPS planejada; API financeira continuará desativada. Reconferir ausência de Worker existente antes de criar para não sobrescrever outra publicação.
2. **Atualizar somente os dois campos de Auth** do JSON proposto no projeto `iwzmsbkbuerleocismhj`, preservando os valores de confirmação, senha e retornos locais. Risco operacional: mensagens futuras usarão o Site URL HTTPS; realizar a publicação/configuração no mesmo procedimento e verificar os retornos após ambas.
3. **Push sem force** dos commits locais preparados para `origin/main`, após nova conferência do remoto; se houver novos commits remotos, integrar sem sobrescrevê-los. Isso disponibiliza o código atualizado no PC de casa.

Essa aprovação futura não deve incluir ativação, allowlist, importação pessoal, teste financeiro de escrita, instalação de JWT de validador ou mudança das chaves de assinatura. Testes de escrita remotos e liberação financeira continuam sendo outra autorização. A publicação inicial torna a interface acessível em PC/celular; dados IndexedDB permanecem por dispositivo até a sincronização ser validada e liberada.
