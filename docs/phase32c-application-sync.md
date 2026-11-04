# Fase 3.2C — integração do aplicativo em homologação

04/11/2026. Node.js **26.7.0** preservado. A integração das telas e dos serviços do aplicativo foi implementada para um **modo local de testes explicitamente ativado**. Produção continua desativada; esta entrega não autoriza implantação ou migração pessoal. A validação por serviços reais foi concluída; a inspeção visual permanece pendente.

## Integração realizada

`createApplicationSyncWorkspace` é a fábrica compartilhada pelo aplicativo principal e pelo ensaio de integração. Ela conserva os repositórios existentes, envolvendo seus comandos com o `SyncClient`/outbox já validado. Não há outro motor financeiro nem um adaptador de finanças simulado.

`App` recebe opcionalmente esse workspace somente na entrada de homologação (`ApplicationTestEntry`). Renderiza o mesmo `Workspace`, telas, formulários, hooks e configurações do Money Saver. `ApplicationFinanceProvider` fornece os repositórios com outbox pelo `FinancialWorkspaceContext`, e o cliente pelo `SyncSettingsContext`. Os comandos das telas normais de contas, lançamentos, cartões, faturas, planejamento e orçamentos passam assim pela transação IndexedDB/outbox. Leituras/aplicações remotas continuam usando transações diretas de réplica, sem gerar eventos de envio.

A entrada normal `src/main.tsx` não fornece esse parâmetro: preserva o `RemoteAccess`, a autenticação funcional, o isolamento atual e o armazenamento local sem sincronização. Login não ativa o mecanismo.

Proteções do modo de teste:

- Exige desenvolvimento, ativação explícita, origem `http://127.0.0.1:<porta>`, projeto exatamente `http://127.0.0.1:54321`, Worker loopback, usuário correspondente à sessão e identificadores válidos de execução/dispositivo. `App` também rejeita o modo no build de produção.
- Usa `money-saver-sync-lab:<usuário>:app-<execução>:<dispositivo>`. Não abre, copia, atualiza ou apaga bancos pessoais v4 ou o banco anônimo.
- O usuário precisa clicar **Ativar sincronização local de testes**. Antes de montar as telas, a fábrica inicializa/verifica a réplica; somente depois o provider inicia envio/recebimento. Se o backend falhar na primeira abertura, não monta um workspace aparentemente conectado. Com réplica já existente, preserva a operação offline e exibe a desconexão.
- Os tokens do ensaio são emitidos pelo Supabase Auth local mediante login real. O Worker os verifica no Auth em cada requisição; o usuário não é inferido do payload. Nenhum segredo administrativo/validador é passado ao frontend. O fluxo de Auth normal não foi modificado.
- Ao interromper/desmontar o cliente, o agendamento e as requisições são cancelados. Uma inicialização assíncrona terminada após desmontagem não inicia envio. Reabrir o mesmo workspace conserva dados, revisão e outbox; uma nova execução do harness usa outro namespace fictício.

## Configurações e experiência

As configurações existentes mostram estado real, pendências, erros, conflitos, última verificação e recibo de gravação do servidor quando o workspace está ativo. A prévia/importação existente foi conservada, com backup, hashes, confirmação e rejeição de destino não vazio. Se houver fonte local não inicializada no namespace de teste, a ativação oferece esse fluxo antes de abrir as telas; não importa automaticamente a fonte.

Restauração genérica de backup e seu seletor de arquivo ficam desabilitados no workspace sincronizado para não invalidar a outbox. Exportação continua disponível. O aplicativo comum mantém a restauração anterior. Avisos de armazenamento distinguem réplica IndexedDB/PostgreSQL local do modo somente navegador. Não foi iniciado redesign nem instalado componente PanelUI.

Erro de conexão sem operações pendentes agora é persistido nos metadados: após recarregar, o status não volta indevidamente para “Sincronizada”. A gravação desse erro respeita a lease da operação, evitando que um processador antigo sobrescreva a confirmação de outro. Uma leitura reconciliada limpa a indicação de conexão.

## Histórico financeiro

Correção de pagamento agora exige um **novo evento de auditoria**, no mesmo conjunto transacional, com o estado anterior e posterior completos e iguais às linhas corrigidas. Evento antigo não pode ser reutilizado. O UUID e a fatura do pagamento são preservados; pagamento estornado continua imutável. O repositório de crédito existente fornece essa auditoria e continua aplicando seus cálculos/validações. Não foi reimplementado o cálculo do pagamento.

Fluxos exercitados pelos mesmos serviços utilizados pelas telas:

- Conta e receita Pix; cartão, compra parcelada e pagamento de fatura.
- Correção auditada de pagamento; estorno parcial e do restante da compra; reversão de pagamento; aplicação explícita de crédito entre faturas, como par transacional.
- Edição concorrente de compra sem histórico; cancelamento sem liquidação. Compras com pagamentos/estornos preservam a proteção do domínio.
- Transferência, ajuste bancário e correção de ajuste; edição/pausa/encerramento de recorrência sem modificar ocorrência já efetivada.
- Orçamento e exclusão propagada por tombstone; exclusão de conta sem vínculos e arquivamento/reabertura de cartão.
- Conflito com dependente bloqueada; resolução explícita preservando backup, operações arquivadas e auditoria. Não há exclusão destrutiva ou “última gravação vence” para resolver conflitos.

## Datas civis e instantes

O calendário financeiro BRL passa a usar explicitamente **America/Sao_Paulo**, por `civilToday`. O dia não é obtido cortando um timestamp UTC nem depende do fuso do processo Worker. Auditoria/criação/atualização continuam sendo instantes ISO UTC. O mês inicial de Dashboard/Planejamento vem desse dia civil, com um objeto de apresentação ao meio-dia local.

`check-financial-timezones.mjs` executa o domínio em quatro processos Node separados: São Paulo, UTC, Nova York e Lisboa. Compara integralmente os planos e ciclos produzidos nos quatro ambientes, usando instantes controlados para:

- Virada de dia/mês de São Paulo às 03:00 UTC.
- Fevereiro de 2023/2024, 29 de fevereiro válido/inválido e vencimento com dia 31.
- Compra antes/no fechamento, parcelas entre meses e dezembro/janeiro.
- Transições de horário de verão de Nova York e histórico de São Paulo em 2018.
- Datas de fatura já salvas, que permanecem iguais mesmo após editar dias do cartão.

Os quatro resultados coincidiram. São testes de domínio em processos reais com `TZ` diferente; não são quatro configurações de fuso do serviço Cloudflare. O Worker real executou o fluxo HTTP/RPC com o mesmo calendário financeiro explícito.

## Testes efetivamente executados

- **204 testes automatizados aprovados**, preservando os 199 anteriores. Cinco casos novos verificam bloqueios do modo, ativação do App sem I/O prematuro, repositórios/outbox sem eco de leituras remotas, estado offline após reabertura e correção auditada sem reutilizar evento antigo.
- **24 grupos de integração/calendário aprovados** no executor local: 18 anteriores, cinco do fluxo completo pelos serviços do aplicativo e um dos quatro processos de fuso. PostgreSQL **17.11**, Supabase Auth/PostgREST reais e **workerd/Wrangler 4.157.0** locais.
- TypeScript, lint, build de produção e build do Worker executados. Avisos conhecidos de anotação do Zod não impedem o build.
- Os **oito grupos da suíte SQL anterior** foram reexecutados e aprovados, validando isolamento, permissões, concorrência, término de conexão e rollback. O cleanup restaurou a base fechada.

O novo fluxo (`test-application-sync-flow.mjs`) usa a fábrica do App e seus repositórios, não `SyncLabPage`. Cria os registros desde um destino vazio de outro usuário fictício, transmite para um segundo cliente, perde uma conexão antes do envio e outra resposta após commit, fecha/reabre o workspace e mantém os mesmos IDs. Executa duas edições concorrentes, bloqueia dependente e resolve com confirmação. Ao final, compara os dois backups com o snapshot PostgreSQL pelo manifesto existente.

Resultado na **revisão 34**: contas com **9.674 e 500 centavos** (total **10.174**); cartão com dívida **700**, crédito **0** e limite disponível **19.300 centavos**. Há **3 compras, 6 parcelas, 6 faturas, 1 pagamento preservado/estornado, 1 transferência, 1 ajuste, 1 recorrência/ocorrência e 6 lançamentos de fatura**. Conteúdo, UUIDs, saldos históricos, faturas, limites e os dois regimes de apuração coincidiram entre clientes e servidor. Nenhum lançamento foi duplicado.

Evidência: `.local/phase32b-validation/report.json`, campos `application` e `timezones`, além dos resultados por grupo. Somente dados fictícios. O harness verifica Docker local/named pipe, projeto/API local e banco financeiro vazio; recusa produção e não carrega `.env.local`. Remove somente suas fixtures/objetos candidatos ao encerrar.

## Reprodução

Com Docker e a stack Supabase local existente iniciados:

```powershell
rtk npm run test:sync:local
rtk npm run lab:sync
```

O segundo comando executa a suíte e imprime **MAIN APP PC** e **MAIN APP PHONE**, em `/app?device=pc` e `/app?device=phone`. Abra os endereços e confirme a ativação em cada cliente. Eles renderizam o App principal, com banco fictício separado e configurações funcionais. O harness fornece um terceiro usuário fictício vazio para a prévia de importação, preservando o laboratório anterior. Ctrl+C encerra e limpa apenas os fixtures SQL da execução; não apaga IndexedDB.

## Pendências e limites

- Inspeção visual/E2E continua pendente pelo bloqueio de navegador registrado anteriormente. Nenhuma nova tentativa de Computer Use foi repetida. SSR/TypeScript e serviços reais não substituem testes de foco, teclado e interação das telas.
- O modo homologado é iniciado pelo harness com tokens de teste e isolamento por execução. A entrada comum permanece somente local. Refresh de sessão e seleção de ambientes para uso conectado cotidiano, testes reais de múltiplas abas/navegadores/dispositivos e revisão completa da UX são etapas anteriores a qualquer liberação de produção.
- Calendário financeiro é São Paulo nesta versão; outros calendários de negócio não são configuráveis. Volume, CPU/memória Workers, rate limiting, retenção/compactação de feed, observabilidade e rotação de secrets ainda exigem revisão operacional.
- Nenhum SQL remoto, credencial de produção, envio pessoal, mudança de Node/dependências, publicação de Worker, push ou deploy. Permanecem os bloqueios do adaptador remoto e do Worker para destinos não locais. A stack foi encerrada após as validações, preservando volumes. Bindings temporários foram removidos; o bundle do aplicativo não contém endpoint de sessão do harness, RPC financeira privilegiada ou secret do validador.
