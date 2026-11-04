# Redesign da autenticação — 04/11/2026

> O destino `/conta` e a separação entre a área de conta e o dashboard foram substituídos pela [entrada direta no dashboard com espaços locais separados](auth-dashboard-entry.md).

Substitui a composição visual e a escolha inicial descritas em `auth-visible.md`. A autenticação continua usando os mesmos serviços reais e o mesmo projeto configurado em `.env.local`.

## Telas e navegação

| Rota               | Comportamento                                                                                                                                                                                               |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/login`           | Entrada padrão sem sessão: e-mail, senha com mostrar/ocultar, recuperação, criar conta e continuar sem conta.                                                                                               |
| `/cadastro`        | E-mail, senha, confirmação e requisitos contextuais. Abre a verificação somente após o serviço aceitar o pedido.                                                                                            |
| `/verificar-email` | Instruções, e-mail mascarado, spam, reenvio e volta ao login. Acesso direto permite solicitar novo link sem afirmar envio anterior.                                                                         |
| `/recuperar-senha` | Pedido por e-mail e confirmação genérica, sem revelar existência de conta. Preserva a etapa após recarregar a aba.                                                                                          |
| `/redefinir-senha` | Exige evento real de recuperação e identidade verificada correspondente. Sem esse fluxo, orienta solicitar outro link, sem campos de senha. Atualização bem-sucedida mostra confirmação antes de continuar. |
| `/conta`           | Sessão/e-mail, logout, troca de conta e acesso explícito ao espaço local. Não mostra dados financeiros como pertencentes à conta.                                                                           |

Navegação usa History API, links reais e `popstate`, sem dependências novas. As cinco rotas solicitadas responderam HTTP 200 no Vite em acesso direto. As rotas financeiras por hash continuam disponíveis no modo local. A escolha local persiste somente na aba e não exige rede ou sessão.

O cliente continua enviando o callback exato já configurado na raiz, sem mudar a allowlist remota. O validador reconhece as novas páginas da mesma origem, mantendo as restrições de URL/chave. O SDK consome o retorno antes da normalização da rota. Links inválidos/expirados mostram mensagem genérica e ações para solicitar outro link. Usuários verificados que acessam login/cadastro/verificação seguem para a conta; recuperação tem prioridade sobre esse redirecionamento.

## Formulários e visual

Dark mode, verde suave, conteúdo limitado a 380 px, campos de 48 px, hierarquia simples e espaçamento consistente. Sem abas, painel gigante, ilustrações ou explicações de infraestrutura. Cada página mostra apenas a etapa relevante. Layout fluido para telas pequenas, foco de navegação, links de teclado e respeito a movimento reduzido.

Cadastro e nova senha exigem pelo menos 12 caracteres, maiúscula, minúscula, número e símbolo, além de confirmação igual. Login preserva compatibilidade com credenciais existentes. Não foi alterada a política remota. O serviço também valida a nova senha antes de chamar o SDK.

Envios têm bloqueio imediato contra duplicidade e descartam atualizações de interface após sair da página. Pedidos por e-mail e reenvio usam intervalo de 60 segundos, persistido na aba quando disponível, e tratam HTTP 429/erros de limite do provedor. O intervalo local não substitui os limites impostos pelo servidor. Confirmação de e-mail nunca é inferida do pedido de cadastro; é mostrada conforme a identidade real verificada.

A etapa de recuperação conserva na aba apenas usuário e prazo de 15 minutos para a interface. O formulário exige também a identidade confirmada no servidor. Logout, expiração, troca de usuário e atualização bem-sucedida invalidam essa etapa. Esse estado não contém senha ou token e não substitui a autorização do Supabase.

## Dados e validação

Os repositórios financeiros e o IndexedDB não foram alterados. O espaço local continua compartilhado pelo perfil do navegador, sem separação por usuário, fato informado no menu local e na área de conta. A área autenticada não monta esse espaço financeiro. Não há migração, exclusão no logout, associação de registros ao login ou sincronização.

Node.js 26.7.0 e dependências preservados. TypeScript, lint, **170 testes** (167 anteriores e três essenciais adicionados) e build aprovados. Os testes de renderização verificam telas independentes, preservação da escolha local, máscara de e-mail, intervalo de reenvio e bloqueio da redefinição sem recuperação. Serviços/configuração continuam cobrindo callbacks, senha, erros, sessão e troca de identidade. Testes usam mocks apenas na suíte.

Supabase real, consultas de leitura: `/auth/v1/settings` respondeu HTTP 200, e-mail/cadastro habilitados e confirmação obrigatória; `/auth/v1/user` sem sessão respondeu HTTP 401. Não foram criadas contas nem enviados e-mails automaticamente. Ensaio completo com conta e entrega de e-mail permanece manual.

Inspeção visual desktop/mobile indisponível: a ferramenta retornou `The browser access host is unavailable`. Não foram produzidas evidências visuais. O build mantém apenas os avisos anteriores de anotações do Zod.

Sem alterações de `.env.local`, SQL, RLS, migrações, configuração remota ou credenciais neste redesign; sem push/deploy.

Referências: [recuperação por senha](https://supabase.com/docs/guides/auth/passwords), [reenvio](https://supabase.com/docs/reference/javascript/auth-resend), [limites do Auth](https://supabase.com/docs/guides/auth/rate-limits).
