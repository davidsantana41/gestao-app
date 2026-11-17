import Link from 'next/link';
import { privacidade } from '@/lib/privacidade';

export const metadata = { title: 'Cookies e armazenamento | APPCAR' };

export default function Cookies() {
  return <main className="app escuro"><div className="container conteudo pilha">
    <Link className="botao secundario" href="/">Voltar ao aplicativo</Link>
    <article className="painel pilha"><h1>Cookies e armazenamento</h1>
      <p>Cookies são pequenos registros utilizados pelo navegador. O APPCAR também usa tecnologias diferentes de cookies, como armazenamento local e a persistência de autenticação gerenciada pelo Firebase.</p>
      <section><h2>O que usamos e para quê</h2><ul>
        <li><strong>Acesso à conta:</strong> o Firebase Authentication mantém informações de sessão. Elas podem persistir entre visitas, até sair da conta ou limpar os dados do site, conforme o navegador.</li>
        <li><strong>Registros e recuperação:</strong> o armazenamento local mantém dados financeiros, preferências e cópias de segurança da conta neste navegador. Essas cópias não são removidas automaticamente ao sair.</li>
        <li><strong>Fechamento do aviso:</strong> guardamos a indicação de que você fechou o aviso neste navegador. Ela permanece até limpar os dados do site ou uma nova versão do aviso ser apresentada.</li>
      </ul></section>
      <section><h2>Google e outros serviços</h2><p>O login com Google só começa quando você escolhe “Continuar com Google”. O Google e o Firebase podem usar cookies e outras tecnologias em seus domínios para autenticação e segurança. O APPCAR recebe os dados de identificação fornecidos pelo login, como identificador e e-mail; não solicita acesso ao Gmail, contatos ou arquivos.</p><p>Consulte também a <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">política de privacidade do Google</a>.</p></section>
      <section><h2>Publicidade e análise de audiência</h2><p>Esta versão não inicializa ferramentas de publicidade ou análise de audiência. Por isso, o aviso não pede autorização para essas categorias. Se essas ferramentas forem adicionadas, será necessário revisar esta política e implementar os controles aplicáveis antes de ativá-las.</p></section>
      <section><h2>Como gerenciar</h2><p>Você pode bloquear cookies e gerenciar os dados deste site nas configurações de privacidade do navegador. Bloquear armazenamento ou janelas de autenticação pode impedir o login e a gravação de registros. Antes de limpar os dados do site, exporte o que precisar: alterações ainda não sincronizadas podem ser perdidas.</p><p>A limpeza deste navegador não exclui sua conta, os dados da nuvem, outros dispositivos nem os arquivos que você baixou. Fechar o aviso também não representa consentimento para publicidade ou novos tratamentos.</p></section>
      <section><h2>Contato</h2><p>{privacidade.responsavel}: <a href={`mailto:${privacidade.email}`}>{privacidade.email}</a>.</p><Link href="/privacidade">Consultar informações de privacidade e seus direitos</Link></section>
      <p className="nota">Versão: {privacidade.versao}.</p>
    </article>
  </div></main>;
}
