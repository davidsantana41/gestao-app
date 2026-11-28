'use client';

import { useEffect, useRef, useState } from 'react';
import { abrirFilaFinanceiraOffline, geracoesDaFila, type ItemFilaFinanceira } from './filaFinanceiraOffline';
import { decidirEstadoGravacao } from './estadoGravacaoFinanceira';
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
type ComandoDiretoPendente = { operacaoId: string; geracao: number; revisao: number; assinatura: string; statusVerificado: boolean };

export function useFinanceiroIntegrado(identidade: SessaoFinanceiraLocal | SessaoFinanceiraReal) {
  const { uid, espacoId } = identidade;
  const real = 'obterToken' in identidade ? identidade : undefined;
  const [leituraConfirmada, setLeituraConfirmada] = useState<{ financeiro: DadosPersistidos; caixinhas?: LeituraCaixinhas }>();
  const dados = leituraConfirmada?.financeiro;
  const [itens, setItens] = useState<ItemFilaFinanceira[]>([]);
  const [geracoes, setGeracoes] = useState<number[]>([]);
  const [geracoesConferidas, setGeracoesConferidas] = useState<number[]>([]);
  const [filaLocalVerificada, setFilaLocalVerificada] = useState(false);
  const [conectada, setConectada] = useState(false);
  const [servicoDisponivel, setServicoDisponivel] = useState<boolean | null>(null);
  const [sincronizando, setSincronizando] = useState(true);
  const [aberta, setAberta] = useState<number>();
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [gravavel, setGravavel] = useState(!real);
  const [revisaoConfirmada, setRevisaoConfirmada] = useState<{ geracao: number; revisao: number }>();
  const fila = useRef<FilaAberta>(null);
  const comandoDiretoPendente = useRef<ComandoDiretoPendente | undefined>(undefined);
  const operando = useRef(false);
  const sessao = useRef<{ token: string; ate: number }>(null);
  const consultaAtiva = useRef<Promise<void> | null>(null);
  const ultimaConsulta = useRef(0);

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
    if (consultaAtiva.current) return consultaAtiva.current;
    const consulta = (async () => {
    setSincronizando(true);
    let respostaRecebida = false;
    try {
    const token = await obterToken();
    if (!token) throw new Error('Autentique a conta para consultar os dados confirmados.');
    const destino = real ? `/api/financeiro?titular=${encodeURIComponent(real.titular)}` : `/espacos/${espacoId}/consulta`;
    const resposta = await fetch(destino, {
      headers: { Authorization: `Bearer ${token}`, 'X-Appcar-Conta-Fila': uid },
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(12000),
    });
    respostaRecebida = true;
    setServicoDisponivel(resposta.status < 500);
    if (resposta.status === 401) sessao.current = null;
    if (!resposta.ok) {
      setServicoDisponivel(resposta.status < 500);
      if (real) setGravavel(false);
      if (resposta.status === 401 || resposta.status === 403) setLeituraConfirmada(undefined);
      throw new Error('Não foi possível consultar o financeiro confirmado.');
    }
    setServicoDisponivel(true);
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
    ultimaConsulta.current = Date.now();
    setErro('');
    } catch (falha) {
      if (!respostaRecebida) setServicoDisponivel(false);
      throw falha;
    } finally {
      setSincronizando(false);
      consultaAtiva.current = null;
    }
    })();
    consultaAtiva.current = consulta;
    return consulta;
  }

  async function atualizar() {
    setErro('');
    try { await consultar(); } catch (falha) { setErro((falha as Error).message); }
  }

  async function consultarOperacaoPendente() {
    const pendente = comandoDiretoPendente.current;
    if (!pendente || !real) return false;
    const token = await obterToken();
    if (!token) throw new Error('Autentique a conta para consultar a confirmaÃ§Ã£o pendente.');
    const resposta = await fetch(`/api/financeiro?espaco=${encodeURIComponent(espacoId)}&operacaoId=${encodeURIComponent(pendente.operacaoId)}`, {
      headers: { Authorization: `Bearer ${token}`, 'X-Appcar-Conta-Fila': uid },
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(12000),
    });
    setServicoDisponivel(resposta.status < 500);
    if (!resposta.ok) throw new Error('NÃ£o foi possÃ­vel consultar a confirmaÃ§Ã£o pendente.');
    const status = await resposta.json() as { estado?: unknown; operacaoId?: unknown; revisao?: unknown };
    if (status.operacaoId !== pendente.operacaoId) throw new Error('O serviÃ§o nÃ£o confirmou o identificador pendente.');
    if (status.estado !== 'confirmada') {
      pendente.statusVerificado = true;
      return false;
    }
    if (!Number.isSafeInteger(status.revisao)) throw new Error('O recibo da operaÃ§Ã£o pendente Ã© invÃ¡lido.');
    comandoDiretoPendente.current = undefined;
    setRevisaoConfirmada({ geracao: pendente.geracao, revisao: status.revisao as number });
    try { await consultar(); } catch { setErro('A operaÃ§Ã£o foi confirmada. Os dados serÃ£o atualizados automaticamente.'); }
    return true;
  }

  async function exclusivo<T>(acao: () => Promise<T>, propagarFalha = false) {
    if (operando.current) {
      if (propagarFalha) throw new Error('Outra operação está sendo confirmada. Aguarde e confira os dados antes de tentar novamente.');
      return;
    }
    operando.current = true;
    setOcupado(true);
    setErro('');
    try { return await acao(); } catch (falha) {
      if (propagarFalha) throw falha;
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
    setConectada(navigator.onLine);
    if (!real?.readOnly) void geracoesDaFila(uid, espacoId).then(atuais => {
      setGeracoes(atuais);
      setFilaLocalVerificada(true);
    }).catch(() => {
      setErro('Não foi possível verificar operações antigas deste dispositivo.');
    });
    else setFilaLocalVerificada(true);
    const online = () => {
      setConectada(true);
      if (fila.current) tentarEnvio();
      else if (comandoDiretoPendente.current) void consultarOperacaoPendente().then(confirmada => { if (!confirmada) void atualizar(); }).catch(() => { setServicoDisponivel(false); });
      else void atualizar();
    };
    const offline = () => setConectada(false);
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    const sincronizarVisivel = () => {
      if (!document.hidden && navigator.onLine && !operando.current && Date.now() - ultimaConsulta.current >= 25_000) {
        if (comandoDiretoPendente.current) void consultarOperacaoPendente().then(confirmada => { if (!confirmada) void atualizar(); }).catch(() => { setServicoDisponivel(false); });
        else void atualizar();
      }
    };
    const intervalo = window.setInterval(sincronizarVisivel, 30_000);
    document.addEventListener('visibilitychange', sincronizarVisivel);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
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
      setGeracoesConferidas(atuais => [...new Set([...atuais, geracao])]);
      setErro('');
    });
  }

  const versao = dados?._sync;
  const aguardandoLeitura = Boolean(revisaoConfirmada && versao?.generation === revisaoConfirmada.geracao
    && versao.revision < revisaoConfirmada.revisao);
  const temPendenciasFila = itens.some(item => item.estado === 'pendente' || item.estado === 'enviando');
  const bloqueiaFilaLegada = !filaLocalVerificada || geracoes.some(g => !geracoesConferidas.includes(g))
    || temPendenciasFila;
  const estadoGravacao = decidirEstadoGravacao({ gravavel, somenteLeitura: Boolean(real?.readOnly), ocupado,
    aguardandoLeitura, conectada, servicoDisponivel, filaLegadaVerificada: filaLocalVerificada,
    filaLegadaBloqueia: bloqueiaFilaLegada });
  const podeSalvar = estadoGravacao.podeSalvar;
  const motivoBloqueio = estadoGravacao.motivo;

  async function registrar(base: DadosPersistidos, alteracao: Record<string, unknown>) {
    const sync = base._sync;
    if (!podeSalvar || !sync) return false;
    if (navigator.onLine && conectada) {
      const assinatura = JSON.stringify(alteracao);
      const anterior = comandoDiretoPendente.current;
      if (anterior && (anterior.geracao !== sync.generation || anterior.revisao !== sync.revision || anterior.assinatura !== assinatura)) {
        throw new Error('A confirmação de uma operação anterior está pendente. Atualize os dados e confira o histórico antes de iniciar outra.');
      }
      if (anterior && !anterior.statusVerificado && await consultarOperacaoPendente()) return true;
      const comando = anterior ?? { operacaoId: crypto.randomUUID(), geracao: sync.generation, revisao: sync.revision, assinatura, statusVerificado: false };
      comandoDiretoPendente.current = comando;
      const enviado = await exclusivo(async () => {
        const token = await obterToken();
        if (!token) throw new Error('Autentique a conta para registrar a operação.');
        let resposta: Response;
        try {
          const destino = real ? `/api/financeiro?espaco=${encodeURIComponent(espacoId)}` : `/espacos/${encodeURIComponent(espacoId)}/comandos`;
          resposta = await fetch(destino, {
            method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(12_000),
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Appcar-Conta-Fila': uid },
            body: JSON.stringify({ operacaoId: comando.operacaoId, geracao: comando.geracao, revisao: comando.revisao, alteracao }),
          });
        } catch {
          try { if (await consultarOperacaoPendente()) return true; } catch { setServicoDisponivel(false); }
          throw new Error('Não foi possível confirmar a resposta do servidor. A mesma operação foi preservada para uma tentativa segura; não inicie outra até conferir os dados.');
        }
        setServicoDisponivel(resposta.status < 500);
        if (!resposta.ok) {
          const falha = await resposta.json().catch(() => ({})) as { erro?: unknown };
          if (resposta.status >= 500) {
            try { if (await consultarOperacaoPendente()) return true; } catch { setServicoDisponivel(false); }
          }
          if (resposta.status >= 400 && resposta.status < 500) comandoDiretoPendente.current = undefined;
          throw new Error(typeof falha.erro === 'string' ? falha.erro : 'O serviço recusou a operação. Atualize os dados e confira o motivo.');
        }
        const recibo = await resposta.json().catch(() => null) as { operacaoId?: unknown; revisao?: unknown; repetida?: unknown } | null;
        if (recibo?.operacaoId !== comando.operacaoId || !Number.isSafeInteger(recibo.revisao)
            || (!recibo.repetida && recibo.revisao !== sync.revision + 1)) {
          throw new Error('O recibo do servidor não corresponde à operação. Atualize os dados antes de tentar novamente.');
        }
        comandoDiretoPendente.current = undefined;
        setRevisaoConfirmada({ geracao: sync.generation, revisao: recibo.revisao as number });
        try { await consultar(); }
        catch { setErro('A operação foi confirmada, mas os dados ainda não sincronizaram. O painel tentará atualizar automaticamente.'); }
        return true;
      }, true);
      return enviado === true;
    }
    throw new Error('Sem conexão. Nenhuma operação foi enfileirada; os campos preenchidos foram preservados.');
  }

  return { dados, caixinhas: leituraConfirmada?.caixinhas, itens, geracoes, geracoesConferidas, aberta, erro, ocupado, podeSalvar, registrar, atualizar, tentarEnvio, desbloquear,
    producao: Boolean(real), gravavel, motivoBloqueio, conectada, servicoDisponivel, sincronizando };
}
