# Preparação do PanelUI Web

Preparação de ferramentas, sem redesign ou instalação de componentes. Node.js **26.7.0** preservado.

## Disponibilidade

- Skill oficial `panelui-web` **0.11.0**, instalada no projeto em `.agents/skills/panelui-web` pelo comando documentado: `rtk npx --yes skills add panel-ui/PanelUI --skill panelui-web --agent codex --yes`. Origem e hash registrados em `skills-lock.json`. O instalador reconhece Codex e confirma a skill disponível no escopo do projeto; sua descoberta automática acontece no próximo turno/sessão.
- Registro `@panelui` em `components.json`: `https://panelui.dev/r/web/{name}.json`. Preservados estilo `new-york`, RSC desativado, TSX, aliases, Lucide e configuração Tailwind/CSS.
- MCP shadcn configurado exclusivamente em `.codex/config.toml`, com comando Windows `cmd /c npx --yes shadcn@4.23.0 mcp` e timeout inicial de 60 s. Não existia servidor equivalente. A configuração global e os demais servidores permaneceram intactos. `codex mcp list` reconhece o servidor como habilitado.
- `shadcn` **4.23.0** foi adicionado como ferramenta de desenvolvimento pelo inicializador oficial `shadcn mcp init --client codex`. Para Codex, esse comando apenas exibiu as instruções TOML; a configuração foi então concluída no projeto. O lockfile mantém todas as versões anteriores; os novos pacotes são dependências da ferramenta. Nenhuma dependência `panelui-web` ou componente de interface foi instalada.

**Reiniciar o Codex** para carregar o servidor no catálogo de ferramentas da sessão. A conexão já foi validada separadamente por MCP/stdio real, usando o mesmo comando e o diretório deste projeto: handshake, lista de ferramentas e `view_items_in_registries` para os seis componentes solicitados. Não confundir essa verificação com carregamento automático do servidor nesta sessão já aberta.

## Compatibilidade e cuidados para o redesign

React 19, Vite, TypeScript/alias `@`, Tailwind v4 e `components.json` atendem à estrutura documentada. Os arquivos do registro têm destino `@components/panelui/<nome>.tsx`, distinto dos componentes atuais em `src/components/ui`.

Há adaptação visual a revisar antes da adoção: o tema atual usa `--surface`, `--surface-raised`, `--danger` e `--muted` como cor de texto. PanelUI espera também tokens shadcn como `--card`, `--muted-foreground`, `--accent`, `--ring`, `--destructive` e papéis `--success`, `--warning`, `--info`, além dos respectivos aliases Tailwind. A presença de `components.json` não significa que esse mapeamento já esteja completo. Não copiar um tema padrão sobre o CSS existente.

Os seis itens consultados usam `@base-ui/react` e `tailwind-variants`. Os diálogos atuais usam Radix: as APIs não são substituições diretas. Essas dependências e eventuais alterações de estilo deverão ser avaliadas na instalação individual futura; nesta preparação, tokens, estilos dos componentes e regras financeiras foram preservados.

Foi acrescentado somente `@source not '../.agents';` ao início de `src/styles.css`, como configuração de detecção do Tailwind. Sem essa exclusão, os exemplos Markdown da skill geravam CSS extra no aplicativo. Não foram alteradas regras visuais ou valores do design system.

## Plano por tela

| Tela | Aplicação futura |
| --- | --- |
| Dashboard | `Frame` para agrupar dados e `Kpi` para saldos/receitas/despesas com os seletores atuais. Tendência de despesas com sentido favorável de queda. Manter valores estáticos por padrão. |
| Contas | `Frame` para a lista responsiva, `Table` para extrato e `Sheet` para detalhes sem perder o contexto. `Dialog` somente para tarefas curtas. |
| Cartões | `Kpi` para limite/dívida; `Table` para faturas e parcelas; `Sheet` para detalhes. Preservar confirmações e fluxos de compra/pagamento/estorno. |
| Lançamentos | `Table` com cabeçalhos, valores alinhados à direita, filtros e ações acessíveis. `Sheet` para detalhes/edição e `Dialog` para tarefas curtas, reutilizando formulários e validações. |
| Planejamento | `Frame` para recorrências e orçamentos, indicadores de progresso legíveis e `Dialog`/`Sheet` para edição. Cor comunica significado, sem substituir texto. |
| Relatórios | `Frame` para filtros/gráficos existentes, `Kpi` para resumos e `Table` para valores exatos e alternativa acessível. Sparklines não substituem gráficos com eixos ou tabelas. |

`RollingNumber` fica opcional para números que realmente mudam durante a leitura. Usar `pt-BR`, BRL, formatação derivada dos centavos existentes e respeitar `prefers-reduced-motion`; nenhuma animação deve sugerir movimentação financeira inexistente. Preferir texto/KPI estático para saldos e relatórios. Evitar efeitos de inclinação, globos, cenários animados e decoração sem função.

Antes de substituir um componente, verificar teclado, foco inicial/retorno do foco, Escape, rótulos/títulos, erros associados aos campos, contraste, responsividade e prevenção de descarte acidental de formulários. Preservar as confirmações financeiras existentes; não trocar confirmação destrutiva por diálogo genérico.

## Consulta e instalação futura

Consulta somente leitura, já executada com sucesso:

```powershell
rtk npx shadcn view @panelui/kpi @panelui/frame @panelui/table @panelui/dialog @panelui/sheet @panelui/rolling-number
```

No redesign autorizado, instalar somente o item necessário, por exemplo `rtk npx shadcn add @panelui/kpi`, após revisar dependências e alterações de CSS/arquivos. Não executar `init` novamente nem instalar a biblioteca completa por conveniência.

## Verificações desta preparação

- JSON/TOML, skill instalada e lock de origem conferidos.
- MCP real e seis consultas ao registro passaram; evidência de consulta em `.local/panelui-preparation`, ignorada pelo Git.
- TypeScript e build verificados após a inclusão da ferramenta de desenvolvimento.
- O CSS final voltou ao mesmo hash/tamanho anterior (`index-CWrrrp8V.css`, 53,88 kB); os hashes dos bundles JavaScript também coincidem com o build anterior à preparação.
- Sem alterações em Auth, Supabase, IndexedDB, Worker, domínio financeiro ou componentes. CSS recebeu apenas a exclusão da pasta de skills na varredura Tailwind. Sem push/deploy.

Fontes oficiais: [Web](https://panelui.dev/docs/web), [Vite](https://panelui.dev/docs/web/installation/vite), [skill](https://panelui.dev/docs/web/skills), [MCP/registro](https://panelui.dev/docs/web/mcp), [MCP no Codex](https://learn.chatgpt.com/docs/extend/mcp), [exclusão de fontes no Tailwind](https://tailwindcss.com/docs/detecting-classes-in-source-files).
