# Revisão do ambiente Node.js 25

Revisão em 03/11/2026. Escopo: padronizar o ambiente escolhido pelo usuário sem alterar a implementação financeira das Fases 1, 2.1 e 2.2.

## Versões detectadas e seleção efetiva

| Contexto                        | Node    | npm     | Executável                                                        |
| ------------------------------- | ------- | ------- | ----------------------------------------------------------------- |
| Terminal no início              | 25.9.0  | 11.12.1 | `C:\nvm\v25.9.0\node.exe`, exposto por `C:\nodejs`                |
| Helper antigo                   | 22.23.4 | 10.9.9  | `%LOCALAPPDATA%\money-saver-tools\node-v22.23.4-win-x64\node.exe` |
| Terminal e helper após correção | 25.9.0  | 11.12.1 | `C:\nvm\v25.9.0\node.exe`                                         |

O `npm run runtime`, chamado diretamente e pelo helper, confirmou o mesmo executável em `process.execPath` e `npm_node_execpath`, e o npm CLI em `C:\nvm\v25.9.0\node_modules\npm\bin\npm-cli.js`. Também foi testada uma chamada do helper a partir de outra pasta, com o Node portátil 22 no início do PATH; o comando continuou usando Node 25.9.0/npm 11.12.1.

Enquanto a instrução anterior ainda estava válida, o Node 24.22.2 foi instalado e selecionado. Após a correção do usuário, nenhuma nova instalação de 24 foi executada. A seleção de 25 pelo NVM ficou aguardando privilégio para recriar o link; a tentativa foi interrompida e `C:\nodejs` foi restaurado como uma **junction para `C:\nvm\v25.9.0`**, sem instalar ou remover versões. O terminal voltou a resolver Node 25.9.0/npm 11.12.1. As versões anteriores permanecem instaladas, inclusive o 24 inativo.

## Alterações aplicadas

- `.tooling.ps1`: removida a preferência pelo portátil 22. Usa um Node 25 existente no PATH ou em `NVM_HOME`, escolhe o npm da mesma instalação, preserva argumentos/código de saída e não altera a seleção global do NVM.
- `package.json`: `engines.node: "25.x"`, diagnóstico `runtime` e verificações de major antes de instalação/dev/preview/testes/lint/typecheck/build. Não há exigência de patch específico.
- `.nvmrc`: contém `25`.
- `package-lock.json`: somente o engine da raiz foi sincronizado. Nenhuma versão, URL, integridade ou relação de dependência foi atualizada.
- README atualizado. Nenhuma configuração Vite, TypeScript ou ESLint precisou ser alterada.

## Compatibilidade das dependências

Foram inspecionados os **352 registros de pacote** do lockfile; **200** declaram `engines.node`. Desses, **199 aceitam Node 25.9.0**. Pacotes sem engine não constituem uma garantia formal de compatibilidade; sua integração foi avaliada por instalação, testes, compilação e inicialização reais.

| Ferramenta travada                        | Resultado no Node 25.9.0                                                   |
| ----------------------------------------- | -------------------------------------------------------------------------- |
| Vite 7.3.7                                | Engine aceita Node 25; build e servidor aprovados                          |
| Plugin React 5.2.0                        | Build aprovado                                                             |
| Tailwind e plugin Vite 4.3.4              | Compilação de estilos aprovada                                             |
| TypeScript 5.9.3                          | Typecheck aprovado                                                         |
| ESLint 10.14.0 / typescript-eslint 8.72.1 | Lint aprovado                                                              |
| Vitest 5.1.0                              | **Engine exclui Node 25**; execução dos 133 testes aprovada neste ambiente |
| @types/node 22.20.5                       | Mantido; não determina o runtime e as APIs atuais compilam                 |

O [manifesto do Vitest 5.1.0](https://github.com/vitest-dev/vitest/blob/v5.1.0/packages/vitest/package.json) declara `^22.12.0 || ^24.0.0 || >=26.0.0`. A consulta ao npm não encontrou release 5.x com declaração diferente. Por isso, `npm ci` emite **um aviso `EBADENGINE`**, mas termina com código 0 e instala as versões travadas. Não foi mascarado o engine, utilizado `--force` ou trocado o major da ferramenta. **Compatibilidade observada nos testes não significa suporte oficial declarado pelo Vitest.**

Não foi identificada falha de execução do Vite, compilador, lint ou suíte financeira sob Node 25. A ressalva formal do Vitest permanece documentada em vez de aplicar uma mudança estrutural não autorizada.

## Alertas de desenvolvimento

O `npm audit` mantém **12 alertas moderados**, propagados na árvore de lint a partir de `minimatch` 10.2.6. Eles não representam 12 falhas independentes no aplicativo. O `npm audit --omit=dev` retornou **zero vulnerabilidades**.

O [advisory do mantenedor](https://github.com/isaacs/minimatch/security/advisories/GHSA-g3hv-75wg-m249) identifica a correção em **11.0.1**. Na consulta realizada:

- `minimatch` 10 termina em 10.2.6, ainda afetado.
- ESLint 10.14.0 exige `^10.2.6`.
- `@eslint/config-array` 0.23.5 exige `^10.2.4`.
- `@typescript-eslint/typescript-estree` 8.72.1 exige `^10.2.2`.

Assim, a correção publicada está fora dos intervalos aceitos pelos consumidores atuais. Não foi aplicado override para 11 nem a sugestão de downgrade/force do npm. Uma atualização futura deverá ser revisada quando os consumidores adotarem a correção ou houver backport compatível.

## Verificações executadas

| Verificação                                                        | Resultado                                                   |
| ------------------------------------------------------------------ | ----------------------------------------------------------- |
| `node --version`                                                   | v25.9.0                                                     |
| `npm.cmd --version` e helper `--version`                           | 11.12.1                                                     |
| `npm run runtime`, direto e pelo helper                            | Mesmo Node/npm e caminhos reais                             |
| Helper com Node 22 no início do PATH e outra pasta de trabalho     | Usa Node 25 e executa o projeto correto                     |
| Consistência manifest/lock                                         | Dependências, devDependencies e engine da raiz consistentes |
| `npm ci`                                                           | Código 0; aviso Vitest `EBADENGINE` documentado             |
| `npm ls --depth=0`                                                 | Código 0; árvore instalada sem inconsistências              |
| `npm run typecheck`                                                | Código 0                                                    |
| `npm run lint`                                                     | Código 0, sem erros/avisos na validação final               |
| Helper `test`                                                      | **133 testes aprovados em 8 arquivos**, código 0            |
| Helper `run build`                                                 | Código 0; 2.998 módulos transformados                       |
| Inicialização Vite pelo helper, com argumentos de porta/strictPort | Vite pronto em 595 ms, porta 5173                           |
| Processo do servidor                                               | Executável `C:\nodejs\node.exe`, versão v25.9.0             |
| HTTP `/`, `/src/main.tsx`, `/src/features/cards/CardsPage.tsx`     | **200** em todos os casos                                   |
| `npm audit --omit=dev`                                             | Zero vulnerabilidades                                       |

O build manteve os dois avisos já existentes do Rollup sobre comentários de anotação em Zod; os comentários são removidos e o build termina normalmente. Não foi feito upgrade de biblioteca para eliminar um aviso sem impacto na compilação.

A comparação SHA-256 confirmou os **60 arquivos de `src/` inalterados**, assim como `vite.config.ts`, `tsconfig.json` e `eslint.config.js`. A comparação completa dos **352 registros não raiz** do lockfile confirmou identidade, inclusive versões e integridades. Os testes de integridade financeira, migração, persistência, pagamentos, estornos e backup da fase 2.2 foram preservados e executados.

Não houve limpeza ou acesso ao IndexedDB real do navegador, alteração de regras financeiras, remoção de funcionalidades, push ou deploy. Os testes usam IndexedDB em memória. As verificações HTTP exercitam o servidor e a transformação dos módulos; **não equivalem a inspeção visual ou teste de interação desktop/mobile**, que continua pendente.
