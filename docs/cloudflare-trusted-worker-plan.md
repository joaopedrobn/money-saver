# Worker confiável — responsabilidades futuras

Atualização da Fase 3.2B: o candidato local e o Worker executado em workerd estão descritos em [phase32b-local-sync.md](phase32b-local-sync.md). O texto abaixo registra o planejamento anterior; não representa o estado implementado no laboratório. Publicação/ativação em produção continuam pendentes.

Documento de preparação. Nenhum Worker, binding, segredo, rota ou deploy Cloudflare foi criado nesta etapa. A sincronização financeira continua desativada.

## Fronteira de autorização

O Worker deverá verificar a sessão pelo Supabase Auth do projeto fixado na configuração do servidor. `user_id`, projeto, revisão ou hash enviados pelo navegador não constituem autorização. O usuário efetivo deve vir exclusivamente da verificação do token. A configuração de homologação deve ser independente da produção; enquanto a ativação não for autorizada, solicitações destinadas ao projeto de produção devem ser recusadas.

O frontend continuará usando somente a publishable key. Credenciais de banco, `service_role` e secret keys não entram no bundle, em `VITE_*`, URLs, respostas HTTP ou logs. Para emitir aprovações, preferir uma conexão de servidor com privilégios específicos do papel validador, em vez de uma credencial administrativa que ignore RLS. A forma de conectar esse papel NOLOGIN ainda precisa ser projetada/revisada; não há uma conexão privilegiada pronta para reutilizar no frontend.

## Validação e emissão de aprovação

1. Limitar tamanho/frequência da solicitação e verificar a identidade no servidor.
2. Fixar o projeto de destino e ler a revisão/estado remoto por uma interface de servidor com escopo do usuário; não confiar na declaração de destino vazio do cliente.
3. Validar envelope canônico, versão do protocolo, UUID da operação, propriedade e revisão esperada.
4. Reutilizar `validateImportForApproval`, `validateBackup`, a integridade de crédito e os seletores financeiros existentes. Não implementar outro cálculo de saldos ou faturas.
5. Conferir o manifesto e calcular hashes a partir dos bytes exatos recebidos, sem confiar em hashes declarados pelo cliente.
6. Emitir aprovação privada, curta e vinculada a usuário/operação/revisão/conteúdo/versão do validador. O navegador nunca poderá escrever na tabela de aprovações.

Se a conexão usar um pool, a definição de contexto de usuário deve ocorrer dentro da mesma transação (`set_config(..., true)`), com valores derivados da identidade verificada e consultas parametrizadas. Não conservar contexto de um usuário para a próxima conexão/requisição. O acesso a heads/aprovações e a associação do papel de conexão ao validador precisam de revisão explícita de privilégios, sem conceder escrita financeira genérica.

Há um gate adicional de compatibilidade: o domínio atual usa datas civis e `today()` do ambiente. Antes de executá-lo em Workers, validar a mesma data de referência e as fronteiras de fuso horário do navegador/servidor, incluindo meia-noite em São Paulo. Não presumir que o relógio UTC do Worker reproduz automaticamente o contexto local. Essa compatibilidade ainda não foi implementada nem testada em Workers.

## Importação e resposta

A aprovação não substitui a transação financeira. A RPC continuará exigindo `auth.uid()`, revisão, propriedade, restrições, trava e operação idempotente. Qualquer chamada futura deve conservar o contexto do usuário; não transformar o Worker num endpoint genérico de SQL, tabelas ou usuários arbitrários.

Timeout após envio é resultado desconhecido. O Worker não pode inventar novo ID, repetir pagamentos com outro ID, sobrescrever por horário ou declarar falha com rollback sem consultar o recibo. Precisará existir uma leitura de estado/recibo com isolamento por usuário, ainda não exposta nesta fase. Repetições devem reutilizar a mesma operação e os mesmos bytes.

Somente após ler o snapshot e reconciliar pelo domínio existente será possível registrar conclusão. Falha após um commit exige investigação/conflito, não exclusão automática de registros. IndexedDB e backup devem permanecer intactos. Nenhum componente pode apresentar “Sincronizado” enquanto a funcionalidade estiver desativada ou a reconciliação estiver pendente.

## Operação e gates para implantação

Registrar apenas ID de operação, fase, duração e códigos de erro necessários. Não registrar JWT, senha, conexão de banco, payload financeiro, e-mail ou snapshots pessoais. Tratar erros de autorização, revisão, validação, limite de espera e conexão separadamente, com resposta legível e sem detalhes privilegiados para o cliente.

Antes de implantar: concluir os testes PostgreSQL reais, revisar privilégios do Worker, validar autenticação e isolamento ponta a ponta, verificar compatibilidade do domínio no runtime Cloudflare, testar datas, limites, concorrência, repetição, falhas de rede e reconciliação. Armazenar futuros segredos exclusivamente nas ferramentas de secrets da Cloudflare, com configuração separada de homologação/produção. Publicação, concessões financeiras e ativação em produção exigem uma etapa posterior autorizada; este documento não as executa.
