# Money Saver no PC de casa

Node.js **26.7.0**, npm e Git. **Docker não é requisito** para frontend, Auth ou sincronização remota após liberação. Docker permanece opcional para testes PostgreSQL.

## Obter e abrir

```powershell
git clone https://github.com/joaopedrobn/money-saver.git
cd money-saver
node --version
npm ci
```

Se já tiver a cópia, confira `git status` e preserve alterações antes de `git pull --ff-only origin main`. Não use reset para atualizar. A entrega descrita em `remote-release-plan.md` só estará no GitHub depois do push autorizado; confira o commit publicado antes de trocar de máquina.

Crie `.env.local` a partir de `.env.example`, com:

```dotenv
VITE_SUPABASE_AUTH_ENABLED=true
VITE_SUPABASE_URL=https://iwzmsbkbuerleocismhj.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=SUBSTITUA_PELA_CHAVE_PUBLICAVEL_DO_PROJETO
VITE_REMOTE_SYNC_ENABLED=false
VITE_SYNC_ALLOWED_USER_IDS=
VITE_SYNC_API_URL=https://money-saver.quem-votar-jp.workers.dev/sync-api
```

Não inclua `VITE_SUPABASE_AUTH_REDIRECT_URL`: sem override, o retorno acompanha a origem atual. Remova um override antigo se usar outro endereço. A publishable key está em Supabase → Settings → API Keys; nunca use secret/service_role, senha do banco ou token do validador. `.env.local` é ignorado pelo Git.

```powershell
npm run dev
```

Abra `http://127.0.0.1:5173/`; `http://localhost:5173/` também pode ser usado. Ambos devem estar na lista de Redirect URLs do Auth. Faça login com a conta existente e confira o e-mail no menu. Login funcionando confirma Auth, **não confirma sincronização financeira**. O modo sem conta continua disponível.

## Acesso à nuvem

Endereço de publicação preparado: **https://money-saver.quem-votar-jp.workers.dev/**. O subdomínio da conta foi consultado; o Worker ainda não foi publicado nesta entrega. Consulte `remote-release-plan.md` para o estado e pendências. Não há endereço publicado confirmado neste momento.

Depois da validação remota aprovada e concluída, habilite o frontend somente para os UUIDs autorizados usando `VITE_REMOTE_SYNC_ENABLED=true` e `VITE_SYNC_ALLOWED_USER_IDS=<UUID autorizado>`. Reinicie Vite. Esses flags não concedem acesso: Worker e banco verificam independentemente sua lista e sessão.

Clique **Abrir réplica da nuvem**. O app verifica o servidor e usa um IndexedDB separado por projeto/usuário. Configurações mostra confirmação, pendências e conflitos. Um segundo dispositivo recupera os dados da conta após abrir sua réplica. Antes da liberação, mantenha o flag `false`; dados antigos permanecem exclusivamente no navegador original.

A importação pessoal é separada: exportar backup no PC original → abrir réplica vazia → selecionar explicitamente o backup em Configurações → conferir prévia, UUIDs e totais → baixar e guardar o backup → confirmar `IMPORTAR PARA A NUVEM`. **Não faça essa etapa antes da autorização e validação remota.** Nenhum IndexedDB antigo é copiado ou limpo automaticamente. Conflitos exigem decisão explícita; a cópia e a fila rejeitada são preservadas.

## Continuar PanelUI

A skill `.agents/skills/panelui-web`, `skills-lock.json`, registro `@panelui` em `components.json` e MCP shadcn em `.codex/config.toml` acompanham o repositório. Abra esta pasta no Codex e reinicie a sessão para carregar o MCP. Em Windows, o comando configurado usa `cmd /c npx`. Consulte `docs/panelui-web-preparation.md` antes de adicionar componentes individuais. Esta entrega não inicia o redesign.

## Verificar

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npm run build:cloudflare
```

Nenhum desses comandos exige Docker. `build:cloudflare` prepara um build com Auth para o endereço HTTPS e sincronização **desativada**. Não executa deploy. Apenas os testes `test:sync:local`/SQL exigem a stack local.
