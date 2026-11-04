# Fase 3.1 — fundação Supabase

Preparação seguinte: [Fase 3.2A — sincronização ainda desativada](phase32a-sync-foundation.md), com RPC candidata fora das migrações e execução de segurança em ambiente descartável pendente.

Atualização: migrações aplicadas em 04/11/2026 e verificadas no [relatório de aplicação](supabase-application-2026-11-04.md). Validação de Auth e gates para sincronização: [fase 3.1.1](supabase-auth-validation.md). Os resultados de teste e as limitações abaixo registram a entrega original da fundação.

## Estado e limites

O backend financeiro ativo continua sendo IndexedDB, inclusive após login/logout. Não existe seleção automática de backend, envio de backup, seed remoto, assinatura Realtime ou sincronização. `selectPersistenceBackend` rejeita a seleção remota. Nenhuma migração local foi modificada. O SDK `@supabase/supabase-js` é a única dependência direta adicionada, com versão exata; as versões anteriores das dependências foram mantidas.

O adaptador Supabase implementa `FinancialRepositories` como preparação: leituras autenticadas usam `ms_snapshot()` e o validador financeiro de backup existente. Escritas, restauração e efetivações rejeitam antes de qualquer chamada de rede. O aplicativo não instancia esse adaptador. As tabelas também não concedem INSERT/UPDATE/DELETE a `authenticated` nesta fase: as políticas CRUD definem a propriedade, mas os privilégios adicionais ficam bloqueados. **Não conceder escrita direta para ativar o adaptador.** Operações financeiras atômicas e testes de concorrência são pré-requisitos da fase 3.2.

O SDK é carregado sob demanda somente com autenticação habilitada e configuração válida. Validação local com Node 26.7.0/npm 11.19.0: `npm ci`, TypeScript, lint, 155 testes (148 anteriores + 7 essenciais da fundação) e build. A instalação mantém os avisos de 12 vulnerabilidades moderadas e aprovação de script do esbuild; não foi aplicado audit fix. Os avisos de anotações do Zod no build são anteriores a esta fase. Navegador não foi tentado novamente, conforme solicitado.

## Inspeção da arquitetura atual

- `src/domain/models.ts`: centavos inteiros, datas civis, UUIDs de entidades, configurações e eventos históricos.
- `src/domain/repositories.ts`: contratos; `src/infrastructure/repositories.ts`: composição Dexie ativa.
- Repositórios especializados: `movement-repository.ts`, `credit-repository.ts`, `planning-repository.ts`, `backup-repository.ts`. Escritas financeiras e auditoria compartilham transações locais; o snapshot é consistente.
- IndexedDB `money-saver`: v1 base; v2 efetivação, categorias e ajustes; v3 crédito, estornos e unicidade de faturas/parcelas; v4 ocorrências e orçamentos. Todas permanecem intactas.
- `BackupPanel` exporta JSON e exige prévia/confirmação para restaurar. `validateBackup` valida estrutura, referências, UUIDs duplicados por tabela, parcelas, pagamentos, estornos e limites numéricos. O envelope permanece v2, estruturas 3/4 e compatibilidade legada. Restauração local substitui tabelas numa única transação mediante `RESTAURAR`. A exportação não limpa o banco.

## Mapa de entidades

Todas as tabelas SQL possuem `user_id → auth.users.id` e chave primária `(user_id, id)`. IDs permanecem UUID; categorias padrão podem repetir seu UUID entre usuários. Datas são `date`, competências são `YYYY-MM`, instantes são `timestamptz`, dinheiro usa `bigint` restrito à faixa aceita pelo domínio. Não há colunas de saldo calculado, dívida residual, limite utilizado ou totais de relatórios.

| Modelo / IndexedDB | PostgreSQL         | Referências no mesmo usuário                                              |
| ------------------ | ------------------ | ------------------------------------------------------------------------- |
| accounts           | ms_accounts        | —                                                                         |
| categories         | ms_categories      | —                                                                         |
| cards              | ms_cards           | conta sugerida                                                            |
| recurring          | ms_recurring       | conta, categoria, cartão opcional                                         |
| transactions       | ms_transactions    | conta, categoria, recorrência opcional                                    |
| transfers          | ms_transfers       | contas de origem e destino distintas                                      |
| adjustments        | ms_adjustments     | conta, categoria opcional                                                 |
| purchases          | ms_purchases       | cartão, categoria                                                         |
| invoices           | ms_invoices        | cartão; competência única por cartão                                      |
| installments       | ms_installments    | compra, fatura; número único por compra                                   |
| payments           | ms_payments        | fatura, conta pagadora; estorno datado preservado                         |
| invoiceEntries     | ms_invoice_entries | fatura, compra/categoria/lançamento original opcionais                    |
| occurrences        | ms_occurrences     | recorrência, exatamente uma transação ou compra                           |
| budgets            | ms_budgets         | categoria; categoria/mês únicos                                           |
| settings           | ms_settings        | uma configuração por usuário                                              |
| audit              | ms_audit           | proprietário; referência polimórfica histórica sem FK ao registro apagado |

Referências compostas `(user_id, referência)` impedem vínculos entre usuários. Não há cascade sobre histórico financeiro. `invoiceEntries.transferId` identifica um par de aplicação de crédito; não referencia uma transferência bancária. `audit.before/after` são snapshots históricos JSON, sem renomeação interna dos campos. A propriedade de suas linhas é protegida por RLS; seus conteúdos serão validados pelo importador transacional futuro. Unicidades adicionais preservam ocorrências efetivadas uma vez e orçamentos únicos. Relações sem FK histórica, direção de categorias, compatibilidade entre compra/fatura, soma das parcelas, excesso de estorno/pagamento e pares de crédito exigem validação agregada na futura operação transacional. Não são consideradas garantidas somente pelo DDL.

`mapping.ts` explicita os campos das 16 entidades, converte camelCase/snake_case, confere proprietário, UUIDs e centavos seguros e normaliza instantes. O decoder exige todas as tabelas e usa `validateBackup`, sem recalcular um motor alternativo. IDs legados que não sejam UUID são bloqueados para análise manual, nunca regenerados silenciosamente. `bigint` recebido como string é rejeitado; os valores devem estar na faixa numérica segura.

## Migrações e segurança

1. `supabase/migrations/202611030001_financial_schema.sql`: domínios, 16 tabelas, restrições, referências compostas e índices; RLS/FORCE RLS habilitados e acesso revogado já nesta transação.
2. `supabase/migrations/202611030002_rls_and_snapshot.sql`: políticas SELECT/INSERT/UPDATE/DELETE com `auth.uid()`; UPDATE verifica proprietário antigo e novo. Acesso anônimo continua revogado; somente SELECT financeiro e EXECUTE do snapshot são concedidos a usuários autenticados.

`ms_snapshot()` é SQL STABLE SECURITY INVOKER, sem argumentos de proprietário e com `search_path` vazio. Retorna as 16 tabelas numa única instrução/MVCC, sob RLS e filtro de usuário. O adaptador verifica o usuário antes/depois e descarta respostas se a identidade mudar. Não há funções SECURITY DEFINER ou chave `service_role` no cliente. O guard de interface não substitui RLS.

As políticas de auditoria também são preparadas, mas alterações de auditoria não são concedidas ao cliente. Na fase 3.2, auditoria deve ser escrita exclusivamente junto da operação financeira atômica, nunca editada diretamente pela UI.

## Configuração externa, somente quando houver um projeto de teste

Nada foi criado ou aplicado remotamente nesta etapa. Não procurar credenciais existentes nem reutilizar projetos sem seleção explícita.

1. Criar/selecionar manualmente um projeto Supabase de desenvolvimento isolado. Aplicar os dois arquivos SQL em ordem pelo fluxo de migrations/SQL Editor escolhido. Conservar o histórico de versões. Não aplicar fixtures em produção.
2. Executar os testes SQL abaixo e revisar as políticas/grants no Dashboard. Antes de habilitar a autenticação de uma instalação, confirmar que as migrações e o isolamento estão corretos.
3. Em Auth, habilitar e-mail/senha e confirmação de e-mail. Configurar SMTP para envio real, política de senha mínima de 12 caracteres e limites de tentativas/envio. Para produção, configurar TLS e as proteções adicionais de Auth disponíveis no projeto.
4. Definir Site URL e Redirect URLs para a origem/caminho exatos do aplicativo. Desenvolvimento: `http://127.0.0.1:5173/`; manter a mesma origem dos dados locais. Não trocar host/porta para testar dados existentes.
5. Copiar `.env.example` para `.env.local`. Preencher somente URL do projeto, chave **publishable** e URL de retorno exata. Definir `VITE_SUPABASE_AUTH_ENABLED=true` somente após a configuração anterior. Reiniciar Vite. Valores `VITE_*` entram no bundle e são públicos: nunca colocar chaves `secret`, `service_role`, senha PostgreSQL ou tokens privilegiados. O cliente rejeita chaves que não comecem com `sb_publishable_`; chaves JWT legadas não são aceitas neste fluxo.
6. Abrir **Configurações → Conta online**, cadastrar conta de teste e validar confirmação, login, logout, renovação e recuperação de senha por e-mail. O retorno PKCE chega ao mesmo pathname, e o evento de recuperação abre `#online`. O formulário de nova senha também fica disponível após restaurar uma sessão válida.

Sem configuração completa, Auth permanece desativado; os dados financeiros locais ficam acessíveis. `#online` protege o painel da sessão com verificação `getUser`, mas nenhuma rota financeira local exige login. Sessão remota usa armazenamento separado `money-saver-remote-auth`; sair remove a sessão deste navegador, sem limpar IndexedDB. Em aparelho compartilhado, login remoto não isola os dados locais já existentes entre pessoas — o perfil do navegador continua sendo o limite local. Não apresentar estes dados como pertencentes à conta autenticada.

## Validação SQL

Não foi encontrado PostgreSQL/Supabase CLI/Docker no ambiente desta entrega; **DDL e RLS ainda não foram executados em PostgreSQL real**. Em um banco Supabase descartável e vazio, com ambas as migrações aplicadas, executar no PowerShell:

```powershell
# Configure MONEY_SAVER_TEST_DATABASE_URL fora do repositório, apenas para banco descartável.
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-supabase-isolation.ps1 -TestProjectRef <ref-descartavel>
```

O script exige uma conexão de administração do banco de testes, cria dois usuários fictícios, verifica RLS/FORCE RLS, grants, quatro políticas por tabela, SELECT/RPC isolados, bloqueio anônimo, INSERT com proprietário forjado, UPDATE/DELETE de outro usuário, troca de proprietário e FK cruzada. Grants temporários permitem exercitar as políticas de escrita preparadas; tudo termina em ROLLBACK. Não concede privilégios permanentes nem migra dados reais. Não executar no banco pessoal/produção, mesmo com rollback. A revisão desses testes e a execução em PostgreSQL são gates para a fase 3.2.

## Plano de migração futura — não executado

1. **Consentimento e cópias:** usuário escolhe explicitamente conta remota e escopo; congelar escritas durante a captura de snapshot consistente, exportar backup local validado e registrar contagens, UUIDs e hash do conteúdo. Não apagar nem marcar dados locais como migrados antecipadamente.
2. **Preflight:** `validateBackup` e integridade de crédito/recorrências; validar todos os UUIDs, faixa de centavos, duplicidades, referências, limites de quantidade e existência de uma única configuração. Detectar ciclos/parcelas/faturas inconsistentes. Bloquear e explicar inconsistências, sem alterar registros para fazê-los caber no schema.
3. **Destino:** confirmar identidade no servidor. Ler e comparar TODAS as tabelas do usuário, inclusive categorias/settings/auditoria. Destino com qualquer dado exige plano de conflito explícito; não presumir banco vazio por não haver contas. Categorias padrão com mesmos IDs só podem ser tratadas como idênticas após comparação do conteúdo.
4. **Idempotência:** futura RPC aceita identificador único da operação + hash do snapshot, proprietário exclusivamente de `auth.uid()`, trava por usuário, registro de estado e resultado. Retry do mesmo identificador/hash retorna o mesmo resultado; hash diferente é rejeitado. Nunca usar upsert cego ou sobrescrever por `updatedAt` do dispositivo.
5. **Ordem dentro de UMA transação:** contas e categorias; cartões e configurações; recorrências; transações/transferências/ajustes; compras e faturas; parcelas e pagamentos; lançamentos de fatura (originais antes dos estornos, pares de crédito juntos); ocorrências; orçamentos; auditoria. Preservar todos os UUIDs e instantes. Não fazer lote por tabela via cliente.
6. **Integridade final:** validar vínculos do mesmo proprietário e compatibilidade de categoria/cartão, quantidades, centavos e sequência de parcelas, pagamentos, estornos e pares de crédito. Comparar contagens/UUIDs/hash normalizado. Pelos mesmos seletores atuais, comparar saldos por conta em datas de controle, receitas/consumo líquido por mês em ambos os regimes, faturas, dívida/crédito por cartão, parcelas futuras e utilização de orçamentos. Diferença impede commit.
7. **Rollback:** falha cancela a transação completa; manter cópias locais intactas e não trocar backend. Só marcar operação como concluída e permitir seleção remota após commit e confirmação de leitura comparada. Reverter um commit posterior requer operação explícita, auditada e vinculada ao lote; não apagar registros por IDs sem conferir lote/alterações posteriores. Backups e procedimento de restauração do destino devem ser ensaiados em homologação.
8. **Conflitos:** nesta fundação, qualquer divergência para mesmo UUID ou destino não vazio bloqueia o processo. A fase 3.2 deve definir revisão explícita, versionamento/revisões do servidor, concorrência, exclusões/tombstones e resolução determinística. Não somar saldos, não recriar pagamentos e não mesclar silenciosamente dados de outro usuário/dispositivo. Sincronização incremental/offline só depois desse contrato.

## Referências oficiais

- [Supabase: RLS e papéis](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Chaves públicas e secretas](https://supabase.com/docs/guides/getting-started/api-keys)
- [Autenticação por senha](https://supabase.com/docs/guides/auth/passwords)
- [Recuperação de senha e PASSWORD_RECOVERY](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail)
