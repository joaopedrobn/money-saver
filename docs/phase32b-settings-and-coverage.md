# Fase 3.2B — configurações funcionais e cobertura financeira

Continuação: [Fase 3.2C — integração do aplicativo em homologação](phase32c-application-sync.md). Este relatório preserva os resultados e limites da etapa anterior.

04/11/2026. Continuação da [infraestrutura local anterior](phase32b-local-sync.md), que já tinha 192 testes. Esta entrega continua limitada à homologação fictícia. A fase não está integralmente liberada: integração de dados pessoais e ativação em produção permanecem pendentes.

## Arquitetura e alterações

O caminho permanece React → IndexedDB/outbox → Worker → RPC PostgreSQL, com leitura incremental de volta ao cliente. A identidade vem de JWT validado pelo Supabase Auth; o payload não escolhe o proprietário. As RPCs candidatas são `ms_import_initial`, `ms_apply_changes`, `ms_changes`, `ms_sync_view` e `ms_approve`. RLS/FORCE RLS, revisão por usuário, advisory lock, aprovação de hash/manifesto, recibos idempotentes, versões e feed/tombstones permanecem ativos apenas durante o harness local. Não há migração nova em produção.

Os repositórios e seletores financeiros existentes continuam sendo utilizados. A regra `purchaseHasHistory` foi extraída do repositório de crédito para uma função pura compartilhada: parcelas de compra com pagamento em qualquer fatura relacionada, ou com lançamento de estorno associado, permanecem protegidas. Não foram reescritos cálculos de saldo, limite, parcelas ou faturas.

O protocolo admite edição de compra sem esse histórico, preservando UUID da compra, substituindo parcelas pelos IDs gerados pelo domínio e emitindo tombstones para as antigas. SQL aplica exclusões dependentes antes das inserções, pois a unicidade de número da parcela é imediata. O conjunto inteiro continua atômico; compras com histórico não são canceladas ou alteradas financeiramente por payload arbitrário. Descrição/observações podem seguir a permissão do domínio sem mudar o histórico financeiro.

Outros ajustes:

- Recibo/hash/reconciliação divergente e feed inválido deixam de ser tratados como desconexão transitória. Operações são preservadas e bloqueadas para revisão. Erro de leitura é persistido nos metadados e impede anunciar sincronização concluída após reabrir o cliente.
- HTTP 401 interrompe o cliente mesmo quando seu callback ainda contém uma identidade em cache. Logout/troca de identidade continuam sem apagar dados ou fila.
- Recibo confirmado conserva `committedAt` do PostgreSQL para exibição da última confirmação do servidor.
- Prévia de migração captura backup consistente, consulta o destino vazio e vincula usuário/projeto/nome real do banco de laboratório. Importação rejeita prévia de outro espaço.

## Seção de configurações

`SettingsPage` usa `SyncSettings`. Sem cliente explicitamente fornecido, mostra **Desativada** e não oferece envio ou importação. Login não cria cliente nem habilita sincronização. O aplicativo mantém os bancos/repositórios locais atuais e o adaptador remoto fechado.

O mesmo componente, quando montado exclusivamente pelo laboratório isolado, oferece:

- Estado, pendências, tentativas e IDs/revisões; última verificação e recibo do servidor.
- Envio e leitura incremental pelo botão **Sincronizar agora**.
- Erros de conexão e erros de integridade distintos; repetição explícita preservando o ID.
- Conflito com confirmação `USAR VERSÃO DO SERVIDOR`, recuperação local e auditoria, sem mesclar pagamentos ou transferências automaticamente.
- Prévia de migração, UUIDs e contagens, saldos, faturas/compromissos, download de backup, confirmação de salvamento e frase `IMPORTAR PARA A NUVEM`. Nesta homologação, a frase autoriza somente o PostgreSQL local. Backup e IndexedDB são preservados.

Não foi instalado componente PanelUI nem alterado o Auth. O CSS novo é restrito aos controles de sincronização, usando os tokens e componentes atuais.

## Laboratório interativo

Com a stack Supabase local existente em execução e sem dados financeiros/candidato preexistentes:

```powershell
rtk npm run lab:sync
```

O comando primeiro executa os testes reais no workerd e só então imprime endereços loopback para PC, celular e importação de outro usuário fictício. PC/celular usam o mesmo proprietário; importação usa o segundo usuário, sem dados remotos. `src/features/settings/SyncLabPage.tsx` não é importado pelo aplicativo e recusa execução fora de desenvolvimento/127.0.0.1.

`scripts/serve-sync-lab.mjs` existe somente no harness: HTML/Vite, proxy de endpoints permitidos para o Worker local e sessão real emitida pelo Auth local para os usuários de teste. O navegador recebe somente o access token do usuário fictício, nunca credencial administrativa, segredo JWT ou token validador. Respostas são `no-store`; a rota de sessão rejeita requisições browser cross-site. A configuração é criada em memória depois das verificações locais, sem carregar `.env.local`.

No cliente de importação, **Carregar dados fictícios** recusa espaços já utilizados; nenhuma base pessoal é aberta. No PC, registrar uma despesa fictícia e sincronizar; no celular, sincronizar para receber. Para queda de conexão, interromper o transporte local pelo botão de teste, criar uma despesa, tentar enviar, recarregar, restaurar a conexão e repetir com o mesmo ID. O erro/conflito bloqueia dependentes até a resolução.

Ctrl+C encerra o harness e remove somente usuários/registros/candidatos SQL criados nesta execução. Bancos IndexedDB do navegador, inclusive os de laboratório, não são apagados; cada execução usa namespace de proprietário/run/dispositivo próprio. A interface principal e o Supabase de produção não são alvos dessas ações.

## Validação e evidências

O relatório efetivo do executor fica em `.local/phase32b-validation/report.json`, com manifesto reconciliado, verificações de privilégios e resultados por grupo. O executor não aceita URL remota, verifica Docker/named pipe/projeto/API loopback/banco vazio, e recusa produção antes de enviar dados. Testes SQL da fase anterior usam socket Unix dentro do contêiner.

Cobertura ampliada: receitas/despesas Pix, contas e categorias relacionadas, transferência/correção, ajustes, cartão/arquivamento, encargos/estornos e edição concorrente de compra sem histórico. Permanecem os casos de autenticação, dois usuários, falha PostgreSQL no meio da importação/rollback, idempotência, aprovação expirada, perda de resposta, reabertura IDB, paginação com gravação entre páginas e reconciliação de dois clientes.

### Resultados finais executados

- **199 testes automatizados aprovados**, preservando os 192 anteriores. Os sete novos casos cobrem recibo divergente, HTTP 401, leitura inconsistente persistida, prévia/backup/origem da migração, proteção/edição de compra e dois estados essenciais de interface.
- **18 grupos reais** da suíte `test:sync:local` aprovados no PostgreSQL **17.11**, Supabase Auth/PostgREST locais e **workerd** com Wrangler **4.157.0**. Incluem a concorrência real sobre a mesma compra sem histórico, substituição atômica de parcelas/tombstones e rejeição de cancelamento de compra com pagamento. Somente um commit vence a revisão; o outro cliente preserva o conflito e o resolve explicitamente com auditoria.
- **8 grupos SQL reais** da suíte `test-supabase-local.mjs` reexecutados e aprovados: RLS/CRUD/referências entre proprietários, importação/idempotência/CAS, concorrência em conexões distintas, término real de conexão com rollback e reconciliação. As instalações candidatas e fixtures foram removidas ao final de ambas as suítes.
- TypeScript, lint, build de produção e build separado do Worker aprovados em Node.js **26.7.0**. Permanecem somente os avisos anteriores de anotação do Zod no build.
- O laboratório interativo foi iniciado com usuários reais de teste, proxy local e prazo automático de encerramento. A conferência visual **não foi executada**, pelo bloqueio descrito abaixo; não é contabilizada como teste aprovado.

Reconciliação final dos dois clientes com o PostgreSQL: **2 contas** com saldos de **10.380 e 1.200 centavos** (total **11.580 centavos**); **2 cartões** com dívidas de **1.400 e 700 centavos**; **3 compras, 7 parcelas, 6 faturas, 2 registros de pagamento, 1 transferência, 1 ajuste, 1 recorrência/ocorrência e 2 lançamentos de encargo/estorno**. Manifestos de conteúdo/UUIDs, saldos por data, faturas, limites, categorias e totais dos dois regimes coincidiram. Nenhum pagamento foi duplicado após a perda de resposta e reabertura IDB.

Problemas identificados/corrigidos nesta execução: falhas de integridade eram tratadas como desconexão e repetidas; HTTP 401 não interrompia necessariamente um callback com identidade em cache; leitura remota divergente não tinha bloqueio persistente; prévia não vinculava o nome real do banco de laboratório; a regra de proteção de compra precisava ser reutilizada na fronteira do Worker; parcelas substituídas precisavam ser apagadas logicamente/registradas antes das novas inserções para respeitar unicidade imediata. Os testes correspondentes passaram.

## Pendências explícitas

- A validação visual foi interrompida pelo mecanismo de segurança do Computer Use, que não conseguiu determinar a URL atual do navegador Windows com confiança. Nenhuma navegação/interação de tela foi concluída. Não há alegação de teste E2E da interface no navegador; cobertura de estado/serviços e testes HTTP/SQL não substituem essa conferência visual.
- O aplicativo normal permanece fechado para sincronização. Falta integrar o ciclo de sessão e os controles a um ambiente homologado de uso diário, com confirmação de migração pessoal futura.
- Correção financeira de pagamentos históricos continua bloqueada pelo candidato. Créditos entre faturas e combinações históricas mais amplas precisam de cobertura ponta a ponta e transições explícitas. Não fazer merge automático para contornar um bloqueio.
- Fusos/viradas de data, navegadores/abas/dispositivos reais, limites de volume, retenção do feed/recibos, rate limit/CORS e operação/rotação de secrets Cloudflare ainda precisam de validação antes de produção.
- Não foi publicado Worker, aplicado SQL remoto, atualizado Node ou dependência, feito push/deploy ou enviado dado pessoal. As limitações de portas Docker/coletor locais permanecem as já documentadas. A stack foi parada após os testes, com volumes preservados e nenhum contêiner Money Saver em execução. Bindings privilegiados temporários foram removidos e não aparecem no bundle do aplicativo.
