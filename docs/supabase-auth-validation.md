# Fase 3.1.1 — Auth e preparação para sincronização

Projeto examinado: **money-saver / iwzmsbkbuerleocismhj / produção**. Node 26.7.0 preservado. Nenhuma conta foi criada e nenhum e-mail foi enviado: o usuário escolheu validar agora sem criar contas e documentar os testes reais pendentes. Nenhuma configuração remota foi alterada.

## O que foi observado no serviço real

O endpoint público `GET /auth/v1/settings`, chamado com a publishable key já configurada, respondeu **HTTP 200**:

| Item | Remoto |
| --- | --- |
| Provedor e-mail | Habilitado |
| Cadastro | Habilitado (`disable_signup=false`) |
| Confirmação de e-mail | Obrigatória (`mailer_autoconfirm=false`) |
| Provedor telefone | Desabilitado |

Uma chamada somente de leitura a `GET /auth/v1/user`, sem sessão, foi rejeitada com **HTTP 401**. Não foi exibido o corpo dessa resposta.

Isso confirma conectividade, configuração pública do Auth e recusa de acesso sem sessão. **Não comprova** cadastro completo, entrega de mensagem, troca de código PKCE, login, refresh ou logout com uma conta real.

`supabase config diff` também foi executado em modo de leitura e manteve as 14 diferenças anteriormente registradas. Os pontos relevantes para Auth são:

| Configuração | Local | Remoto |
| --- | --- | --- |
| Site URL | `http://127.0.0.1:5173/` | `http://localhost:3000` |
| Redirect URLs adicionais | `http://127.0.0.1:5173/` | Lista vazia |
| Confirmação por e-mail | Obrigatória | Obrigatória |
| Senha mínima | 12 caracteres no cliente e TOML | 6 caracteres no servidor |
| Intervalo entre mensagens | 1 segundo no TOML | 1 minuto |
| OTP | 6 dígitos no TOML | 8 dígitos |
| TOTP: cadastro/verificação | Desativados no template local | Ativados |

A comparação não revelou diferença para expiração de JWT de 3600 segundos, rotação de refresh tokens habilitada e janela de reutilização de 10 segundos. Isso é comparação de configuração, não ensaio de renovação. Duas credenciais são mascaradas pela API e 12 propriedades ficam fora do escopo do CLI; não foram lidos valores secretos. Configuração de SMTP/entrega e limites efetivos de envio ainda precisam ser conferidos no Dashboard.

## Origens locais e ações necessárias no Dashboard

`http://127.0.0.1:5173/` e `http://localhost:5173/` são origens diferentes. Seus IndexedDB, armazenamento de sessão e verificadores PKCE não são compartilhados. Não trocar host/porta para procurar dados pessoais já existentes.

Antes de testes reais, mediante configuração explícita do responsável:

1. Definir Site URL para a origem escolhida; na instalação atual, `http://127.0.0.1:5173/`.
2. Permitir o retorno exato dessa origem em Redirect URLs. Se houver testes em `http://localhost:5173/`, permitir também esse endereço exato, sem wildcards amplos, e usar um perfil de teste sem dados pessoais.
3. A variável `VITE_SUPABASE_AUTH_REDIRECT_URL` deve coincidir com a origem e o pathname em uso. O cliente rejeita a configuração de 127.0.0.1 quando aberto por localhost; os testes agora cobrem explicitamente essa distinção. Não há fallback silencioso entre hosts. Reiniciar Vite após mudar o ambiente.
4. Elevar o mínimo do servidor para pelo menos 12 caracteres; não reduzir o mínimo do cliente. Preservar confirmação de e-mail, OTP e MFA. Não executar `config push` em massa: o template local tem outras diferenças que reduziriam proteções ou alterariam limites/recursos.
5. Conferir SMTP, remetente, templates de confirmação/recuperação e limites de envio. O template deve respeitar o retorno aprovado; testar confirmação e recuperação no mesmo navegador/perfil/origem que iniciou o fluxo PKCE.

Essas ações **não foram executadas** nesta fase. O modo local permanece disponível mesmo se Auth estiver desativado ou mal configurado.

## Código de autenticação e sessão

- Cadastro e alteração de senha exigem 12 caracteres no cliente. Cadastro e recuperação enviam o callback exato validado. Login, logout e mensagens de erro continuam sem imprimir detalhes internos do provedor ou credenciais.
- O SDK permanece com PKCE, `persistSession=true`, `autoRefreshToken=true` e armazenamento `money-saver-remote-auth`, separado do IndexedDB. O logout usa `scope: local`, encerrando a sessão deste navegador; não promete encerrar todas as sessões de outros dispositivos.
- Foi extraído um observador de Auth testável, sem importação de repositórios financeiros. A identidade só é exibida depois de `getUser` confirmar no servidor. O evento de recuperação abre o painel de nova senha.
- A verificação agora tem prazo de interface de 15 segundos, mensagem de falha e opção de tentar novamente. Respostas atrasadas não restauram uma identidade após logout ou troca de conta. O prazo limita o carregamento da interface; não é uma promessa de cancelamento da requisição interna do SDK.
- Chamadas Auth subsequentes são agendadas fora do callback do SDK, com `setTimeout`, para evitar reentrância sob o lock de sessão. Timers e assinatura são removidos ao desmontar.
- `TOKEN_REFRESHED` atualiza o prazo da sessão. Se o prazo expirar sem renovação, o painel remove a identidade e pede novo login; o modo local continua disponível. Timers de UI não substituem autorização no servidor/RLS.
- A troca de usuário desmonta o formulário remoto anterior. **Não troca, apaga, atribui ou envia o conjunto financeiro local.** O perfil do navegador continua sendo a fronteira dos dados locais nesta etapa.

Os testes de serviços usam SDK simulado, sem rede nem e-mails. Os testes do observador usam tempo controlado e cobrem restauração verificada, sessão ausente, logout/identidade concorrentes, timeout/retentativa, descarte de resposta tardia, renovação/expiração, recuperação, erros e limpeza. São validações de código, **não** testes ponta a ponta com Supabase Auth real. A interface foi revisada em código; fluxos visuais com conta real continuam pendentes.

## RLS: inspeção estrutural versus teste de isolamento

A consulta de catálogos `supabase/checks/phase31-postflight.sql` foi repetida com `db query --remote --read-only`. Confirmou **16 tabelas com RLS/FORCE RLS**, quatro políticas por tabela e ausência de privilégios financeiros para anon/PUBLIC ou de escrita para authenticated. A inspeção das políticas compara propriedade por `auth.uid()` e as referências são compostas com `user_id`, conforme a verificação detalhada da aplicação.

Isso **não demonstra** isolamento efetivo com dois usuários. `supabase/tests/isolation.sql` prepara esse teste em Supabase descartável: dois usuários fictícios, leitura/snapshot, INSERT forjado, UPDATE/DELETE de outro proprietário, alteração de proprietário, FKs cruzadas e operações próprias. Grants temporários exercitam as políticas de escrita; tudo termina em rollback. Não representa liberação de escrita para o aplicativo.

O script agora exige marcador de projeto descartável. O runner `scripts/test-supabase-isolation.ps1`:

- Rejeita o ref de produção antes de qualquer conexão.
- Confere se o host direto ou usuário do pooler corresponde ao ref de teste informado.
- Usa conexão dedicada por variáveis de processo libpq, sem senha em argumentos/logs; restaura o ambiente ao terminar.
- Exige TLS com validação de certificado (`verify-full`) e psql já disponível; não instala dependências ou banco.
- Ignora `.psqlrc`, exige `ON_ERROR_STOP` e não permite prompt de senha inesperado.

Preparação, **somente** após criar e selecionar um Supabase descartável vazio e aplicar nele as migrações aprovadas:

```powershell
# Definir MONEY_SAVER_TEST_DATABASE_URL de forma segura, fora do repositorio.
# Usar endpoint direto ou pooler do projeto descartavel; configurar a CA confiavel do PostgreSQL.
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-supabase-isolation.ps1 -TestProjectRef <ref-descartavel>
```

O guard de produção e a sintaxe do runner foram verificados localmente. **Os testes SQL não foram executados**: não foi fornecido ambiente descartável e psql não está disponível. O guard reduz erros operacionais; não substitui a conferência humana do projeto e das credenciais. Não executar o script diretamente com um marcador falso no banco de produção.

## Checklist de ensaio real ainda pendente

No ambiente de teste, sem dados pessoais: cadastrar e-mail autorizado; confirmar pelo link no mesmo perfil; rejeitar senha incorreta; entrar; recarregar e validar persistência; recuperar e alterar senha; rejeitar link inválido/expirado com orientação para novo link; observar renovação; simular rede indisponível e expiração; sair e confirmar que a sessão não volta; testar logout em outra aba; testar troca de usuário sem alteração financeira local. Se MFA estiver inscrito, validar o fluxo apropriado sem desabilitá-lo. Nunca registrar senha, código PKCE, access token ou refresh token em evidências.

## Gates antes da fase 3.2

1. **Identidade e consentimento:** concluir os ensaios de Auth e isolamento reais; decidir requisitos de MFA. Identificar claramente dispositivo, origem, projeto e usuário de destino, sem inferir que dados locais pertencem ao login atual. Isolar perfis de teste/produção; avaliar chave de sessão específica por projeto antes de múltiplos projetos na mesma origem.
2. **Migração explícita:** apresentar prévia e confirmação de envio. Exportar e validar backup consistente antes de qualquer envio; bloquear escritas concorrentes durante a captura. Preservar UUIDs, instantes, datas e centavos; nunca remapear IDs silenciosamente.
3. **Operação transacional e idempotência:** futura RPC única com identidade derivada de `auth.uid()`, identificador da operação e hash; trava/revisão por usuário. Retry idêntico retorna o resultado anterior; conteúdo divergente é rejeitado. Não implementar importação em lotes independentes por tabela, upsert cego ou escolha pelo relógio do dispositivo.
4. **Preflight e duplicidades:** detectar qualquer dado preexistente nas 16 entidades, IDs/competências/ocorrências/orçamentos duplicados e relações inválidas. Resolver destino não vazio ou conflito explicitamente antes de escrever; evitar repetir pagamentos, parcelas e efetivações em retries.
5. **Paridade financeira:** dentro da operação futura, validar relacionamentos, parcelas, pagamentos, estornos e pares de crédito; comparar contagens/UUIDs/hash e os mesmos seletores de saldos, faturas, dívidas/créditos, receitas/consumo nos dois regimes e orçamentos. Divergência deve impedir commit.
6. **Concorrência entre dispositivos:** definir revisão do servidor, tombstones, tratamento offline, conflitos, locks e reconciliação antes de liberar escrita. Não ligar dois dispositivos ao mesmo dataset por uma simples preferência de UI.
7. **Rollback:** ensaiar rollback total por falha e retomada idempotente; manter cópia local intacta. Recuperação após commit exige lote auditável e proteção contra alterações posteriores. Troca de backend somente depois de commit e reconciliação verificada.
8. **Permissões:** nenhuma concessão ampla de INSERT/UPDATE/DELETE ao cliente para ativar sincronização. Projetar operações/RPCs atômicas e auditoria junto da transação, com escopo mínimo, testes de acesso/conflito e nova aprovação. A RLS atual verifica proprietário; não implementa por si só integridade financeira agregada nem revogação instantânea de JWTs já emitidos.

O [plano detalhado original](supabase-foundation.md#plano-de-migração-futura--não-executado) permanece válido. Não houve implementação ou ativação de sincronização nesta fase.

## Validação local

Node 26.7.0, sem atualização de dependências. **TypeScript, lint, 163 testes e build aprovados** (155 anteriores + 8 essenciais de Auth/sessão). Avisos anteriores de anotações Zod no build permanecem.

A primeira suíte revelou um teste financeiro legado dependente da data: `applyCredit` registra o dia atual, mas a asserção usa 03/11/2026. Somente o relógio `Date` desse teste foi fixado nessa data; timers do IndexedDB continuam reais, asserções e motor financeiro não mudaram. A suíte completa passou após essa estabilização.

Migrações aprovadas e seus hashes foram preservados; IndexedDB/dados pessoais não foram abertos ou alterados por este trabalho. Não houve novos usuários, envios de e-mail, alteração de configuração remota, escrita financeira, push ou deploy.

Referências oficiais: [eventos de Auth](https://supabase.com/docs/reference/javascript/auth-onauthstatechange), [sessões](https://supabase.com/docs/guides/auth/sessions), [autenticação por senha](https://supabase.com/docs/guides/auth/passwords).
