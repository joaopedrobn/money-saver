# Autenticação visível e gerenciamento de conta — 04/11/2026

> A apresentação visual e a escolha inicial abaixo foram substituídas pelo [redesign com páginas independentes](auth-redesign.md). As observações de configuração e isolamento permanecem como histórico desta implementação.

## Diagnóstico desta cópia

O `App` já envolvia o dashboard com `RemoteAccess`, mas esse componente só mostrava autenticação no hash `#online`. Qualquer outra entrada renderizava o espaço financeiro diretamente. O único link para conta online ficava em Configurações. O avatar `EU` era estático e não tinha menu nem relação com o Supabase.

Na inspeção inicial não existia `.env.local` na raiz do projeto, apenas `.env.example`; não havia variáveis `VITE_*` no ambiente do agente. A configuração requer `VITE_SUPABASE_AUTH_ENABLED=true`, URL, publishable key e callback exato. O dashboard local aberto não valida Auth.

Após a indicação das duas cópias, foi confirmado que a edição e o Vite da porta 5173 usam `C:\Users\Soluções SIG\Desktop\projetos\money-saver`. O caminho `C:\Users\tony stark\Desktop\Projetos\money-saver` não existe neste ambiente. A chave anteriormente informada também não está no histórico local disponível. A consulta somente de leitura pelo CLI Supabase não pôde prosseguir porque ele está sem sessão autenticada; nenhuma credencial foi criada ou alterada.

O usuário forneceu novamente a publishable key existente do projeto e autorizou sua gravação. Foi configurado o `.env.local`, ignorado pelo Git, com `VITE_SUPABASE_AUTH_ENABLED=true`, URL `https://iwzmsbkbuerleocismhj.supabase.co`, a publishable key recebida e callback `http://127.0.0.1:5173/`. Nenhuma chave administrativa foi usada; o valor da chave não foi impresso nas saídas de validação. As demais linhas do arquivo foram preservadas.

O Vite foi reiniciado neste diretório com porta 5173 estrita. A leitura HTTP do módulo servido confirmou que as quatro variáveis carregadas coincidem com o `.env.local`; o seletor financeiro continua `local`. A configuração foi aceita pelo validador existente. O endpoint real `GET /auth/v1/settings` respondeu **HTTP 200**, com e-mail/cadastro habilitados e confirmação obrigatória (`emailAutoconfirm=false`). `GET /auth/v1/user`, sem sessão, respondeu **HTTP 401**. Isso comprova conectividade pública e rejeição sem sessão, mas não o fluxo completo com conta real.

O cliente existente foi preservado: SDK Supabase real, PKCE, persistência e renovação de sessão; observador verifica identidade com `getUser`, trata timeout, expiração e respostas tardias após logout/troca de usuário. Não foi adicionado roteador: os hashes financeiros existentes continuam funcionando após a escolha de modo. Callbacks com `code` ou erro abrem a área de autenticação, mesmo com retorno à raiz.

## Experiência e fronteira dos dados

- Entrada oferece “Entrar com conta Supabase” e “Continuar localmente”, inclusive quando existe sessão anterior. Continuar localmente não exige rede ou login. Recarregar volta à escolha explícita; a sessão Supabase pode persistir separadamente.
- Modo local mantém o dashboard e os repositórios IndexedDB existentes. Seus dados pertencem ao espaço deste navegador, sem atribuição automática a qualquer login. Como antes, quem acessar esse perfil de navegador poderá escolher esse espaço local.
- Modo conectado oferece login, cadastro, orientação e reenvio de confirmação, recuperação, definição de nova senha, estado/e-mail confirmado, logout e troca de conta. Senhas novas exigem 12 caracteres. Trocar de conta primeiro encerra a sessão atual; se houver erro, não libera a troca como se o logout tivesse funcionado.
- Menu superior mostra sessão verificada, e-mail quando disponível, entrar/criar conta, gerenciar, sair, trocar e escolher modo. Desconectado usa ícone de armazenamento e rótulo “Modo local”, sem avatar autenticado fictício.
- A área conectada é de gerenciamento de conta nesta etapa. Ela **não monta o espaço financeiro local**, evitando apresentar dados anônimos do navegador como dados do usuário A ou B. Não há dataset financeiro por usuário nem sincronização até a Fase 3.2. Para usar as funções financeiras atuais, escolha explicitamente o modo local.
- Armazenamento financeiro é sempre IndexedDB; remoto é apenas Auth. Login, logout e troca de conta não importam, migram, atribuem, apagam ou enviam registros financeiros. O seletor de persistência e os repositórios financeiros não foram alterados.

## Como testar com o Supabase real

1. O `.env.local` já está configurado, e o Vite já foi reiniciado com essas variáveis. Abra `http://127.0.0.1:5173/`. Não troque para `localhost`, pois é outra origem, com outro IndexedDB e verificador PKCE. Em futuras edições do ambiente, preserve a publishable key existente, não use service role e reinicie o Vite.
2. Abra a raiz e escolha conta Supabase. Em “Cadastrar”, informe seu e-mail de teste e uma senha de pelo menos 12 caracteres. Confira a mensagem e abra o link recebido no mesmo navegador/perfil/origem. Se necessário, use “Confirmar e-mail” para solicitar novo link. Confirmação depende da entrega e do callback permitidos pelo projeto real.
3. Em “Entrar”, teste senha incorreta e depois as credenciais corretas. Confirme e-mail/estado de sessão na área de conta e no menu. Recarregue, escolha conta Supabase e confirme restauração verificada da sessão.
4. Use “Recuperar senha”, abra o link no mesmo navegador e defina/confirme a nova senha. Links inválidos ou expirados devem orientar um novo pedido. Não compartilhe tokens ou links de recuperação.
5. Use “Sair da conta”: deve reaparecer login e o estado sem sessão, preservando os dados locais. Para testar outro usuário, use “Trocar de conta” antes de entrar com o usuário B. Nenhum espaço financeiro local deve aparecer na área autenticada de A ou B.
6. Escolha o modo local explicitamente e confira que os registros financeiros anteriores continuam disponíveis no mesmo navegador. Teste também sem rede: a escolha local e as funções IndexedDB continuam disponíveis, independentemente do Auth.

Nenhuma conta de teste foi criada automaticamente e nenhum e-mail foi enviado neste trabalho. Os testes unitários usam mocks somente na suíte; a aplicação usa os serviços Supabase existentes, sem simulação.

## Validação

Node.js 26.7.0 preservado; sem mudanças de dependências. TypeScript, lint, 167 testes e build passaram. Os quatro novos testes essenciais cobrem escolha/modos/callbacks e orientação de e-mail não confirmado; a suíte existente cobre sessão, timeout, expiração e descarte de identidade antiga na troca de conta. O teste de serviço existente também passou a verificar o callback do reenvio de confirmação.

Validação visual não concluída: host do navegador integrado indisponível; tentativa pelo Brave interrompida pelo controle de computador por não conseguir determinar a URL atual com segurança. Não houve interação posterior com o navegador. Cadastro, entrega de e-mail, confirmação, recuperação e login/logout reais permanecem pendentes de um ensaio com conta autorizada; a configuração local e a conectividade pública foram verificadas.

O verificador local ignorado `.local/verify-auth-environment.mjs` permite repetir a conferência sem imprimir a chave: `node .local/verify-auth-environment.mjs`. Quando a configuração estiver válida, ele consulta somente os endpoints públicos de leitura `/auth/v1/settings` e `/auth/v1/user` sem sessão para verificar conectividade e rejeição anônima. Não cadastra usuários, envia e-mails ou acessa dados financeiros.

SQL, RLS, banco remoto, credenciais e IndexedDB existente não foram alterados. Sem migração, push ou deploy.

Referências da implementação: [autenticação por senha e PKCE](https://supabase.com/docs/guides/auth/passwords), [eventos de sessão e recuperação](https://supabase.com/docs/reference/javascript/auth-onauthstatechange).
