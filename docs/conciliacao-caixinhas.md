# Conciliação e auditoria de caixinhas

## Consulta atual

Histórico e relatórios mostra as pendências de todo o espaço consultado, independentemente do mês selecionado. A tela usa os dados já carregados no painel. Coincidências exatas de nome e referências em conflito são evidências para revisão. IDs duplicados ficam fora do conjunto de identidades atribuíveis.

## Fluxo proposto para autorização posterior

1. O proprietário abre a pendência, consulta o registro original e inspeciona as candidatas pelo ID permanente.
2. **Manter pendente** fecha a revisão sem gravação. A opção fica disponível mesmo quando há só uma candidata.
3. Para **Confirmar vínculo**, o proprietário seleciona explicitamente a caixinha, informa o motivo e confere o resumo com os IDs da movimentação e da caixinha.
4. Antes de gravar, a operação verifica o UID do proprietário, a geração financeira, a identidade da movimentação, o estado da caixinha e eventual conciliação concorrente. Se o registro mudou, reabre a revisão. Grava o vínculo separado do lançamento original e o evento de auditoria na mesma transação. Reutiliza o ID da operação nas tentativas.
5. Quando um registro carecer de identidade estável, mantém a pendência até estabelecer uma referência verificável. A posição da linha serve para consulta naquela versão do histórico. Uma correção posterior produz outro evento relacionado ao original.

## Eventos propostos

Cada evento contém um ID único, o ID permanente da caixinha, o tipo, a data e hora de confirmação e o UID do autor derivado da sessão autenticada. Inclui motivo quando aplicável. Cada evento é acrescentado ao histórico, preservando os anteriores.

| Evento | Dados específicos |
| --- | --- |
| Criação | Nome e finalidade iniciais. |
| Renomeação | Nome anterior e novo. |
| Arquivamento | Estado anterior e novo, motivo e ID da operação relacionada quando existir. |
| Reativação | Estado anterior e novo e motivo. |
| Conciliação | ID da movimentação, ID do lançamento pai quando aplicável, referência legada original, ID da caixinha escolhida e motivo. |

A proteção da autoria e de eventos já confirmados deve ser aplicada na camada de gravação. O armazenamento, a visibilidade da auditoria em espaços compartilhados e o tratamento de backups, restauração e reinicialização dependem de aprovação antes da persistência.

## Etapa 3B

O protótipo usa somente estado em memória e dados fictícios. Seu roteiro de navegador cria uma rota temporária na cópia de teste do painel. O relatório real continua a usar os dados existentes. Estado arquivado é explícito e vinculado ao ID permanente. A ausência de uma configuração legada, isoladamente, permanece evidência histórica.

### Referência verificável

Escopo de verificação proposto na gravação futura: UID proprietário e geração financeira, mais o identificador único do lançamento pai, a família da movimentação, a chave original quando existir e o SHA-256 de uma representação versionada. A versão inicial inclui data e tipo do lançamento e os campos registrados do subitem. Chave explícita duplicada, pai ausente ou duplicado e subitens indistinguíveis sem ID mantêm a pendência. A posição só seleciona a linha exibida e fica fora da referência. O hash verifica a evidência original, sem provar a qual caixinha ela pertence. Uma edição relevante invalida a revisão e exige nova conferência. Guardar a evidência original mínima no futuro evento, com visibilidade privada para o proprietário.

### Armazenamento e integração propostos

| Dimensão | Proposta para ativação posterior |
| --- | --- |
| Estado, vínculos e auditoria | Guardar o catálogo de estado, os vínculos de conciliação e a trilha de auditoria em coleções separadas sob o UID proprietário. Usar um documento por evento, com ID da operação reutilizado em tentativas, carimbo de tempo do servidor e revisão confirmada. A trilha cresce independentemente do documento financeiro. |
| Autorização | Reservar comandos ao proprietário autenticado. Recomenda-se uma camada confiável de gravação que confira UID, geração, revisão, estados e evidência, atribua autoria e horário e acrescente o evento de auditoria. Impedir alterações e exclusões diretas pelos clientes. Restringir a leitura da trilha privada e testar isolamento e revogação no emulador. [Regras por campo e acesso a documentos](https://firebase.google.com/docs/firestore/security/rules-fields) |
| Sincronização | Executar a mudança de estado e o evento na mesma transação autorizada. O catálogo precisa sinalizar a versão compatível com o documento financeiro. Avaliar bloqueio de clientes antigos e validadores para todas as entradas de escrita, inclusive edições retroativas, antes de ativar a exclusão de arquivadas nas novas movimentações. Projetar transações para repetição em concorrência e exigir confirmação atualizada quando o contexto mudar. [Transações do Firestore](https://firebase.google.com/docs/firestore/manage-data/transactions) |
| Compartilhamento | Manter a trilha privada separada dos documentos que parceiros podem ler por inteiro. Se aprovado, oferecer uma projeção de leitura com estado e informações pertinentes ao relatório, sem motivos privados nem UID do autor. |
| Backup, restauração e reset | Definir exportação versionada que reúna documento financeiro, catálogo, vínculos e trilha sob a mesma geração e revisão verificáveis. Validar UID, referências e integridade antes de recuperar. Preservar eventos anteriores e deduplicar por ID. Definir política de retenção e de segregação por geração no reset. Exercitar restauração isolada e reconciliar com os backups JSON do aplicativo. [Backups do Firestore](https://firebase.google.com/docs/firestore/backups) |

### Sequência de ativação

1. Aprovar escopo de leitura compartilhada, política de retenção, formato de backup e compatibilidade com clientes antigos. Confirmar por simulação somente leitura quais IDs legados podem ser reaproveitados.
2. Implementar atrás de um controle de ativação, com testes no emulador de permissões, autoria, eventos imutáveis, repetição, concorrência, restauração e reset. Medir o comportamento de cada versão do cliente.
3. Habilitar comandos de criação, renomeação, reativação e arquivamento com saldo zero somente após conferir que todos os caminhos de movimentação respeitam o estado e preservam nome e finalidade registrados na época. A projeção dos movimentos antigos usa os campos existentes e indica metadados ausentes.
4. Manter o arquivamento com saldo negativo bloqueado. Para saldo positivo, aguardar uma etapa que valide uma transferência explícita para o Saldo principal ou outra caixinha ativa, confirmada junto com o arquivamento e o evento.
5. Para recuar após ativação, suspender comandos novos e continuar lendo o formato introduzido e sua auditoria. Aprovar separadamente o momento de qualquer gravação ou liberação em produção.

## Etapa 3C — piloto no emulador

O adaptador exige o projeto fictício demo-appcar-ciclo, Firestore em 127.0.0.1:8089 e UID fictício. A suíte confere o hub em 127.0.0.1:4413 e a configuração de cada cliente antes das gravações. O aplicativo real continua sem importar o adaptador.

| Caminho sob o proprietário | Conteúdo |
| --- | --- |
| caixinhasControle/piloto | Marcador provisionado na fixture. Enquanto ativo, congela escritas financeiras de clientes antigos e permite o reset somente ao operador autorizado. As regras atuais continuam valendo nas contas sem marcador. |
| caixinhasCatalogo/{id} | UUID preservado no namespace de reservas diárias, proprietário, nome, finalidade, estado, versão, operação e datas do servidor. |
| caixinhasAuditoria/{operacaoId} | Evento privado e imutável, autor, momento da confirmação, geração e revisão financeiras, versões, snapshots anterior e posterior e motivo. |
| caixinhasConciliacao/{id} | Caminho reservado com leitura do proprietário e escrita bloqueada. |

O piloto usa uma alegação de operador exclusivo dos testes para verificar o saldo na mesma transação, a partir do histórico financeiro registrado. A transação compara geração, revisão e versão da caixinha. O evento e a mudança precisam ser gravados juntos, e a repetição idêntica devolve o recibo anterior. A regra verifica o pareamento dos documentos com getAfter. O saldo atestado depende da confiança no operador. As regras por si só não somam os lançamentos e nenhuma credencial de operador integra o painel. [Validação atômica com regras do Firestore](https://firebase.google.com/docs/firestore/manage-data/transactions#data_validation_for_atomic_operations)

A restauração é um exercício da fixture em ambiente vazio, com cópia da mesma conta e geração e deduplicação por ID. O fluxo de backup, restauração e sincronização usado pelo painel permanece como está. A ativação futura requer restaurador autorizado com validação integral de esquemas e referências, detecção de colisões de conteúdo e política explícita para gerações antigas. O piloto cria apenas caixinhas novas. Adoção de IDs legados existentes, proteção contra movimentos novos em caixinhas arquivadas e acesso compartilhado ao catálogo ficam para autorização posterior.

Para reverter o piloto local, encerrar o emulador dedicado e preservar o código e o histórico de testes. Em uma ativação futura com dados duráveis, retirar o acesso aos comandos, manter as leituras do catálogo e da auditoria e conservar a proteção contra escritas incompatíveis até existir um caminho de gravação compatível. A retomada requer conferência de versão e geração, além de autorização separada.

## Etapa 3D — integridade financeira e compatibilidade

O teste usa operadores fictícios distintos para catálogo e financeiro. O módulo Node do piloto calcula o saldo pelo histórico confirmado dentro da transação e consulta os documentos das caixinhas afetadas ao gravar. Um arquivamento disputa pela mesma versão financeira que um crédito ou retirada. A gravação avança uma revisão e cria um recibo imutável da alteração na mesma transação. O recibo diferencia uma repetição da mesma alteração de um comando concorrente. As regras conferem a presença de ambos com getAfter. Nenhuma capacidade de atestar ou gravar é entregue ao painel. [Validação de operações atômicas no Firestore](https://firebase.google.com/docs/firestore/manage-data/transactions#data_validation_for_atomic_operations)

| Caminho atual | Tratamento exigido antes de ativar no painel |
| --- | --- |
| Salvar e editar turno | Passar pelo comando financeiro. Considerar reservas diárias, rateios, reservas fixas, data do turno e modelo de reservas atualizado no salvamento de um turno novo. O protótipo testa lançamento e configuração de forma separada. |
| Entrada e saída avulsa | Identificar a origem pelo ID. O saldo principal continua com a semântica atual. Só operações de caixinha com estado explícito recebem o controle adicional de saldo no piloto. |
| Excluir e editar retroativamente | Comparar as evidências anteriores e novas de cada caixinha. Rejeitar alterações em contribuições, retiradas ou registros configurados ligados a uma arquivada. Impedir que uma revisão reaproveite o saldo já consumido. |
| Configurações | Aplicar a mesma política ao modelo de reservas e aos custos fixos. Considerar seus efeitos em turnos futuros e manter os rateios históricos. |
| Sincronização, resolução de conflitos e recuperação local | As escritas atuais passam por conditionalWrite, mas as regras bloqueiam esse caminho em contas do piloto. Antes de integrar, converter as operações já validadas para comandos da camada confiável e preservar pendências offline e resolução explícita. |
| Reinicialização e restauração | Reset continua separado da movimentação normal e deixa intactos catálogo, auditoria e recibos de gerações anteriores. Antes de disponibilizar restauração, validar identidade, autorização, evidências e geração na mesma janela de execução. |

A adoção legada é uma projeção sem gravação. Reutiliza as chaves explícitas com namespace, inclusive para homônimas, e mantém pendências sem correspondência comprovável. O piloto persistente continua restrito a caixinhas diárias com UUID. O planejador de restauração aceita exportação financeira simples, exportação de privacidade e backup de reinicialização em modo de consulta. No formato com catálogo, auditoria e recibos, verifica o proprietário, a geração, a sequência de eventos, o estado final e colisões de conteúdo sob o mesmo ID. O ensaio grava apenas na fixture vazia. Destinos cujo financeiro ou catálogo divergem exigem análise explícita.

Ainda faltam um endpoint autenticado confiável, validação completa do lançamento antes de aceitar valores do cliente, comando composto para turno e modelo de reservas, adoção persistente de IDs de todas as famílias, autenticação do arquivo de backup e restaurador autorizado para contas com dados. As regras controlam papéis e atomicidade. A soma e a detecção de alterações dependem do operador confiável. O piloto usa o cálculo existente, inclusive sua precisão numérica. Divergências de arredondamento devem ser avaliadas antes de definir a política de saldo zero em produção. Nenhuma transferência faz parte desta etapa.

## Etapa 3E — comando financeiro no emulador

O comando valida turno novo e edição, entrada, retirada, exclusão e custos fixos. Ele recebe valores monetários em centavos inteiros e deriva os totais sobre a versão confirmada do documento. Um turno novo grava o lançamento, o modelo de reservas com valores zerados, a revisão e o recibo na mesma transação. A edição mantém o modelo vigente e reutiliza o rateio do turno original. A suíte encerrou a etapa com 14 testes aprovados no projeto fictício.

## Etapa 3F — auditoria para integração futura

| Requisito | Classificação | Resultado e limite |
| --- | --- | --- |
| Autorização e atomicidade do piloto | Implementado e testado | O Firestore Emulator aplica as regras sobre o UID autenticado, o provedor não anônimo, a marca de piloto e a alegação de operador exigida para cada operação. As fixtures fornecem identidade e alegações por `authenticatedContext`. A regra confere autoria, revisão, horário e pareamento de documentos. |
| Autenticação e autorização em produção | Depende de infraestrutura ou autorização futura | O adaptador exige projeto fictício e loopback. Falta um serviço que valide o token, derive o UID da sessão, faça a autorização em cada comando e mantenha a identidade de serviço sob controle do servidor. O cálculo do saldo e a validação do conteúdo financeiro estão no operador. As regras conferem o recibo e a revisão, mas não recalculam os dados nem garantem que a escrita passou pelo validador. Se for usado Admin SDK, o serviço precisará aplicar a política integralmente, pois esse acesso não usa as regras do cliente. |
| Operação offline e reenvio | Parcialmente implementado | O piloto recusa a escrita offline. O teste serializa o comando e o reenvia manualmente com o mesmo UUID após religar a rede. O recibo por geração e revisão reconhece a repetição idêntica. A sincronização legada persiste o estado pendente separadamente. |
| Fila durável para comandos | Não implementado | Falta persistência por UID e geração, recuperação após reiniciar, estado de envio e confirmação, detecção de conflito e unicidade do ID no escopo definido para todos os tipos. O recibo atual é indexado por revisão e o UUID da operação integra a assinatura. Inserções também usam o UUID no ID do lançamento. |
| Revisão, concorrência e mudança de geração | Implementado e testado | O comando antigo que ainda não foi gravado é rejeitado após o reset fictício. Uma repetição já confirmada pode retornar o recibo antigo sem gravar na nova geração. Arquivamento e turno disputam a mesma versão financeira e os testes conferem o documento final. |
| Política em centavos | Parcialmente implementado | A entrada recusa frações de centavo. Valores derivados e saldos ainda usam a fórmula legada em ponto flutuante. O teste de caracterização reproduz o resíduo de R$ 0,10 + R$ 0,20 − R$ 0,30 e o bloqueio de arquivamento apesar de a soma inteira resultar em 0. |
| Salvamento conjunto de turno e modelo | Implementado e testado | A transação grava os dois na inclusão e preserva os dados anteriores quando o arquivamento vence a disputa. A edição preserva o rateio histórico. |
| Cobertura de todas as rotas de gravação | Parcialmente implementado | Os dois operadores financeiros do piloto aplicam a comparação de evidências. A consulta de estado persistente cobre reservas diárias com UUID. Fora do piloto o painel continua usando a gravação de snapshots. Edição e exclusão de turno, avulsos e custos usam esse caminho, assim como sincronização, resolução de conflitos e recuperação. Reset usa um caminho separado. |
| Cliente antigo e usuário sem permissão | Implementado e testado | Na conta marcada, o caminho legado é bloqueado. O proprietário sem alegação e outra conta não executam o comando financeiro. A parceria pode ler o financeiro quando autorizada, mas não gravar nem ler os recibos. |
| Adoção persistente de IDs legados | Não implementado | A projeção conserva IDs explícitos com namespace e lista as evidências ambíguas sem atribuir vínculo. A persistência exigiria um plano de identidade para todas as famílias e validação das colisões antes de autorizar a gravação. |
| Restauração e preservação dos totais | Parcialmente implementado | Backups legados são consultados sem gravar. O plano atual preserva o documento financeiro e os totais, deduplica recibos e eventos idênticos e rejeita divergência de conteúdo ou geração do destino. A gravação em destino vazio foi exercitada apenas pela fixture. Falta um restaurador autorizado, autenticação de procedência e validação integral do histórico e das referências. |

### Política monetária proposta

Representar valores novos e limites de saldo em centavos inteiros. Rejeitar frações de centavo em campos monetários recebidos. Na nova rotina de cálculo, usar aritmética inteira ou racional, com arredondamento ao centavo mais próximo e empate para longe de zero nos valores derivados. Para novos rateios, distribuir o resto em centavos por uma ordem estável de dias, preservando a soma mensal. Somar os centavos antes de comparar saldo zero ou verificar saldo insuficiente.

Manter íntegros os valores históricos, inclusive rateios com frações de centavo. Preservar a leitura e os totais atuais. Para decisões sobre o saldo de uma caixinha, projetar valores históricos sem gravar alterações. Se houver valor fracionário histórico, origem ambígua ou total fora do limite de inteiros seguros, deixar a decisão pendente até existir uma reconciliação explícita. A suíte verifica a fronteira de entrada e a preservação histórica. O cálculo integral proposto ainda requer implementação e testes de soma mensal, limites, empates e compatibilidade.

### Ordem de integração proposta

1. Definir o contrato monetário, o catálogo aplicável a cada origem e as condições para conciliação e restauração. Conferir backups fictícios em consulta, com cotejo dos totais legados.
2. Implementar e testar o serviço autenticado, a autorização por conta e a identidade de serviço. Unificar os caminhos de gravação e testar a proteção de toda origem afetada, incluindo edição, exclusão, configuração, recuperação e reset.
3. Implementar a fila durável por conta e geração, com recibo por ID de operação, reenvio idempotente, quarentena de operações antigas e resolução explícita de conflitos.
4. Ensaiar adoção e restauração autorizadas em ambiente isolado, com deduplicação, retenção de evidências pendentes e conferência dos totais. Validar a convivência com versões antigas e o plano de reversão.
5. Após nova autorização, habilitar um piloto controlado e ampliar somente depois de verificar os resultados e a possibilidade de suspensão segura.

### Verificação local

Passaram 18 testes de ciclo, 13 de regras e 52 de sincronização no Firebase Emulator Suite. A suíte local de cálculos, catálogo e ciclo também passou, assim como a verificação de TypeScript e o ESLint dos arquivos auditados. O teste registrou o resíduo monetário observado na Etapa 3F. A Etapa 3G cobre a correção no piloto.

## Etapa 3G — centavos e identidade no piloto

O piloto usa aritmética inteira para somar as evidências de saldo, conferir limites, calcular os totais de um comando de turno e decidir se uma caixinha pode ser arquivada. Entradas monetárias do comando são centavos inteiros. Valores históricos em reais entram no cálculo somente se o decimal armazenado representar centavos exatos e puder ser convertido sem ambiguidade. Um valor de configuração serve para identificar a caixinha, e os valores de saldo vêm das movimentações confirmadas. O relatório e os lançamentos anteriores conservam a leitura legada.

| Aspecto | Comportamento no piloto 3G |
| --- | --- |
| Saldo zero | R$ 0,10 + R$ 0,20 − R$ 0,30 soma 0 centavos. Os saldos positivos e negativos continuam impedindo o arquivamento. |
| Valores derivados | O cálculo da reserva de acidente arredonda a razão inteira ao centavo mais próximo, com empate para longe de zero. As despesas e o líquido são somados em centavos. |
| Novos rateios | Divide cada custo mensal pelos dias de trabalho do calendário existente. Atribui um centavo extra aos primeiros dias elegíveis até esgotar o resto. O resultado depende da data e permanece estável em lançamentos fora de ordem. Turnos novos em dias inelegíveis ou já rateados recebem zero. Todas as parcelas previstas somam o mensal se a configuração permanecer estável. Dias sem turno e mudanças de custos durante o mês podem fazer a soma efetivamente lançada diferir. |
| Edição histórica | Conserva o rateio e os nomes das reservas já registradas naquele turno. Se a edição depender de um rateio ou saída fracionária ou inválida, aguarda conciliação. A projeção e o planejamento são operações de leitura. |
| Evidências pendentes | Frações de centavo, valores inválidos, negativos usados como magnitude de uma movimentação, estouro no total, IDs ausentes ou duplicados e referências por nome ou em conflito impedem atestar o saldo da identidade afetada. Frações que se cancelam também exigem conciliação. |

O plano de adoção é versionado e ordenado por ID e conteúdo das evidências. Mantém o ID original no namespace da família, distingue homônimas, conserva nomes históricos e trata pais e retiradas sem identidade estável como pendências. A posição da evidência na lista fica fora do plano. Para uma adoção futura, conferir proprietário, geração, revisão e evidências novamente, validar a codificação das chaves de armazenamento e colisões com o catálogo persistido. Gravar somente identidades aprovadas após autorização. As referências ambíguas continuam disponíveis para revisão individual.

Os comandos e as decisões de saldo operam no emulador dedicado. As regras e o formato do recibo permanecem na versão anterior. O estado persistido do piloto ainda é restrito às reservas diárias com UUID. A adoção de todas as famílias requer uma etapa futura.

## Etapa 3H — serviço autenticado no emulador

O comando `npm run test:financeiro-servico` inicia Auth e Firestore no projeto fictício `demo-appcar-financeiro`. O serviço Node escuta apenas em loopback, confere os endereços dos emuladores e usa uma conexão administrativa local. As regras exclusivas dessa configuração negam leitura e escrita por clientes. A arquitetura do painel e as regras gerais do projeto seguem o fluxo anterior.

| Fronteira | Verificação |
| --- | --- |
| `POST /sessao` | O servidor envia as credenciais fictícias ao Auth Emulator e obtém o UID da resposta. Emite um bearer opaco, válido por cinco minutos e mantido em memória. A API recebe apenas esse bearer para executar comandos. Os tokens não assinados emitidos pelo Auth Emulator não são aceitos diretamente pela API. |
| `POST /espacos/{uuid}/comandos` | O identificador externo seleciona o espaço. O UID vem da sessão. A transação lê a configuração interna do espaço e exige proprietário correspondente e permissão de comandos ativa. O corpo aceita os campos do contrato financeiro. UID, permissões e totais calculados ficam fora desse contrato. |
| Gravação | Na mesma transação, o serviço verifica a geração vigente, aplica a regra de revisão, valida a operação, resolve as identidades afetadas, lê seu estado, calcula seus saldos em centavos e escreve o resultado com a auditoria. Uma identidade afetada com cadastro indisponível ou referências ambíguas exige revisão antes da escrita. |
| Recibo | O documento de auditoria usa o UUID da operação no espaço. Guarda autor, geração, revisões anterior e confirmada, tipo, lançamento alvo quando aplicável, caixinhas afetadas, assinatura do conteúdo e horário do Firestore. Na geração vigente, reenvio idêntico retorna o recibo original mesmo após novas revisões. Conteúdo diferente com o mesmo UUID gera conflito. A geração é verificada antes da consulta ao recibo. |
| Histórico | A edição deriva os totais pelo comando da 3G e preserva o rateio aplicável e o nome histórico. A presença de valores fracionários históricos que impeçam a validação mantém a operação pendente de conciliação. |

O espaço privado armazena controle de acesso em `espacosFinanceiros/{id}`, financeiro em `dados/main`, estados de caixinhas em `caixinhas/{idCodificado}` e recibos em `operacoes/{uuid}`. As fixtures provisionam esses documentos e simulam mudanças de geração e estado. O serviço oferece os comandos financeiros de turno, entrada, retirada, exclusão e custos fixos. Administração de catálogos, conciliação persistente, reset, restauração e gestão de espaços requerem caminhos próprios.

### Limites da proteção e integração futura

Em produção, substituir a sessão local pela verificação de identidade Firebase no servidor, com verificação de projeto, assinatura, expiração e revogação. A sessão local expira por tempo e não consulta a revogação a cada comando. Usar uma identidade de serviço dedicada com permissões restritas, definir HTTPS, limites de requisição e política de sessão, e impedir que credenciais administrativas cheguem ao navegador. No emulador, a identidade administrativa da fixture também pode gravar, como ocorre no teste de mudança de geração.

O bloqueio de clientes foi testado no espaço privado com as regras locais da 3H. O fluxo legado ainda permite gravações nas contas autorizadas pelas regras gerais. Para fechar esse caminho, é necessário inventariar escritas legadas e administrativas, implementar os caminhos autorizados de provisionamento e manutenção, preparar a transição dos dados e validar a revogação de gravações legadas no momento do corte. A fila offline continua em uma etapa posterior. Qualquer ativação exige nova autorização.

### Evidência local

A suíte exerceu o serviço por HTTP com dois usuários criados no Auth Emulator. Conferiu o UID do autor na auditoria, o acesso cruzado negado, a revisão do documento gravado, a ausência de recibo em comandos recusados e o bloqueio de escrita direta com o SDK autenticado. Também verificou concorrência, reenvio, geração antiga, saldo, estado das caixinhas e preservação do rateio histórico.

## Etapa 3I — fila offline do piloto

A fila usa IndexedDB com confirmação estrita de escrita. Cada fila é identificada pelo UID autenticado, espaço e geração. O comando é copiado no enfileiramento e recebe um UUID aleatório. O reenvio mantém o UUID, a geração, a revisão original e o conteúdo. A API da fila envia somente ao endpoint autenticado de comandos da mesma origem. O serviço compara a conta esperada com o UID da sessão e aplica as mesmas verificações transacionais da Etapa 3H.

| Estado | Tratamento |
| --- | --- |
| Pendente | Gravado localmente e aguardando envio ou confirmação. Falta de sessão, falha de rede ou resposta sem recibo verificável mantêm esse estado para nova tentativa. |
| Enviando | Gravado antes da requisição. Um Web Lock exclusivo por escopo acompanha a leitura, escrita e requisição. Se a aba fechar, outra tentativa pode recuperar o estado e reenviar o UUID original. |
| Confirmado | A fila grava o recibo e o estado na mesma escrita local após verificar o UUID e a revisão confirmada. Um recibo recuperado por idempotência satisfaz o mesmo contrato. |
| Conflito | Revisão divergente ou colisão de conteúdo exige análise. O comando fica registrado com a revisão original e não entra automaticamente em outro envio. |
| Rejeitado | Geração antiga, falta de permissão no espaço, saldo insuficiente, caixinha arquivada ou comando inválido. O registro permanece na fila para consulta. |

### Recuperação e proteção local

1. Reabrir a mesma origem com o perfil de navegador original e desbloquear o escopo com o segredo local da conta. A integração futura deve derivar o escopo da sessão e bloquear a fila ao trocar de conta. Uma sessão de outra conta não consegue reenviar a fila do titular.
2. Para uma confirmação incerta, restabelecer a sessão e reenviar o mesmo comando. Se a transação já foi confirmada e a geração continua vigente, o serviço retorna o recibo original. Se a geração mudou, o serviço rejeita a tentativa e o comando permanece para revisão. Para conferir uma confirmação perdida de geração antiga, será necessário um caminho futuro de consulta autorizada à auditoria.
3. Conferir a revisão e as condições financeiras em conflitos. Caso a intenção ainda se aplique, uma decisão explícita pode gerar um comando novo com outro UUID. O módulo processa uma operação por chamada e não reescreve revisões em lote.
4. A limpeza explícita por data remove apenas confirmados com recibo local. Pendentes, envios interrompidos, conflitos e rejeitados continuam armazenados.

O conteúdo financeiro e os recibos são criptografados com AES-GCM. A chave é derivada em memória por PBKDF2 a partir de um segredo forte, diferente para cada conta, que o módulo não armazena. UID, espaço e geração permanecem visíveis como chaves de escopo. A proteção depende do segredo, da origem e do perfil. Código executado na mesma origem pode acessar a fila aberta. Perda do segredo, limpeza do navegador ou remoção do armazenamento podem impedir a recuperação. Um navegador sem IndexedDB, Web Locks e Web Crypto não abre a fila. A integração futura precisa definir recuperação do segredo e cópia segura de comandos ainda sem recibo.

A suíte `npm run test:fila-financeira` usa Chrome em perfil temporário, Auth e Firestore em loopback e um proxy local para interromper requisições antes e depois da confirmação. O painel mantém a sincronização anterior. A fila opera somente com o serviço do piloto e a ativação exige autorização posterior.

Na execução da Etapa 3I, o teste ponta a ponta recuperou o mesmo UUID após fechar e reabrir o Chrome. Duas abas emitiram uma única requisição de recuperação, e o recibo repetido confirmou a operação sem alterar o total novamente. A suíte também verificou conflito de revisão, geração antiga, saldo, caixinha arquivada, falta de permissão, troca de conta, segredo incorreto e limpeza restrita a confirmados.

## Etapa 3J — mapa e preparação da integração

O painel atual lê `users/{uid}/appData/main` por consulta e assinatura via `useGestao.ts` e `syncSession.ts`. O cache, o diário por aba e as versões de recuperação estão no navegador. As mutações de conteúdo passam por `conditionalWrite` e a reinicialização tem uma transação própria. O piloto HTTP grava em outro namespace. O corte precisa definir uma fonte autorizada por espaço para evitar duas versões financeiras graváveis.

| Caminho | Leitura e gravação atuais | Mudança futura por arquivo |
| --- | --- | --- |
| Cadastro de turno | `TurnoForm.tsx` lê o formulário, o modelo de reservas e os custos e calcula o lançamento. `page.tsx` atualiza histórico e modelo no mesmo snapshot. | Em `TurnoForm.tsx` e `page.tsx`, enviar valores de entrada em centavos e IDs permanentes pelo comando de turno, com geração e revisão da base. O serviço deriva os totais e retorna o recibo. |
| Edição de turno e exclusão | `page.tsx` recebe ações de histórico e relatórios em `Relatorios.tsx`, substitui ou remove o item por ID via `atualizar`. O formulário edita turnos. A exclusão também alcança avulsos. | Enviar edição/exclusão com ID do alvo e base observada. Revalidar rateio original e evidências antes/depois, inclusive efeitos em caixinhas arquivadas. Edição de avulsos exigiria contrato próprio caso seja adicionada. |
| Entradas e saídas avulsas | `AvulsoForm.tsx` lê saldos por `resumir`, seleciona a origem e monta o lançamento. `page.tsx` inclui o resultado no snapshot. | O formulário envia tipo, valor em centavos, data, descrição e origem escolhida. O serviço valida identidade, estado e saldo das caixinhas e mantém a semântica aprovada do saldo principal. Confirmar tratamento de origens legadas que não cabem no contrato atual. |
| Reservas diárias e fixas | `TurnoForm.tsx` carrega o modelo, permite acrescentar/remover reservas diárias e inclui valores no turno. O turno novo renova o modelo com valores zerados. A edição recupera valores do turno anterior. Os nomes de reservas fixas são lidos dos dados. | Provisionar previamente as identidades exigidas pelo serviço ou projetar um comando atômico de criação e turno. Usar referências permanentes nos seletores e preservar nomes históricos. Mudanças de catálogo, modelo isolado e nomes fixos precisam de autorização e contrato explícitos. |
| Custos fixos | `CustosFixos.tsx` lê e edita a configuração. `page.tsx` substitui a lista. Turnos usam o rateio salvo. | Encaminhar a lista validada ao serviço em centavos. Cobrir criação, desativação e identidade de cada custo. Preservar os rateios históricos mesmo quando a configuração mudar. |
| Caixinhas acumuladas e relatórios | `Relatorios.tsx`, `AvulsoForm.tsx` e `gestao.ts` leem o histórico e os nomes por `resumir`. `PendenciasConciliacao.tsx` usa a projeção para consulta. A tela de ciclo é um protótipo local. | Entregar uma projeção autorizada com saldo verificável, estado e evidências pendentes. Manter os totais históricos na apresentação. Criar caminhos de catálogo e conciliação no serviço antes da ativação. |
| Preferências | `page.tsx` usa o mesmo snapshot para tema e lembrete. | Retirar preferências do caminho de gravação financeira ou criar operação com permissão e campos específicos. Evitar manter acesso a snapshots financeiros apenas para gravar preferências. |
| Sincronização automática | `useGestao.ts` abre `SyncSession`, acompanha nuvem e eventos de conexão/localStorage. `syncSession.ts` grava por transação em `conditionalWrite`. | Criar adaptador novo de leitura e enfileirar intenções no escopo do UID, espaço e geração. A tela confirma e recarrega pelo recibo. Um snapshot legado pendente vai para prévia e revisão humana, sem envio automático. |
| Conflito e recuperação local | `page.tsx` permite escolher nuvem/local e recuperar cópias. `SyncSession.resolve` pode gravar a versão local inteira. `recover` recupera uma cópia com revisão pendente. | Desligar a escolha que publica o snapshot para espaços ativados. Comparar versões e reconstruir somente intenções explicitamente aprovadas, com UUID novo se a intenção ou a base mudou. |
| Backup, restauração e reinicialização | `page.tsx` exporta os dados em uso. `Privacidade.tsx` inclui cópias da sessão e navegador. `ReiniciarDados.tsx` confere o backup e chama `resetTransaction` via `useGestao.ts`. A recuperação local e a prévia do piloto são os caminhos observados. O painel não tem importador geral de JSON financeiro. | Versionar o pacote de backup, com leitura e validação antes de qualquer escrita. Criar operações separadas de restauração e reset no serviço. O reset confirma a mesma base, avança geração e preserva a trilha anterior. |
| Espaços compartilhados | `useCompartilhamento.ts` e `compartilhamento.ts` leem convites e criam, aceitam ou revogam em `shareInvites`. O Dashboard do parceiro abre cache separado e só leitura. As regras conferem a parceria vigente no caminho de dados. | Separar leitura autorizada de escrita do proprietário. Revalidar vínculo por requisição. Reservar caixa privada, auditoria, recibos, backup, reset e fila ao proprietário. A revogação bloqueia novas leituras e não recolhe cópias já vistas. `GestaoFamiliar.tsx` é vitrine sem persistência financeira. |

Em `comandoFinanceiro.ts`, `centavosFinanceiros.ts` e `integridadeCaixinhas.ts`, manter a interpretação de históricos sem recálculo e resolver os casos que exigem conciliação. Em `servicoFinanceiroEmulador.ts` e no futuro serviço de produção, prever provisionamento autorizado, projeção de leitura, catálogo, manutenção e credencial exclusiva do servidor. `filaFinanceiraOffline.ts` precisa de vínculo com a sessão do painel, fluxo de desbloqueio e tratamento explícito de conflitos. `firestore.rules` exige política de corte por espaço que negue criação, atualização, reset e exclusão por clientes legados, mesmo com UID válido. O marcador e as alegações de operador do piloto atual servem de ensaio, e as regras privadas da 3H protegem somente o namespace novo.

### Prévia e adoção de IDs

A função `preverAdocaoLegada` em `compatibilidadeFinanceira.ts` recebe o JSON e as identidades do catálogo de destino. Apresenta a fonte escolhida, as alternativas disponíveis, os totais da fonte, os IDs propostos, os reaproveitados, colisões e evidências pendentes. O arquivo original fica guardado na prévia, inclusive cópias e versões que não foram selecionadas. O backup simples não contém UID verificável, e os metadados de titularidade dos outros formatos identificam o arquivo sem autenticar sua procedência.

Em uma adoção autorizada, fixar o UID, o espaço, a geração, a revisão e a assinatura do conteúdo de origem e do manifesto aprovado. Preservar as chaves inequívocas no namespace `fixo:`, `diaria:` ou `reserva-fixa:`. Reutilizar o registro persistido compatível e seu estado. Homônimas continuam separadas por ID. Colisões, IDs ausentes, duplicados e vínculos por nome ficam pendentes. Na escrita futura, conferir a base e a chave novamente na transação, usar uma chave de operação idempotente e parar diante de divergência. Conferir nomes, lançamentos e totais antes e depois. A prévia desta etapa não grava o catálogo.

### Backup, recuperação e reversão

| Fonte | Conteúdo disponível |
| --- | --- |
| `appcar-backup-*.json` | Snapshot em uso, configurações e histórico. |
| `appcar-meus-dados-*.json` | Conta declarada, dados em uso, última nuvem carregada e cópias do navegador. |
| `appcar-reset-backup-v1` | UID, remoto, local, base, estado pendente/conflito e cópias anteriores ao reset. |
| Pilotos 3C–3I | Catálogo, auditoria, recibos por revisão do ciclo, registros por UUID do serviço e fila criptografada no navegador. A nova suíte agrega essas evidências em um JSON de ensaio. Os exportadores atuais não incluem o pacote completo. |

Para o formato futuro, definir manifesto com versão, titular, espaço, geração, revisão, origem, contagens e verificação de integridade/procedência. Tirar uma leitura consistente do servidor para catálogo, auditoria, recibos e financeiro e capturar separadamente o envelope criptografado de cada dispositivo autorizado. Preservar filas que possam conter envios sem confirmação. Registrar o instante de cada captura. Deduplicar pela identidade do registro e conferir conteúdo antes de reutilizar. Um conflito de ID, espaço, geração, revisão ou conteúdo bloqueia a restauração. Ensaiar inicialmente em destino vazio, sempre conferindo a correspondência de totais e recibos. O pacote de ensaio não é um importador.

Se o segredo da fila for perdido, preservar o navegador e o envelope criptografado, sem limpar ou sobrescrever o armazenamento. Procurar uma cópia autorizada do segredo e usar a mesma origem, perfil e escopo. Uma fila ainda aberta em outra aba pode estar desbloqueada e deve ser conferida antes de ser fechada. Sem segredo nem instância desbloqueada, os comandos locais não enviados são irrecuperáveis pelo servidor. Confirmar na trilha os recebidos antes de reconstruir intenções manualmente, com outra chave e novos UUIDs somente depois da revisão. O piloto ainda precisa de consulta autorizada à auditoria e de exportação versionada do envelope em uma integração futura.

Na reversão, suspender novos comandos e reenvios, manter a leitura autorizada e o bloqueio das gravações legadas, preservar catálogos, recibos e filas. Verificar as operações incertas pela auditoria antes de retomar. Voltar a gravar snapshots antigos exigiria outro corte autorizado e um plano de reconciliação, pois abrir duas fontes de escrita pode sobrescrever confirmações já aceitas.

### Ordem de ativação e pontos de decisão

1. Definir identidade de produção, permissão de serviço, leitura do parceiro, contratos administrativos, versão mínima do cliente, capacidade e monitoramento. Validar backups de ensaio e política de recuperação do segredo.
2. Inventariar dispositivos e versões do piloto futuro, confirmar as bases remotas e pré-visualizar as propostas com totais. Exportar rascunhos legados e separar conflitos e filas por geração.
3. Após autorização, preparar bloqueio de escrita por espaço antes de liberar o escritor novo. Verificar abas antigas, proprietário, parceiro, revogação, sessão expirada, recuperação de cópias, conflitos e tentativas com geração antiga. A interface pode avisar para atualizar, mas o bloqueio precisa valer sem o aviso da interface.
4. Adotar somente identidades aprovadas em transação idempotente. Conferir as leituras e os totais. Liberar os comandos e a fila em um espaço piloto, com monitoramento de recusas, conflitos e reenvios sem recibo.
5. Reavaliar resultados e autorizar separadamente a ampliação. Os riscos prioritários são gravação dupla, incompatibilidade de IDs legados, alteração silenciosa de totais, perda do segredo local e revogação insuficiente de sessões ou parceiros.

### Evidência local da Etapa 3J

As fixtures reproduziram os três contratos JSON atuais, inclusive um backup de reinício com apenas a versão local disponível. A prévia respeitou colisões com a mesma chave lógica em outro ID, reutilizou IDs inequívocos e preservou totais e cópias pendentes. O ensaio do corte bloqueou `conditionalWrite` e `resetTransaction` em uma aba legada e confirmou a revogação de leitura do parceiro. O serviço rejeitou uma sessão expirada antes de gravar. No Chrome, o pacote fictício preservou catálogo, auditoria e recibos, e o envelope copiado para JSON pôde ser decifrado para recuperar a operação pendente sem importar dados. O ensaio não substitui a implementação de um exportador completo.

## Etapa 3K — preparação de identidade, administração e backup

| Área | Implementação local e limite |
| --- | --- |
| Identidade de servidor | `identidadeFinanceiraServidor.ts` prepara a ligação com o Firebase Admin Auth. Chama `verifyIdToken(token, true)`, confere projeto, emissor, expiração e correspondência entre UID e sujeito. A identidade retornada contém apenas o UID. A suíte usa um token do Auth Emulator e um verificador injetado para simular recusa por revogação. O HTTP do piloto continua usando a sessão opaca local. O SDK administrativo real, as credenciais e a verificação de revogação ponta a ponta ficam para a integração autorizada. [Verificação de tokens](https://firebase.google.com/docs/auth/admin/verify-id-tokens) · [Gerenciamento de sessões](https://firebase.google.com/docs/auth/admin/manage-sessions) |
| Comando financeiro | O serviço confere UID, espaço, habilitação financeira e lista de operações autorizadas na transação. Entradas sem autorização são recusadas antes de consultar recibos ou gravar. A lista é parte do controle privado do espaço fictício. |
| Administração | A concessão administrativa identifica titular, espaço e operações autorizadas. Provisionamento exige espaço ainda inexistente. Reset, restauração e manutenção exigem confirmação vinculada à operação, ao titular, ao espaço e à geração/revisão vigentes, com backup conferido. Apenas o backup recebeu um endpoint. Os demais são contratos locais sem executor. Uma integração futura deve verificar em fonte privada o identificador e a validade da confirmação do servidor e consumir a autorização transacionalmente. |
| Backup do servidor | `POST /espacos/{uuid}/backup` exige sessão e concessão de backup. Captura snapshot financeiro, catálogo e estados, auditoria e recibos no espaço privado do piloto. Confere estabilidade do controle, financeiro e coleções em leituras sucessivas antes de assinar. O formato `appcar-financeiro-backup-v1` usa manifesto versionado, SHA-256 e assinatura Ed25519. A validação usa uma chave pública confiável fornecida por fora do arquivo e confere vínculo de conta, espaço, geração, revisão e recibos. O ensaio usa chave efêmera, sem exportar a privada. |
| Fila offline | `exportarCopiaProtegida` produz o formato separado `appcar-fila-criptografada-v1`. Inclui escopo, origem, IV e conteúdo autenticado por AES-GCM. O segredo, o token e a senha ficam fora do arquivo. A conferência exige o segredo correto e o mesmo escopo e origem. A prévia recupera o conteúdo em memória e não modifica a fila existente. |
| Recuperação | Arquivos truncados, adulterados, de versão desconhecida, vinculação divergente ou chave desconhecida são recusados. A conferência pode ser refeita após interrupção com o original íntegro. Os testes comparam o financeiro antes e depois e conferem o reenvio idempotente do comando original. A restauração gravável, a reconciliação entre cópias diferentes e a adoção dos JSONs legados continuam caminhos separados. |

O backup financeiro assinado garante integridade e procedência vinculadas à chave confiável. O conteúdo financeiro do arquivo continua legível e sua guarda futura exige criptografia e controle de acesso. No piloto as leituras repetidas detectam mudanças observáveis. Em produção, a captura deve usar uma leitura consistente ou um protocolo versionado que cubra catálogo, manutenção e financeiro. Histórico antigo e auditoria anterior de outros formatos precisam de política e testes próprios de adoção. Para a fila, perda do segredo e da última instância desbloqueada impede recuperar comandos que ficaram apenas no navegador.

### Checklist para um piloto controlado

- [ ] Adotar Firebase Admin Auth com projeto explícito, TLS e verificação real de assinatura, expiração, revogação e conta desabilitada. Testar recusa segura quando a verificação estiver indisponível.
- [ ] Provisionar identidades distintas para execução financeira, exportação e manutenção, com credenciais gerenciadas e permissões mínimas. Verificar o escopo efetivamente aplicável e isolar recursos se for necessário. O acesso privilegiado do servidor depende de IAM. [Controle de acesso no Firestore](https://firebase.google.com/docs/firestore/security/iam)
- [ ] Implementar catálogo, provisionamento, reset e restauração com confirmação autenticada, operação idempotente, backup previamente verificado e revalidação transacional de geração e revisão. Preservar auditoria, recibos e registros pendentes.
- [ ] Provisionar assinatura gerenciada e registro confiável das chaves públicas por versão. Definir rotação, revogação, retenção, criptografia do arquivo e tratamento de exportações grandes.
- [ ] Ensaiar exportação consistente, recuperação em destino de teste, interrupção e retomada. Conferir totais, IDs, catálogo, recibos e comandos pendentes. Preservar a cópia cifrada quando o segredo da fila estiver indisponível.
- [ ] Ensaiar o bloqueio do fluxo legado inclusive em abas antigas, o isolamento de parceiros e outras contas e a suspensão segura do piloto. Obter autorização específica antes de qualquer habilitação.

## Etapa 3L — administração e recuperação no emulador

As operações administrativas são executadas em `POST /espacos/{id}/administracao`, no mesmo serviço local autenticado. A concessão privada em `concessoesAdministrativas/{id}` identifica UID, espaço e operações permitidas. A concessão de backup, isoladamente, não autoriza alterações. O executor confere o UID da sessão e a concessão dentro da transação, antes de responder com um recibo. O UUID é único por espaço entre comandos financeiros e administrativos. O recibo administrativo guarda a assinatura da intenção e o resultado. Reenvio idêntico retorna o resultado anterior, sujeito à autorização vigente. Reutilizar o ID com alteração de conteúdo gera conflito.

| Operação | Prontidão no piloto | Condições e limites |
| --- | --- | --- |
| Provisionamento | Implementado localmente | Exige concessão prévia, destino inexistente e UUID. Cria geração e revisão zero, configura as reservas fixas e inicia com escrita financeira desabilitada. A concessão inicial é fornecida pela fixture privada. |
| Preparo da restauração | Implementado localmente | Verifica assinatura, versão, titular, espaço, geração e revisão. Aceita para prévia apenas o snapshot inicial intacto do espaço. Grava auditoria de preparo. O piloto não aplica restauração e bloqueia destinos já usados. |
| Reinicialização | Implementada localmente | Exige concessão específica, frase explícita, UUID e backup assinado correspondente à base atual. Arquiva o snapshot financeiro anterior, muda a geração e grava auditoria na mesma transação. Catálogo, recibos e eventos anteriores continuam disponíveis. A fila rejeita reenvio de geração antiga. Um arquivo de geração preexistente bloqueia o reset. |
| Manutenção | Implementada localmente | Altera somente nome do espaço ou nome, finalidade e estado de uma caixinha existente. Exige backup da base atual e autorização `manter`. Arquivamento exige saldo zero verificável. A alteração avança a revisão, registra antes e depois e conserva os lançamentos e totais. |
| Backup assinado e cifrado | Implementado e testado localmente | O backup assinado também inclui auditoria administrativa e gerações arquivadas, com leitura dos arquivos da versão anterior que não tenham esses campos. O envelope opcional `appcar-financeiro-criptografado-v1` usa AES-256-GCM com IV aleatório. A abertura confere integridade da cifra e procedência da assinatura antes de entregar a prévia. A chave de recuperação de 32 bytes é fornecida à rotina por fora do arquivo. O endpoint de exportação ainda retorna o formato assinado legível. |
| Autenticação e custódia em produção | Pendente | Exige Firebase Admin Auth real com revogação, identidade e concessões gerenciadas, autorização para provisionar, assinatura com registro de chaves confiáveis, custódia e recuperação de chaves de cifra e revisão de IAM. |
| Restauração com gravação e ativação | Pendente de autorização | Exige plano revisado, validação completa de destino e procedência, execução em ambiente isolado e revalidação transacional. O corte precisa manter bloqueadas as versões legadas. |

Se a transmissão for interrompida antes da confirmação, não há mudança administrativa confirmada. Se a resposta for perdida depois da confirmação, reautenticar e reenviar exatamente o mesmo UUID e conteúdo. Não reenviar com novo UUID sem consultar a auditoria. A operação fica bloqueada quando a base diverge, a procedência não pode ser verificada ou a requisição administrativa ultrapassa o limite local de 512.000 bytes. O catálogo e o financeiro da operação são preservados como descrito acima. A captura de backup continua usando leituras sucessivas, com os limites documentados na Etapa 3K.

Para recuperar um backup cifrado, preservar a cópia original, a chave de recuperação e a chave pública de assinatura por canais separados. **Perder a chave de recuperação impede decifrar o arquivo.** Ter a chave pública ou o token da conta não recupera o conteúdo cifrado. A chave de backup financeiro e o segredo da fila protegem conteúdos diferentes. A perda do segredo da fila continua impedindo recuperar os comandos que só existam nela, salvo se houver uma instância ainda desbloqueada.

Antes de ativar, repetir em ambiente isolado os cenários de falha antes e depois da transação, aprovar a custódia de chaves, verificar as condições de descarte em caso de conflito, validar o retorno aos modos de leitura e de suspensão de escrita e obter autorização específica. O painel atual e as regras publicadas permanecem fora do piloto.

## Etapa 3M — auditoria consolidada

**A auditoria bloqueia a integração em produção.** A proteção demonstrada no banco privado do serviço depende de suas regras próprias, da identidade administrativa do emulador e de estruturas diferentes das usadas pelo painel. O fluxo atual continua autorizado para contas fora do marcador da fase 3C.

### Estado real por etapa

| Etapa | Estado verificado |
| --- | --- |
| 3A | Projeção e consulta de evidências implementadas na árvore local. IDs inequívocos e pendências são consultáveis. Faltam confirmação e persistência de vínculos. |
| 3B | Ciclo visual em memória e referências verificáveis para ensaio. Sem integração com o catálogo persistido. |
| 3C | Persistência de ciclo, autoria e auditoria em emulador, com catálogo restrito a reservas diárias UUID e papel fictício. |
| 3D | Comparação transacional de evidências, bloqueio e restauração em fixture isolada. O caminho de teste ainda aceita lançamentos já calculados pelo operador. |
| 3E | Comandos tipados e validação sobre dados confirmados. Turno e modelo de reservas persistem juntos. |
| 3F | Auditoria da separação entre motor financeiro, permissões do operador e regras. Identificou as lacunas de centavos, identidade e fila. |
| 3G | Centavos inteiros, rateio determinístico e plano de identidade sem escrita. Histórico fracionário ou ambíguo fica pendente. Adoção persistente ainda indisponível. |
| 3H | Serviço HTTP em loopback com autenticação local, autorização transacional e recibos por UUID. O banco privado bloqueia o SDK cliente. |
| 3I | Fila IndexedDB cifrada com Web Locks e recuperação por recibo em Chrome. Integração de sessão, revisão de conflitos e gestão de segredos ainda pendentes. |
| 3J | Inventário de gravações, prévia de três formatos JSON e ensaio de corte e preservação de cópias. Sem migração. |
| 3K | Contrato Firebase Admin Auth, permissões específicas, backup assinado e cópia cifrada da fila. O SDK administrativo real e a revogação ponta a ponta não estão ligados ao HTTP. |
| 3L | Provisionamento, preparo de restauração, manutenção e reset transacional no serviço local. Restauração com escrita e exportação HTTP cifrada continuam pendentes. |

### Matriz de requisitos

| Requisito | Evidência local | Lacuna de integração |
| --- | --- | --- |
| Arquivar somente com saldo zero | Ciclo e serviço verificam o saldo em centavos. Fração histórica ou origem ambígua impede atestar o saldo. | Disponibilizar a projeção autorizada e a revisão de pendências. |
| Motivo, data, hora e autor | O ciclo 3C já exigia motivo. A 3M exige motivo também na manutenção 3L, grava o horário do Firestore e o UID da sessão, e separa transição de estado de edição de metadados. | Consolidar a apresentação das duas trilhas e controlar o acesso privado à auditoria. Os eventos administrativos anteriores à 3M podem não ter motivo. |
| Reativar e renomear com histórico | Ciclo cobre as duas operações. A 3M testa reativação no serviço e bloqueia edição de metadados enquanto arquivada. Histórico e totais continuam intactos no ensaio. | Conectar a interface ao serviço e definir autorização de catálogo. Finalidade pode ser editada pelo executor administrativo 3L, embora seja invariável no ciclo 3C. |
| Homônimas com IDs diferentes | Projeção e ciclo preservam IDs distintos e nomes registrados à época. | O serviço 3H–3L não oferece criação arbitrária de caixinha. O provisionamento semeia apenas as reservas fixas. Adoção e criação precisam de comando autorizado. |
| Preservar lançamentos e totais | Testes de cálculo, ciclo, serviço e backup cobrem edição com rateio preservado, reset com arquivo anterior e recuperação de recibos. | Definir política de rateio retroativo quando um turno com rateio é movido de data e conferir os totais por conta antes do corte. |
| Impedir movimento em arquivada | O serviço consulta a identidade e o estado dentro da transação. Testes cobrem retirada, exclusão, alteração e a transição com motivo. | Bloquear fontes legadas e administrativas paralelas. Projetar estado para cada família e tratar origens sem cadastro, inclusive durante criação de custos ou reservas. |
| Exibir antigas e pendências | A leitura de arquivadas existe no piloto 3C. Relatórios locais consultam a projeção de pendências. O demonstrador de ciclo usa dados fictícios. | Falta uma leitura autenticada do catálogo e da auditoria no serviço novo, com titularidade e projeção para parceiro. Falta uma interface ligada a essa leitura. |
| Fila, reset e recuperação | A fila conserva UUID e base, serializa tentativas entre abas, concilia recibo e recusa reenvio de geração antiga. Reset arquiva e incrementa geração na mesma transação. | Falta consulta autorizada de recibos de gerações anteriores e procedimento de recuperação quando só a fila local contém a intenção. |
| Backup íntegro e recuperação | Assinatura, cifra em rotina separada, validação de titular e espaço e preparo em fixture. Os testes cobrem adulteração e perda de resposta. | O endpoint retorna arquivo legível e a captura não é um snapshot transacional de todas as coleções. A restauração gravável e a custódia gerenciada continuam indisponíveis. |

### Caminhos de escrita e gravidade

| Gravidade | Achado | Condição para aprovação |
| --- | --- | --- |
| Crítica | `useGestao.ts` e `syncSession.ts` ainda publicam snapshots via `conditionalWrite` e usam `resetTransaction`. Isso inclui resolução de conflitos e recuperação. As regras gerais permitem os caminhos nas contas não marcadas. | Fonte única de escrita, bloqueio de criação, atualização e reset pelo cliente no espaço ativado, com testes de abas antigas e tentativas offline. |
| Alta | No piloto 3C, os papéis de operador são fronteiras de confiança. As regras validam pareamento de documentos e estrutura e deixam os cálculos e as evidências ao operador. No banco privado novo, o SDK cliente é bloqueado, mas a identidade privilegiada do servidor ou da fixture pode gravar. | Remover os escritores de ensaio do plano de ativação. Verificar Firebase Admin Auth real, revogação, IAM e credenciais segregadas de execução, backup e manutenção. |
| Alta | Catálogos e trilhas distintos têm regras diferentes. O ciclo usa versões e recibos por revisão. O serviço usa UUID e confere geração antes de devolver o recibo financeiro. O ciclo pode devolver recibo antigo sem alterar dados. Os backups 3C e 3K/3L têm formatos distintos. | Escolher autoridade para catálogo, auditoria e recibos. Definir conversão verificável sem misturar trilhas, e manter os dados originais disponíveis para conferência. |
| Alta | Backup assinado legível, chave efêmera local, leitura sucessiva de coleções e restauração sem executor. Não há garantia de recuperar fila sem seu segredo ou conciliar uma confirmação perdida de geração anterior. | Custódia e rotação de chaves, exportação consistente e cifrada, verificação de recuperação, consulta de auditoria e exercício de falha com dados fictícios. |
| Alta | Falta fluxo privado para criação, adoção e conciliação de todas as identidades exigidas pelo serviço. Há leituras e escritas legadas que usam nomes e chaves sem namespace. | Contrato único de IDs, prévia de adoção sem duplicação, gravação idempotente autorizada e tratamento explícito de pendências por família. |
| Alta | Revogar parceria bloqueia novas leituras no Firestore. O cache de uma sessão anteriormente autorizada e as cópias feitas fora do aplicativo podem continuar acessíveis naquele dispositivo. | Definir minimização e retenção de cache do parceiro, testar revogação e troca de conta e limitar a projeção ao conteúdo compartilhável. |
| Média | Dois caminhos de cálculo convivem. O painel usa a fórmula legada, e o serviço calcula novos rateios pelo calendário em centavos. A regra de edição retroativa que preserva rateio precisa cobrir mudanças de data e possíveis cobranças no mesmo dia. | Aprovar semântica de rateio, validar totais históricos e novos em fixtures representativas e comparar relatórios lado a lado. |
| Média | Regex de UUID, exclusão de campos de credenciais e validação de envelopes aparecem em mais de um módulo. A guarda administrativa 3K protege a exportação e a 3L tem sua própria checagem transacional. | Consolidar contratos e autorização ao remover os protótipos superados. Manter leitura de versões antigas e testes de compatibilidade e integridade. |

A 3M corrigiu a ausência de motivo no executor 3L e a possibilidade de combinar mudança de estado com edição de metadados. A correção cobre o piloto privado e não altera regras Firestore nem gravações do painel.

### Integração por fases e reversão

1. Unificar o contrato de identidade e definir qual fonte responde por leitura, catálogo, eventos, recibos e escrita. Decidir o tratamento de saldos históricos, rateios retroativos e permissões de parceiro.
2. Prover autenticação e revogação reais, IAM, custódia e recuperação de chaves. Implementar leitura autorizada, ciclo completo, adoção e manutenção. Ensaiar backup cifrado e restauração em destino isolado.
3. Em ambiente fictício, validar a prévia por conta e dispositivo, congelar escritores legados, exportar pendências, testar cliente antigo e bloquear dupla escrita. Comparar totais, catálogos, eventos e recibos antes e depois.
4. Após autorização específica, liberar um espaço controlado com telemetria de recusas, conflitos, exportações e reenvios. Ampliar apenas após conferência dos dados e possibilidade demonstrada de reversão.

Se for necessário suspender, bloquear novos comandos e reenvios, manter a leitura autorizada e conservar a vedação a snapshots antigos. Preservar o financeiro confirmado, os arquivos de geração, o catálogo, as trilhas e as filas. Reconciliar operações incertas pelo UUID antes de retomar. Uma mudança de volta ao formato legado exigiria outro corte aprovado e reconciliação, pois voltar a liberar snapshots enquanto o serviço grava cria duas autoridades sobre os mesmos dados.

### Checklist de aprovação do piloto

- [ ] Fonte única para escrita e bloqueio de cliente desatualizado comprovado.
- [ ] Papéis de proprietário, parceiro, serviço e manutenção validados, com revogação real e credenciais isoladas.
- [ ] Catálogo completo, motivo e auditoria, leitura de arquivadas e tratamento de pendências prontos para a interface.
- [ ] Comparação de totais e política de rateio aprovadas com dados fictícios representativos.
- [ ] Backup cifrado consistente, recuperação com interrupção ensaiada e custódia de chaves aprovada.
- [ ] Comandos pendentes e confirmações incertas reconciliáveis sem restaurar snapshots ou reutilizar UUID indevidamente.
- [ ] Reversão ensaiada, documentação operacional revisada e autorização específica concedida.

### Evidências e lacunas de cobertura da 3M

Passaram 16 cenários do serviço, 23 de ciclo, 13 de regras, 52 de sincronização, 11 testes locais e a verificação de cálculos. Passaram TypeScript, ESLint e a verificação do diff. O painel com dados simulados passou em desktop e larguras móveis. A suíte de autenticação com Firebase simulado e a fila de Chrome com Auth e Firestore emulados passaram em retestes isolados. Na primeira execução concorrente, a autenticação estourou o tempo de navegação e a fila já havia voltado a pendente pelo tempo limite antes do fechamento do Chrome. O reteste da fila confirmou recuperação do envio interrompido, sem duplicação.

As suítes locais não comprovam revogação real no SDK administrativo, IAM, capacidade, consistência de backup em produção, restauração com escrita, suporte offline em outros navegadores ou leitura do catálogo novo pela interface. O ensaio de corte cobre as regras e as fixtures do emulador.

O roteiro de sincronização e reset em Chrome e Edge precisou passar pela seleção de módulo após login e recarga. A correção ficou no teste. `test:manual-sync` e `test:auto-reset` passaram, cada um em uma conta fictícia nova, com 11 verificações de sincronização entre navegadores, conflito, conferência do backup, recusa de backup de outra conta, reset, bloqueio da geração antiga e preservação dos lançamentos da geração nova.

## Primeira entrega funcional local

A demonstração abre em `http://localhost:3000/demonstracao` quando a porta 3000 está livre. Se estiver ocupada, o endereço é `http://localhost:3212/demonstracao`. Inicie com `npm run demo:local` e mantenha o processo em execução. No Windows, se o Java não estiver no PATH, disponibilize o JDK usado pelas outras suítes apenas na sessão do comando. O runner usa o projeto fictício `demo-appcar-ciclo`, Firestore em `127.0.0.1:8089` e uma cópia do Next que omite o inicializador Firebase real. A API exige a configuração local, o hub dedicado e a origem esperada nas escritas.

As ações do catálogo usam o executor transacional e a auditoria do ciclo. O formulário de perfil e os dados básicos do veículo persistem no documento fictício do demonstrador. O cabeçalho usa o nome cadastrado e oferece um nome neutro quando o perfil legado ainda não tem nome. O espaço compartilhado consulta o Firestore com o papel fictício de parceiro e exibe os relatórios em somente leitura. As alegações dos papéis pertencem ao demonstrador local. O cadastro grava dados de contato e não cria uma credencial de login.

Os dados persistem ao recarregar a página enquanto o emulador continua ativo. O runner não exporta os dados ao encerrar. A segunda entrega precisa de login no Auth Emulator para percorrer cadastro e alteração de contas de ponta a ponta, operações financeiras ligadas ao serviço e à fila, revisão e confirmação de vínculos pendentes e gerenciamento de convites. A integração a dados reais depende das autorizações e barreiras identificadas na Etapa 3M.

## Painel financeiro integrado no emulador

`npm run demo:financeiro` abre o painel do motorista existente em `/demonstracao`, na porta 3000 ou na 3212 quando a primeira está ocupada. O runner verifica o Auth e o Firestore do projeto `demo-appcar-financeiro`, cria uma conta e um espaço fictícios vazios e encaminha apenas sessão, consulta e comandos ao serviço financeiro local. A compilação local remove o inicializador Firebase de produção. O painel desse espaço usa a consulta do serviço e a fila IndexedDB, sem abrir a SyncSession legada.

Desbloqueie a fila com uma senha fictícia de pelo menos 16 caracteres. Na mesma origem e no mesmo navegador, use a mesma senha para recuperar envios após recarregar. Turnos novos, edições de turno, entradas, retiradas e exclusões preservam a revisão observada e o UUID emitido no enfileiramento. A fila conserva conflitos e rejeições para consulta. O histórico, os saldos e os relatórios refletem a leitura confirmada pelo serviço.

A aba **Caixinhas** do painel financeiro local permite criar, editar, desativar, reativar, excluir logicamente e revisar vínculos verificáveis. Os comandos usam a fila e as mesmas validações do servidor. Edição de avulsos, alterações de custos, preferências, recuperação de snapshots e reset ficam fora deste fluxo. A conta e o espaço fictícios têm a duração da execução dos emuladores. O runner de ciclo anterior continua disponível por `npm run demo:local`.

## Preparação do caminho de produção

O painel principal resolve o destino com o ID token da sessão quando `NEXT_PUBLIC_APPCAR_FINANCEIRO_PRODUCAO=1`. Somente uma resposta explícita de espaço legado abre a SyncSession. Para o espaço integrado, a API Node usa Firebase Admin Auth com verificação de revogação e confere o titular e a concessão a cada comando. O parceiro autorizado recebe somente a consulta. A fila mantém o escopo UID, espaço e geração e o mesmo contrato de recibos.

O documento financeiro continua em `users/{uid}/appData/main`. A transação lê o marcador `financeiroIntegrado/{uid}`, o controle `espacosFinanceiros/{espacoId}` e o documento existente. Atualiza os campos do comando e a revisão e grava o recibo em `espacosFinanceiros/{espacoId}/operacoes/{operacaoId}`. Um novo custo sem identidade histórica pode receber a caixinha na mesma transação. As regras locais acrescentam o bloqueio de escrita pelo SDK cliente quando existir o marcador, inclusive durante suspensão.

O painel integrado consulta o catálogo, os saldos, as movimentações e as pendências na mesma leitura do documento financeiro. A alteração de caixinhas entra na fila existente, com as permissões individuais `caixinha-criar`, `caixinha-editar`, `caixinha-arquivar`, `caixinha-reativar`, `caixinha-excluir` e `caixinha-conciliar` em `operacoesFinanceiras`. O titular consulta os eventos privados com autoria e motivo. O parceiro ativo consulta somente os dados financeiros compartilhados e a projeção de caixinhas. Espaços legados mantêm a consulta histórica das caixinhas.

As identidades e os vínculos são gravados em `caixinhas/{id}` e `vinculosCaixinhas/{geracao}-{referencia}` sob o espaço privado. A conciliação confirma uma referência estável do histórico, conserva o lançamento original e grava a decisão com o recibo na mesma transação. Turnos e retiradas usam os vínculos vigentes ao validar o saldo. Arquivamento exige saldo zero, referências revisadas e ausência de provisionamento ativo para caixinhas de rateio ou de reserva fixa. A exclusão de uma identidade sem histórico é lógica e conserva o identificador e a auditoria. Referências sem identidade verificável continuam pendentes. Caixinhas históricas sem cadastro privado exigem preparo da identidade pelo operador antes da ativação de ações sobre elas.

No painel integrado, um depósito transfere valor do Saldo principal para uma caixinha ativa e deixa o lançamento visível no histórico. Um estorno marca o lançamento original e desconta seu efeito dos totais, preservando seus campos. O recibo conserva o estado anterior, o estado posterior e o motivo. Retiradas, depósitos, correções de turno e estornos ligados a uma caixinha aparecem na auditoria. Uma mudança que invalide um vínculo já confirmado ou agrave saldo negativo em uma caixinha é rejeitada. Antes de habilitar um espaço legado, compare os saldos por caixinha e por período, inclusive quando o histórico contém rateios com precisão inferior a um centavo. Preserve esses registros durante a análise.

Para ativar, são necessários:

1. O backend Node inclui o `firebase-admin`. Na Vercel, a produção usa uma identidade federada OIDC do projeto `gestao-app` com uma conta de serviço dedicada no Google Cloud, sem chaves permanentes. Configure `APPCAR_FIREBASE_OIDC_AUDIENCE` (o caminho do provedor de identidade federada) e `APPCAR_FIREBASE_OIDC_SERVICE_ACCOUNT` (e-mail da conta de serviço). A relação de confiança deve corresponder somente ao deploy de produção do projeto. A conta de serviço precisa de acesso às transações Firestore e de leitura de usuários para conferir revogação. Defina `APPCAR_FIREBASE_PROJECT_ID=appcar-a0886` e `APPCAR_FINANCEIRO_PRODUCAO=1` após configurar a identidade. A ativação no cliente é uma variável pública separada, sem credencial.
2. Publicar primeiro as regras do bloqueio legado com autorização. Antes de marcar cada conta, conferir o documento e seus metadados de versão, as pendências locais dos dispositivos, a titularidade, os IDs históricos e o catálogo. Preparar o controle e as permissões no espaço privado. O marcador administrativo usa `{ contrato: 'appdata-v1', espacoId: <UUID>, estado: 'suspenso' | 'ativo' }`. Sua criação bloqueia todas as escritas legadas, inclusive reset e recuperação em clientes antigos. O serviço exige `_sync` válido e conserva o caminho e o formato existentes.
3. Para interromper a escrita integrada, manter o marcador e mudar seu estado para `suspenso`. Conservar documentos, recibos e filas. A reversão ao cliente legado exige conciliar UUIDs com resultado incerto e pendências dos dispositivos e autorizar o desbloqueio depois que o servidor estiver suspenso. A remoção do marcador reabre a escrita legada e não pode ser usada como resposta automática a falhas.

Na revisão local, deixe as variáveis de ativação ausentes. O backend financeiro real exige ambiente de produção, projeto explícito e ausência das variáveis dos emuladores. Edição de avulsos, restauração e reset continuam fora dos comandos disponíveis neste painel integrado.
