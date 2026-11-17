# APPCAR

Aplicativo de gestão de turnos, combustível, reservas e despesas, reconstruído em Next.js e React. Mantém o projeto Firebase e o formato dos dados da versão anterior.

## Executar

```powershell
npm.cmd install
npm.cmd run dev
```

Abra http://localhost:3000. No PowerShell, os comandos com `.cmd` funcionam mesmo quando a política de execução bloqueia `npm.ps1`.

## Organização

- `src/app/page.tsx`: sessão, navegação e ações do painel.
- `src/components/gestao/TurnoForm.tsx`: formulário com um estado único; o resumo deriva diretamente dos campos.
- `src/lib/gestao.ts`: cálculos e tipos compatíveis com o histórico anterior.
- `src/lib/useGestao.ts`: carregamento, cópias locais e sincronização serializada.
- `src/components/gestao/`: custos fixos, movimentações avulsas e relatórios.

## Regras do turno

- Preço por litro = valor gasto ÷ litros abastecidos.
- Consumo médio = KM trabalhado ÷ litros abastecidos.
- Reserva de acidente = R$ 0,038 × KM total do carro.
- Reservas diárias são valores diretos por turno e entram nas despesas do turno.
- Custos fixos são rateados de segunda a sábado, descontando os feriados configurados no calendário do aplicativo. O rateio usa o mês da data escolhida.
- A edição preserva o rateio e as saídas do turno original. Salvar uma edição mantém o mesmo ID.
- Retirar de uma reserva ou caixinha reduz o saldo dessa reserva, sem descontar novamente o saldo principal.
- Ao salvar, os nomes das reservas permanecem e os valores do próximo turno começam zerados.

## Preservação dos dados

O documento continua em `users/{uid}/appData/main`; a cópia local continua em `gestao-app-dados-v2-{uid}`. As regras em `firestore.rules` não precisam mudar.

Carregar o painel não grava na nuvem. Na primeira leitura, a versão reconstruída guarda uma cópia dos dados locais e outra dos dados da nuvem no navegador, com os sufixos `-antes-reconstrucao` e `-nuvem-antes-reconstrucao`. Os registros antigos são mantidos como foram salvos; atualizar a tela não os recalcula.

Alterações são copiadas para um journal próprio de cada aba antes da sincronização. As gravações usam transações que comparam a base confirmada com o documento atual: outro dispositivo não pode ser sobrescrito silenciosamente por um cliente atualizado. Se houver divergência, a edição local permanece pendente e o painel pede que o usuário escolha a versão a usar, preservando cópias das versões anteriores. O botão **Exportar backup** baixa os dados atuais em JSON; a exportação na aba **Privacidade** inclui também as cópias locais. Veja [sincronização segura e testes](docs/sincronizacao-segura.md).

Os formulários de turno permanecem preenchidos ao trocar de aba dentro do painel. Um formulário ainda não salvo não sobrevive ao fechamento ou recarregamento da página.

Para o Firebase, habilite Email/Password no Authentication, autorize o domínio e publique `firestore.rules` no projeto existente. O código local não publica regras nem altera configurações do Firebase.

## Verificar

```powershell
npm.cmd test
npm.cmd run test:dashboard
npm.cmd run lint
npm.cmd run build
```

O teste de interface usa o Next.js real, Chrome sem interface e armazenamento simulado em um projeto temporário dentro de `.next/dashboard-check`. Não utiliza contas ou documentos reais. Requer Node.js 24 e Chrome no caminho padrão do Windows; outro executável pode ser informado em `CHROME_PATH`. Verifica nomes e totais, combustível, exclusão e cancelamento, edição sem duplicação, preservação do histórico, layout móvel e recuperação de falhas de sincronização.

A cópia do código anterior à reconstrução fica em `.backups/`, ignorada pelo Git. Essa cópia contém código, não os documentos de sua conta Firebase.
