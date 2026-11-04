# Fase 3.2A.1 — validação real em Supabase local

Estado posterior: [Fase 3.2B — configurações funcionais, 199 testes e cobertura ampliada](phase32b-settings-and-coverage.md). Este documento preserva os resultados e limites da etapa original.

Data: **04/11/2026**. Os testes financeiros foram executados contra **PostgreSQL real 17.11**, em contêineres Supabase locais. A infraestrutura passou nos cenários descritos abaixo. **A sincronização continua desativada e não está liberada para produção.**

## Ambiente e isolamento

| Item               | Resultado observado                                                                                                                                   |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node.js            | **26.7.0**, preservado                                                                                                                                |
| Windows / WSL      | Windows 10 Pro 22H2; WSL **3.0.3**, Ubuntu WSL2, kernel **6.18.54.1**                                                                                 |
| Docker Desktop     | **4.98.0**, instalado por usuário com instalador oficial; hash SHA-256 e assinatura Docker verificados; aceite/Plano Personal concluídos pelo usuário |
| Docker Engine      | **29.9.2**, contexto local `desktop-linux`                                                                                                            |
| Supabase CLI       | **3.0.0**, via npx, sem alterar dependências do projeto                                                                                               |
| PostgreSQL         | **17.11**, imagem Supabase `17.11.0.011`                                                                                                              |
| Projeto local      | `money-saver`, usando o `supabase/config.toml` existente                                                                                              |
| Conexão dos testes | Socket Unix `/var/run/postgresql` **dentro** de `supabase_db_money-saver`, via named pipe local do Docker                                             |

O executor [test-supabase-local.mjs](../scripts/test-supabase-local.mjs) não recebe URL de banco, não carrega `.env.local` e não usa credenciais de produção. Rejeita contexto Docker remoto, contêiner sem os rótulos do projeto, imagem de banco inesperada, conexão sem socket Unix, migrações ausentes, dados financeiros locais preexistentes ou colisão com os IDs sintéticos. A conferência com o domínio usa Vite SSR com `envFile:false`.

Nenhuma chamada ao projeto remoto `iwzmsbkbuerleocismhj`, criação de projeto remoto, login/link remoto, `db push`, reset de banco ou migração de dados pessoais foi realizada. As migrações existentes, `config.toml`, `package.json` e lockfile foram comparados ao baseline e permaneceram idênticos. O IndexedDB do navegador não foi aberto por estes testes.

## Migrações realmente aplicadas

O primeiro `supabase start` aplicou no banco local:

1. `202611030001_financial_schema.sql`.
2. `202611030002_rls_and_snapshot.sql`.

As duas versões foram confirmadas no histórico de migrações. Não houve `supabase init`, sobrescrita dos arquivos ou alteração das migrações já aprovadas. O candidato da Fase 3.2A foi instalado separadamente para os testes, fora de `migrations`.

## Testes reais — resultados

| Cenário executado                                                                                                                      | Resultado                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Catálogo: 16 tabelas com RLS/FORCE RLS e 64 políticas originais                                                                        | **Passou**                                                                                                                            |
| CRUD/RLS com dois usuários fictícios, recusa de proprietário forjado, edição/exclusão de outro proprietário e FK cruzada               | **Passou** — suíte SQL de isolamento existente                                                                                        |
| Snapshot sob contexto `authenticated` de A/B; cada um recebe somente suas linhas                                                       | **Passou**                                                                                                                            |
| Escrita direta financeira de `authenticated` e acesso anônimo à RPC bloqueados                                                         | **Passou**                                                                                                                            |
| EXECUTE fechado por padrão para PUBLIC/anon/authenticated/service_role; concessão somente na transação/instalação local de teste       | **Passou**                                                                                                                            |
| Executor NOLOGIN/NOBYPASSRLS, sem SUPER/CREATEROLE; usuário comum sem associação aos papéis internos                                   | **Passou**                                                                                                                            |
| `SECURITY DEFINER` pertence ao executor limitado; `search_path` vazio e `row_security=on`; verificador agregado é `SECURITY INVOKER`   | **Passou** — assertivas no catálogo real                                                                                              |
| Papéis internos acessam `auth.uid()` sem poder assumir os papéis de API; validador sem SELECT/INSERT/UPDATE/DELETE financeiro genérico | **Passou**                                                                                                                            |
| Importação inicial do conjunto relacionado: conta, categoria, cartão, compra, duas faturas, duas parcelas, despesa e pagamento         | **Passou** — 10 registros por usuário                                                                                                 |
| Pedido sem aprovação e pedido com proprietário adulterado                                                                              | **Rejeitados corretamente**, SQLSTATE `42501`                                                                                         |
| Conjunto com parcela faltante                                                                                                          | **Rejeitado corretamente**; finanças, revisão, versões e recibo não ficaram parcialmente gravados                                     |
| Referência de B para uma conta existente somente em A                                                                                  | **Rejeitada corretamente**, SQLSTATE `23503`                                                                                          |
| Mesmo ID/revisão/payload repetido                                                                                                      | **Passou** — mesmo recibo, sem duplicação                                                                                             |
| Mesmo ID com bytes diferentes                                                                                                          | **Rejeitado corretamente**, SQLSTATE `23505`                                                                                          |
| Outra operação com revisão zero depois de um commit                                                                                    | **Rejeitada corretamente**, SQLSTATE `40001`                                                                                          |
| Quatro conexões reais: duas transações titulares em usuários diferentes e duas operações concorrentes                                  | **Passou** — usuários avançam em paralelo; operações sobre o mesmo proprietário aguardam a trava e atingem o timeout `55P03`          |
| Interrupção real de uma conexão antes do commit                                                                                        | **Passou** — nenhum registro financeiro, head ou recibo desse usuário persistiu; retry da mesma operação depois do rollback funcionou |
| Retry depois do commit da outra conexão                                                                                                | **Passou** — recibo exatamente igual; novo ID com revisão antiga recusado                                                             |
| SHA-256 do payload no PostgreSQL versus cálculo do domínio                                                                             | **Passou**, mesmos bytes/UTF-8                                                                                                        |
| Reconciliação dos snapshots reais de A e B pelo domínio atual                                                                          | **Passou** — conteúdo completo, UUIDs, referências, centavos, saldos, faturas, cartões e dois regimes de consumo                      |
| Limpeza das fixtures e dos objetos temporários sem reset                                                                               | **Passou**, após correção descrita abaixo                                                                                             |

No cenário fictício, o saldo reconciliado foi **9.400 centavos** por usuário, com dívida de cartão de **500 centavos** e limite disponível de **99.500 centavos** em 04/11/2026. Esses valores vieram dos seletores financeiros existentes, sem outro motor de cálculo em SQL.

Foram mantidos os **179 testes da aplicação**, todos aprovados. TypeScript, lint e build também passaram; permanecem somente os avisos anteriores de anotações do Zod. Os testes SQL reais são adicionais e não foram contabilizados como se fossem esses testes unitários.

## Falhas encontradas e corrigidas

### 1. Concessões inválidas sobre `auth`

A primeira execução real falhou com `42501: permission denied for schema auth`. O papel `postgres` local, assim como no modelo de privilégios do Supabase, tinha USAGE, mas não era dono do schema `auth` nem tinha grant option sobre ele/`auth.uid()`. Os GRANTs anteriores geraram avisos e não resolveram o acesso dos papéis internos.

Correção no candidato [prepare.sql](../supabase/phase32a/prepare.sql): herança explícita de `authenticated` para o executor e de `anon` para o validador, com `INHERIT TRUE, SET FALSE` nas associações. Foram removidos os GRANTs ineficazes sobre objetos de Auth. O atributo geral dos papéis continua NOINHERIT; somente essas associações específicas permitem herança. As permissões financeiras genéricas continuam bloqueadas, e o executor permanece NOBYPASSRLS. Os testes agora verificam esse acesso e a impossibilidade de SET ROLE.

Foi uma falha que bloqueava a operação, não um vazamento entre proprietários observado. O Auth funcional e seus objetos não foram modificados.

### 2. Finalização da limpeza com FK adiada

A primeira limpeza depois dos testes concorrentes recebeu `55006: cannot DROP TABLE operations because it has pending trigger events`. Havia verificações da FK adiada de versões/recibos pendentes na mesma transação da limpeza.

Correção no executor: `SET CONSTRAINTS ALL IMMEDIATE` depois de remover as fixtures e antes de remover os objetos de teste. As constraints não foram desativadas. A tentativa anterior de limpeza foi revertida pelo PostgreSQL; antes da recuperação, os snapshots foram comparados com a evidência sintética para garantir que não tinham mudado. Somente as duas fixtures conhecidas foram removidas. A execução completa posterior passou, inclusive a limpeza, sem reset do banco.

## Revisão final do estado

Antes de parar a stack, o banco local confirmou:

- 16 tabelas financeiras com RLS/FORCE RLS e 64 políticas originais.
- Função candidata, schema privado, papéis de teste e dois usuários fictícios removidos.
- Nenhuma concessão genérica de INSERT/UPDATE/DELETE financeiro para `authenticated`.
- Dados sintéticos removidos; volumes e esquema base preservados.

Evidências locais ignoradas pelo Git: `.local/local-sync-validation/report.json`, relatórios por execução, `final-state.json`, snapshots **exclusivamente fictícios** e logs. O relatório final registra oito grupos aprovados do executor; a suíte contém diversas assertivas SQL adicionais.

## Pendências do ambiente local

1. **Vector/logs:** o coletor auxiliar tentou alcançar `host.docker.internal:2375`, recebeu conexão recusada e reiniciou. PostgreSQL, Auth e os serviços centrais ficaram saudáveis, e isso não bloqueou os testes financeiros. A exposição do daemon sem TLS não foi habilitada. É necessário resolver a integração de logs do CLI/Docker Desktop antes de depender dela para observabilidade.
2. **Portas publicadas:** a rede dedicada `money-saver-homolog-local` foi criada com a opção de bind padrão `127.0.0.1`, conforme as orientações oficiais. Nesta combinação CLI 3.0.0/Docker Desktop 4.98.0, a inspeção efetiva ainda mostrou `0.0.0.0`/`::` para as portas publicadas. Portanto, essa medida **não foi considerada resolvida**. Ao encerrar, somente a stack local `money-saver` foi parada, com volumes preservados e sem contêineres do projeto em execução. Docker Desktop permanece instalado e funcional.

Fontes para o procedimento: [Docker Desktop no Windows](https://docs.docker.com/desktop/setup/install/windows-install/), [Supabase local e rede dedicada](https://supabase.com/docs/guides/local-development), [bind de portas Docker](https://docs.docker.com/engine/network/port-publishing/). A evidência observada prevalece sobre presumir que a opção de rede funcionou.

## Repetir a validação

Com Docker Desktop em execução e a stack local iniciada pelo Supabase CLI no diretório atual:

```powershell
rtk proxy npx --yes supabase@3.0.0 start --workdir . --network-id money-saver-homolog-local
rtk proxy node scripts/test-supabase-local.mjs
```

O script de testes usa o Docker CLI instalado por usuário ou encontrado no PATH; um terminal antigo pode precisar ser reaberto para o CLI Supabase encontrar `docker`. Verificar o bind efetivo e restringir o acesso local antes de manter a stack publicada. Não usar flags de projeto remoto, `--no-backup`, `--all`, reset ou credenciais de produção para repetir esta suíte.

## Pendências para a Fase 3.2B

- Implementar/revisar o [Worker confiável](cloudflare-trusted-worker-plan.md), a validação real do JWT no servidor e a emissão de aprovações. As aprovações desta suíte foram fixtures administrativas, não um Worker implantado.
- Concluir outbox durável, bloqueio/revisão local durante a migração, orquestração de envio/recibo e tratamento de resultado desconhecido.
- Definir/testar operações incrementais, tombstones e resolução explícita de conflitos, sem última gravação vence.
- Expandir os ensaios PostgreSQL para estornos, pares de crédito, recorrências, orçamentos, auditoria, datas/fusos e limites. A fixture real validada aqui não preenche todas as 16 tabelas, embora os catálogos/políticas/privilégios das 16 tenham sido inspecionados.
- Testar chamadas HTTP/JWT ponta a ponta, perda da resposta após commit e falhas de leitura/reconciliação pós-commit. A interrupção física executada nesta fase ocorreu antes do commit; replay após commit foi testado separadamente.
- Resolver os dois pontos auxiliares da stack local. Antes de qualquer produção, revisar e validar os privilégios no ambiente de destino autorizado; passar no Supabase local não concede autorização de implantação.

Nenhum Worker foi implementado/publicado, nenhuma sincronização foi ativada, nenhum dado pessoal foi migrado e não houve push ou deploy.
