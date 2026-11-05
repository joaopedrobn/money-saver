# Validação remota final — 2026-11-05

## Escopo e resultado

Uma única rodada de `node scripts/test-sync-remote-final.mjs --isolation-reconciliation`
passou contra a aplicação HTTPS e o Supabase remoto, exclusivamente com os dois
usuários fictícios previamente identificados. O teste de concorrência aprovado
anteriormente não foi repetido. Worker, Hyperdrive, RPCs e infraestrutura não foram
alterados nesta rodada.

- Leitura isolada entre proprietários, referência cruzada rejeitada sem dados
  parciais e bloqueio de edição/exclusão genéricas: aprovados.
- Reconciliação de dois caches IndexedDB independentes com o snapshot remoto:
  saldos, faturas, cartão, UUIDs e relacionamentos iguais.
- Os dois snapshots passaram pelas validações financeiras existentes. O inventário
  verificou 26 referências entre tabelas e a origem por operação registrada de cada
  registro fictício.

Os caches usam fake-indexeddb com sessões Auth reais e chamadas HTTPS reais. Esta
rodada não representa validação visual em dois aparelhos físicos.

## Fixtures reutilizáveis

O executor mantém um registro privado por `runId`, proprietário e papel lógico do
recurso, com UUIDs, operações e um UUID distinto para cada execução. Contas e
categorias comprovadas no inventário são reutilizadas pelos IDs; novos recursos
recebem nomes no namespace do `runId` e UUIDs dos repositórios existentes. Os IDs
são registrados antes do envio. Colisões não registradas interrompem a execução.
Lançamentos de despesa informam explicitamente `kind: 'transaction'`.

O inventário e o registro ficam em `.local/remote-bidirectional/`, ignorado pelo
Git. Não contêm dados pessoais de usuários reais para publicação. O executor exige
esse inventário e as credenciais fictícias locais; não cria usuários nem utiliza
credenciais administrativas.

## Limpeza

Foram removidos 19 registros financeiros fictícios, com predicados explícitos de
proprietário e UUID, conferência do conteúdo e das referências antes da transação.
Restaram zero registros financeiros ativos desses fixtures. Foram preservados 20
registros de auditoria, recibos imutáveis e feed como evidência; o inventário privado
também conserva o snapshot anterior à limpeza. Nenhum registro desconhecido foi
excluído. Os hashes dos dados de outros proprietários permaneceram iguais nas 16
tabelas, antes dos testes e após a limpeza.

A conta pessoal continua fora da allowlist. Os usuários fictícios e os controles
remotos existentes não foram alterados.

## Publicação e ativação

Uma única rodada local terminou com TypeScript, lint, 221 testes em 24 arquivos e
builds de frontend e Worker aprovados, usando Node.js 26.7.0. O build emitiu apenas
avisos de anotações de dependências e tamanho de chunk, sem falha.

Não houve commit, push ou deploy. A atualização do GitHub exige revisão dos arquivos
locais, commits e autorização para push. Ativar a conta pessoal requer autorização
separada, configuração controlada dos gates do frontend e servidor e revisão da
prévia/backup antes de qualquer importação pessoal. Nenhuma importação foi feita.
