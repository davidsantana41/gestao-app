# Validação manual isolada da sincronização

## Ambiente preparado

- Aplicativo: **http://127.0.0.1:3100**.
- Projeto fictício: `demo-appcar-manual`.
- Authentication Emulator: `127.0.0.1:9198`.
- Firestore Emulator: `127.0.0.1:8188`.
- Chrome e Edge usam perfis exclusivos em `.backups/manual-sync/`.
- As duas janelas foram abertas e conferidas na conta fictícia, com o Firestore
  de teste conectado. A faixa amarela **TESTE LOCAL APPCAR** deve estar visível.
- Conta somente do Emulator: `sync-manual@example.test`.
- Senha fictícia somente local: `APPCAR-teste-local-21!`.

Não use `localhost:3000`, credenciais pessoais, Firebase Console ou a instância
normal do aplicativo neste ensaio. O inicializador Firebase foi substituído apenas
na cópia gerada em `.backups/manual-sync/app`; a configuração de produção não mudou.
Os perfis dos navegadores de teste não são os perfis pessoais habituais.

Projetos `demo` não têm recursos Firebase reais. As conexões são feitas explicitamente
aos emuladores, conforme a documentação do [Firestore](https://firebase.google.com/docs/emulator-suite/connect_firestore)
e do [Authentication](https://firebase.google.com/docs/emulator-suite/connect_auth).

## O que foi executado em 17/11/2026

Foi executado o aplicativo real em **Chrome e Edge headless**, com duas sessões
independentes, Authentication Emulator e Firestore Emulator reais. As chamadas
Firebase não foram substituídas por mocks. **10 cenários aprovados, 0 reprovados**
na execução concluída. Isso é uma verificação automatizada, não aceite manual humano.

| Cenário executado | Resultado e evidência |
| --- | --- |
| Mesma conta nos dois navegadores | Login local aprovado; abrir o painel não criou lançamentos |
| Alterações financeiras a partir da mesma base | Receita de R$ 100 no Chrome; despesa de R$ 20 no Edge gerou conflito |
| Preservação local no conflito | Edge manteve a despesa; servidor conservou a receita do Chrome |
| Cancelar uma escolha | Nenhuma alteração no documento remoto ou na versão local |
| Nuvem muda com confirmação aberta | A confirmação antiga foi recusada após nova receita no Chrome |
| Escolher a nuvem | A despesa substituída permaneceu em backup local com ID único |
| Perda de conexão e recarga | Despesa de R$ 30 permaneceu local após desconectar o Firestore e recarregar |
| Reconexão com concorrência | Mudança remota durante a desconexão gerou conflito; sem sobrescrita |
| Escolher explicitamente a versão local | Exigiu confirmação; a receita remota substituída permaneceu no backup |
| Reconexão sem concorrência e recarga final | Sincronizou uma única vez; resultado persistiu após recarregar |

O resumo automatizado também confirmou **zero exceções não tratadas** e requisições
do aplicativo somente a `127.0.0.1:3100`, `127.0.0.1:8188` e `127.0.0.1:9198`.

Relatório estruturado: [latest-report.json](../.backups/manual-sync/latest-report.json).
Capturas e snapshots: diretório indicado no campo `evidence` desse relatório.
Há uma tentativa inicial interrompida por um seletor incorreto da automação;
o seletor foi corrigido sem alterar o aplicativo. A execução concluída acima passou.

O estado final do ensaio automatizado contém quatro lançamentos fictícios, com
saldo de R$ 127. A despesa B1 e a receita A3, substituídas por escolhas explícitas,
continuam nos backups dos navegadores. O protocolo não soma automaticamente versões.

## Aceite humano ainda pendente

As janelas visíveis foram preparadas após a execução automatizada. Ainda falta
uma pessoa executar e aprovar o roteiro abaixo, incluindo compreensão das mensagens,
download/abertura dos backups e comportamento em dispositivos físicos.

Antes de começar, em **cada navegador**, abra **Privacidade > Baixar meus dados
pessoais**. Esse arquivo inclui cópias locais; o backup simples do cabeçalho inclui
apenas a versão em uso. Não limpe armazenamento nem feche o ambiente antes de exportar.

### 1. Conflito financeiro e cancelamento

1. Abra a aba **Registrar turno** nas duas janelas. Confira a conta fictícia e a
   faixa de teste. Ambos devem estar na mesma base após o ensaio automático.
2. No Chrome, registre uma **entrada avulsa de R$ 13**, descrição `MANUAL-A`.
   Aguarde a mensagem **Salvo na nuvem e neste navegador**.
3. No Edge, sem antes verificar a sincronização, registre uma **saída avulsa de
   R$ 9**, descrição `MANUAL-B`.
4. Confirme que o Edge apresenta conflito e conserva `MANUAL-B` na versão local.
   A versão remota deve conter `MANUAL-A`.
5. Clique em **Usar dados deste navegador** e depois **Cancelar**. Nenhuma versão
   deve ser substituída. Exporte novamente os dados pessoais de ambos os navegadores.

### 2. Escolha explícita de versão

1. No Edge, escolha **Usar dados da nuvem** e confirme conscientemente.
2. A versão em uso deve mudar para a nuvem. O backup exportado pelo Edge deve
   conservar `MANUAL-B` em uma chave `antes-resolver-local` com ID único.
3. Para testar a outra escolha, crie novo conflito, exporte as duas cópias e escolha
   **Usar dados deste navegador**. Isso substitui a versão ativa remota inteira,
   não faz mesclagem. O backup `antes-resolver-nuvem` deve conter a versão substituída.
4. Sem sua confirmação, a nuvem não deve mudar por causa da versão conflitante.

### 3. Desconexão, recarga e reconexão

1. Use **Verificar sincronização** e resolva conflitos para alinhar os dois painéis.
2. No Edge, clique no botão amarelo **Desconectar Firestore de teste**.
3. Registre uma despesa fictícia e confira **Salvo localmente**.
4. Recarregue o Edge. A despesa deve continuar disponível e o controle amarelo deve
   indicar **desconectado**.
5. No Chrome conectado, registre outra movimentação e aguarde confirmação da nuvem.
6. No Edge, clique em **Reconectar Firestore de teste**. Deve aparecer conflito,
   conservando a despesa local. Cancele a escolha uma vez e confirme que ela permanece.
7. Resolva explicitamente após exportar. Repita sem modificar o Chrome durante a
   desconexão: a edição deve sincronizar uma vez, sem duplicação.
8. Recarregue conectado e confira os lançamentos e saldos.

O botão amarelo desconecta **apenas o Firestore**. A página Next continua acessível
localmente, o que permite testar recarga e recuperação dos dados. Um recarregamento
com todo o navegador completamente offline não foi aprovado neste ensaio: não há
service worker/PWA que garanta abrir o app nessa condição. Desligar o Wi-Fi não
desconecta serviços em `127.0.0.1`; use o botão de teste para este roteiro.

### 4. Conferência visual e aceite

- Verifique os textos, os valores e a legibilidade das decisões em Chrome e Edge.
- Abra os arquivos JSON baixados e localize os lançamentos substituídos nos backups.
- Confira que um formulário ainda não salvo permanece preenchido quando a nuvem muda.
- Registre navegador, versão, data, resultado e descrição de qualquer divergência.
- Testes em celular, Safari/Firefox e dois dispositivos físicos permanecem pendentes.

## Reabrir ou reproduzir o ambiente

Em um terminal, na raiz, mantenha em execução:

```powershell
npm.cmd run manual:sync
```

O comando exige as dependências já instaladas e identifica o Temurin 21 localmente.
Não muda PATH ou JAVA_HOME globais. Recusa portas ocupadas e não encerra serviços
preexistentes. A cópia do aplicativo é gerada automaticamente fora de `src`.

Em uma instância recém-iniciada, antes de qualquer edição manual:

```powershell
npm.cmd run test:manual-sync
```

A suíte recusa uma conta que já tenha lançamentos; não limpa dados para repetir o
ensaio. Ela deixa evidências e perfis separados. Para abrir as janelas visíveis:

```powershell
npm.cmd run manual:open
```

Mantenha os terminais da instância e das janelas em execução. Neste ambiente Codex,
a abertura gráfica precisou ocorrer fora das restrições que impediam processos GPU;
isso não exigiu alterar configurações do sistema ou do aplicativo. Um usuário pode
abrir a URL manualmente em Chrome e Edge se preferir.

Os emuladores desta sessão são descartáveis e não foram configurados para persistir
o banco após encerrar. Exporte os dados fictícios/evidências antes de reiniciar.
Não rode o ensaio automático contra uma sessão em uso para aceite manual.

## Parecer para publicação

**A sincronização passou no ensaio técnico isolado; a publicação ainda não está
liberada por esta validação.** Falta o aceite humano deste roteiro e permanecem:

1. Plano de atualização/encerramento dos clientes antigos, que ainda podem gravar
   sem o protocolo de transação.
2. Conferência das regras efetivamente publicadas, sem acesso a documentos reais.
3. Conclusão das pendências documentadas de privacidade, retenção e procedimento
   de exclusão de conta/dados, conforme `docs/privacidade-lgpd.md`.
4. Aceite explícito dos limites de offline, backups locais e ausência de mesclagem.

Não foi feito deploy, não foram alteradas regras publicadas e nenhum documento real
foi consultado ou modificado. Nesta etapa só foram adicionados recursos de teste,
documentação e exclusão dos artefatos temporários da análise do ESLint.
