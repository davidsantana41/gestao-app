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
type ComandoDiretoPendente = { operacaoId: string; geracao: number; revisao: number; assinatura: string };

export function useFinanceiroIntegrado(identidade: SessaoFinanceiraLocal | SessaoFinanceiraReal) {
  const { uid, espacoId } = identidade;
  const real = 'obterToken' in identidade ? identidade : undefined;
  const [leituraConfirmada, setLeituraConfirmada] = useState<{ financeiro: DadosPersistidos; caixinhas?: LeituraCaixinhas }>();
  const dados = leituraConfirmada?.financeiro;
  const [itens, setItens] = useState<ItemFilaFinanceira[]>([]);
  const [geracoes, setGeracoes] = useState<number[]>([]);
  const [filaLocalVerificada, setFilaLocalVerificada] = useState(false);
  const [conectada, setConectada] = useState(false);
  const [aberta, setAberta] = useState<number>();
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [gravavel, setGravavel] = useState(!real);
  const [revisaoConfirmada, setRevisaoConfirmada] = useState<{ geracao: number; revisao: number }>();
  const fila = useRef<FilaAberta>(null);
  const comandoDiretoPendente = useRef<ComandoDiretoPendente | undefined>(undefined);
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
      setErro('Não foi possível conferir a fila financeira local.');
    });
    else setFilaLocalVerificada(true);
    const online = () => {
      setConectada(true);
      if (fila.current) tentarEnvio();
      else void atualizar();
    };
    const offline = () => setConectada(false);
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    const sincronizarVisivel = () => {
      if (!document.hidden && navigator.onLine && !operando.current) void atualizar();
    };
    const intervalo = real ? window.setInterval(sincronizarVisivel, 20_000) : undefined;
    if (real) document.addEventListener('visibilitychange', sincronizarVisivel);
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
      if (registros.some(item => item.estado === 'pendente' || item.estado === 'enviando')) await enviar(ativa);
    });
  }

  const versao = dados?._sync;
  const aguardandoLeitura = Boolean(revisaoConfirmada && versao?.generation === revisaoConfirmada.geracao
    && versao.revision < revisaoConfirmada.revisao);
  const temPendenciasFila = itens.some(item => item.estado === 'pendente' || item.estado === 'enviando');
  const filaAtualAberta = aberta !== undefined && aberta === versao?.generation;
  const estadoGravacao = decidirEstadoGravacao({ gravavel, somenteLeitura: Boolean(real?.readOnly), ocupado,
    aguardandoLeitura, temPendenciasFila, producao: Boolean(real), conectada, filaLocalVerificada,
    quantidadeFilasLocais: geracoes.length, filaEstaAberta: aberta !== undefined, filaAtualAberta });
  const { podeSalvar, modo: modoGravacao, motivo: motivoBloqueio } = estadoGravacao;

  async function registrar(base: DadosPersistidos, alteracao: Record<string, unknown>) {
    const ativa = fila.current, sync = base._sync;
    if (!podeSalvar || !sync) return false;
    if (!ativa && modoGravacao === 'direto' && real) {
      if (!conectada || !navigator.onLine) throw new Error('Sem conexão. A operação não foi enviada; conecte-se e tente novamente.');
      const assinatura = JSON.stringify(alteracao);
      const anterior = comandoDiretoPendente.current;
      if (anterior && (anterior.geracao !== sync.generation || anterior.revisao !== sync.revision || anterior.assinatura !== assinatura)) {
        throw new Error('A confirmação de uma operação anterior está pendente. Atualize os dados e confira o histórico antes de iniciar outra.');
      }
      const comando = anterior ?? { operacaoId: crypto.randomUUID(), geracao: sync.generation, revisao: sync.revision, assinatura };
      comandoDiretoPendente.current = comando;
      const enviado = await exclusivo(async () => {
        const token = await obterToken();
        if (!token) throw new Error('Autentique a conta para registrar a operação.');
        let resposta: Response;
        try {
          resposta = await fetch(`/api/financeiro?espaco=${encodeURIComponent(espacoId)}`, {
            method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(12_000),
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Appcar-Conta-Fila': uid },
            body: JSON.stringify({ operacaoId: comando.operacaoId, geracao: comando.geracao, revisao: comando.revisao, alteracao }),
          });
        } catch {
          throw new Error('Não foi possível confirmar a resposta do servidor. A mesma operação foi preservada para uma tentativa segura; não inicie outra até conferir os dados.');
        }
        if (!resposta.ok) {
          const falha = await resposta.json().catch(() => ({})) as { erro?: unknown };
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
        catch { setErro('A operação foi confirmada, mas a atualização da tela falhou. Use Atualizar dados confirmados.'); }
        return true;
      }, true);
      return enviado === true;
    }
    if (!ativa) return false;
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
    producao: Boolean(real), gravavel, modoGravacao, motivoBloqueio };
}
