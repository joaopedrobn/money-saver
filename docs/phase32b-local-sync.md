# Fase 3.2B — sincronização em laboratório local

Continuação desta entrega: [configurações funcionais e cobertura financeira](phase32b-settings-and-coverage.md). O texto abaixo preserva o relatório original com 192 testes e 16 grupos; resultados e pendências atuais constam no complemento.

Validação em 04/11/2026. Produção permanece desativada. Nenhum SQL remoto, publicação Cloudflare, push ou importação pessoal foi executado. Node.js permanece **26.7.0**.

## Componentes

- `src/worker/index.ts`: handler Web Fetch executado no **workerd real**, por HTTP. Identidade obtida no Auth local (`/auth/v1/user`), JWT e e-mail confirmado obrigatórios, envelopes estritos, limites de bytes e erros sem dados/tokens. Não confia em proprietário/destino do cliente. Respostas sem cache; redirecionamentos não são seguidos.
- JWT do usuário nas RPCs financeiras, com `auth.uid()` e RLS. Um JWT **exclusivo do papel validador** aprova o hash/revisão/manifesto verificados pelo domínio. O Worker não recebe `service_role`, senha de banco ou segredo de assinatura. O harness usa a credencial administrativa **local** somente para criar usuários fictícios e o segredo JWT **local** somente para emitir a credencial temporária mínima.
- `supabase/phase32b/prepare.sql`: candidato fora das migrações. Instala `ms_approve`, `ms_sync_view`, `ms_changes` e `ms_apply_changes`, aproveitando `ms_import_initial`. Trava por proprietário, revisão esperada, recibo por UUID/hash, validação vinculada aos bytes, conjunto financeiro em transação única. UUID apagado não pode ser reutilizado. Escrita genérica de `authenticated` continua proibida.
- As cinco RPCs privilegiadas têm proprietário específico NOLOGIN/NOBYPASSRLS, `search_path` vazio e `row_security=on`. Aprovação não é executável por `authenticated`, `anon` ou `service_role`. O validador não tem acesso financeiro genérico; renovação de aprovação só altera prazo, para conteúdo/revisão/manifesto/versão idênticos. O contexto de proprietário da aprovação é local à transação.
- `incremental.ts`: diferenças por registro nas 16 entidades, UUIDs, propriedade, centavos, referências e integridade financeira pelo domínio existente. Nenhum segundo cálculo de saldo/fatura. Histórico de pagamentos/parcelas/lançamentos de fatura é protegido contra substituição arbitrária; estorno explícito de pagamento é permitido.
- Feed imutável com linha ou tombstone por revisão/entidade/UUID. Leitura fixa limite superior; cursor usa revisão/entidade em collation C/UUID. Gravações entre páginas aparecem na próxima rodada. O cliente acumula e valida todas as páginas antes de aplicá-las em uma transação IDB.
- `outbox.ts`: bancos optativos `money-saver-sync-lab:*`, separados dos bancos atuais. Adaptadores envolvem as mutações dos repositórios existentes numa transação IDB com a fila; `mutate()` agrupa vários comandos. Conserva UUID, proprietário, tipo, payload, revisão, criação, estado, chave idempotente, manifesto, sequência, tentativas, lease e próximo envio. Não persiste tokens.
- Lease transacional entre processadores, timeout HTTP de 20 s, lease de 60 s e backoff de até 30 s. `start()` processa/puxa periodicamente e é optativo; `stop()` cancela requisições e agendamento. Identidade vem do observador Auth existente por callback, sem outra lógica de sessão. Troca de identidade bloqueia envio e leitura do dataset de outro proprietário. Confirmação exige recibo, leitura autoritativa e reconciliação.
- Conflito preserva a operação e bloqueia suas dependentes. `resolveUsingServer('USAR VERSÃO DO SERVIDOR')` preserva backup e operações rejeitadas, instala a versão autoritativa e enfileira auditoria com IDs/revisão. Não reaplica pagamentos automaticamente nem escolhe por horário. Escolha da versão local requer revisão manual e novas operações financeiras explícitas.
- Importação inicial reutiliza prévia, manifesto, destino vazio e confirmação da Fase 3.2A. O teste salva backup sintético em arquivo, confere seu hash, importa pela outbox e verifica os totais. Exportação contém somente as 16 tabelas financeiras; restauração genérica em banco com outbox é bloqueada para preservar a fila. Backup normal do aplicativo permanece disponível.
- `SyncStatus` aceita desativada/local/sincronizando/verificada/offline/pendente/conflito/erro, contagem e última conclusão. O aplicativo continua **desativado**, com os repositórios e bancos atuais. O cliente de laboratório não é montado no React nem importa automaticamente qualquer IDB existente.

## Testes reais

`rtk npm run test:sync:local`: Docker Desktop local, PostgreSQL **17.11**, Auth/PostgREST locais, Wrangler **4.157.0** e workerd. Não carrega `.env.local`; verifica contexto Docker/named pipe, rótulo do contêiner, projeto CLI, URL exata `http://127.0.0.1:54321` e banco financeiro vazio. Não aceita URL de conexão remota. Dois usuários `example.invalid` e duas instâncias Dexie com **fake-indexeddb** simulam navegadores. Auth, JWT, HTTP, runtime Worker, RLS e transações PostgreSQL são reais.

Os 16 grupos passaram:

| Validação | Resultado |
| --- | --- |
| Alvo local vazio e credenciais independentes | Passou |
| Instalação candidata e inspeção efetiva de grants/owners/search_path/RLS/papéis | Passou |
| Runtime workerd real e HTTP loopback | Passou |
| Login/JWT real; ausência/JWT inválido/alvo de produção rejeitados | Passou |
| Falha PostgreSQL após inserir parcelas; rollback financeiro/feed/revisão/recibo; renovação de aprovação expirada e repetição do mesmo ID | Passou |
| Backup salvo, prévia, confirmação e importação reconciliada | Passou |
| Resposta perdida após commit; IDB reaberto; mesmo pagamento repetido sem duplicação | Passou |
| Duas escritas HTTP concorrentes; um vencedor, um conflito; resolução explícita auditada | Passou |
| Compra/parcelas/faturas, orçamento/tombstone e rejeição de UUID apagado | Passou |
| Adaptadores, edição de despesa, estorno explícito e efetivação de recorrência | Passou |
| 210 eventos paginados, gravação entre páginas recebida no próximo cursor | Passou |
| Dois usuários, leitura isolada, proprietário/referência inválidos sem alteração parcial | Passou |
| Logout/troca de conta bloqueiam envio e preservam operações | Passou |
| Agendador optativo envia e outro cliente recebe automaticamente | Passou |
| Dois clientes e PostgreSQL reconciliados pelo domínio | Passou |
| Cleanup das fixtures/RPCs/papéis e base fechada restaurada | Passou |

Reconciliação final: **1 conta, 2 compras, 5 parcelas, 4 faturas, 2 registros de pagamento (um estornado), 1 recorrência/ocorrência**. Saldo **8.930 centavos**, dívida do cartão **1.400 centavos**, limite disponível **98.600 centavos**, iguais nos dois clientes e servidor. Conteúdo, UUIDs, saldos históricos, regimes mensais, categorias, auditoria e totais também foram comparados.

Evidências: `.local/phase32b-validation/report.json`, com manifesto e inspeção dos privilégios, e `initial-backup.synthetic.json`, somente fixtures, ignorados pelo Git. Bindings temporários locais são removidos ao encerrar. Candidatos e usuários fictícios são removidos transacionalmente; não há reset ou exclusão de dados existentes.

Reexecutado também `rtk node scripts/test-supabase-local.mjs`: oito grupos da Fase 3.2A.1 passaram, incluindo RLS/CRUD entre usuários, referências cruzadas, atomicidade, idempotência, revisão, sessões concorrentes, encerramento real de conexão, rollback e reconciliação.

Os **179 testes anteriores foram preservados**. Treze testes novos cobrem adaptadores, atomicidade local/fila, persistência/backoff, lease, logout durante resposta, propriedade em leitura, backup, histórico, normalização UTC e estados/gate. Total: **192 testes**. TypeScript, lint, testes, build Vite e build separado do Worker foram executados.

## Correções encontradas

1. `redirect: 'error'` é rejeitado por workerd. Corrigido para `manual`, sem seguir redirecionamentos.
2. UTC PostgreSQL (`+00:00`) versus IDB (`.000Z`) provocava falsa divergência na edição. Corrigido usando normalização já existente no mapeamento, incluindo colunas nulas.
3. Aprovação vencida impedia recuperação após interrupção longa. Renovação agora só aceita conteúdo/proprietário/revisão/manifesto/versão idênticos.
4. Backup genérico incluía tabelas novas de controle. Corrigido com allowlist financeira; restauração no laboratório não pode invalidar a fila.
5. Wrangler no Windows falhou ao resolver tsconfig com caminhos absolutos/acentos. Vite já instalado gera módulo ES sem env files e workerd executa com `--no-bundle`. Não foram adicionadas dependências; Wrangler temporário é fixado via npx.

## Limites e pendências para produção

- **Não é liberação de sincronização em produção.** Worker/transporte recusam destinos não locais; `SYNC_ENABLED=false`, adaptador financeiro remoto fechado e SQL fora de `supabase/migrations`.
- O candidato bloqueia correção de valor/data de pagamento registrado, alterações financeiras de compras existentes e substituição de parcelas. O aplicativo local conserva esses recursos; integração exige transições explícitas adicionais. Encargos, crédito entre faturas, transferências, ajustes e outras combinações não têm cobertura ponta a ponta nesta suíte.
- Resolução disponível no cliente de laboratório: escolha explícita do servidor com recuperação e auditoria. Interface React de comparação/resolução, UX da migração e integração do ciclo de sessão/online ficam para etapa posterior. Não há botão de migração pessoal/ativação.
- Validar múltiplas abas/navegadores/dispositivos reais, limites de histórico/payload, desempenho e viradas de data em São Paulo. `today()` ainda depende do runtime; o teste em 04/11/2026 não valida fronteiras de fuso.
- Provisionar/revisar credencial mínima com rotação/revogação em secrets Cloudflare; limites de frequência/CPU/memória, CORS/same-origin, observabilidade sem dados pessoais e configuração de homologação independente. Nenhuma conta Cloudflare foi acessada ou Worker publicado.
- Definir retenção/compactação de recibos/feed/tombstones sem perder clientes offline, recuperação de backup sincronizado e contrato de versões.
- Stack local mantém limitações da Fase 3.2A.1: portas Docker além do loopback e coletor vector. O harness usa somente loopback/socket e não habilita Docker TCP sem TLS. A stack foi parada após os testes, com volumes preservados e nenhum contêiner Money Saver em execução.

## Reprodução

Com Docker ativo e a configuração Supabase local existente iniciada pelo CLI, sem `init` ou reset:

```powershell
rtk npm run test:sync:local
rtk npm run typecheck
rtk npm run lint
rtk npm test
rtk npm run build
rtk npm run build:worker
```

O primeiro comando recusa banco financeiro não vazio/candidato preexistente; não apaga esses dados para executar. Falha de cleanup exige inspeção local, sem reset automático. `worker/wrangler.jsonc` contém estrutura local sem secrets. O harness usa configuração/bindings efêmeros em `.local`.

Referências oficiais usadas: [identidade verificada pelo Auth](https://supabase.com/docs/reference/javascript/auth-getuser), [Fetch no runtime Workers](https://developers.cloudflare.com/workers/runtime-apis/fetch/).
