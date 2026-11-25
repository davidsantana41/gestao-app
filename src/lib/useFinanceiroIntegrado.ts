'use client';

import { useEffect, useRef, useState } from 'react';
import { abrirFilaFinanceiraOffline, geracoesDaFila, type ItemFilaFinanceira } from './filaFinanceiraOffline';
import type { DadosPersistidos } from './gestao';
import type { EventoAuditoriaCaixinha, obterTodasCaixinhas } from './gestaoCaixinhasIntegrada';

export type LeituraCaixinhas = {
  relatorio: ReturnType<typeof obterTodasCaixinhas>;
  auditoria: EventoAuditoriaCaixinha[];
  acoes: string[];
};

export type SessaoFinanceiraLocal = { uid: string; espacoId: string; email: string; senha: string };
type SessaoFinanceiraReal = { uid: string; espacoId: string; titular: string; readOnly: boolean; obterToken: () => Promise<string | null> };
type Fila = Awaited<ReturnType<typeof abrirFilaFinanceiraOffline>>;
type FilaAberta = { geracao: number; fila: Fila };

export function useFinanceiroIntegrado(identidade: SessaoFinanceiraLocal | SessaoFinanceiraReal) {
  const { uid, espacoId } = identidade;
  const real = 'obterToken' in identidade ? identidade : undefined;
  const [leituraConfirmada, setLeituraConfirmada] = useState<{ financeiro: DadosPersistidos; caixinhas?: LeituraCaixinhas }>();
  const dados = leituraConfirmada?.financeiro;
  const [itens, setItens] = useState<ItemFilaFinanceira[]>([]);
  const [geracoes, setGeracoes] = useState<number[]>([]);
  const [aberta, setAberta] = useState<number>();
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [gravavel, setGravavel] = useState(!real);
  const [revisaoConfirmada, setRevisaoConfirmada] = useState<{ geracao: number; revisao: number }>();
  const fila = useRef<FilaAberta>(null);
  const operando = useRef(false);
  const sessao = useRef<{ token: string; ate: number }>(null);

  async function obterToken() {
    if ('obterToken' in identidade) return identidade.obterToken();
    const { email, senha } = identidade;
    if (sessao.current && sessao.current.ate > Date.now()) return sessao.current.token;
    const resposta = await fetch('/sessao', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, senha }), redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(5000),
    });
    if (!resposta.ok) throw new Error('Sessão do emulador indisponível.');
    const autenticada = await resposta.json();
    if (autenticada.uid !== uid || typeof autenticada.token !== 'string') throw new Error('A sessão pertence a outra conta.');
    sessao.current = { token: autenticada.token, ate: Date.now() + 240_000 };
    return sessao.current.token;
  }

  async function consultar() {
    const token = await obterToken();
    if (!token) throw new Error('Autentique a conta para consultar os dados confirmados.');
    const destino = real ? `/api/financeiro?titular=${encodeURIComponent(real.titular)}` : `/espacos/${espacoId}/consulta`;
    const resposta = await fetch(destino, {
      headers: { Authorization: `Bearer ${token}`, 'X-Appcar-Conta-Fila': uid },
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(12000),
    });
    if (resposta.status === 401) sessao.current = null;
    if (!resposta.ok) {
      if (real) setGravavel(false);
      if (resposta.status === 401 || resposta.status === 403) setLeituraConfirmada(undefined);
      throw new Error('Não foi possível consultar o financeiro confirmado.');
    }
    const leitura = await resposta.json() as { financeiro: DadosPersistidos; modo?: string; espacoId?: string; gravavel?: boolean; caixinhas?: LeituraCaixinhas; gestaoCaixinhas?: LeituraCaixinhas };
    if (real && (leitura.modo !== 'integrado' || leitura.espacoId !== espacoId || !leitura.caixinhas)) {
      setGravavel(false);
      setLeituraConfirmada(undefined);
      throw new Error('O espaço mudou. Reabra o painel para verificar o destino financeiro.');
    }
    const { financeiro } = leitura;
    const versao = financeiro?._sync;
    if (!versao || !Number.isSafeInteger(versao.generation) || !Number.isSafeInteger(versao.revision)) {
      throw new Error('O serviço não forneceu uma versão financeira válida.');
    }
    if (real) setGravavel(!real.readOnly && leitura.gravavel === true);
    setLeituraConfirmada(atual => {
      const base = atual?.financeiro._sync;
      if (base && (base.generation > versao.generation || (base.generation === versao.generation && base.revision > versao.revision))) return atual;
      return { financeiro, caixinhas: real ? leitura.caixinhas : leitura.gestaoCaixinhas };
    });
  }

  async function atualizar() {
    setErro('');
    try { await consultar(); } catch (falha) { setErro((falha as Error).message); }
  }

  async function exclusivo<T>(acao: () => Promise<T>) {
    if (operando.current) return;
    operando.current = true;
    setOcupado(true);
    setErro('');
    try { return await acao(); } catch (falha) {
      setErro(falha instanceof Error ? falha.message : 'Operação indisponível.');
    } finally {
      operando.current = false;
      setOcupado(false);
    }
  }

  async function enviar(ativa: FilaAberta) {
    const item = await ativa.fila.enviarProximo(enviando => setItens(atuais => atuais.map(
      registro => registro.comando.operacaoId === enviando.comando.operacaoId ? enviando : registro,
    )));
    if (item?.recibo) setRevisaoConfirmada({ geracao: ativa.geracao, revisao: item.recibo.revisao });
    setItens(await ativa.fila.listar());
    if (item?.estado === 'confirmado' || item?.estado === 'conflito' || item?.estado === 'rejeitado') await consultar();
  }

  function tentarEnvio() {
    const ativa = fila.current;
    if (ativa) void exclusivo(async () => {
      sessao.current = null;
      await enviar(ativa);
    });
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void consultar().catch(falha => setErro((falha as Error).message));
    if (!real?.readOnly) void geracoesDaFila(uid, espacoId).then(setGeracoes).catch(() => {
      setErro('Não foi possível consultar as filas locais.');
    });
    const online = () => {
      if (fila.current) tentarEnvio();
      else void atualizar();
    };
    window.addEventListener('online', online);
    const sincronizarVisivel = () => {
      if (!document.hidden && navigator.onLine && !operando.current) void atualizar();
    };
    const intervalo = real ? window.setInterval(sincronizarVisivel, 20_000) : undefined;
    if (real) document.addEventListener('visibilitychange', sincronizarVisivel);
    return () => {
      window.removeEventListener('online', online);
      document.removeEventListener('visibilitychange', sincronizarVisivel);
      window.clearInterval(intervalo);
      fila.current?.fila.bloquear();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function desbloquear(segredoLocal: string, geracao: number) {
    if (real?.readOnly) return;
    void exclusivo(async () => {
      const nova = await abrirFilaFinanceiraOffline({ escopo: { uid, espacoId, geracao }, segredoLocal, obterToken, producao: Boolean(real) });
      let registros;
      try { registros = await nova.listar(); } catch (falha) { nova.bloquear(); throw falha; }
      fila.current?.fila.bloquear();
      const ativa = { fila: nova, geracao };
      fila.current = ativa;
      setAberta(geracao);
      setItens(registros);
      if (registros.some(item => item.estado === 'pendente' || item.estado === 'enviando')) await enviar(ativa);
    });
  }

  const versao = dados?._sync;
  const aguardandoLeitura = Boolean(revisaoConfirmada && versao?.generation === revisaoConfirmada.geracao
    && versao.revision < revisaoConfirmada.revisao);
  const podeSalvar = gravavel && aberta !== undefined && aberta === versao?.generation && !aguardandoLeitura
    && !ocupado && !itens.some(item => item.estado === 'pendente' || item.estado === 'enviando');

  async function registrar(base: DadosPersistidos, alteracao: Record<string, unknown>) {
    const ativa = fila.current, sync = base._sync;
    if (!podeSalvar || !ativa || !sync) return false;
    if (ativa.geracao !== sync.generation) {
      throw new Error('Este formulário pertence a uma geração anterior. Confira os dados e reabra o formulário antes de enviar.');
    }
    const item = await exclusivo(async () => {
      const salvo = await ativa.fila.enfileirar(sync.revision, alteracao);
      setItens(atuais => [...atuais, salvo]);
      setGeracoes(atuais => [...new Set([...atuais, ativa.geracao])]);
      return salvo;
    });
    if (!item) return false;
    void exclusivo(() => enviar(ativa));
    return true;
  }

  return { dados, caixinhas: leituraConfirmada?.caixinhas, itens, geracoes, aberta, erro, ocupado, podeSalvar, registrar, atualizar, tentarEnvio, desbloquear,
    producao: Boolean(real), gravavel };
}
