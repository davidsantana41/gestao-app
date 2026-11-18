'use client';

import Link from 'next/link';
import { useState } from 'react';
import { auth } from '@/lib/firebase';
import { baixarJson, privacidade } from '@/lib/privacidade';
import { dataLocal, type DadosPersistidos } from '@/lib/gestao';
import { storagePrefixes } from '@/lib/syncSession';

export default function Privacidade({ uid, email, dados, dadosNuvem, readOnly = false }: {
  uid: string; email: string | null; dados: DadosPersistidos; dadosNuvem: DadosPersistidos | null; readOnly?: boolean;
}) {
  const [erro, setErro] = useState('');
  function exportar() {
    try {
      const usuario = auth.currentUser;
      const copias: Record<string, unknown> = {};
      for (const [indice, chave] of storagePrefixes(uid).entries()) {
        for (let i = 0; i < localStorage.length; i++) {
          const item = localStorage.key(i);
          if (item && (item === chave || item.startsWith(chave + '-'))) {
            const texto = localStorage.getItem(item), sufixo = item.slice(chave.length) || 'principal';
            const nome = indice === 0 && copias[sufixo] === undefined ? sufixo : `legado${sufixo}`;
            try { copias[nome] = JSON.parse(texto || 'null'); }
            catch { copias[nome] = texto; }
          }
        }
      }
      baixarJson(`appcar-meus-dados-${dataLocal()}.json`, {
        exportadoEm: new Date().toISOString(),
        conta: { identificador: uid, email, emailConfirmado: usuario?.emailVerified ?? null,
          criadaEm: usuario?.metadata?.creationTime ?? null, ultimoAcessoEm: usuario?.metadata?.lastSignInTime ?? null },
        dadosEmUso: dados, ultimaVersaoNuvemCarregada: dadosNuvem, copiasNesteNavegador: copias,
        observacao: 'Inclui os dados disponíveis ao aplicativo nesta sessão e neste navegador. Não inclui senhas, tokens, logs do provedor ou cópias em outros dispositivos. A versão da nuvem é a última carregada, não uma nova consulta.',
      });
      setErro('');
    } catch { setErro('Não foi possível exportar seus dados. Verifique as permissões de armazenamento e download do navegador.'); }
  }
  if (readOnly) return <section className="painel pilha" aria-labelledby="privacidade-titulo"><h2 id="privacidade-titulo">Acesso compartilhado</h2><p>Este espaço está em modo <strong>Somente visualização</strong>. Gerenciamento de convites, backups, restauração, reinicialização e alterações de permissões ficam disponíveis apenas para o proprietário.</p><p>Revogações bloqueiam novas leituras; o aplicativo não afirma apagar cópias já visualizadas ou capturas de tela.</p></section>;
  return <section className="painel pilha" aria-labelledby="privacidade-titulo">
    <div><h2 id="privacidade-titulo">Privacidade e seus dados</h2><p className="ajuda">Consulte as informações de privacidade e acesse uma cópia dos seus dados.</p></div>
    <div className="grade-custos">
      <div className="custo-item"><h3>Acessar meus dados</h3><p>Baixe seus dados de conta disponíveis, lançamentos, configurações e cópias de segurança deste navegador.</p><button className="botao secundario" type="button" onClick={exportar}>Baixar meus dados pessoais</button><p className="nota">O arquivo contém informações pessoais e financeiras. Guarde-o em local seguro.</p></div>
      <div className="custo-item"><h3>Corrigir informações</h3><p>Você pode editar turnos, custos fixos, nomes de reservas e lembretes nas seções do painel. Para outras correções, use o canal de privacidade.</p></div>
      <div className="custo-item"><h3>Solicitar atendimento</h3><p>Peça informações, correção ou exclusão dos seus dados. Solicitações de exclusão precisam considerar a conta, os dados na nuvem e as cópias de segurança.</p>{privacidade.email ? <a className="botao secundario" href={`mailto:${privacidade.email}?subject=${encodeURIComponent('Solicitação de privacidade — APPCAR')}`}>Contatar responsável</a> : <p className="mensagem erro">O canal de privacidade ainda está em configuração.</p>}</div>
    </div>
    <p>Este navegador mantém cópias dos seus dados mesmo após sair da conta. Em dispositivos compartilhados, evite salvar informações e limpe os dados do site pelo navegador após exportar o que precisar. Isso não apaga os dados da nuvem nem os arquivos baixados.</p>
    <Link className="botao secundario" href="/privacidade">Ler informações de privacidade</Link>
    {erro && <p role="alert" className="mensagem erro">{erro}</p>}
  </section>;
}
