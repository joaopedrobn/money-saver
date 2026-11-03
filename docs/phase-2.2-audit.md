# Auditoria funcional da Fase 2.2

Execução em 03/11/2026. Escopo: preservar e revisar as Fases 1, 2.1 e 2.2, sem novas funcionalidades de negócio, push ou deploy.

## Resultado e limites da auditoria

A validação automatizada foi aprovada: TypeScript, lint, **135 testes em 9 arquivos** e build de produção. Os **133 testes anteriores, em 8 arquivos, permanecem sem alterações**, conferidos por SHA-256 contra a referência local da revisão anterior. Foi corrigido um erro no filtro de tipos de movimentação. Não foi encontrada inconsistência de saldos, parcelas ou consumo nos cenários executados.

**A auditoria visual desktop/mobile permanece pendente.** O controle do Brave foi interrompido pela própria ferramenta antes da navegação para o aplicativo:

> Computer Use has been stopped for this turn because it could not determine the current browser URL on Windows with enough confidence to enforce policy.

Não houve tentativa de contornar o bloqueio. Não há screenshots de evidência do aplicativo. Não foram verificados pixels, alinhamentos, fontes renderizadas, espaçamentos, overflow real, teclado/foco, toque, console do navegador ou cliques de todas as ações. A renderização React e a revisão de código descritas abaixo não equivalem a testes E2E em navegador.

## Ambiente preservado

| Item | Detectado |
| --- | --- |
| Node | **25.9.0** |
| npm usado pelo helper | **11.12.1** |
| Executável resolvido pelo helper | `C:\nvm\v25.9.0\node.exe` |
| Executável no PATH / servidor | `C:\nodejs\node.exe`, apontando para a instalação 25.9.0 |
| Vite | 7.3.7 |
| Vitest | 5.1.0 |
| Política existente | `engines.node: 25.x`, `.nvmrc: 25` |

Os comandos de validação foram executados via `.tooling.ps1`, incluindo a verificação de runtime dos scripts. Nenhuma versão do Node foi instalada, desinstalada ou selecionada nesta auditoria. `package.json`, `.tooling.ps1`, `.nvmrc` e `package-lock.json` não foram alterados. Os 352 registros de dependências do lockfile coincidem com a referência local anterior.

## Problema reproduzido e corrigido

**Pagamentos de fatura apareciam no filtro “Ajuste”.** A visão bancária representa pagamentos e devoluções como movimentos derivados, com `kind: adjustment` e `paymentId`, para reutilizar a tabela. O filtro verificava somente `kind`, classificando uma liquidação como ajuste de saldo.

O teste de regressão falhou antes da correção: esperava somente o ajuste verdadeiro, mas recebeu também `payment` e `payment-reversal`. Após a correção:

- “Ajuste” mostra somente ajustes de saldo, excluindo movimentos vinculados a pagamentos.
- “Pagamento / estorno de fatura” permite consultar as duas saídas/entradas vinculadas.
- “Despesa” continua restrito ao consumo bancário; pagamentos não viram outra despesa.
- O histórico completo, as chaves dos registros, o saldo progressivo e todos os cálculos continuam preservados.

Arquivos alterados: `src/domain/finance.ts` e `src/features/movements/MovementFilters.tsx`. Não houve migração de banco ou alteração de regra financeira.

## Cenário financeiro integrado

Reprodução do cenário e da regressão do filtro:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .tooling.ps1 test -- src/infrastructure/phase22-audit.test.ts
```

O teste usa os repositórios reais, transações Dexie e `fake-indexeddb`. Cria bases com nomes `phase22-audit-<UUID>` e `phase22-restore-<UUID>` em memória, removidas ao final. Não abre nem limpa o banco pessoal do navegador. Datas financeiras fixas de janeiro a maio de 2026; corte dos cálculos em 03/11/2026.

Configuração:

- Conta A: saldo inicial **R$ 4.000,00**; conta B: **R$ 1.000,00**.
- Cartão A: conta A, limite **R$ 5.000,00**, fechamento dia 10, vencimento dia 20.
- Cartão B: conta B, limite **R$ 2.000,00**, fechamento dia 25, vencimento dia 5 do mês seguinte.
- A: compra de **R$ 3.000,00 em 6 × R$ 500,00**, em 05/01; competências janeiro a junho.
- B: compra no fechamento, em 25/01, de **R$ 100,00 em R$ 33,34 + R$ 33,33 + R$ 33,33**. Competências fevereiro/março/abril, vencimentos 05/03, 05/04 e 05/05.
- Edição de B para **R$ 120,00 em 3 × R$ 40,00**. Continuam existindo duas compras e nove parcelas, sem duplicação.
- Alteração posterior do calendário de B para fechamento 28/vencimento 8: as parcelas e as datas das faturas já existentes permanecem preservadas.

Todos os valores da tabela foram conferidos por asserções no teste:

| Etapa | Saldo A | Saldo B | Conferência adicional |
| --- | ---: | ---: | --- |
| Compras registradas | R$ 4.000,00 | R$ 1.000,00 | Nenhum débito bancário por compra no crédito |
| Pix recebido R$ 200, enviado R$ 50 e transferência A→B de R$ 100 | R$ 4.050,00 | R$ 1.100,00 | Transferência neutra no consolidado |
| Pagamento integral da fatura A de janeiro: R$ 500 | R$ 3.550,00 | R$ 1.100,00 | Fatura zerada; A utilizado/disponível: R$ 2.500 / R$ 2.500 |
| Pagamento parcial B: R$ 15 de uma fatura de R$ 40 | R$ 3.550,00 | R$ 1.085,00 | Residual R$ 25; B utilizado R$ 105, disponível R$ 1.895 |
| Pix enviado corrigido para R$ 60, pagamento B corrigido para R$ 20 e estorno do pagamento A | R$ 4.040,00 | R$ 1.080,00 | Fatura A reabre R$ 500; comprometimento A volta a R$ 3.000 |
| Novo pagamento A de R$ 500 e estorno parcial da compra B de R$ 10 | **R$ 3.540,00** | **R$ 1.080,00** | B residual R$ 10; utilizado **R$ 90**, disponível **R$ 1.910** |

Conferências adicionais executadas:

- Consumo de janeiro antes da correção do Pix: **R$ 3.170,00** por compra ou **R$ 550,00** por competência. Pagamentos e transferência não entram novamente no consumo.
- Após correção do Pix: janeiro **R$ 3.180,00**; estorno de compra reconhecido em março: **−R$ 10,00**, no regime por compra.
- No regime de parcelas, fevereiro reconhece **R$ 530,00**: R$ 500 de A + R$ 40 de B − R$ 10 de estorno alocado na fatura de fevereiro.
- Planejamento de março após o primeiro pagamento parcial: **R$ 525,00** de compromissos (fatura A de R$ 500 + residual B de R$ 25), sem somar parcelas outra vez.
- Pagamento de R$ 25,01 sobre residual de R$ 25 é rejeitado. Edição financeira destrutiva de compra com pagamento é rejeitada. Backup de todas as tabelas, inclusive auditoria, permanece idêntico após as falhas.
- Descrição e observações de compra protegida continuam editáveis.
- Três registros de pagamento e uma devolução derivada resultam em quatro movimentos bancários rastreáveis. Não há uma transação de consumo extra para eles.
- Saldo final consolidado: **R$ 4.620,00**. Último saldo de cada extrato coincide com o saldo derivado da respectiva conta.
- `assertCreditIntegrity` aprova referências, parcelas, somas e histórico.
- Fechar a conexão e abrir a mesma base em nova instância preserva o snapshot e todas as tabelas exportadas.
- Restaurar o backup em outra base isolada produz o mesmo snapshot e passa novamente pela integridade.

Reabertura Dexie em memória foi validada. Recarregar uma página real e persistência em disco no perfil do navegador continuam pendentes de E2E.

## Interface e ações

Foram executadas as funções reais de renderização React, com os dados persistidos do cenário, para nove componentes: dashboard, extrato, lançamentos, cartões, detalhe de fatura, planejamento, configurações, formulário de compra com histórico protegido e formulário de pagamento. Todos renderizaram sem exceção, com conteúdo financeiro esperado. Isso exercita a renderização inicial, não eventos, efeitos, portais de modais ou cálculos de layout do navegador.

| Área | Revisão de código / execução disponível | Limite |
| --- | --- | --- |
| Navegação e layout | Hash de páginas, navegação mobile via Dialog, títulos e links inspecionados | Histórico voltar/avançar, abertura/fechamento e foco não exercitados no navegador |
| Dashboard | Renderizado; consumo, saldos, regime e projeção calculados no cenário | Gráfico, tooltip, ocultação visual e alinhamento não inspecionados |
| Contas e extrato | Repositórios, saldo progressivo, formulários e proteções de exclusão cobertos pela suíte; extrato renderizado | Formulário interativo e exclusão por clique não exercitados |
| Lançamentos | Pix, transferência, edição, filtros e ausência de duplicidade executados; tabela renderizada | Digitação, paginação e seleção real dos filtros não exercitadas |
| Cartões e compras | Múltiplos vínculos, edição, calendários, prévia, cancelamento/estorno e arquivamento cobertos pelos testes; lista/formulário renderizados | Abas, confirmação de prévia e modais não exercitados por clique |
| Faturas e pagamentos | Integral/parcial/correção/devolução, encargos, créditos e atomicidade cobertos pela suíte; detalhe/formulário renderizados | Modal de comprovante e interações não inspecionados visualmente |
| Planejamento | Competência versus vencimento e projeção residual conferidos; tela renderizada | Navegação mensal por clique pendente |
| Configurações | Categorias, backup, restauração e regime cobertos pela suíte; tela renderizada | Seletor de arquivo e download real não exercitados |

A revisão estática encontrou breakpoints, grids com `minmax(0, 1fr)`, rolagem interna nas tabelas, limite de altura dos diálogos e rótulos nos controles. **Não se conclui daí que a responsividade, a tipografia ou a acessibilidade estejam visualmente aprovadas.** A página “Relatórios” continua explicitamente como próxima etapa; os indicadores do dashboard funcionam. Não é uma funcionalidade removida nem parte pendente do motor da Fase 2.2. Recorrências automáticas também continuam fora desse escopo.

## Validações finais

| Validação | Resultado |
| --- | --- |
| `.tooling.ps1 run runtime` | Node 25.9.0 / npm 11.12.1 |
| `.tooling.ps1 run typecheck` | Aprovado, exit 0 |
| `.tooling.ps1 run lint` | Aprovado, exit 0, sem diagnósticos |
| `.tooling.ps1 test` | **135/135**, 9/9 arquivos; 15,60 s |
| `.tooling.ps1 run build` | Aprovado, exit 0; 2.998 módulos; Vite 7.3.7 |
| Vite desenvolvimento `127.0.0.1:5173` | HTTP 200 no HTML, `main.tsx` e nos dois módulos alterados |
| Preview de produção `127.0.0.1:4173` | HTTP 200 no HTML, JS principal, quatro chunks e CSS |
| `npm audit --omit=dev` | Zero vulnerabilidades, exit 0 |
| `npm audit` | 12 alertas moderados de desenvolvimento, exit 1; sem correção forçada |

O build mantém os dois avisos conhecidos de comentários `@__PURE__` de Zod; o Rollup remove as anotações e conclui normalmente. Nenhum erro novo de compilação ou renderização foi observado.

Os alertas de desenvolvimento continuam na árvore `minimatch`/ESLint/TypeScript ESLint. O audit sugere `--force`, inclusive mudança potencialmente incompatível de TypeScript ESLint. Nenhuma atualização, override ou regeneração do lockfile foi aplicada. A ressalva de suporte declarado de Vitest 5.1.0 ao Node 25 permanece documentada em [node25-review.md](node25-review.md): a suíte executa, mas o intervalo `engines` da ferramenta exclui essa versão principal. A configuração escolhida pelo usuário foi preservada.

Evidências reproduzíveis: `src/infrastructure/phase22-audit.test.ts` e os oito arquivos de testes anteriores. A conferência HTTP e de hashes desta máquina foi registrada em `.local/phase22-http-preservation.json` (arquivo local ignorado; não necessário para executar a suíte).

## Pendências reais

1. Executar a inspeção visual desktop/mobile e o cenário por cliques quando o controle do navegador estiver disponível. Validar responsividade, zoom, teclado, foco, modais, mensagens e todas as ações visíveis, inclusive backup/download.
2. Confirmar recarga e persistência em um perfil real isolado de navegador. A cobertura atual usa IndexedDB em memória e reabertura de conexão.
3. Reavaliar as 12 vulnerabilidades de desenvolvimento e o suporte declarado do Vitest quando houver alterações compatíveis nas ferramentas, sem trocar o Node 25 escolhido pelo usuário automaticamente.

Os dados IndexedDB pessoais não foram lidos, modificados ou apagados. Não houve push, deploy ou publicação. A validação funcional automatizada está aprovada; a auditoria visual não está concluída.
