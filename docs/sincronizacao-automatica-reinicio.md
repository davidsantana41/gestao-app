# Sincronização automática e reinicialização financeira

Implementação local preparada em 17/11/2026. **Não houve publicação, consulta de
documentos reais ou reinicialização de conta real nesta etapa.** As autorizações
anteriores de deploy não foram reutilizadas: este pedido exige autorização posterior.

## Fluxo de sincronização

### Arquivos desta implementação

- Núcleo: `src/lib/syncSession.ts`, `src/lib/useGestao.ts`, `src/lib/gestao.ts`.
- Interface: `src/app/page.tsx`, `src/components/ReiniciarDados.tsx` (novo),
  `src/components/gestao/TurnoForm.tsx`, `AvulsoForm.tsx` e `CustosFixos.tsx`.
- Regras locais: `firestore.rules`; configuração isolada nova: `firebase.auto-reset.json`.
- Execução e testes: `package.json`, `scripts/check-sync.mjs`,
  `scripts/check-dashboard.mjs`, `scripts/check-auto-reset.mjs` (novo),
  `scripts/check-manual-sync.mjs` e `scripts/manual-sync.mjs`.
- Documentação: `README.md`, este documento (novo),
  `docs/sincronizacao-segura.md`, `docs/testes-firestore.md` e
  `docs/validacao-manual-sincronizacao.md`.

- O documento continua em `users/{uid}/appData/main`. Authentication não muda.
- `onSnapshot` recebe mudanças do servidor em dispositivos da mesma conta. Eventos
  de cache ou com gravações pendentes não são considerados confirmação remota.
- Um painel sem alterações pendentes adota a atualização sem pedir escolha.
- Alterações pendentes usam comparação de três versões: base original, edição local
  e documento remoto. Inclusões com IDs diferentes e alterações independentes são
  combinadas. O mesmo ID não é inserido novamente em uma reconexão.
- Um lançamento financeiro é tratado como unidade: valores calculados não são
  combinados campo a campo. Edições incompatíveis no mesmo ID, edição contra exclusão,
  configurações incompatíveis e cópias legadas sem base confiável exigem resolução.
- Cada escrita passa por `runTransaction`, que relê a base e refaz a comparação.
  Uma revisão recusada durante disputa só é repetida quando outra leitura comprova
  uma mudança concorrente; erros reais de permissão não são ignorados.
- A geração atual é uma barreira: uma cópia anterior à reinicialização nunca é
  combinada com os registros novos, nem pode substituir a nuvem pela escolha local.
- Os formulários guardam a base da edição. Receber dados novos não apaga um rascunho
  e salvar um formulário desatualizado não passa a ser uma edição da versão nova.
- Lembretes e custos fixos sem rascunhos acompanham os dados atuais automaticamente.
- Indicadores: **Salvo localmente**, **Sincronizando**, **Salvo na nuvem** e
  **Conflito identificado**. A conexão restabelecida tenta enviar pendências seguras.

## Versões e regras locais

O documento ganhou o campo opcional `_sync`:

```text
generation: contador inteiro de reinicializações, começando em zero
revision: contador de gravações dentro da geração
resetId: identificador único da última reinicialização, quando houver
startedOn: data de início informada, inicialmente 2026-11-17
```

A primeira gravação de um documento legado introduz geração 0/revisão 1. Gravações
normais mantêm a geração e incrementam a revisão em um. Reiniciar exige geração
anterior + 1, revisão 0 e histórico vazio. O identificador permite confirmar um
resultado incerto sem limpar novamente registros lançados após o reinício.

As regras locais continuam restringindo tudo ao UID proprietário, negando exclusão
do documento e acesso a outros caminhos. Após introduzir `_sync`, elas recusam
gravações sem metadados, revisões antigas e gerações anteriores. Uma geração antiga
com histórico vazio também não pode fazer o contador retroceder.

Não há administradores nem hierarquia empresarial. Cada usuário gerencia apenas
seu próprio documento. Os nove testes de permissões anteriores continuam válidos
para documentos legados; os testes de sincronização cobrem as novas transições.

**As regras publicadas não foram alteradas.** Antes de publicar este aplicativo,
é obrigatório autorizar e revisar a publicação dessas regras. As regras antigas
não permitem `_sync`; publicar só o app bloquearia as novas gravações. Publicar só
as regras mantém documentos legados funcionando até a migração de cada conta;
após uma conta receber metadados, clientes antigos deixam de poder gravar nela.
Coordenar a atualização dos navegadores e exportar backups antes dessa transição.

## Onde estão os dados e o que será preservado

| Local | Conteúdo e tratamento |
| --- | --- |
| Firestore `users/{uid}/appData/main` | Histórico, configurações, reservas, preferências e metadados de sincronização |
| Estado React e memória do SDK | Dados em uso e cache temporário; não são a cópia durável offline |
| `localStorage`, prefixo `gestao-app-dados-v2-{uid}` | Cópia compatível, journals por aba com base/dados/pendência, versões de conflito e backups |
| `sessionStorage` da mesma conta | Ponteiros da própria aba para seu journal e sua preparação de reinício |
| `localStorage`, `-reset-intent-{id}` | Preparação e fase da operação, separadas por ID; cada aba retoma seu próprio plano |
| IndexedDB gerenciado pelo Firebase Auth | Sessão de login; não é apagada nem exportada com senhas/tokens |
| IndexedDB de cache Firestore de versões antigas, se existir | Esta versão não ativa persistência financeira em disco; não se apagam bancos compartilhados. A geração/regras invalidam reenvios antigos |
| Arquivos JSON baixados | Cópias controladas pelo usuário, fora do alcance de uma limpeza da conta |

A interface consulta os nomes de bancos IndexedDB disponíveis no navegador, quando
a API permite. Não lê nem apaga sessões ou dados de outras contas. Um backup não
alcança dados locais exclusivos de outro dispositivo: exportá-los no próprio
dispositivo se necessário. Limpar o armazenamento do site pode eliminar pendências
offline; o aplicativo não o faz automaticamente.

## Reinicialização: preparação sem exclusão

Em **Privacidade > Reiniciar dados financeiros**, a preparação:

1. Confere que a sessão autenticada corresponde ao UID do painel.
2. Lê novamente o servidor; identifica contagens local/remota e alterações pendentes.
3. Preserva um JSON com documento remoto, dados locais, base e todas as cópias
   financeiras disponíveis desta conta neste navegador. Não inclui credenciais.
4. Persiste uma intenção única, com a versão exata a ser reinicializada.
5. Exibe conta, UID, contagens, início da nova fase, dados zerados/preservados e riscos.

Preparar não escreve no Firestore. Não é necessário excluir conta, coleção ou projeto.

## Confirmação obrigatória antes de qualquer reinício real

Após publicação autorizada e com a conta correta aberta:

1. Exportar cópias de outros dispositivos, especialmente os que estão offline.
2. Preparar o reinício no dispositivo principal e conferir e-mail, UID e contagens.
3. Clicar em **Baixar backup antes do reinício** e guardar o arquivo em local seguro.
4. Selecionar o arquivo baixado no campo de conferência. O conteúdo completo deve
   corresponder ao backup daquela preparação e conta; outro arquivo é recusado.
5. Conferir as versões pendentes no JSON. Resolver as pendências ou aceitar sua
   preservação no backup antes de prosseguir.
6. Marcar a autorização da conta e digitar **REINICIAR MINHA CONTA**.
7. Somente então clicar em **Confirmar reinicialização desta conta**.

O botão fica desabilitado sem os requisitos. A transação recusa dados locais ou
remotos que tenham mudado depois da preparação, exigindo novo backup e conferência.
Nenhuma autorização foi dada para executar esses passos em uma conta real agora.

### Resultado esperado

- Histórico vazio; faturamento, combustível, saldo principal e dias trabalhados em zero.
- Despesas, caixinhas e reservas acumuladas zeradas, pois derivam do histórico.
- Nomes de reservas preservados; valores das reservas diárias zerados.
- Custos fixos mensais configurados preservados, sem lançamentos anteriores nos relatórios.
- Conta, senha, login Google/e-mail, regras, projeto, coleções, tema e lembrete preservados.
- Data inicial registrada como 17/11/2026. A data não importa históricos antigos;
  todos os registros da geração anterior saem da versão ativa.

Navegadores antigos ainda podem mostrar suas cópias quando offline, mas as regras
novas impedem o reenvio. No app atualizado, a cópia antiga fica em quarentena para
exportação, e a ação de substituir a nuvem por ela é desabilitada.

## Falhas, retomada e recuperação

- Antes do commit: os dados financeiros continuam intactos; backup e intenção permanecem.
- Confirmação perdida: novas edições ficam bloqueadas até **Verificar resultado da
  reinicialização**. O app consulta o ID no servidor; não repete uma limpeza às cegas.
- Se o mesmo ID já foi confirmado, o app adota a geração atual, incluindo novos
  lançamentos feitos depois. Repetir a operação não os apaga.
- Se nada foi confirmado e o documento não mudou, a preparação pode ser conferida
  e confirmada novamente. Se mudou, fazer nova preparação/backup.
- Sem espaço para backup: o reinício não começa. Se faltar espaço após o commit,
  conservar o arquivo baixado, liberar espaço e verificar o resultado novamente.
- Após recarregar, a própria aba retoma seu plano pelo ID. Outra aba não substitui
  esse plano. Disputas entre reinicializações têm um único vencedor.

Restaurar deliberadamente todo um backup antigo não é a resolução normal de conflitos
e não há importação automática desse arquivo. Se houver arrependimento após um
reinício real, solicitar restauração separada: conferir UID/JSON, preservar a geração
atual e preparar uma operação autorizada com nova geração. Não reduzir contadores
nem colar um documento antigo diretamente no Firestore.

## Testes e evidências

Executados exclusivamente com dados fictícios:

| Verificação | Resultado |
| --- | --- |
| Concorrência, reconexão, versões, backups e reinicialização | 49 testes aprovados |
| Nove testes anteriores de segurança do Firestore | 9 aprovados |
| Chrome + Edge com Auth/Firestore Emulator e app real | 11 cenários aprovados |
| Regressões de cálculos, histórico, painel e autenticação | Aprovadas |
| TypeScript, ESLint e build | Aprovados |

Os testes incluem disputa na primeira gravação, conflitos no mesmo lançamento,
configurações independentes, novas edições durante confirmação, falhas de permissão,
espaço insuficiente, interrupção antes/depois do commit, reexecução idempotente,
abas com preparações diferentes e tentativa de restaurar geração antiga vazia.

O ensaio dos navegadores baixou um backup fictício, conferiu o arquivo pelo controle
de upload, recusou um arquivo de outra conta, confirmou o reset fictício e tentou
reconectar um dispositivo antigo. Depois registrou um único turno na nova geração:
R$ 461,33 de faturamento, R$ 92,20 de combustível, R$ 10,00 de reserva diária e
R$ 9,36 de reserva de acidente, com saldo de R$ 349,77. O mesmo ID apareceu no outro
navegador e permaneceu após recarregar. Não foi o primeiro turno real do proprietário.

Evidências locais: `.backups/auto-reset-tests.log`, `.backups/auto-reset-rules.log` e
o `latest-report.json` do diretório indicado em `.backups/auto-reset-final-path.txt`.
São arquivos locais ignorados pelo Git; não contêm dados de contas reais.

### Reproduzir

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

Para o ensaio completo de navegador, manter em outro terminal:

```powershell
npm.cmd run manual:auto-reset
```

Isso cria uma cópia de teste em `http://127.0.0.1:3200`, Auth em `9298`, Firestore
em `8288` e projeto fictício `demo-appcar-auto-reset`. Em uma conta fictícia nova:

```powershell
npm.cmd run test:auto-reset
```

A suíte recusa uma conta já preenchida; não apaga dados automaticamente para repetir.
Aceita também um diretório de fixture local como argumento. Não executar testes
destrutivos contra o app normal ou uma conta real. O `manual:sync` anterior continua
disponível na porta 3100; sua suíte agora usa o mesmo roteiro atualizado.

## Próximos passos autorizáveis e uso diário até 30/11/2026

1. Revisar este diff e autorizar posteriormente atualização das regras, GitHub e Vercel.
2. Publicar as regras testadas antes/junto do app e atualizar os navegadores antigos.
3. Só então preparar o backup da conta real e apresentar e-mail, UID, contagens e
   conteúdo a zerar. Aguardar confirmação explícita e conferência do arquivo.
4. Após o reinício real, validar métricas zeradas antes do primeiro lançamento.
5. Diariamente: salvar o turno, aguardar confirmação da nuvem, conferir no outro
   dispositivo, verificar despesas/reservas/relatórios e exportar uma cópia ao fechar.
6. Registrar divergências até 30/11/2026. O acompanhamento diário e o aceite em
   celular físico permanecem manuais; não foram criadas automações ou notificações.

Limites: sem abertura garantida totalmente offline/PWA; cópias de outros aparelhos
precisam ser exportadas neles; backups podem consumir espaço; documento único mantém
o limite de tamanho do Firestore. A reinicialização financeira não equivale à exclusão
da conta ou à conclusão das pendências de LGPD.
