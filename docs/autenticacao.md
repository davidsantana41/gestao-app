# Cadastro e recuperação de acesso

## Login com Google

O botão “Continuar com Google” usa Firebase Authentication com seleção de conta em popup. Não solicita permissões adicionais de Gmail, contatos ou Drive. Uma sessão anônima, se existir, usa vinculação para preservar o UID. Conflitos de credenciais exibem orientação sem migrar registros nem mesclar documentos automaticamente.

Para habilitar no projeto real:

1. Abra Firebase Console > Authentication > Sign-in method > Google.
2. Habilite Google, revise o nome público do projeto e selecione o e-mail de suporte; salve.
3. Em Authentication > Settings > Authorized domains, confira os domínios publicados e adicione `localhost` se precisar testar localmente. Não presuma que localhost esteja autorizado por padrão.
4. Revise a configuração OAuth/tela de consentimento do projeto Google quando aplicável.
5. Teste com uma conta Google de teste e verifique UID e histórico. Não crie contas duplicadas nem transfira dados apenas porque o e-mail coincide.

Os testes de navegador usam Firebase simulado. A configuração remota e um login Google real não foram validados. Se o navegador bloquear o popup, o aplicativo orienta permiti-lo; não há redirecionamento automático para substituir o popup.

Referência: https://firebase.google.com/docs/auth/web/google-signin

O cadastro valida a senha usando a política do Firebase, confirma a digitação e solicita um e-mail de verificação. O painel permite solicitar novamente e recarregar o estado de verificação. Contas existentes continuam acessando seus dados enquanto o endereço não foi confirmado; isso é uma orientação de interface, não uma restrição de autorização no Firestore.

O envio de e-mails usa o idioma pt-BR. A recuperação mantém uma resposta genérica, inclusive quando o Firebase informa que o usuário não existe. Limites de envio do Firebase continuam valendo; o painel acrescenta um intervalo local entre reenvios bem-sucedidos.

## Configuração no Firebase Console

1. Em Authentication, confirme que o provedor E-mail/senha está habilitado.
2. Revise a política de senhas e a proteção contra enumeração de e-mails nas configurações de Authentication.
3. Em Authentication > Templates, configure o nome público APPCAR, remetente e endereço de resposta. Revise os textos permitidos pelo console nos modelos de verificação e recuperação.
4. A página personalizada está em `/conta/acao`. Depois de publicar, configure a URL de ação dos modelos para `https://SEU-DOMINIO/conta/acao`, mantendo os parâmetros de ação que o Firebase acrescenta. Sem essa configuração, os e-mails continuam abrindo a página padrão do Firebase.
5. Confirme os domínios autorizados. Para ensaios locais, use um projeto de teste ou o Authentication Emulator; não substitua a URL pública dos e-mails por localhost no projeto usado por clientes.

Não há credenciais administrativas neste repositório para alterar essas configurações. As alterações de console e o recebimento real de e-mails precisam de validação no projeto de destino.

## Validação de entrega em uma conta de teste

- Cadastrar, receber a mensagem, confirmar o endereço e usar “Já confirmei meu e-mail”.
- Solicitar recuperação, abrir o link, confirmar uma nova senha e entrar novamente.
- Reabrir um link usado ou expirado e conferir a mensagem de orientação.
- Conferir spam, remetente, idioma e apresentação no celular.

Referência: https://firebase.google.com/docs/auth/web/manage-users e https://firebase.google.com/docs/auth/custom-email-handler
