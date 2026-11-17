import Link from 'next/link';
import { privacidade } from '@/lib/privacidade';

export const metadata = { title: 'Privacidade | APPCAR' };

export default function InformacoesPrivacidade() {
  return <main className="app escuro"><div className="container conteudo pilha">
    <Link className="botao secundario" href="/">Voltar para o aplicativo</Link>
    <section className="painel pilha">
      <h1>Privacidade no APPCAR</h1>
      <p>Consulte também a <Link href="/cookies">política de cookies e armazenamento</Link>.</p>
      {(!privacidade.responsavel || !privacidade.email) && <p className="mensagem erro">Informações em preparação: a identificação do responsável, o canal de atendimento e as condições de retenção precisam ser concluídos antes da disponibilização pública.</p>}
      <p className="mensagem">Aviso em preparação. Os prazos de retenção e as bases legais ainda precisam de definição pelo responsável.</p>
      <div><h2>Quem é responsável</h2><p>{privacidade.responsavel || 'Responsável ainda não informado.'}</p><p>{privacidade.email ? <a href={`mailto:${privacidade.email}`}>{privacidade.email}</a> : 'Contato de privacidade ainda não informado.'}</p></div>
      <div><h2>Dados usados pelo aplicativo</h2><p>O APPCAR usa e-mail e identificador da conta para autenticação, além dos dados que você registra: turnos, valores, despesas, reservas, quilometragem, combustível, lembretes e preferências. Evite incluir dados de outras pessoas ou informações sensíveis nos campos de texto livre.</p></div>
      <div><h2>Finalidades</h2><p>Essas informações permitem acessar sua conta, organizar seu trabalho, calcular relatórios, sincronizar seus registros e recuperar o acesso. A base legal de cada finalidade ainda será documentada pelo responsável; esta página não solicita consentimento genérico.</p></div>
      <div><h2>Onde os dados ficam</h2><p>O login e os e-mails de acesso são processados pelo Firebase Authentication, e os registros sincronizados ficam no Cloud Firestore, serviços do Google. Se escolher o login Google, o provedor compartilha dados de identificação e perfil, como identificador e e-mail, com o Firebase; o APPCAR não solicita acesso ao Gmail, contatos ou arquivos. Há também cópias e backups no armazenamento deste navegador. A senha é tratada pelo serviço de autenticação e não faz parte dos backups exportados pelo APPCAR.</p><p>A localização dos serviços, as condições contratuais e eventuais transferências internacionais precisam ser verificadas pelo responsável na configuração do projeto.</p></div>
      <div><h2>Armazenamento no navegador</h2><p>O aplicativo usa armazenamento local para preservar registros e resolver diferenças entre as versões local e da nuvem. O serviço de login também mantém informações de sessão. As cópias locais podem permanecer após sair. Limpar os dados deste site pelo navegador remove cópias locais e pode encerrar a sessão; não remove os dados na nuvem, outros dispositivos ou arquivos exportados.</p></div>
      <div><h2>Seus direitos e opções</h2><p>No painel, em “Privacidade”, você pode exportar os dados disponíveis da conta e deste navegador. Os registros editáveis podem ser corrigidos no próprio painel. Você também pode solicitar confirmação e acesso ao tratamento, correção, informações sobre compartilhamento, portabilidade e exclusão, conforme as condições legais aplicáveis.</p><p>O canal de atendimento depende do contato do responsável informado acima. A exportação do aplicativo não inclui todos os possíveis registros técnicos mantidos pelo provedor.</p></div>
      <div><h2>Retenção e exclusão</h2><p>Os registros e backups são mantidos para acesso e recuperação. Os prazos de retenção e o procedimento de exclusão da conta e das cópias ainda precisam ser definidos pelo responsável. Excluir um lançamento no painel não elimina necessariamente suas versões em backups. Encerrar uma sessão também não exclui a conta.</p></div>
      <div><h2>Segurança</h2><p>Use uma senha exclusiva, confirme seu e-mail e proteja o acesso ao dispositivo. Não envie senhas ou arquivos financeiros por e-mail para solicitar atendimento. A análise de uma solicitação pode exigir confirmação de identidade proporcional ao pedido.</p></div>
      <p className="nota">Versão das informações: {privacidade.versao}. Esta página descreve a implementação e as pendências atuais; não é uma certificação de adequação à LGPD.</p>
    </section>
  </div></main>;
}
