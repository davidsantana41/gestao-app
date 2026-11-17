# Sincronização segura do APPCAR

## Protocolo

O documento continua em `users/{uid}/appData/main`, com os campos existentes.
Não há migração automática, campo de versão novo nem mudança de regras.
A versão é o conteúdo completo da base confirmada, comparado de forma canônica
(ordem de propriedades não importa; ordem de lançamentos e valores importa).

Antes de gravar, exige-se leitura do servidor. `runTransaction` relê o documento
e compara com a base original em **cada repetição** da transação. Havendo mudança,
interrompe sem gravar e preserva a edição local. Trocar apenas o tema também usa
esse protocolo. Não há fallback para `setDoc` ou fila offline de documentos antigos.
O callback da transação não altera estado React nem armazenamento local.

Cada aba montada recebe uma chave própria `gestao-app-dados-v2-{uid}-sync-{uuid}`
com dados, base, indicação de base conhecida e pendência. `sessionStorage` aponta
para a cópia da própria aba para recuperação após recarregar. Ao remontar, a aba
cria uma nova chave e mantém a anterior. Uma aba duplicada também cria sua chave.
A chave principal antiga continua sendo escrita para compatibilidade, mas nunca
é a única cópia de uma edição. O marcador antigo de pendência é informativo;
a autoridade passa a ser o journal próprio da aba.

Offline, a edição aceita fica no journal local. A reconexão e o botão
**Verificar sincronização** tentam a transação novamente. Ler ou carregar o painel
não grava na nuvem. Uma cópia antiga sem base exige comparação manual quando difere
da nuvem. Confirmação perdida após um commit não duplica registros: uma leitura
posterior confirma o conteúdo ou apresenta conflito conservador.

O timeout de leitura não gera escrita tardia. A transação iniciada não é cancelada
nem duplicada por um timeout da saída; a sessão mantém uma única operação em curso.
Sair só conclui quando não há pendência nem conflito na sessão atual.

## Conflitos e recuperação

- A versão remota é conferida novamente antes de resolver; se mudou desde a
  comparação exibida, a escolha é recusada e precisa ser revista.
- Escolher a versão local usa outra transação condicional. Uma mudança ocorrida
  entre a conferência e o commit também é detectada.
- Antes da escolha são criadas cópias com IDs únicos das versões local e remota.
  Os atalhos de exportação antigos também continuam disponíveis.
- Escolher a nuvem muda os dados em uso, mas conserva os dados locais no backup.
- A tela oferece recuperação de journals pendentes de outras sessões do mesmo
  usuário. Recuperar preserva a versão atual e não grava automaticamente na nuvem.
- Atualizações de outra aba não substituem formulários nem provocam ciclos de
  eventos de armazenamento. Em outro dispositivo, a mudança é verificada ao salvar,
  reconectar ou usar o botão de sincronização; não há atualização em tempo real.
- Formulários são reiniciados apenas na confirmação bem-sucedida de uma escolha
  ou recuperação explícita. Rascunhos de formulário ainda não salvos não são backups.

As cópias podem ser exportadas pela aba **Privacidade > Baixar meus dados pessoais**.
O backup simples do cabeçalho contém apenas a versão em uso.

## Testes

Requer Node 24.12+ e Java 21+. No PowerShell, partindo da raiz do projeto:

```powershell
$env:JAVA_HOME = 'C:\Program Files\Eclipse Adoptium\jdk-21.0.13.9-hotspot'
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"
$env:CI = 'true'
$env:DEBUG = ''
$env:XDG_CONFIG_HOME = Join-Path (Get-Location) '.backups/firebase-test-config'
$env:FIREBASE_EMULATORS_PATH = Join-Path (Get-Location) '.backups/firebase-emulators'
npm.cmd run test:sync
npm.cmd run test:rules
npm.cmd test
npm.cmd run test:dashboard
npm.cmd run test:auth
npm.cmd run lint
npm.cmd run build
```

Não executar `build` junto dos testes de navegador: estes criam projetos temporários
em `.next`, que o build pode limpar. O cache do Emulator fica em `.backups` para não
ser removido pelo build. A suíte exige projeto `demo-appcar-isolation` e o endereço
`127.0.0.1:8088`; não importa a configuração Firebase do app.

`check-sync.mjs` usa conexões independentes ao Emulator e barreiras para coordenar
disputas e repetição real de transações. Testa offline, recarga, confirmação incerta,
edições durante gravação/resolução, falhas locais, permissão negada e isolamento.
Os testes do painel usam Next e Chrome reais com serviço Firebase simulado;
também abrem duas abas para verificar journals e preservação de formulário.

### Resultado verificado em 17/11/2026

| Verificação | Resultado |
| --- | --- |
| Concorrência e sincronização no Emulator | 26 aprovados, 0 falhas |
| Regras do Firestore no Emulator | 9 aprovados, 0 falhas |
| Cálculos e compatibilidade do histórico | Aprovado |
| Painel no Chrome, incluindo duas abas | Aprovado |
| Autenticação no Chrome com Firebase simulado | Aprovado |
| ESLint | Aprovado |
| Build de produção e TypeScript | Aprovado |

O build apenas gera artefatos locais; não publica o aplicativo. Nenhum teste utiliza
contas ou documentos reais. As regras e a configuração Firebase do app não mudaram.

## Validação manual isolada

Use somente uma cópia de teste com Firebase apontando ao Emulator/projeto de teste.
Não usar a configuração normal do app para esses ensaios.

1. Abra a mesma conta de teste em dois navegadores. Carregue a mesma base nos dois.
2. No primeiro, salve um turno. No segundo, salve outro turno ou troque o tema.
   O segundo deve indicar conflito; seu turno/tema local deve continuar disponível.
3. Exporte os dados pessoais antes de escolher uma versão. Escolha a local e
   confira que o arquivo exportado conserva as duas versões anteriores.
4. Repita escolhendo a nuvem. O painel deve adotar a nuvem, mantendo a versão
   rejeitada no backup exportável.
5. Desconecte um navegador, salve um turno e recarregue. Reconecte após modificar
   a nuvem no outro navegador: deve haver conflito, nunca substituição silenciosa.
6. Repita sem modificar a nuvem: a edição offline deve sincronizar uma única vez.
7. Abra duas abas do mesmo navegador, faça edições pendentes distintas e recarregue.
   Cada aba deve recuperar sua cópia; cópias das outras sessões devem ser recuperáveis.
8. Preencha um turno sem salvar. Verifique uma mudança remota: os campos devem
   permanecer preenchidos. Não limpar os dados do navegador durante o teste.

## Limites restantes

Clientes antigos ainda podem executar gravações incondicionais. Antes de uma futura
publicação, encerrar/atualizar abas antigas e fazer backups. Impedir tecnicamente
clientes antigos exigiria evoluir protocolo/regras, com autorização separada.

Não há mesclagem automática. Uma escolha explícita pode substituir a versão em uso,
mas as versões anteriores ficam preservadas no navegador que fez a escolha.
Os backups não são enviados a um arquivo de histórico na nuvem.

Journals e backups não são apagados automaticamente, podendo consumir espaço.
Se o armazenamento falhar, novas alterações são rejeitadas e a interface informa
o erro. Limpar o navegador ou perder o dispositivo pode eliminar alterações offline;
exportar dados continua necessário. O documento único mantém o limite de tamanho
do Firestore e o histórico deve ser acompanhado ao longo do uso.
