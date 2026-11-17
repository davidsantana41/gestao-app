# Privacidade e LGPD — situação da implementação

Responsável informado pelo proprietário: santatec.
Canal informado: davidangelosantana@gmail.com.
Cadastro centralizado em `src/lib/privacidade.ts`.

## Implementado

- Política `/cookies` e aviso informativo que registra apenas seu fechamento em `appcar-aviso-armazenamento-v1`. Não representa consentimento para publicidade. Links permanentes permitem consultar novamente a política.
- Login Google opcional por ação do usuário, sem escopos adicionais. O Firebase pode manter dados de perfil do provedor, além dos dados que o painel exibe. Incluir esse perfil na avaliação administrativa de pedidos de acesso/exclusão.
- A política distingue cookies de armazenamento local e persistência do Firebase. Não foram adicionados Analytics, pixels ou publicidade. Se forem adicionados no futuro, inventariar, definir base legal e implementar os controles aplicáveis antes de carregá-los.

- Página `/privacidade` acessível sem login, com identificação, contato, dados tratados, finalidades, fornecedores, cópias locais e limites da implementação.
- Link na tela de acesso/cadastro, sem caixa de consentimento genérico.
- Aba Privacidade no painel, com exportação de identificador, e-mail, metadados de conta disponíveis, dados em uso, última versão remota carregada e backups do próprio usuário neste navegador. Não exporta senha ou tokens.
- Canal por `mailto:` para solicitações. Abre o programa de e-mail; o app não envia nem registra automaticamente o pedido.
- Instruções sobre correção e diferenças entre sair, apagar registros, limpar armazenamento local e excluir uma conta.

## Mapeamento técnico

| Dados | Local | Finalidade técnica |
| --- | --- | --- |
| E-mail, identificador, autenticação e metadados de conta | Firebase Authentication | Login, recuperação e confirmação de e-mail |
| Histórico, valores, reservas, custos, quilometragem, combustível, lembretes e tema | Firestore, documento de dados da própria conta | Organização financeira e sincronização |
| Dados em uso e snapshots de recuperação | localStorage, chaves da própria conta | Preservação local e resolução de conflitos |
| Informações de sessão | Persistência gerenciada pelo Firebase Authentication | Manter login |
| JSON exportado | Downloads escolhidos pelo usuário | Acesso e cópia dos dados |

Não foi encontrada inicialização do Firebase Analytics nem de publicidade no código revisado. Um identificador de medição na configuração não demonstra que Analytics esteja ativo. Serviços de autenticação, hospedagem e banco podem manter registros técnicos, a verificar em suas configurações e contratos.

## Pendências antes da disponibilização pública

- Definir e documentar a base legal de cada finalidade. Não presumir consentimento nem escolher uma base sem avaliar a relação com o usuário.
- Definir prazos de retenção por categoria, hipóteses legais de conservação e tratamento de backups, logs e contas inativas.
- Verificar região do Firestore, contratos do provedor e mecanismo aplicável a eventual transferência internacional.
- Conferir as regras efetivamente publicadas. O arquivo local restringe leitura/gravação ao UID e nega delete; a configuração remota não foi consultada.
- Testar isolamento entre duas contas com Firebase Emulator e regras reais antes de publicar regras. Não publicar mudanças nas regras sem validar.
- Definir processo de atendimento: registro dos pedidos, verificação proporcional de identidade, prazos legais, resposta, atendimento de correção, acesso e exclusão.
- Implementar e testar, em ambiente controlado, procedimento administrativo de exclusão de dados no Firestore e da identidade no Authentication. Excluir só a identidade não remove o documento financeiro. Não há exclusão completa automática implementada.
- Planejar como lidar com dispositivos antigos/offline que ainda contenham backups. A limpeza de um navegador não alcança outros dispositivos nem arquivos exportados.
- Revisar acessos administrativos, autenticação forte para administradores e resposta a incidentes.

## Procedimento provisório para pedidos

O canal publicado recebe pedidos por e-mail. O operador deve confirmar recebimento, verificar a identidade sem pedir senha, identificar o direito solicitado e responder conforme o prazo aplicável. Antes de apagar dados reais, documentar eventual obrigação de retenção e o escopo; executar por operador autorizado e verificar a conclusão em cada serviço. Não declarar exclusão de backups ou logs sem evidência.

As pendências são mostradas na página para que o aviso não seja confundido com uma declaração de conformidade completa. A adequação envolve decisões e operação, além do código.

Referências oficiais:
- https://www.gov.br/anpd/pt-br/assuntos/titular-de-dados/direito-dos-titulares
- https://firebase.google.com/docs/auth/web/manage-users
- https://firebase.google.com/docs/firestore/manage-data/delete-data
