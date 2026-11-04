# Entrada direta no dashboard — 04/11/2026

Substitui o destino intermediário `/conta` documentado nas etapas anteriores. Não existe mais a tela “Sua conta” no fluxo de entrada.

## Comportamento

- Confirmação com sessão verificada, login bem-sucedido e restauração de sessão levam diretamente a `/`, sem cliques adicionais. `/login`, `/cadastro`, `/verificar-email` e o endereço legado `/conta` também levam a `/` quando há sessão válida.
- Sem sessão verificada, aparece login. Um código no endereço não comprova autenticação nem confirmação. Quando não consegue entrar automaticamente, o aplicativo orienta o login; erros explícitos de link continuam oferecendo novo pedido.
- O mesmo observador Supabase continua sendo a única origem da identidade. A interface aguarda `getUser`, mantém expiração/timeout e descarta verificações atrasadas. Ao perder uma sessão autenticada, retorna ao login com mensagem. O modo explicitamente sem conta permanece independente do Auth.
- Recuperação tem prioridade. O evento real de recuperação abre `/redefinir-senha`; a identidade deve ser verificada antes de liberar o formulário. A confirmação de senha atualizada permanece na tela até “Continuar”, que então abre `/`. Uma sessão de recuperação não é encaminhada automaticamente ao dashboard.
- E-mail, confirmação, logout, troca de conta e acesso ao espaço sem conta estão no menu superior do dashboard. Os avisos de armazenamento local continuam no menu e nas configurações.

## Dados locais

O dashboard autenticado usa um conjunto IndexedDB separado por projeto e usuário. O esquema e os repositórios Dexie existentes são reaproveitados; não há backend financeiro remoto. Os componentes recebem repositórios vinculados ao espaço em que foram montados, inclusive backup, cartões, planejamento e lançamentos. O workspace é remontado ao mudar de espaço/usuário, descartando estado e formulários da conta anterior. Operações já iniciadas continuam vinculadas aos seus repositórios originais.

A base antiga `money-saver`, usada sem conta, foi preservada. Ela não é copiada, atribuída, apagada nem migrada durante login/logout. O primeiro acesso autenticado pode mostrar um dashboard vazio: os registros antigos continuam no espaço sem conta, acessível explicitamente pelo menu “Usar espaço sem conta”. O retorno à mesma conta no mesmo navegador recupera seu conjunto local separado. Os registros não são apresentados como sincronizados ou disponíveis em outro dispositivo.

## Validação

Node.js 26.7.0 preservado; sem atualização de dependências. TypeScript, lint, **174 testes** e build aprovados. Quatro testes essenciais acrescentados aos 170 anteriores: destinos de entrada/restauração, prioridade da recuperação, integração da verificação com o evento de recuperação e persistência/isolamento dos conjuntos locais com operações atrasadas. O teste IndexedDB usa exclusivamente `fake-indexeddb`, sem abrir dados financeiros do navegador.

Supabase real, somente leitura: configuração pública do Auth HTTP 200, cadastro/e-mail habilitados e confirmação obrigatória; usuário sem sessão HTTP 401. Nenhum usuário ou e-mail foi criado automaticamente. O usuário já confirmou o funcionamento de cadastro/confirmação; o novo destino após login/confirmação foi validado em testes de código, sem ensaio com sua sessão pessoal.

## Ensaio manual

1. Abra `/login` e entre: deve aparecer o dashboard em `/`, com a conta no menu.
2. Recarregue e visite `/cadastro`: com sessão válida, permaneça no dashboard.
3. Confirme outro cadastro pelo link no mesmo navegador: sessão válida abre `/`; sem sessão, aparece login.
4. Recupere a senha: deve aparecer o formulário de nova senha, depois a confirmação da atualização, e somente então o botão para continuar ao dashboard.
5. Crie um registro de teste no espaço autenticado A, saia e entre com B: o registro de A não deve aparecer. Volte a A para conferir persistência.
6. Para localizar registros anteriores ao isolamento, escolha “Usar espaço sem conta”. O menu e Configurações informam que esse conjunto é compartilhado pelo perfil do navegador, sem vínculo com a conta e sem sincronização.

Sem alteração de SQL, RLS, esquema financeiro, dados financeiros existentes ou configurações remotas. Sem migração, push ou deploy.
