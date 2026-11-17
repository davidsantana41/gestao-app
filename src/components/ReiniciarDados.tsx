'use client';

import { useState } from 'react';
import { baixarJson } from '@/lib/privacidade';
import { version, type ResetPlan, type ResetConfirmation } from '@/lib/syncSession';

export default function ReiniciarDados({ uid, email, plan, prepare, backup, exported, execute, check, onComplete }: {
  uid: string; email: string | null; plan: ResetPlan | null;
  prepare: () => Promise<ResetPlan>; backup: (id: string) => unknown; exported: (id: string) => void;
  execute: (id: string, confirmation: ResetConfirmation) => Promise<boolean>;
  check: () => Promise<boolean> | undefined; onComplete: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [phrase, setPhrase] = useState('');
  const [verifiedId, setVerifiedId] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [databases, setDatabases] = useState<string[]>([]);
  const waiting = plan?.phase === 'uncertain' || plan?.phase === 'executing';
  const valid = Boolean(plan && plan.uid === uid && verifiedId === plan.id && accepted && phrase === 'REINICIAR MINHA CONTA' && plan.exported);
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await action(); } catch (error) { setError(error instanceof Error ? error.message : 'Não foi possível concluir. As cópias existentes foram mantidas.'); }
    finally { setBusy(false); }
  };
  return <section className="painel pilha" aria-labelledby="reiniciar-titulo">
    <h2 id="reiniciar-titulo">Reiniciar dados financeiros</h2>
    <p>Prepare uma nova fase financeira a partir de 17/11/2026. Preparar e exportar o backup não apaga nada.</p>
    <p>A conta, o login, os custos fixos configurados, os nomes das reservas, o tema e o lembrete serão preservados. O histórico e os saldos de movimentações serão zerados; os valores das reservas diárias começarão em zero.</p>
    <button type="button" className="botao secundario" disabled={busy || Boolean(waiting)} onClick={() => void run(async () => {
      await prepare(); setVerifiedId(''); setPhrase(''); setAccepted(false);
      if (typeof indexedDB.databases === 'function') {
        const names = await indexedDB.databases(); setDatabases(names.map(item => item.name || 'Banco sem nome'));
      }
    })}>Preparar reinicialização e backup</button>
    {plan && <div className="pilha">
      <p><strong>Conta:</strong> {email || 'Sem e-mail'}<br /><strong>Identificador:</strong> {uid}</p>
      <p><strong>Lançamentos na nuvem:</strong> {plan.remoteCount}. <strong>Na versão local:</strong> {plan.localCount}. Esses números podem incluir os mesmos registros; não devem ser somados.</p>
      <p><strong>Backup:</strong> cópia completa desta conta, da leitura da nuvem e das cópias financeiras disponíveis neste navegador, criada em {new Date(plan.createdAt).toLocaleString('pt-BR')}.</p>
      {plan.hadPending && <p className="mensagem aviso">Há alterações locais pendentes ou em conflito. O backup inclui as versões local e remota. Confira ambas antes de prosseguir.</p>}
      <p>Os dados financeiros ficam no Firestore e nas chaves locais desta conta. Esta versão não ativa cache persistente do Firestore em IndexedDB. Sessões de autenticação e eventuais caches antigos não serão apagados. Bancos IndexedDB identificados: {databases.length ? databases.join(', ') : 'nenhum identificado nesta consulta'}.</p>
      <p>As cópias de outros dispositivos não estão neste arquivo: exporte-as em cada dispositivo se necessário. Após o reinício, cópias da geração anterior serão bloqueadas para envio e continuarão disponíveis para exportação. Rascunhos ainda não salvos não integram o backup e os formulários serão reiniciados após sua confirmação.</p>
      <button type="button" className="botao secundario" disabled={busy} onClick={() => {
        try { baixarJson(`appcar-antes-reinicio-${plan.id}.json`, backup(plan.id)); exported(plan.id); }
        catch { setError('Não foi possível exportar. Nenhum dado foi reinicializado.'); }
      }}>Baixar backup antes do reinício</button>
      <label className="campo"><span>Selecione o arquivo JSON baixado para verificar a cópia</span><input type="file" accept="application/json,.json" disabled={busy} onChange={event => {
        const file = event.currentTarget.files?.[0]; setVerifiedId(''); setAccepted(false);
        if (!file) return;
        void run(async () => {
          const content: unknown = JSON.parse(await file.text());
          if (version(content) !== version(backup(plan.id))) throw new Error('O arquivo não corresponde ao backup completo desta preparação. Baixe e confira novamente.');
          setVerifiedId(plan.id);
        });
      }} /></label>
      <p role="status">{verifiedId === plan.id ? 'Arquivo de backup conferido: conteúdo íntegro e correspondente a esta conta.' : 'Aguardando conferência do arquivo baixado.'}</p>
      {plan.phase === 'committed' ? <p className="mensagem sucesso" role="status">Reinicialização confirmada. A geração {plan.generation} está ativa. O backup anterior continua disponível.</p>
        : waiting ? <button type="button" className="botao secundario" disabled={busy} onClick={() => void run(async () => { if (await check()) onComplete(); })}>Verificar resultado da reinicialização</button>
        : <form className="pilha" aria-busy={busy} onSubmit={event => {
          event.preventDefault(); if (!valid || !plan) return;
          void run(async () => { if (await execute(plan.id, { uid, phrase, backupVerified: verifiedId === plan.id && accepted })) { setPhrase(''); setAccepted(false); onComplete(); } });
        }}>
          <label><input type="checkbox" checked={accepted} disabled={busy || verifiedId !== plan.id} onChange={event => setAccepted(event.currentTarget.checked)} /> Conferi o backup e autorizo zerar somente os dados financeiros desta conta.</label>
          <label className="campo"><span>Digite REINICIAR MINHA CONTA para confirmar</span><input name="confirmar-reinicio" autoComplete="off" value={phrase} disabled={busy} onChange={event => setPhrase(event.currentTarget.value)} /></label>
          <p>Se a nuvem ou os dados locais mudarem após esta preparação, a operação será recusada. Em caso de interrupção, use a verificação do resultado antes de tentar novamente.</p>
          <button className="botao primario" type="submit" disabled={busy || !valid}>Confirmar reinicialização desta conta</button>
        </form>}
    </div>}
    {error && <p className="mensagem erro" role="alert">{error}</p>}
  </section>;
}
