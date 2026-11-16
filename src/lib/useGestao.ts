'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import { dadosPadrao, lerDados, type DadosPersistidos } from './gestao';

async function prazo<T>(operacao: Promise<T>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operacao, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('A conexão demorou mais que o esperado.')), 10000);
    })]);
  } finally { clearTimeout(timer); }
}

export function useGestao(uid: string) {
  const chave = `gestao-app-dados-v2-${uid}`;
  const [dados, setDados] = useState<DadosPersistidos | null>(null);
  const [status, setStatus] = useState('Carregando seus dados…');
  const [erro, setErro] = useState('');
  const [conflito, setConflito] = useState(false);
  const [revisao, setRevisao] = useState(0);
  const atual = useRef<DadosPersistidos | null>(null);
  const remoto = useRef<DadosPersistidos | null>(null);
  const nuvem = useRef(false);
  const fila = useRef(Promise.resolve());
  const versao = useRef(0);
  const montado = useRef(true);

  const guardar = useCallback((valor: DadosPersistidos, sufixo = '') => {
    localStorage.setItem(chave + sufixo, JSON.stringify(valor));
  }, [chave]);

  useEffect(() => {
    let ativo = true;
    montado.current = true;
    const carregar = async () => {
      let local: DadosPersistidos | null = null;
      try {
        const texto = localStorage.getItem(chave);
        if (texto) {
          local = lerDados(JSON.parse(texto));
          if (!localStorage.getItem(chave + '-antes-reconstrucao')) localStorage.setItem(chave + '-antes-reconstrucao', texto);
        }
      } catch { /* O documento remoto ainda pode ser carregado. */ }
      try {
        const snapshot = await prazo(getDoc(doc(db, 'users', uid, 'appData', 'main')));
        if (!ativo) return;
        const cloud = snapshot.exists() ? lerDados(snapshot.data()) : null;
        remoto.current = cloud;
        const pendente = localStorage.getItem(chave + '-pendente') === 'true';
        const divergiu = Boolean(local && cloud && JSON.stringify(local) !== JSON.stringify(cloud));
        const escolhido = (pendente || divergiu) && local ? local : cloud ?? local ?? dadosPadrao();
        if (cloud && !localStorage.getItem(chave + '-nuvem-antes-reconstrucao')) guardar(cloud, '-nuvem-antes-reconstrucao');
        atual.current = escolhido;
        nuvem.current = !divergiu;
        setDados(escolhido);
        setConflito(divergiu);
        setErro('');
        setStatus(divergiu ? 'Há alterações locais pendentes. Escolha qual versão deseja usar.' : 'Dados carregados.');
        // Carregar a tela nunca grava nem substitui o documento na nuvem.
      } catch (falha) {
        if (!ativo) return;
        nuvem.current = false;
        if (local) {
          atual.current = local;
          setDados(local);
          setStatus('Modo local: suas alterações ficam neste navegador até sincronizar.');
        } else {
          setErro('Não foi possível recuperar seus dados. Verifique a conexão e tente novamente.');
        }
        console.warn('Carregamento do armazenamento:', falha);
      }
    };
    void carregar();
    return () => { ativo = false; montado.current = false; };
  }, [uid, chave, guardar, revisao]);

  const atualizar = useCallback((transformar: (dados: DadosPersistidos) => DadosPersistidos) => {
    if (!atual.current) return false;
    const proximo = transformar(atual.current);
    // Falha local interrompe a alteração: não afirmamos que um dado sem backup foi salvo.
    try {
      guardar(proximo);
      localStorage.setItem(chave + '-pendente', 'true');
    } catch {
      setErro('Não foi possível salvar neste navegador. Exporte um backup e libere espaço antes de continuar.');
      return false;
    }
    atual.current = proximo;
    setDados(proximo);
    const minhaVersao = ++versao.current;
    if (!nuvem.current) {
      setStatus('Alterações salvas neste navegador; sincronização pendente.');
      return true;
    }
    setStatus('Salvando…');
    fila.current = fila.current.then(async () => {
      try {
        await setDoc(doc(db, 'users', uid, 'appData', 'main'), proximo);
        if (minhaVersao === versao.current) {
          localStorage.removeItem(chave + '-pendente');
          if (montado.current) setStatus('Tudo salvo na nuvem e neste navegador.');
        }
      } catch {
        if (montado.current) setStatus('Backup local salvo. A sincronização precisa ser tentada novamente.');
      }
    });
    return true;
  }, [guardar, chave, uid]);

  const resolver = (origem: 'local' | 'nuvem') => {
    if (!atual.current) return;
    if (remoto.current) guardar(remoto.current, '-antes-resolver-nuvem');
    guardar(atual.current, '-antes-resolver-local');
    setConflito(false);
    nuvem.current = true;
    if (origem === 'nuvem' && remoto.current) {
      atual.current = remoto.current;
      guardar(remoto.current);
      localStorage.removeItem(chave + '-pendente');
      setDados(remoto.current);
      setStatus('Versão da nuvem carregada. A cópia local anterior foi preservada.');
    } else atualizar(d => d);
  };

  return { dados, status, erro, conflito, atualizar, resolver,
    tentarNovamente: async () => { try { await prazo(fila.current); setErro(''); setRevisao(r => r + 1); } catch { setErro('A sincronização está pendente. Seu backup local foi mantido.'); } },
    aguardar: () => prazo(fila.current),
  };
}
