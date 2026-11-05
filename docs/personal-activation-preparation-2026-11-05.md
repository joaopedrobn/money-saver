# GitHub, Cloudflare e ativação pessoal — preparação

Revisão de 05/11/2026, sem deploy, ativação, nova migração ou importação financeira.
Resultados de teste: [validação remota final](remote-validation-final-2026-11-05.md).
Este documento descreve o estado atual; os relatórios anteriores de preflight são
registros históricos, inclusive a proposta antiga de validador por JWT. O caminho
usado e validado atualmente é Hyperdrive com a role restrita de aprovação.

## Código revisado para o GitHub

Destino autorizado: `joaopedrobn/money-saver`, branch `main`, sem force push.
Os commits anteriores `3f65f05`, `2681fd8` e `17c5bc5` foram preservados e revisados,
incluindo as versões intermediárias dos arquivos. As alterações seguintes registram
as correções já validadas: conexão do validador, tratamento dos erros/revisões,
retomada da fila após renovação da sessão, proteção da primeira importação, testes
remotos reutilizáveis e a migração corretiva `202611050001` já aplicada.

A revisão dos arquivos candidatos e do histórico a enviar não encontrou secrets,
tokens literais, chaves privadas, credenciais reais conhecidas ou identidade pessoal
da ativação nos conteúdos versionados. Exemplos e testes contêm somente valores
fictícios. `.env.local`, credenciais, evidências, snapshots e configurações propostas
com o UUID pessoal permanecem em caminhos ignorados pelo Git. Os builds existentes
mantêm a sincronização do frontend desativada e sua allowlist vazia.

Os 221 testes, TypeScript, lint e builds já aprovados não foram repetidos: nenhum
código de aplicação ou regra financeira foi alterado nesta revisão.

## Cloudflare publicada versus versão validada

URL: https://money-saver.quem-votar-jp.workers.dev/

- Versão ativa: `00310fb6-8094-4ec4-8018-40390f1be186`, 100% do tráfego.
- Deployment: `24608c59-3a97-414d-bf0f-e0649c65b4b9`, criado em
  `2026-11-05T13:51:52Z`.
- O módulo publicado `index.js` é **idêntico byte a byte** ao Worker validado local.
  SHA-256: `4045bdf63e041cb39cb02be5b29122d8a30f7b702347f0f46cb3d6054c454da4`.
- CSS e vendors referenciados pelo HTML também são iguais. O frontend principal e
  o HTML diferem: publicado `index-ClWzmRh2.js`, local `index-BRZK2u2T.js`.
- A versão local inclui as proteções de backup/prévia e escolha explícita de origem
  antes da primeira importação, ausentes no frontend publicado. Uma publicação
  futura deve enviar os Static Assets atualizados; não requer nova lógica no Worker,
  novo Hyperdrive, novas credenciais administrativas ou reaplicar SQL.

As leituras usaram os endpoints oficiais de [deployment e conteúdo do Worker](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/)
e GET dos assets públicos. Nenhum endpoint de deploy foi invocado. A consulta de
Workers Builds retornou 403 com o OAuth disponível; não foi alterada configuração
de CI/CD. Não há workflow GitHub Actions neste repositório.

## Controles atuais e alteração futura exata

O UUID da conta pessoal já cadastrada e confirmada foi reconferido privadamente.
Sua nuvem está vazia nas 16 tabelas, revisão zero; não está na allowlist.

| Controle | Estado observado | Proposta após autorização separada |
| --- | --- | --- |
| Frontend `VITE_REMOTE_SYNC_ENABLED` | `false` publicado e local | `true` em build controlado |
| Frontend `VITE_SYNC_ALLOWED_USER_IDS` | vazio | somente o UUID pessoal confirmado |
| Worker `REMOTE_SYNC_ENABLED` | `true`, restrito aos fixtures | manter `true` |
| Worker `SYNC_ALLOWED_USER_IDS` | dois usuários fictícios | substituir somente pelo UUID pessoal |
| Banco `environment.enabled` | `true` | manter `true` |
| Banco `allowed_users` | somente os dois usuários fictícios | remover esses dois IDs e incluir somente o UUID pessoal |
| RLS, revisão, idempotência, aprovação e limites | existentes/validados | preservar |

O arquivo versionado `worker/wrangler.production.jsonc` continua fechado por
padrão (`false` e lista vazia). Não deve ser usado inadvertidamente como configuração
de ativação. Foram preparados **apenas arquivos privados propostos**, não executados,
em `.local/remote-bidirectional/`: configuração de deploy, plano de variáveis e SQL
transacional de alteração da allowlist. Eles fixam o projeto e o UUID pessoal e
interrompem se a allowlist ou a conta diferirem do estado revisado. A mudança de
allowlist não exige nova migração de schema nem acesso administrativo no frontend.

O Auth já aponta para a URL HTTPS correta, preservando callbacks locais. Não é
necessário pedir senha/token pessoal, alterar o Auth, enfraquecer RLS ou conceder
escritas financeiras genéricas. Hyperdrive e o segredo do validador permanecem no
servidor. Nenhum usuário adicional deve ser liberado.

## Primeira sincronização pessoal

Não foi identificado novo impedimento técnico nesta revisão. Permanecem bloqueios
intencionais: autorização da publicação dos assets e da ativação nos três gates.
A importação dos dados locais é uma decisão separada: backup salvo, inspeção e
prévia, totais/relacionamentos conferidos e confirmação explícita. Se a nuvem tiver
recebido dados antes dessa etapa, inspecionar novamente e não mesclar automaticamente.
O IndexedDB original deve permanecer preservado. A rodada remota validou HTTP real
e caches independentes, sem teste visual em dois dispositivos físicos.
