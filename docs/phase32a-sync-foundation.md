# Fase 3.2A — infraestrutura de sincronização, ainda desativada

> Continuação: [validação real no Supabase local — Fase 3.2A.1](phase32a1-local-validation.md). O relatório seguinte registra os testes PostgreSQL executados, duas correções e os limites de cobertura. As pendências abaixo registram o estado da entrega original; não representam autorização para produção.

Data: 04/11/2026. **Preparação local concluída; segurança transacional/RLS da nova RPC ainda não validada em Supabase descartável.** Nenhum SQL desta fase foi aplicado remotamente e nenhum dado financeiro pessoal foi enviado.

## Inspeção e decisões

Foram revisados os 16 modelos/tabelas, as duas migrações existentes, `ms_snapshot`, os adaptadores Dexie/Supabase, `validateBackup`, a integridade de crédito, o isolamento IndexedDB por projeto/usuário e o plano da Fase 3.1. As migrações existentes, os cálculos financeiros, os repositórios locais, o Auth e seus fluxos não foram alterados nesta fase.

O mecanismo ativo permanece IndexedDB. `selectPersistenceBackend` continua rejeitando persistência remota; o adaptador financeiro remoto continua recusando escritas. Não há fila automática, listener financeiro, envio em segundo plano, seleção de backend, botão de migração ou variável `VITE_*` capaz de ativar a sincronização. `submitFinancialImport` rejeita antes de qualquer I/O.

O escopo transacional preparado é **importação inicial completa em destino vazio**. Sincronização incremental, atualização/exclusão financeira e merge de um destino já preenchido não são implementados nem liberados nesta fase. Isso evita inventar uma política de sobrescrita enquanto os testes e a estratégia incremental ainda não estão certificados.

## Operações preparadas

| Artefato                        | Responsabilidade                                                                                                   | Situação                                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `sync/protocol.ts`              | Prévia, limites, IDs/centavos, hash do backup e do payload, confirmação vinculada, repetição exata e reconciliação | Implementado e testado localmente; sem transporte habilitado                                      |
| `sync/trusted-validation.ts`    | Validação pura para um futuro worker confiável, usando o domínio existente                                         | Implementado/testado; worker, autenticação do worker e gravação de aprovações **não implantados** |
| `sync/state.ts`                 | Estados de operação, resultado desconhecido após desconexão, conflito e conclusão somente após reconciliação       | Contrato/reducer testado; outbox durável e integração com escritas locais pendentes               |
| `supabase/phase32a/prepare.sql` | RPC candidata `ms_import_initial`, aprovação privada, head/revisão, versões de registro e recibo idempotente       | Somente arquivo candidato fora de `migrations`; não executado em banco                            |
| `supabase/tests/sync.sql`       | RLS anterior + dois usuários, RPC, rollback de finanças/metadados, propriedade, FK cruzada, idempotência e CAS     | Preparado; execução real pendente                                                                 |
| `SyncStatus.tsx`                | Estado, última conclusão, pendências e conflitos/erros futuros                                                     | Em Configurações, fixado no estado desativado; não declara dados sincronizados                    |

## Transação e limites de confiança

Uma chamada recebe UUID da operação, revisão esperada e **texto exato** do payload. O hash SHA-256 é calculado pelo servidor a partir desses bytes; não se aceita um hash declarado pelo cliente como prova. O cliente produz JSON canônico e conserva os mesmos bytes para retries. O proprietário é sempre `auth.uid()`, sem parâmetro que permita escolher outro usuário.

A RPC candidata:

1. Verifica usuário, gate exclusivo de sandbox, limites e ID da operação.
2. Obtém advisory lock transacional por usuário, com limite de espera, e trava o head.
3. Retorna o recibo anterior para a mesma operação/revisão/hash. Reutilizar o ID com outro conteúdo é rejeitado.
4. Exige revisão zero, destino totalmente vazio nas **16 entidades**, e aprovação confiável não expirada vinculada ao usuário/operação/revisão/hash.
5. Insere as entidades em ordem de referências, sem regenerar UUIDs e sem upsert por tabela. Campos desconhecidos, proprietário divergente e inteiros fracionários são recusados; tipos, domínios, unicidades e FKs compostas continuam sendo aplicados.
6. Confere invariantes estruturais adicionais de compras/parcelas/faturas e pares de crédito. As regras financeiras completas continuam no validador de domínio confiável; não foi reescrito um motor financeiro em SQL.
7. Registra revisão do conjunto e versões iniciais dos registros, além do recibo. Tudo está na mesma transação. Uma exceção propaga e desfaz finanças, head, versões e recibo.

O executor proposto é NOLOGIN/NOINHERIT/NOBYPASSRLS, não é dono das tabelas financeiras e recebe apenas SELECT/INSERT financeiro. RLS/FORCE RLS permanece ativo, com políticas específicas por `auth.uid()`. Ele não recebe UPDATE/DELETE financeiro genérico. A função usa `search_path` vazio, referências qualificadas e nomes de tabela limitados por allowlist. EXECUTE fica revogado de PUBLIC, anon, authenticated e service_role. A suíte concede EXECUTE apenas dentro da transação de teste, desfeita ao final.

**Uma prévia validada no navegador não autoriza importação.** Apenas o futuro serviço confiável poderá inserir a aprovação privada, depois de verificar o JWT no servidor, fixar projeto/usuário de destino e executar `validateImportForApproval` com o domínio atual. A aplicação não tem USAGE no schema privado, INSERT nas aprovações ou associação aos papéis internos. O worker não existe em produção; portanto, a aprovação permanece um bloqueio fechado. Mudanças no domínio exigem revisar/versionar o validador e invalidar aprovações antigas.

As aprovações duram no máximo 15 minutos e guardam hashes/contexto, sem duplicar o payload financeiro. Um retry de uma operação já concluída retorna o recibo mesmo após expirar sua aprovação original. As aprovações fabricadas pela suíte SQL são fixtures administrativas para testar restrições do banco, **não uma prova de segurança da futura integração do worker**.

Fundamentos consultados: [funções e privilégios Supabase](https://supabase.com/docs/guides/database/functions), [locks transacionais PostgreSQL](https://www.postgresql.org/docs/17/explicit-locking.html), [SHA-256 no PostgreSQL](https://www.postgresql.org/docs/17/functions-binarystring.html).

## Reconciliação e concorrência

O manifesto usa `validateBackup`/`assertCreditIntegrity` e os seletores existentes `balancesAt`, `invoiceSummary`, `cardSummary`, `monthlySummary` nos dois regimes e `budgetUsage`. Compara conteúdo completo, contagens, UUIDs, saldos em datas relevantes, parcelas/faturas, dívida/crédito/limite e resultados por mês. `asOf` é fixado na operação para evitar resultados diferentes ao atravessar a meia-noite.

O payload normaliza a representação de UUIDs e instantes sem trocar sua identidade nem alterar o backup/IndexedDB original. IDs legados não UUID são rejeitados para revisão, sem conversão silenciosa. Limites desta preparação: 10 MB, 10 mil registros no conjunto, 512 datas de conferência e 240 competências. Exceder um limite bloqueia a operação inteira; não inicia lotes parciais.

O servidor usa revisão global e metadados de versão por registro. Dois dispositivos com a mesma revisão não podem ambos importar: após um commit, o outro recebe conflito. Não existe “última gravação vence”, escolha pelo relógio do dispositivo ou soma/merge automático de saldos. Exclusões/tombstones têm lugar nos metadados, mas nenhuma operação de exclusão ou incremental é liberada.

Uma desconexão após envio significa **resultado desconhecido**, não falha comprovada. O contrato não permite preparar uma operação nova enquanto a anterior está pendente: conserva o ID e repete/consulta a mesma operação. Respostas com outro ID são descartadas; um recibo de commit apenas leva a “verificação pendente”. Somente a leitura posterior reconciliada pode registrar conclusão. Não há reconciliação automática de conflitos entre dispositivos nesta fase.

## Fluxo futuro de migração

1. Selecionar explicitamente usuário/projeto e o respectivo IndexedDB; a base sem conta não é migrada automaticamente.
2. Bloquear escritas concorrentes no escopo local durante captura/envio/verificação e exportar backup consistente com o repositório atual.
3. Salvar o arquivo local e registrar seu hash; validar estrutura, UUIDs, centavos, referências e integridade financeira.
4. Ler head e todas as entidades remotas. Qualquer dado/revisão preexistente exige resolução explícita; não presumir vazio por não haver contas.
5. Mostrar prévia e manifesto, obter `IMPORTAR PARA A NUVEM` e confirmar novamente o hash dos dados locais. Dados alterados exigem novo backup/prévia.
6. Obter a aprovação do serviço confiável e persistir duravelmente a operação exata antes do envio.
7. Executar uma RPC transacional e conferir recibo/revisão. Em resultado desconhecido, repetir a mesma operação; nunca gerar outro ID para contornar a dúvida.
8. Ler novamente o snapshot remoto e comparar o manifesto pelo domínio existente.
9. Só então registrar conclusão. Preservar backup e IndexedDB, inclusive após sucesso.

As funções puras de prévia/confirmação/conferência estão preparadas. O bloqueio de escritas locais, download/recibo integrado, outbox durável, worker confiável e o orquestrador de transporte ainda precisam ser implementados/revisados antes de qualquer ativação.

Falha antes do commit desfaz a transação remota. Divergência ou falha de leitura **depois** do commit não pode ser chamada de rollback: preservar o conjunto local, congelar a operação como pendência/conflito e investigar o recibo. Correção de um commit requer operação futura explícita, auditada e validada contra revisões; não foi criado um botão de exclusão/reversão remota.

## O que foi efetivamente testado

- Node.js **26.7.0**, TypeScript, lint, **179 testes** (174 anteriores + cinco essenciais) e build. Avisos anteriores do Zod permanecem.
- Os testes novos exercitam hashes/retries exatos; usuário/projeto/espaço local; destino não vazio; backup/confirmação/dados alterados; rejeição de parcelas incompletas, propriedade forjada e manifesto adulterado; reconciliação pelo domínio; ausência de chamadas de rede; estados de desconexão/commit/verificação; UI desativada e fixture SQL sintética validada pelo mesmo domínio.
- Gramática SQL/PLpgSQL dos novos arquivos analisada localmente por `pglast` em pasta ignorada `.local`, sem instalar dependência no projeto. **Isso não executa SQL nem valida privilégios, RLS, atomicidade ou concorrência.**
- Sintaxe PowerShell do executor aprovada. O guard recusou `-TestProjectRef iwzmsbkbuerleocismhj -Suite Sync` **antes de procurar conexão/psql**, sem conexão ao projeto de produção.
- Nenhum ambiente `MONEY_SAVER_TEST_DATABASE_URL` está configurado; psql, Docker e projeto descartável selecionado não estão disponíveis. **A suíte SQL não foi executada. A segurança remota desta RPC não está validada.**

## Executar quando houver Supabase descartável

A autorização desta fase já contempla os testes em ambiente descartável; falta disponibilizar o ambiente/conexão, não uma autorização para produção. A publishable key do aplicativo não é uma credencial de administração e não foi reutilizada para preparar testes no projeto pessoal.

Em projeto descartável vazio, aplicar somente as duas migrações já revisadas. Configurar a conexão de teste em variável de processo segura, com CA/TLS, e psql disponível. Depois:

```powershell
rtk proxy powershell -NoProfile -File scripts/test-supabase-isolation.ps1 -TestProjectRef <ref-descartavel> -Suite Sync
```

O runner confere ref/host/usuário do pooler, rejeita produção, exige TLS `verify-full`, não passa senha em argumentos e restaura o ambiente do processo. A suíte roda o isolamento anterior, instala o candidato dentro de uma transação, testa os dois usuários e termina em rollback, incluindo papéis/políticas/grants de teste. Requer banco descartável fresco, com permissão administrativa para criar os papéis e transferir a propriedade da função. Incompatibilidade de permissões no serviço deve ser resolvida no sandbox, sem substituir por função administrativa que ignore RLS.

### Gate adicional: duas conexões reais

Os testes sequenciais de CAS não substituem concorrência real. Em outra instalação descartável do candidato, com fixtures/aprovações sintéticas autorizadas:

1. Sessão A inicia transação, assume authenticated/A e importa; manter a transação aberta.
2. Sessão B, com o mesmo usuário e operação, tenta importar. Deve esperar a trava e atingir o limite de espera se A continuar aberta, sem efeitos parciais.
3. Após commit de A, repetir B com os mesmos bytes: mesmo recibo e nenhuma duplicação.
4. Repetir com IDs de operação diferentes e revisão zero: apenas um commit; outro recebe conflito de revisão.
5. Repetir com usuários diferentes: conjuntos/recibos distintos e leituras isoladas.
6. Interromper a conexão depois de enviar e consultar/repetir o mesmo ID; conferir exatamente uma operação, mesmas linhas/versões e reconciliação completa.

Esse ensaio ainda não foi executado nem automatizado em duas conexões nesta fase. Ele é gate obrigatório antes de qualquer concessão real de execução ou implantação do worker.

## Pendências e autorizações da próxima etapa

Disponibilizar ambiente descartável e executar SQL, limites, falhas e concorrência real; revisar o papel executor no Supabase gerenciado; implementar e auditar autenticação do worker e emissão de aprovações; concluir outbox/bloqueio local e orquestração; ensaiar reconciliação com crédito, estornos, recorrências, auditoria e falhas pós-commit. Incrementais, conflitos e exclusões precisam de contratos/testes próprios.

Aplicar novos objetos em produção, conceder EXECUTE financeiro, implantar worker, habilitar sincronização ou migrar dados pessoais **não estão autorizados nesta fase**. Nenhuma dessas ações foi realizada. Não houve alteração de Auth, Node, credenciais, migrações existentes, dados pessoais, push ou deploy.
