# Isolamento do Firestore

As regras locais atuais também validam `_sync`, revisões e avanço de geração. Os
nove cenários abaixo foram reexecutados e aprovados; os 49 testes de sincronização
cobrem as novas transições. As regras publicadas não foram modificadas. Consulte
[sincronização automática e reinicialização](sincronizacao-automatica-reinicio.md)
antes de uma futura publicação coordenada.

Os testes usam somente `demo-appcar-isolation` e `127.0.0.1:8088`.
Não importam `src/lib/firebase.ts`, não exigem login e não acessam documentos reais.
A autenticação é simulada pelo rules-unit-testing, incluindo provider e email_verified.
Não validam o fluxo real de login nem a configuração remota de provedores.

## Executar

Requer Java 21+ no PATH e dependências npm instaladas.

### Windows: preparar Java sem alterar configurações globais

1. Baixe um **JDK 21 para Windows x64 em ZIP**, por exemplo Eclipse Temurin
   em https://adoptium.net/temurin/releases/?version=21. Confira o checksum do download.
2. Extraia em uma pasta de sua escolha. A pasta raiz do JDK contém `bin/java.exe`.
3. No terminal PowerShell que executará os testes, ajuste somente esta sessão
   (substitua o caminho de exemplo pelo diretório extraído):

```powershell
$env:JAVA_HOME = 'C:\ferramentas\jdk-21'
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"
java -version
where.exe java
node -v
npm.cmd -v
```

Fechar esse terminal descarta os ajustes. Não é necessário usar `setx`, alterar
a política de execução do PowerShell ou instalar ferramentas globalmente.
No PowerShell, use `npm.cmd` se `npm.ps1` for bloqueado.

### Ambiente preparado e execução validada em 17/11/2026

- Temurin JDK 21.0.13+9 instalado via winget, pacote exato
  `EclipseAdoptium.Temurin.21.JDK`, fonte winget, instalador oficial Adoptium
  e hash validado pelo winget. Somente o recurso principal do JDK foi solicitado.
- JDK em `C:\Program Files\Eclipse Adoptium\jdk-21.0.13.9-hotspot`.
- Node 24.19.0; npm 11.17.0; firebase-tools 15.36.0;
  rules-unit-testing 6.0.0; Firestore Emulator 1.22.0.
- Resultado: **9 testes aprovados, 0 reprovados**, saída 0.
- Nenhuma regra publicada ou documento real foi acessado/modificado.
- JAVA_HOME e PATH foram ajustados somente no processo da execução.

Para repetir em outro terminal, sem alterar variáveis globais:

```powershell
$env:JAVA_HOME = 'C:\Program Files\Eclipse Adoptium\jdk-21.0.13.9-hotspot'
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"
$env:CI = 'true'
$env:XDG_CONFIG_HOME = Join-Path (Get-Location) '.backups/firebase-test-config'
$env:FIREBASE_EMULATORS_PATH = Join-Path (Get-Location) '.backups/firebase-emulators'
npm.cmd run test:rules
```

O cache e a configuração da CLI ficam em `.backups`, para não serem removidos pelo build. A primeira execução requer
download do componente oficial do Emulator. `CI` evita a consulta de avisos da CLI.
Os erros PERMISSION_DENIED das tentativas proibidas são esperados; o resultado
da suíte é determinado pelas asserções e pelo resumo final, não por esses logs.

```powershell
npm.cmd install --save-dev @firebase/rules-unit-testing firebase-tools
npm.cmd run test:rules
```

A configuração separada `firebase.emulator.json` inicia somente o Firestore Emulator.
O teste carrega `firestore.rules` no emulator, limpa apenas seus dados sintéticos
antes de cada caso e termina as conexões ao concluir. A porta deve estar livre.
Não executar a suíte em um emulator compartilhado com outros testes.

Expectativas das regras atuais:

| Sessão | Ler/criar/atualizar próprio | Acesso a outro usuário | Excluir próprio |
| --- | --- | --- | --- |
| Senha, e-mail confirmado | Permitido | Negado | Negado |
| Senha, e-mail não confirmado | Permitido | Negado | Negado |
| Google | Permitido | Negado | Negado |
| Anônima | Permitido | Negado | Negado |
| Sem autenticação | Negado | Negado | Negado |

Também são testados campos extras, caminhos alternativos e listagem de usuários.
Permitir anônimos e e-mail não confirmado descreve a política atual;
não significa recomendação para produção. Os testes não alteram essa política.

## Comparar com regras publicadas

Não foi possível obter a versão publicada nesta sessão: não havia conexão Firebase
autenticada disponível. Não confundir aprovação dos testes locais com validação remota.

1. No Firebase Console, abra o projeto correto e Firestore Database > Rules.
2. Copie a versão efetivamente publicada (não um rascunho) para um arquivo temporário
   fora do repositório. Não publique nem altere nada no Console.
3. Execute:

```powershell
node scripts/compare-firestore-rules.mjs C:/caminho/regras-publicadas.rules
git diff --no-index -- firestore.rules C:/caminho/regras-publicadas.rules
```

O comparador só lê arquivos locais; ignora BOM e diferenças CRLF/LF.
Diferenças em comentários/espaços também são sinalizadas; não é comparação semântica.
Registre projeto, banco e horário da consulta separadamente para rastreabilidade.
