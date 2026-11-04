# Money Saver

Uso em outro computador, sem Docker: [guia do PC de casa](docs/home-setup.md). Estado e aprovações da infraestrutura remota: [plano de publicação](docs/remote-release-plan.md). Sincronização de produção permanece desativada até revisão e teste remoto autorizados.

Aplicativo de gestão financeira pessoal com interface em português, tema escuro e persistência local. A fase **2.2** acrescenta cartões de crédito, compras, parcelas, faturas, pagamentos, estornos, créditos e projeção de caixa ao motor bancário da fase 2.1. A arquitetura e os cadastros anteriores foram preservados. A fase **3.1** prepara Supabase e autenticação opcional, mantendo todos os dados financeiros locais. Não há sincronização bancária, migração automática ou dados financeiros de demonstração.

## Fase 2.2 — cartões e faturas

1. Cadastre suas contas e abra **Cartões → Novo cartão**. Informe instituição, nome, apelido, limite, dias de fechamento/vencimento e conta sugerida. Bandeira e quatro últimos dígitos são opcionais. Não existem campos para número completo, CVV, senha ou credenciais.
2. Use **Novo lançamento → Cartão de crédito** ou **Cartões → Nova compra**. Informe valor original, acréscimo total em reais, data, categoria e número de parcelas. Clique em **Revisar parcelas** e confira competências, fechamentos, vencimentos e valores antes de **Confirmar compra**. A confirmação verifica a mesma prévia dentro da transação; se outra aba alterar o calendário, exige nova revisão.
3. Abra o cartão e consulte **Faturas**, **Compras**, **Parcelamentos**, **Pagamentos** e **Evolução do limite**. O filtro de parcelamentos permite incluir os concluídos/estornados; parcelas históricas não são apagadas.
4. Em uma fatura, use **Registrar pagamento**, escolha qualquer conta cadastrada e a data real, revise e confirme. Pagamentos integrais, parciais e adicionais atualizam a conta e liberam crédito na mesma operação atômica.
5. Consulte o **comprovante interno** em Pagamentos. Ele é um registro local do aplicativo, não um comprovante emitido por um banco. É possível corrigir o pagamento ou registrar seu estorno datado.

Cartões arquivados não aceitam novas compras, mas preservam dívidas, faturas, pagamentos e consultas. É possível reativá-los. Instituições diferentes podem compartilhar a mesma conta sugerida; o vínculo nunca executa pagamentos automáticos. Trocar a conta sugerida não muda a origem dos pagamentos antigos. Contas com vínculos históricos continuam protegidas contra exclusão.

### Calendário e parcelamento

- **Competência é o mês do fechamento**, não necessariamente o mês da compra ou do vencimento. O período é `[início, fechamento)`: compras no dia do fechamento entram na fatura seguinte. A fatura passa a fechada nesse dia.
- Dias 29–31 inexistentes são ajustados para o último dia do mês, incluindo fevereiro bissexto. O vencimento fica no mesmo mês somente se sua data efetiva for posterior ao fechamento; caso contrário, passa ao mês seguinte. Dias iguais também usam o mês seguinte.
- Exemplo: fechamento dia 31 e vencimento dia 5 geram fechamento em **28/02/2026** e vencimento em **05/03/2026**. Compra em 28/02 entra no próximo ciclo.
- Faturas armazenam suas próprias datas e a política de calendário utilizada. Alterar o cartão não recalcula faturas existentes, inclusive futuras já projetadas. Ciclos novos respeitam os limites dos ciclos adjacentes já registrados, evitando lacunas/sobreposições ao preencher histórico antigo.
- Financiado = valor original + acréscimo monetário informado. São permitidas 1–360 parcelas, cada uma de pelo menos um centavo. Não há cálculo percentual, juros compostos, rotativo, multa ou encargos automáticos.
- O motor divide **centavos inteiros**, com sobras nas primeiras parcelas. R$ 100 / 3 gera R$ 33,34 + R$ 33,33 + R$ 33,33. Principal e acréscimo também permanecem conciliados exatamente com os totais originais.
- Editar uma compra sem liquidações pode mudar valor, quantidade, categoria ou cartão em uma transação: mantém o ID da compra e substitui sua alocação sem duplicar parcelas. Faturas vazias são preservadas como contexto histórico.

### Contabilidade, pagamento e limite

- A compra compromete **todo o valor financiado**, mas não debita a conta bancária. O pagamento é a única saída bancária da liquidação da fatura e não vira outra despesa de consumo.
- Total original, juros financiados, encargos explícitos, ajustes, pagamentos, dívida residual e crédito são calculados dos registros. Não há outro saldo mutável de limite ou fatura.
- Fechamento e pagamento são estados separados. O estado exibido pode ser aberta, fechada, parcialmente paga, paga/sem saldo ou vencida. Uma fatura fica vencida quando há dívida **após** o dia do vencimento. Fatura com crédito tem dívida residual zero e crédito exibido separadamente.
- Pagamento antecipado é permitido até o saldo da dívida registrada na data informada. Excesso é rejeitado. Regras históricas também impedem uma inserção/correção retroativa de tornar um pagamento posterior excessivo.
- Corrigir pagamento altera conta, valor, data e observações do registro, mantendo ID e auditoria dos valores anteriores. Não pode trocar a fatura. Depois de estornado, o pagamento não pode ser corrigido/reestornado.
- Estornar pagamento preserva a saída original e registra a devolução à mesma conta na data efetiva do estorno. A fatura reabre e o limite volta a ficar comprometido a partir dessa data. Essa devolução não é receita de consumo.
- Limite utilizado é a dívida líquida dos ciclos do cartão, descontados pagamentos e créditos; fica no mínimo zero. Disponível = contratado − utilizado. Crédito excedente permanece identificado e não aumenta artificialmente o limite contratado. Compras acima do limite são permitidas com aviso.
- A evolução mostra o comprometimento ao final de cada dia com eventos reais; o disponível usa o limite contratado **atual** como referência. Alterações do limite contratado são preservadas na auditoria.

### Cancelamento, estornos e ajustes

- **Cancelar registro** é para compra lançada por engano, sem histórico de liquidação/estorno: retira o registro do consumo e dos compromissos, mantendo compra, parcelas e motivo na auditoria. Não representa uma devolução comercial real.
- A proteção é conservadora: se qualquer fatura da compra possui histórico de pagamento (mesmo posteriormente estornado), ou a compra possui estorno, seus campos financeiros não podem ser recriados. Descrição/observações continuam editáveis sem trocar IDs/datas das parcelas. Para devolver valores, use **Estornar compra**.
- Estorno de compra pode ser total ou parcial, até o total financiado ainda não estornado. Reduz primeiro as parcelas da compra em faturas ainda com saldo; parcelas e pagamentos originais permanecem intactos. O excedente vira crédito no ciclo correspondente à data do estorno, sem entrada bancária automática.
- Crédito na mesma fatura compensa seus novos débitos naturalmente. Para outra fatura do mesmo cartão, use **Aplicar crédito**: são criados dois ajustes vinculados e atômicos, sem movimentar banco nem consumo. Não há aplicação implícita entre cartões ou saque automático de crédito.
- Encargos são lançamentos explícitos com categoria. Uma cobrança incorreta pode ser **estornada** integralmente e, se necessário, registrada novamente com o valor correto. O original e sua compensação datada permanecem no histórico.

### Consumo e planejamento

O dashboard permite escolher e persistir a apuração do crédito:

- **Compra:** total financiado na data da compra; encargos/estornos nas suas datas efetivas.
- **Parcelas:** valores na competência de fechamento de cada fatura; encargos/estornos na competência das respectivas faturas. Assim, estornar parcelas futuras também compensa seu consumo futuro. Consumo líquido pode ser negativo quando devoluções superam compras naquele período.

Despesas bancárias continuam reconhecidas na efetivação. Pagamentos de cartão, suas devoluções, transferências próprias e aplicações de crédito nunca entram novamente no consumo. Relatórios de consumo são separados da previsão de desembolso.

O planejamento navega entre meses e mostra receitas previstas, despesas bancárias pendentes, faturas residuais e seu detalhamento de parcelas. **Parcela não é somada outra vez à fatura.** A projeção parte do banco atual, soma previsões e subtrai apenas pendências até o fim do mês, inclusive vencidas. Valores já pagos não são subtraídos de novo. Créditos de fatura só abatem outra fatura após aplicação explícita; não são tratados como dinheiro bancário. Para meses passados, o histórico segue consultável, mas não se projeta o saldo de hoje para trás.

### Persistência e backup

O IndexedDB evolui para **v3**, mantendo nome, dados e versões anteriores. Acrescenta `invoiceEntries`, campos opcionais compatíveis com entidades legadas e índices únicos de cartão/competência e compra/número da parcela. A migração não gera compras, dívidas ou débitos bancários.

O envelope JSON permanece **v2**, com `schemaVersion: 3` e a nova tabela de ajustes. A versão atual importa backups antigos v1/v2 sem a tabela nova, assumindo-a vazia. Backups novos exigem o aplicativo atualizado. A prévia inclui cartões, compras, parcelas, faturas e pagamentos. Além da validação estrutural, são verificados vínculos, competências únicas, parcelas consecutivas, soma de principal/acréscimo, pagamentos, limites de estorno e pares de transferência de crédito. A restauração continua integral, atômica e condicionada à confirmação explícita; não há mesclagem silenciosa.

## Fase 2.1 — uso e comportamento

- **Lançamentos:** criar, consultar detalhes, editar, excluir com confirmação e pesquisar descrição/observações. Há atalho de lançamento rápido no dashboard após cadastrar a primeira conta. Filtros de período, conta, categoria, tipo e status. A lista começa com 50 registros e permite carregar mais.
- **Operações:** receita, despesa, Pix recebido/enviado, transferência e ajuste positivo/negativo. Valores são positivos no formulário; o tipo define o sinal. Transferências exigem contas diferentes e são um único registro, sem lançamentos artificiais de receita/despesa.
- **Efetivação:** previstos, pendentes e cancelados não alteram saldo. Marcar como pago/recebido exige data real até hoje. Vencimento e efetivação são distintos: um compromisso futuro pode ser pago antecipadamente. Não são aceitas operações ou efetivações anteriores à abertura das contas envolvidas.
- **Saldos:** derivados do saldo inicial e histórico; nenhum saldo derivado é gravado. Edições, cancelamentos e exclusões recalculam as contas. Saldo negativo é permitido e gera aviso. Ajustes alteram o saldo sem mudar o saldo inicial nem os indicadores de consumo.
- **Contas → Ver extrato:** instituição, saldo inicial/atual, entradas/saídas filtradas, meses anteriores e saldo progressivo. Ordem por data efetiva (ou vencimento para não realizados), instante de criação e UUID. O saldo progressivo é calculado com todo o histórico antes da filtragem, preservando o contexto.
- **Dashboard:** saldo consolidado atual; receitas, despesas e resultado líquido do mês escolhido; despesas por categoria; evolução diária real até hoje; últimas movimentações e próximos compromissos. Transferências e ajustes ficam fora das receitas/despesas de consumo. Categorias arquivadas permanecem nos indicadores históricos.
- **Planejamento:** compromissos previstos e pendentes, incluindo vencidos, com registro da data de pagamento/recebimento. Não há recorrências automáticas nem projeções artificiais.
- **Configurações → Categorias:** 10 categorias iniciais de despesa e 5 de receita, com edição de nome, cor e ícone, criação, arquivamento e reativação. O grupo não muda após criação. Arquivar preserva vínculos e histórico; categorias arquivadas não são aceitas em novos lançamentos. Não há exclusão física de categorias.
- **Configurações → Backup:** exportação JSON v2, leitura de formatos v1/v2, validação estrutural e referencial e prévia com quantidades e saldo. A restauração substitui **todas** as tabelas em uma transação; exige reconhecimento de cópia dos dados atuais e a palavra `RESTAURAR`. Falhas revertem a restauração inteira. Importação de arquivo limitada a 10 MB; não há mesclagem silenciosa.

Os repositórios verificam contas, categorias, datas, status e centavos antes de gravar. Operações financeiras e auditoria usam a mesma transação IndexedDB. O snapshot que abastece a interface também é lido em uma transação consistente.

## Executar localmente

Ambiente escolhido para este projeto: **Node.js 26.x**, com npm. A migração foi validada com **Node 26.7.0 e npm 11.19.0**. `engines.node` e `.nvmrc` indicam a versão principal 26, incluindo 26.7.0, sem fixar um patch desnecessariamente. Os scripts verificam o Node efetivamente utilizado antes de instalar, iniciar, compilar ou testar.

O Vitest 5.1.0 travado no lockfile declara `^22.12.0 || ^24.0.0 || >=26.0.0`, incluindo Node 26.7.0. O [relatório histórico da revisão Node 25](docs/node25-review.md) foi preservado com os resultados e a ressalva de compatibilidade daquele ambiente.

Utilize sempre a mesma origem/porta: o IndexedDB é separado por protocolo, host, porta e perfil do navegador.

```sh
npm ci
npm run runtime
npm run dev
```

Acesse o endereço mostrado no terminal, normalmente **http://127.0.0.1:5173/**. O servidor escuta somente na interface local.

O helper Windows usa Node 26 do PATH ou uma instalação 26 já existente em `NVM_HOME`. Executa o npm da **mesma instalação** e ajusta o PATH apenas para o processo e seus filhos. Não usa mais o Node portátil 22, não baixa executáveis, não troca a seleção global do NVM e preserva os argumentos dos comandos. Pode ser chamado de outra pasta, pois executa os comandos na raiz do projeto:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .tooling.ps1 run dev
```

Para os demais comandos, substitua `run dev` por `ci`, `run runtime`, `run typecheck`, `run lint`, `test` ou `run build`. `npm run runtime` informa as versões efetivas e os caminhos de Node/npm. A versão de `@types/node` não seleciona o executável Node: ela foi mantida, pois as APIs usadas pelo projeto continuam compilando corretamente.

Nenhuma dependência foi atualizada nesta revisão. O `package-lock.json` foi preservado, alterando apenas o metadado de engine na raiz para acompanhar `package.json`. O `npm ci` reinstalou as versões já travadas; não foi aplicado `audit fix --force` nem override de major.

## Entregue

- React 19, TypeScript estrito, Vite e Tailwind CSS v4 com plugin oficial.
- Componentes locais no padrão shadcn/ui, configuração `components.json`, Radix para modal e confirmação, Lucide e tokens de design reutilizáveis.
- Sidebar desktop, menu modal mobile, navegação por hash com histórico do navegador, foco e fechamento de modais por teclado, link para pular ao conteúdo, redução de movimento e opção para ocultar valores.
- Dashboard sem números fictícios: saldo agregado, indicadores mensais e gráficos alimentados pelo histórico real. O saldo total é sempre **atual**.
- Cadastro de contas corrente, poupança, carteira e investimentos, com nome, instituição, data/saldo inicial e cor.
- Validação compartilhada entre formulário e repositório; saldos negativos são aceitos; entrada monetária no formato `1.234,56`, até R$ 9.999.999.999,99 por saldo inicial.
- Persistência em IndexedDB, atualização reativa entre componentes/abas e erros de armazenamento visíveis.
- Auditoria de criação, edição e exclusão na mesma transação do cadastro. Contas com movimentos ou vínculos não podem ser excluídas; saldo/data inicial não podem ser alterados após movimentos.
- Configurações com informações de privacidade, categorias e exportação/importação validada de todas as tabelas.
- Cartões, compras, parcelas, faturas, pagamentos e estornos estão funcionais. Relatórios incluem análise por período, categoria, conta e cartão, reutilizando o consumo no crédito do dashboard.

## Arquitetura

```text
src/
  domain/
    models.ts           Entidades, datas civis, instantes e valores em centavos
    money.ts            Funções financeiras puras e políticas monetárias
    finance.ts          Snapshot, filtros, extrato e agregações mensais
    credit.ts           Calendário, parcelas, faturas, limites e projeção
    credit-integrity.ts Invariantes financeiras e sequência histórica
    credit-validation.ts    Schemas de cartões, compras e pagamentos
    credit-views.ts     Progresso e histórico de comprometimento
    financial-validation.ts  Validação do motor financeiro
    backup.ts           Schema versionado e integridade do backup
    default-categories.ts    Categorias iniciais com IDs estáveis
    validation.ts       Schema Zod de contas
    repositories.ts     Contratos independentes do banco e da interface
  infrastructure/
    database.ts         Schema Dexie versionado e índices
    repositories.ts     Adaptadores de contas e composição dos repositórios
    movement-repository.ts   Movimentos, categorias e leitura consistente
    backup-repository.ts     Exportação e restauração atômica
    credit-repository.ts     Cartões, compras, liquidação e ajustes atômicos
  features/accounts/
    AccountForm.tsx     Formulário com React Hook Form e Zod
    constants.ts        Tipos e cores apresentados na interface
    AccountStatement.tsx     Extrato com filtros e saldo progressivo
  features/movements/   Formulário, lista, detalhes, filtros e efetivação
  features/categories/  Criação, edição, arquivamento e reativação
  features/dashboard/   Dashboard com indicadores e gráficos reais
  features/backup/      Prévia e confirmação de restauração
  features/settings/    Composição das configurações
  features/cards/       Cartões, faturas, prévias, pagamentos e estornos
  features/planning/    Projeção mensal com banco e faturas
  components/ui/        Button, Dialog e primitivas reutilizáveis
  hooks/                Leitura reativa através dos repositórios
  lib/                  Utilitários de composição de classes
  test/                 IndexedDB em memória para testes
  App.tsx               Composição do layout, páginas e navegação
  styles.css            Design tokens, estilos e breakpoints
  phase2.css            Tabelas, filtros, gráficos e novos módulos responsivos
  credit.css            Componentes e breakpoints da fase 2.2
```

O domínio não importa React nem Dexie. As portas `AccountRepository`, `MovementRepository`, `CategoryRepository`, `CreditRepository`, `SettingsRepository` e `BackupRepository` expõem os módulos implementados. Um adaptador Supabase poderá implementar os mesmos contratos; a assinatura reativa de Dexie em `useFinances` deverá ser substituída por uma estratégia compatível com esse adaptador. Os dados da interface vêm de um snapshot consistente, sem duplicar saldos em um segundo estado compartilhado. Compras, parcelas, faturas e ajustes são criados/alterados junto com a auditoria em uma transação; falhas revertem tudo.

Entidades: `BankAccount`, `CreditCard`, `Transaction`, `CreditCardPurchase`, `Installment`, `CreditCardInvoice`, `InvoicePayment`, `InvoiceEntry`, `RecurringTransaction`, `Category`, `Transfer`, `BalanceAdjustment` e `FinancialSettings`. `Movement` continua uma visão derivada; agora o extrato inclui pagamentos de fatura e suas devoluções, vinculados e somente para consulta. Correções são feitas em Cartões, sem uma transação bancária duplicada. A auditoria inclui snapshots anteriores/posteriores, alocações de compras e identificadores estáveis.

**Migração:** o banco mantém o nome `money-saver` e a versão 1 original. A versão 2 adiciona índices, normaliza datas de efetivação legadas, adiciona o estado de arquivamento e categorias iniciais ausentes. Os cadastros e lançamentos existentes não são apagados. Categorias existentes, inclusive renomeadas, são preservadas. Reabrir o banco não recria as categorias. Alterações futuras deverão adicionar novas versões Dexie.

Recharts alimenta a evolução de saldos no dashboard. Zustand continua desnecessário nesta etapa: o estado transitório é local e os dados persistidos são consultados de forma reativa, inclusive após alterações em outras abas. O corte de data atual é revisto periodicamente para acompanhar a virada do dia.

## Regras financeiras

- Dinheiro é armazenado como **centavos inteiros seguros**. Parsing, formatação, soma e distribuição de centavos ficam centralizados em `domain/money.ts`.
- Datas civis usam `YYYY-MM-DD`, sem conversão implícita para UTC. `createdAt`, `updatedAt` e auditoria são instantes UTC em ISO 8601.
- O saldo inicial é patrimônio inicial, não uma receita. Não há total derivado persistido.
- A função de saldo considera receitas/despesas realizadas, transferências, pagamentos de fatura e ajustes até a data de corte. Pendências não alteram saldo. Compras no crédito não entram nesse cálculo.
- Transferências preservam o patrimônio agregado. O pagamento de fatura debita a conta sem criar outra despesa de consumo.
- A distribuição e a alocação em faturas são funções puras. Centavos restantes vão para as primeiras parcelas, sem cálculo monetário com float.
- Totais e situações de faturas são derivados de parcelas, ajustes, datas e pagamentos, sem duplicação de despesas ou totais mutáveis.

## Verificações

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run preview
```

Vitest usa `fake-indexeddb`, sem dados reais. Os **58 testes anteriores foram preservados**. A fase 2.2 adiciona cobertura de múltiplos cartões/contas, privacidade de campos, compras à vista/parceladas/acréscimos, centavos, fronteiras do fechamento, vencimento posterior, fevereiro/bissextos/dia 31, mudança de calendário e preenchimento de lacunas, edição/cancelamento/estornos, parcelas protegidas, pagamentos integrais/parciais/adicionais/antecipados, outra conta de origem, correção/devolução, patrimônio líquido, consumo sem duplicação, regime persistido, projeção residual, arquivamento, reabertura do banco, migração v2→v3, backup, rollback e concorrência de pagamentos. Inclui testes de integração do fluxo compra → fatura → pagamento → extrato/limite.

Resultado da fase 2.2: **TypeScript, lint, 133 testes e build de produção aprovados**, preservando os 58 testes anteriores. HTML, JavaScript principal e CSS do preview de produção responderam HTTP 200. Há também cobertura de prévia desatualizada, da ordem de pagamento/estorno/novo pagamento com relógio de baixa precisão e de totais fora do intervalo monetário seguro. O Rollup emite dois avisos sobre comentários de anotação da dependência Zod e remove esses comentários no build; não são erros de compilação.

Auditoria funcional de 03/11/2026: **TypeScript, lint, 135 testes e build aprovados com Node 25.9.0/npm 11.12.1**. Os 133 testes anteriores foram preservados integralmente. O cenário integrado adicional confere duas contas/cartões, parcelamentos, Pix, transferência, pagamentos integral/parcial, correção, estornos, consumo sem duplicação, reabertura e restauração em bases isoladas. O filtro “Ajuste” foi corrigido para não incluir pagamentos de fatura; estes possuem a opção “Pagamento / estorno de fatura”. Nove componentes React também foram renderizados com os dados do cenário. O [relatório da auditoria](docs/phase-2.2-audit.md) registra valores esperados, resultados e pendências.

O build gera `dist/`, com bibliotecas separadas para cache. Na auditoria mais recente, a ferramenta interrompeu o controle do Brave por não conseguir determinar a URL atual com segurança; **a inspeção visual e os fluxos completos em navegador desktop/mobile não foram concluídos**. Há breakpoints para filtros, tabelas com rolagem interna, formulários, categorias e extratos; sua revisão visual continua pendente. A persistência após reabrir a conexão está coberta por teste automatizado; recarregar uma página real não foi validado por automação. A renderização React em testes não substitui essa inspeção.

Dependências de produção: `npm audit --omit=dev` retornou **zero vulnerabilidades**. A instalação também reportou **12 alertas moderados** na árvore de ferramentas de lint, originados em `minimatch`; não foi aplicado um override de major potencialmente incompatível. Reavalie com `npm audit` ao atualizar. Não use `npm audit fix --force` sem revisar alterações de compatibilidade.

## Próximas etapas

### Fase 2.3 compacta

Em **Planejamento**, recorrências mensais, semanais e anuais podem ser cadastradas, editadas, pausadas e encerradas. Cada ocorrência exige confirmação de valor e data efetivos. Contas só mudam na efetivação; no cartão a confirmação registra uma compra e o pagamento continua em Faturas. Dias inexistentes usam o último dia do mês; recorrências anuais usam o mês inicial e semanais usam 1=segunda a 7=domingo. Encerramento é definitivo e não apaga o histórico. Alterações afetam somente ocorrências não efetivadas.

Orçamentos são limites por categoria e mês; salvar novamente a mesma categoria atualiza o limite. Utilização segue o regime de consumo do dashboard, incluindo estornos e excluindo pagamentos de fatura. Projeções de 3, 6 e 12 meses partem do saldo atual, incorporam pendências e recorrências a partir de hoje e usam o vencimento das faturas, sem somar parcelas novamente. Pausar/encerrar retira previsões não efetivadas. Os três novos indicadores do dashboard referem-se ao mês atual.

IndexedDB v4 acrescenta ocorrências com chave única por recorrência/data e orçamentos únicos por mês/categoria. A migração preserva as tabelas existentes. Backups com novos dados usam estrutura 4; formatos antigos continuam aceitos. Não há efetivação automática, sincronização bancária ou cobrança real. Sete novos testes cobrem o módulo; os 135 anteriores foram mantidos.

Validação da Fase 2.3: **142 testes aprovados**, TypeScript, lint e build aprovados com Node 25. O teste legado de migração passou a exigir a versão 4, mantendo as asserções de preservação dos dados. Foi executada uma rodada completa; após essa adequação, somente o arquivo afetado foi repetido. Sem novas dependências, auditoria visual, push ou deploy.

1. Validar visualmente os fluxos desktop/mobile e adicionar testes de interface/acessibilidade quando houver ambiente de navegador disponível.
2. Refinar o acompanhamento individual de liquidação de parcelas compartilhando fatura; nesta fase pagamentos liquidam a fatura e o bloqueio de edição financeira é conservador sobre seu histórico inteiro.
3. Avaliar fluxos de renegociação/parcelamento de fatura e retorno de crédito para conta bancária, sempre com operações explícitas e novas regras/testes.
4. Calendário detalhado e eventuais políticas adicionais de recorrência; cadastro, confirmação e projeção de recorrências já funcionam na Fase 2.3.
5. Exportação de relatórios e análises adicionais, se necessárias.
6. Mesclagem/importação incremental de backups, se necessária; a restauração atual substitui o conjunto completo após confirmação.
7. Escritas transacionais Supabase e migração explícita na fase 3.2; Open Finance somente em etapa futura autorizada.

Os dados existem somente no perfil deste navegador e dispositivo. A exportação permite guardá-los; limpar os dados do navegador ou usar outro host/porta/perfil pode removê-los ou fazê-los parecer ausentes. O tema e o idioma são fixos nesta etapa. Nenhum deploy ou push remoto foi realizado.

### Fase 2.4 — relatórios

**Relatórios** reúne receitas realizadas, consumo líquido, resultado, saldos bancários e comparação com o período anterior. Filtros: mês, intervalo personalizado, últimos 3/6/12 meses (até hoje), conta, cartão e categoria. Conta e cartão selecionam origens alternativas de consumo; compras não são atribuídas à conta sugerida do cartão. Saldos usam o histórico bancário completo, filtrado apenas por conta e período.

Os cinco gráficos Recharts incluem tabelas consultáveis, estados vazios e ocultação de valores. A apuração começa com a preferência salva e pode ser alternada nesta página entre compra e competência das parcelas. Estornos reduzem o consumo; pagamentos de fatura, transferências e ajustes não o duplicam. Meses completos comparam com meses anteriores; intervalos parciais comparam com os dias imediatamente anteriores, de igual duração. Períodos com datas futuras mostram somente dados realizados até hoje.

O seletor de consumo é compartilhado com o resumo mensal; valores continuam em centavos inteiros. Sem novas dependências, alterações de schema ou gravações nos dados financeiros. Validação com Node **26.7.0** e npm **11.19.0**: TypeScript, lint, **148 testes** (142 existentes + 6 novos) e build aprovados. Os novos testes cobrem comparação, categorias, parcelas, movimentações bancárias, filtros e estornos. A inspeção visual permanece pendente: a ferramenta retornou `The browser access host is unavailable`.

### Fase 3.1 — Supabase e autenticação

Fundação PostgreSQL com 16 tabelas, UUIDs por proprietário, centavos inteiros, FKs compostas, índices, RLS/FORCE RLS e políticas por usuário em [duas migrações SQL](supabase/migrations). O adaptador remoto compatível está preparado para leitura consistente; escritas remotas permanecem bloqueadas tanto no adaptador quanto nos grants. IndexedDB v4 continua ativo, inclusive após login/logout, sem envio ou migração de dados.

**Configurações → Conta online** prepara cadastro, login, logout, recuperação/nova senha, sessão persistente e painel autenticado. Auth só é habilitado por configuração explícita e completa em `.env.local`, usando [`.env.example`](.env.example); apenas chave publishable, nunca secret/service role. Sem Supabase, o modo local permanece disponível. O [guia da fundação](docs/supabase-foundation.md) documenta a arquitetura, configuração externa, testes SQL e o plano de importação, conflitos, comparação financeira e rollback para a fase 3.2. Nenhum projeto remoto foi criado. A execução SQL/RLS e os fluxos reais de e-mail dependem de ambiente de teste configurado.

Referências de configuração: [Vite](https://vite.dev/guide/), [Tailwind v4 com Vite](https://tailwindcss.com/docs/installation/using-vite) e [shadcn/ui com Vite](https://ui.shadcn.com/docs/installation/vite).

Conexão ao projeto Supabase informado: configuração e vínculo estão em [supabase-connection.md](docs/supabase-connection.md). As duas migrações foram aplicadas com autorização explícita em 04/11/2026; [histórico e verificações de segurança](docs/supabase-application-2026-11-04.md). O `.env.local` fica ignorado pelo Git. IndexedDB permanece ativo; escritas financeiras remotas e migração de dados continuam bloqueadas.

**Fase 3.1.1:** Auth real respondeu com cadastro por e-mail habilitado e confirmação obrigatória. Sessões ganharam verificação com prazo, retentativa, tratamento de expiração e proteção contra respostas atrasadas. TypeScript, lint, **163 testes** e build aprovados; sem novas dependências. URLs de retorno e senha mínima ainda dependem do Dashboard; testes completos com contas e isolamento em ambiente descartável permanecem pendentes, conforme solicitado. [Validação e requisitos da fase 3.2](docs/supabase-auth-validation.md).
