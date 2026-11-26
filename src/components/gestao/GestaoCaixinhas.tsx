'use client';

import { useId, useMemo, useState } from 'react';
import { dataLocal, moeda, numero, type DadosPersistidos } from '@/lib/gestao';
import { reaisParaCentavos } from '@/lib/centavosFinanceiros';
import {
  obterTodasCaixinhas,
  type EventoAuditoriaCaixinha,
  type CaixinhaCompleta,
  type PendenciaRevisao,
} from '@/lib/gestaoCaixinhasIntegrada';
import type { IdCaixinha } from '@/lib/catalogoCaixinhas';
import type { LeituraCaixinhas } from '@/lib/useFinanceiroIntegrado';

export type GestaoCaixinhasProps = {
  dados: DadosPersistidos;
  readOnly?: boolean;
  bloquearEnvio?: boolean;
  motivoBloqueioEnvio?: string;
  motivoSomenteLeitura?: string;
  leitura?: LeituraCaixinhas;
  onComando?: (alteracao: Record<string, unknown>, base: DadosPersistidos) => Promise<false | 'confirmada' | 'enfileirada'>;
};

type AbaCaixinhas = 'ativas' | 'arquivadas' | 'conciliacao' | 'auditoria';

const rotulosAuditoria: Record<EventoAuditoriaCaixinha['acao'], string> = {
  criar: 'Criação',
  renomear: 'Edição',
  arquivar: 'Desativação',
  reativar: 'Reativação',
  excluir: 'Exclusão',
  conciliar: 'Vínculo confirmado',
  depositar: 'Depósito',
  retirar: 'Retirada',
  estornar: 'Estorno',
  corrigir: 'Correção',
};

type ModalEstado =
  | { tipo: 'criar' }
  | { tipo: 'visualizar'; caixinha: CaixinhaCompleta }
  | { tipo: 'editar'; caixinha: CaixinhaCompleta }
  | { tipo: 'depositar' | 'retirar'; caixinha: CaixinhaCompleta }
  | { tipo: 'arquivar'; caixinha: CaixinhaCompleta }
  | { tipo: 'reativar'; caixinha: CaixinhaCompleta }
  | { tipo: 'excluir'; caixinha: CaixinhaCompleta }
  | { tipo: 'conciliar'; pendencia: PendenciaRevisao };

export default function GestaoCaixinhas({
  dados,
  readOnly = false,
  bloquearEnvio = false,
  motivoBloqueioEnvio,
  motivoSomenteLeitura,
  leitura,
  onComando,
}: GestaoCaixinhasProps) {
  const [aba, setAba] = useState<AbaCaixinhas>('ativas');
  const [dialogo, setDialogo] = useState<{ modal: ModalEstado; base: DadosPersistidos } | null>(null);
  const modal = dialogo?.modal;
  const setModal = (valor: ModalEstado | null) => setDialogo(valor ? { modal: valor, base: dados } : null);
  const [filtroTexto, setFiltroTexto] = useState('');
  const [feedback, setFeedback] = useState<{ tipo: 'sucesso' | 'erro'; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const filtroId = useId();

  // Projeção completa das caixinhas e pendências
  const relatorio = useMemo(() => leitura?.relatorio ?? obterTodasCaixinhas(dados), [dados, leitura]);
  const auditoriaEspaco = leitura?.auditoria ?? [];
  const podeAcao = (acao: string) => !readOnly && leitura?.acoes.includes(acao) === true;
  const saldoConfirmado = relatorio.caixinhas.every(c => c.saldoAtestado);

  const caixinhasAtivas = useMemo(
    () => relatorio.caixinhas.filter(c => c.estado === 'ativa'),
    [relatorio.caixinhas],
  );

  const caixinhasDesativadas = useMemo(
    () => relatorio.caixinhas.filter(c => c.estado === 'arquivada'),
    [relatorio.caixinhas],
  );

  const caixinhasFiltradas = useMemo(() => {
    const lista = aba === 'ativas' ? caixinhasAtivas : caixinhasDesativadas;
    if (!filtroTexto.trim()) return lista;
    const termo = filtroTexto.toLowerCase();
    return lista.filter(
      c =>
        c.nome.toLowerCase().includes(termo) ||
        c.id.toLowerCase().includes(termo) ||
        c.finalidade.toLowerCase().includes(termo),
    );
  }, [aba, caixinhasAtivas, caixinhasDesativadas, filtroTexto]);

  const aplicarAlteracao = async (comandoPayload: Record<string, unknown>) => {
    if (!onComando || !dialogo) return;
    setFeedback(null);
    setOcupado(true);
    try {
        if (bloquearEnvio || !podeAcao(String(comandoPayload.tipo))) {
          setFeedback({ tipo: 'erro', texto: 'A operação está indisponível no momento. Confira o estado da fila.' });
          return;
        }
        if (dialogo.base._sync?.generation !== dados._sync?.generation || dialogo.base._sync?.revision !== dados._sync?.revision) {
          setFeedback({ tipo: 'erro', texto: 'Os dados mudaram. Feche a revisão e abra a operação novamente.' });
          return;
        }
        const resultado = await onComando(comandoPayload, dialogo.base);
        if (resultado) {
          setFeedback({ tipo: 'sucesso', texto: resultado === 'confirmada'
            ? 'Operação confirmada pelo serviço financeiro.'
            : 'Operação adicionada à fila. Acompanhe a confirmação no painel.' });
          setModal(null);
        } else {
          setFeedback({ tipo: 'erro', texto: 'Não foi possível confirmar a operação no servidor.' });
        }
    } catch (erro) {
      setFeedback({
        tipo: 'erro',
        texto: erro instanceof Error ? erro.message : 'Erro ao processar operação.',
      });
    } finally {
      setOcupado(false);
    }
  };

  return (
    <section className="pilha caixinhas-gestao" aria-labelledby="titulo-gestao-caixinhas">
      {/* Cabeçalho */}
      <div className="titulo-linha">
        <div>
          <p className="sobretitulo">PLANEJAMENTO &amp; RESERVAS</p>
          <h2 id="titulo-gestao-caixinhas">Gestão de caixinhas</h2>
          <p className="ajuda">
            Gerencie reservas financeiras, rateios e destinos de recursos com identificadores permanentes e auditoria
            completa.
          </p>
        </div>
        {podeAcao('caixinha-criar') && (
          <button
            type="button"
            className="botao primario"
            disabled={bloquearEnvio || ocupado}
            title={bloquearEnvio ? motivoBloqueioEnvio : undefined}
            onClick={() => {
              setFeedback(null);
              setModal({ tipo: 'criar' });
            }}
          >
            + Criar caixinha
          </button>
        )}
      </div>
      {bloquearEnvio && !readOnly && <p id="motivo-bloqueio-caixinhas" role="status" className="mensagem aviso">
        {motivoBloqueioEnvio || 'As operações estão temporariamente indisponíveis. Confira a conexão e a fila financeira.'}
      </p>}
      {readOnly && leitura && <p role="status" className="mensagem aviso">
        {motivoSomenteLeitura || 'Este acesso está em modo somente leitura; operações das caixinhas não estão disponíveis.'}
      </p>}
      {!leitura && <p className="ajuda">A edição de caixinhas fica disponível em espaços com o serviço financeiro integrado.</p>}

      {/* Cartões de Indicadores */}
      <div className="grade-metricas">
        <div className="metrica destaque" data-saldo={saldoConfirmado ? (relatorio.totalSaldoCentavos >= 0 ? 'positivo' : 'negativo') : undefined}>
          <span>Saldo total em caixinhas</span>
          <strong>{saldoConfirmado ? moeda(relatorio.totalSaldoCentavos / 100) : 'Em revisão'}</strong>
          <small>{caixinhasAtivas.length} caixinhas ativas</small>
        </div>
        <div className="metrica">
          <span>Caixinhas ativas</span>
          <strong>{caixinhasAtivas.length}</strong>
          <small>Disponíveis para turno e retiradas</small>
        </div>
        <div className="metrica">
          <span>Caixinhas desativadas</span>
          <strong>{caixinhasDesativadas.length}</strong>
          <small>Preservadas no histórico com saldo zerado</small>
        </div>
        <div className="metrica" style={relatorio.totalPendencias > 0 ? { borderColor: '#f59e0b' } : undefined}>
          <span>Movimentações para revisar</span>
          <strong style={relatorio.totalPendencias > 0 ? { color: '#f59e0b' } : undefined}>
            {relatorio.totalPendencias}
          </strong>
          <small>
            {relatorio.totalPendencias === 0
              ? 'Nenhuma movimenta??o para revisar'
              : `${relatorio.totalPendencias} registro(s) para revisar`}
          </small>
        </div>
      </div>

      {/* Feedback Mensagem */}
      {feedback && (
        <div
          role={feedback.tipo === 'erro' ? 'alert' : 'status'}
          className={`mensagem ${feedback.tipo === 'erro' ? 'erro' : 'sucesso'}`}
        >
          {feedback.texto}
        </div>
      )}

      {/* Abas de Navegação Interna */}
      <nav className="abas-caixinhas" aria-label="Navegação da gestão de caixinhas">
        <button
          type="button"
          className={`aba-item ${aba === 'ativas' ? 'ativa' : ''}`}
          onClick={() => setAba('ativas')}
          aria-current={aba === 'ativas' ? 'page' : undefined}
        >
          Caixinhas ativas ({caixinhasAtivas.length})
        </button>
        <button
          type="button"
          className={`aba-item ${aba === 'arquivadas' ? 'ativa' : ''}`}
          onClick={() => setAba('arquivadas')}
          aria-current={aba === 'arquivadas' ? 'page' : undefined}
        >
          Desativadas ({caixinhasDesativadas.length})
        </button>
        <button
          type="button"
          className={`aba-item ${aba === 'conciliacao' ? 'ativa' : ''}`}
          onClick={() => setAba('conciliacao')}
          aria-current={aba === 'conciliacao' ? 'page' : undefined}
        >
          Vínculos a revisar
          {relatorio.totalPendencias > 0 && (
            <span className="badge-contador">{relatorio.totalPendencias}</span>
          )}
        </button>
        <button
          type="button"
          className={`aba-item ${aba === 'auditoria' ? 'ativa' : ''}`}
          onClick={() => setAba('auditoria')}
          aria-current={aba === 'auditoria' ? 'page' : undefined}
        >
          Histórico e auditoria ({auditoriaEspaco.length})
        </button>
      </nav>

      {/* Conteúdo da Aba Ativas e Desativadas */}
      {(aba === 'ativas' || aba === 'arquivadas') && (
        <div className="pilha compacta">
          {/* Barra de Filtro */}
          <div className="barra-filtro-caixinhas">
            <label htmlFor={filtroId} className="sr-only">
              Filtrar caixinhas por nome ou finalidade
            </label>
            <input
              id={filtroId}
              type="search"
              placeholder="Buscar por nome, ID ou finalidade…"
              value={filtroTexto}
              onChange={e => setFiltroTexto(e.target.value)}
              className="campo-busca-caixinhas"
            />
            {filtroTexto && (
              <button
                type="button"
                className="botao discreto"
                onClick={() => setFiltroTexto('')}
                title="Limpar busca"
              >
                Limpar
              </button>
            )}
          </div>

          {caixinhasFiltradas.length === 0 ? (
            <div className="painel vazio">
              <p>
                {filtroTexto
                  ? 'Nenhuma caixinha encontrada com os termos buscados.'
                  : aba === 'ativas'
                    ? 'Nenhuma caixinha ativa cadastrada. Clique em "+ Criar caixinha" para começar.'
                    : 'Nenhuma caixinha desativada no momento.'}
              </p>
            </div>
          ) : (
            <div className="grade-caixinhas-cards">
              {caixinhasFiltradas.map(c => (
                <article key={c.id} className="card-caixinha">
                  <header className="card-caixinha-topo">
                    <div className="card-caixinha-titulos">
                      <div className="card-caixinha-tags">
                        <span className={`tag-familia tag-${c.familia}`}>
                          {c.familia === 'diaria'
                            ? 'Reserva diária'
                            : c.familia === 'fixo'
                              ? 'Custo fixo'
                              : 'Reserva fixa'}
                        </span>
                        <span className={`tag-estado tag-${c.estado}`}>
                          {c.estado === 'ativa' ? 'Ativa' : 'Desativada'}
                        </span>
                      </div>
                      <h3 className="card-caixinha-nome">{c.nome}</h3>
                      <p className="card-caixinha-id" title="Identificador permanente">
                        <code>{c.id}</code>
                      </p>
                    </div>

                    <div className="card-caixinha-saldo-bloco">
                      <span className="card-caixinha-saldo-rotulo">Saldo atual</span>
                      <strong
                        className="card-caixinha-saldo-valor"
                        data-saldo={c.saldo > 0 ? 'positivo' : c.saldo < 0 ? 'negativo' : undefined}
                      >
                        {moeda(c.saldo)}
                      </strong>
                      {!c.saldoAtestado && (
                        <span className="alerta-saldo-pendente" title={c.motivoSaldoNaoAtestado}>
                          Vínculos em revisão
                        </span>
                      )}
                    </div>
                  </header>

                  <div className="card-caixinha-corpo">
                    <p className="card-caixinha-finalidade">
                      <strong>Finalidade: </strong>
                      {c.finalidade || <span className="texto-suave">Não informada</span>}
                    </p>

                    <div className="card-caixinha-mini-indicadores">
                      <div>
                        <span>Entradas: </span>
                        <strong>{moeda(c.totalCreditos)}</strong>
                      </div>
                      <div>
                        <span>Retiradas: </span>
                        <strong>{moeda(c.totalDebitos)}</strong>
                      </div>
                      <div>
                        <span>Movimentações: </span>
                        <strong>{c.movimentos.length}</strong>
                      </div>
                    </div>
                  </div>

                  <footer className="card-caixinha-acoes">
                    <button
                      type="button"
                      className="botao secundario compacto"
                      onClick={() => setModal({ tipo: 'visualizar', caixinha: c })}
                    >
                      Visualizar
                    </button>

                    {!readOnly && c.editavel !== false && (
                      <>
                        {c.estado === 'ativa' && podeAcao('deposito-caixinha') && (
                          <button type="button" className="botao secundario compacto" disabled={bloquearEnvio || ocupado}
                            title={bloquearEnvio ? motivoBloqueioEnvio : undefined}
                            onClick={() => setModal({ tipo: 'depositar', caixinha: c })}>Depositar</button>
                        )}
                        {c.estado === 'ativa' && podeAcao('retirada') && (
                          <button type="button" className="botao secundario compacto" disabled={bloquearEnvio || ocupado}
                            title={bloquearEnvio ? motivoBloqueioEnvio : undefined}
                            onClick={() => setModal({ tipo: 'retirar', caixinha: c })}>Retirar</button>
                        )}
                        <button
                          type="button"
                          className="botao secundario compacto"
                          disabled={bloquearEnvio || ocupado || !podeAcao('caixinha-editar')}
                          title={bloquearEnvio ? motivoBloqueioEnvio : undefined}
                          onClick={() => setModal({ tipo: 'editar', caixinha: c })}
                        >
                          Editar
                        </button>

                        {c.estado === 'ativa' ? (
                          <button
                            type="button"
                            className="botao secundario compacto"
                            disabled={bloquearEnvio || ocupado || !podeAcao('caixinha-arquivar')}
                            title={bloquearEnvio ? motivoBloqueioEnvio : undefined}
                            onClick={() => setModal({ tipo: 'arquivar', caixinha: c })}
                          >
                            Desativar
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="botao secundario compacto"
                            disabled={bloquearEnvio || ocupado || !podeAcao('caixinha-reativar')}
                            title={bloquearEnvio ? motivoBloqueioEnvio : undefined}
                            onClick={() => setModal({ tipo: 'reativar', caixinha: c })}
                          >
                            Reativar
                          </button>
                        )}

                        <button
                          type="button"
                          className="botao perigo compacto"
                          disabled={bloquearEnvio || ocupado || !podeAcao('caixinha-excluir')}
                          title={bloquearEnvio ? motivoBloqueioEnvio : c.podeExcluir
                            ? 'Excluir caixinha sem movimentos' : 'Exclusão física bloqueada por ter histórico'}
                          onClick={() => setModal({ tipo: 'excluir', caixinha: c })}
                        >
                          Excluir
                        </button>
                      </>
                    )}
                  </footer>
                </article>
              ))}
            </div>
          )}
        </div>
      )}

      {aba === 'conciliacao' && (
        <div className="pilha compacta">
          <div className="painel">
            <h3>Confirme a caixinha da movimentação</h3>
            <p className="ajuda">
              Veja movimentações antigas cuja caixinha ainda precisa ser confirmada. Ao confirmar o vínculo,
              o saldo é atualizado e o lançamento original fica preservado.
            </p>
          </div>

          {relatorio.pendencias.length === 0 ? (
            <div className="painel vazio">
              <p>Nenhuma movimentação precisa de revisão.</p>
            </div>
          ) : (
            <div className="lista-pendencias">
              {relatorio.pendencias.map(p => (
                <article key={p.id} className="item-pendencia painel">
                  <div className="item-pendencia-header">
                    <div>
                      <div className="card-caixinha-tags">
                        <span className="tag-familia tag-pendencia">{p.fonteDescricao}</span>
                        <span className="tag-motivo">{p.motivoDescricao}</span>
                      </div>
                      <h4 className="item-pendencia-titulo">
                        {p.descricao}
                        {p.data && ` · ${p.data}`}
                      </h4>
                      <p className="item-pendencia-referencia">
                        Origem original: <code>{p.referenciaOriginal || 'Sem referência'}</code>
                        {p.lancamentoId && ` · Lançamento: ${p.lancamentoId}`}
                      </p>
                    </div>

                    <div className="item-pendencia-valor">
                      <span className="card-caixinha-saldo-rotulo">Valor</span>
                      <strong>{moeda(p.valor)}</strong>
                    </div>
                  </div>

                  {p.candidatos.length > 0 && (
                    <div className="item-pendencia-sugestoes">
                      <span>Possíveis caixinhas sugeridas: </span>
                      {p.candidatos.map(c => (
                        <span key={c.id} className="selo">
                          {c.nome} ({c.criterio})
                        </span>
                      ))}
                    </div>
                  )}

                  {podeAcao('caixinha-conciliar') && (
                    <div className="item-pendencia-rodape">
                      <button
                        type="button"
                        className="botao primario compacto"
                        disabled={bloquearEnvio || ocupado || (leitura && !p.referenciaVerificada)}
                        onClick={() => setModal({ tipo: 'conciliar', pendencia: p })}
                      >
                        Revisar vínculo
                      </button>
                      {leitura && !p.referenciaVerificada && <p className="ajuda">A movimentação precisa de uma referência verificável para confirmar a caixinha.</p>}
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Conteúdo da Aba Histórico e Auditoria */}
      {aba === 'auditoria' && (
        <div className="pilha compacta">
          <div className="painel">
            <h3>Trilha de auditoria das caixinhas</h3>
            <p className="ajuda">
              Histórico cronológico imutável de todas as criações, renomeações, desativações, reativações e vínculos
              confirmados.
            </p>
          </div>

          {auditoriaEspaco.length === 0 ? (
            <div className="painel vazio">
              <p>Nenhum evento de auditoria registrado até o momento.</p>
            </div>
          ) : (
            <div className="tabela-scroll">
              <table className="tabela-auditoria">
                <thead>
                  <tr>
                    <th>Data / Hora</th>
                    <th>Ação</th>
                    <th>Caixinha ID</th>
                    <th>Motivo informado</th>
                    <th>Detalhes</th>
                    <th>Autor UID</th>
                  </tr>
                </thead>
                <tbody>
                  {auditoriaEspaco.map(e => (
                    <tr key={`${e.id}:${e.caixinhaId}`}>
                      <td>
                        <time dateTime={e.confirmadoEm}>
                          {new Date(e.confirmadoEm).toLocaleString('pt-BR')}
                        </time>
                      </td>
                      <td>
                        <span className={`badge-acao badge-acao-${e.acao}`}>
                          {rotulosAuditoria[e.acao]}
                        </span>
                      </td>
                      <td>
                        <code>{e.caixinhaId}</code>
                      </td>
                      <td>{e.motivo || '—'}</td>
                      <td>
                        {e.acao === 'renomear' && (
                          <span>
                            {e.nomeAnterior} ➔ <strong>{e.nomeNovo}</strong>
                          </span>
                        )}
                        {e.acao === 'criar' && <span>Nome: {e.nomeNovo}</span>}
                        {e.lancamentoId && e.acao !== 'conciliar' && <span>Lançamento {e.lancamentoId}</span>}
                        {e.acao === 'conciliar' && e.vinculo && (
                          <span>
                            {e.vinculo.descricao} ({moeda(e.vinculo.valor)})
                          </span>
                        )}
                        {(e.acao === 'arquivar' || e.acao === 'reativar' || e.acao === 'excluir') && (
                          <span>{e.motivo || 'Transição de estado'}</span>
                        )}
                      </td>
                      <td>
                        <small>{e.autorUid}</small>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Modais de Ações */}
      {modal?.tipo === 'criar' && (
        <ModalCriarCaixinha
          ocupado={ocupado}
          onCancelar={() => setModal(null)}
          onConfirmar={(nome, finalidade) => void aplicarAlteracao({
            tipo: 'caixinha-criar', nome, finalidade, motivo: 'Criação inicial da caixinha',
          })}
        />
      )}

      {modal?.tipo === 'visualizar' && (
        <ModalVisualizarCaixinha caixinha={modal.caixinha} onFechar={() => setModal(null)} />
      )}

      {(modal?.tipo === 'depositar' || modal?.tipo === 'retirar') && (
        <div className="overlay-modal" role="dialog" aria-modal="true" aria-labelledby="movimentar-caixinha">
          <form className="painel modal-conteudo pilha" onSubmit={evento => {
            evento.preventDefault();
            const campos = new FormData(evento.currentTarget);
            const valor = numero(String(campos.get('valor') ?? ''));
            try {
              const valorCentavos = reaisParaCentavos(valor);
              if (valorCentavos < 1) throw new Error('Informe um valor maior que zero.');
              const { caixinha } = modal;
              void aplicarAlteracao({
                data: dataLocal(), descricao: String(campos.get('descricao') ?? ''), valorCentavos,
                ...(modal.tipo === 'depositar'
                  ? { tipo: 'deposito-caixinha', caixinhaId: caixinha.id }
                  : { tipo: 'retirada', origem: caixinha.familia === 'diaria' ? caixinha.id : caixinha.idOriginal }),
              });
            } catch (erro) {
              setFeedback({ tipo: 'erro', texto: (erro as Error).message });
            }
          }}>
            <h3 id="movimentar-caixinha">{modal.tipo === 'depositar' ? 'Depositar' : 'Retirar'} · {modal.caixinha.nome}</h3>
            <p className="ajuda">{modal.tipo === 'depositar' ? 'O valor sairá do Saldo principal e entrará nesta caixinha.' : 'O valor será debitado desta caixinha.'}</p>
            <label className="campo"><span>Valor (R$)</span><input name="valor" inputMode="decimal" required /></label>
            <label className="campo"><span>Descrição</span><input name="descricao" maxLength={300} required /></label>
            {feedback?.tipo === 'erro' && <p role="alert" className="mensagem erro">{feedback.texto}</p>}
            <div className="acoes">
              <button type="button" className="botao secundario" onClick={() => setModal(null)}>Cancelar</button>
              <button type="submit" className="botao primario" disabled={bloquearEnvio || ocupado}>Confirmar</button>
            </div>
          </form>
        </div>
      )}

      {modal?.tipo === 'editar' && (
        <ModalEditarCaixinha
          caixinha={modal.caixinha}
          ocupado={ocupado}
          onCancelar={() => setModal(null)}
          onConfirmar={(nome, finalidade, motivo) => void aplicarAlteracao({
            tipo: 'caixinha-editar', caixinhaId: modal.caixinha.id, nome, finalidade, motivo,
          })}
        />
      )}

      {modal?.tipo === 'arquivar' && (
        <ModalArquivarCaixinha
          caixinha={modal.caixinha}
          ocupado={ocupado}
          onCancelar={() => setModal(null)}
          onConfirmar={motivo => void aplicarAlteracao({ tipo: 'caixinha-arquivar', caixinhaId: modal.caixinha.id, motivo })}
        />
      )}

      {modal?.tipo === 'reativar' && (
        <ModalReativarCaixinha
          caixinha={modal.caixinha}
          ocupado={ocupado}
          onCancelar={() => setModal(null)}
          onConfirmar={motivo => void aplicarAlteracao({ tipo: 'caixinha-reativar', caixinhaId: modal.caixinha.id, motivo })}
        />
      )}

      {modal?.tipo === 'excluir' && (
        <ModalExcluirCaixinha
          caixinha={modal.caixinha}
          ocupado={ocupado}
          onCancelar={() => setModal(null)}
          onConfirmar={motivo => void aplicarAlteracao({ tipo: 'caixinha-excluir', caixinhaId: modal.caixinha.id, motivo })}
        />
      )}

      {modal?.tipo === 'conciliar' && (
        <ModalConciliarVinculo
          pendencia={modal.pendencia}
          caixinhas={caixinhasAtivas.filter(c => c.editavel !== false && (modal.pendencia.fonte !== 'reserva-diaria' || c.familia === 'diaria'))}
          ocupado={ocupado}
          onCancelar={() => setModal(null)}
          onConfirmar={(caixinhaId, motivo) => void aplicarAlteracao({
            tipo: 'caixinha-conciliar', caixinhaId, referencia: modal.pendencia.referenciaVerificada, motivo,
          })}
        />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// SUBCOMPONENTES / MODAIS
// ---------------------------------------------------------------------------

function ModalCriarCaixinha({
  ocupado,
  onCancelar,
  onConfirmar,
}: {
  ocupado: boolean;
  onCancelar: () => void;
  onConfirmar: (nome: string, finalidade: string) => void;
}) {
  const [nome, setNome] = useState('');
  const [finalidade, setFinalidade] = useState('');
  const [erro, setErro] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nome.trim()) {
      setErro('Informe o nome da caixinha.');
      return;
    }
    onConfirmar(nome.trim(), finalidade.trim());
  };

  return (
    <div className="overlay-modal" role="dialog" aria-modal="true" aria-labelledby="modal-criar-titulo">
      <div className="modal-conteudo painel">
        <h3 id="modal-criar-titulo">Criar nova caixinha</h3>
        <p className="ajuda">
          Crie uma caixinha com identificador permanente exclusivo (ID permanente). Ela receberá reservas de turnos e
          movimentações de forma auditável e rastreável.
        </p>

        <form onSubmit={submit} className="pilha compacta">
          <label className="campo">
            <span>Nome da caixinha *</span>
            <input
              type="text"
              required
              placeholder="Ex.: Manutenção, Férias, IPVA…"
              value={nome}
              onChange={e => setNome(e.target.value)}
              maxLength={120}
              autoFocus
            />
          </label>

          <label className="campo">
            <span>Finalidade / Descrição do objetivo</span>
            <textarea
              placeholder="Ex.: Reserva para troca de pneus e revisões preventivas sem comprometer o lucro líquido diário."
              value={finalidade}
              onChange={e => setFinalidade(e.target.value)}
              maxLength={300}
              rows={3}
            />
          </label>

          {erro && (
            <p role="alert" className="mensagem erro">
              {erro}
            </p>
          )}

          <div className="acoes">
            <button type="button" className="botao secundario" onClick={onCancelar} disabled={ocupado}>
              Cancelar
            </button>
            <button type="submit" className="botao primario" disabled={ocupado}>
              {ocupado ? 'Criando…' : 'Criar caixinha'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ModalVisualizarCaixinha({
  caixinha,
  onFechar,
}: {
  caixinha: CaixinhaCompleta;
  onFechar: () => void;
}) {
  const [abaInterna, setAbaInterna] = useState<'movimentos' | 'auditoria'>('movimentos');

  return (
    <div className="overlay-modal" role="dialog" aria-modal="true" aria-labelledby="modal-detalhes-titulo">
      <div className="modal-conteudo painel modal-largo">
        <div className="titulo-linha">
          <div>
            <h3 id="modal-detalhes-titulo">{caixinha.nome}</h3>
            <p className="ajuda">
              ID permanente: <code>{caixinha.id}</code>
            </p>
          </div>
          <button type="button" className="botao secundario compacto" onClick={onFechar}>
            Fechar
          </button>
        </div>

        {/* Resumo Financeiro */}
        <div className="grade-metricas pequena">
          <div className="metrica">
            <span>Saldo verificado</span>
            <strong data-saldo={caixinha.saldo > 0 ? 'positivo' : caixinha.saldo < 0 ? 'negativo' : undefined}>
              {moeda(caixinha.saldo)}
            </strong>
          </div>
          <div className="metrica">
            <span>Total de entradas</span>
            <strong>{moeda(caixinha.totalCreditos)}</strong>
          </div>
          <div className="metrica">
            <span>Total de retiradas</span>
            <strong>{moeda(caixinha.totalDebitos)}</strong>
          </div>
          <div className="metrica">
            <span>Estado atual</span>
            <strong>{caixinha.estado === 'ativa' ? 'Ativa' : 'Desativada'}</strong>
          </div>
        </div>

        <div style={{ margin: '14px 0' }}>
          <p>
            <strong>Finalidade: </strong>
            {caixinha.finalidade || 'Não informada'}
          </p>
          {!caixinha.saldoAtestado && (
            <p className="mensagem aviso">
              ⚠️ {caixinha.motivoSaldoNaoAtestado || 'Saldo em revisão.'}
            </p>
          )}
        </div>

        {/* Abas Internas */}
        <div className="abas-caixinhas">
          <button
            type="button"
            className={`aba-item ${abaInterna === 'movimentos' ? 'ativa' : ''}`}
            onClick={() => setAbaInterna('movimentos')}
          >
            Movimentações vinculadas ({caixinha.movimentos.length})
          </button>
          <button
            type="button"
            className={`aba-item ${abaInterna === 'auditoria' ? 'ativa' : ''}`}
            onClick={() => setAbaInterna('auditoria')}
          >
            Trilha de alterações ({caixinha.auditoria.length})
          </button>
        </div>

        {abaInterna === 'movimentos' && (
          <div className="tabela-scroll" style={{ maxHeight: '320px' }}>
            {caixinha.movimentos.length === 0 ? (
              <p className="vazio">Nenhuma movimentação registrada nesta caixinha até o momento.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Tipo</th>
                    <th>Descrição</th>
                    <th style={{ textAlign: 'right' }}>Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {caixinha.movimentos.map(m => (
                    <tr key={m.id}>
                      <td>{m.data}</td>
                      <td>
                        <span className="selo">{m.tipo === 'conciliacao' ? 'Vínculo confirmado' : m.tipo}</span>
                      </td>
                      <td>{m.descricao}</td>
                      <td
                        style={{ textAlign: 'right', fontWeight: 600 }}
                        data-saldo={m.valor >= 0 ? 'positivo' : 'negativo'}
                      >
                        {m.valor >= 0 ? `+ ${moeda(m.valor)}` : `- ${moeda(Math.abs(m.valor))}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {abaInterna === 'auditoria' && (
          <div className="tabela-scroll" style={{ maxHeight: '320px' }}>
            {caixinha.auditoria.length === 0 ? (
              <p className="vazio">Nenhum evento de auditoria específico registrado.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Data / Hora</th>
                    <th>Ação</th>
                    <th>Motivo</th>
                    <th>Autor</th>
                  </tr>
                </thead>
                <tbody>
                  {caixinha.auditoria.map(a => (
                    <tr key={a.id}>
                      <td>{new Date(a.confirmadoEm).toLocaleString('pt-BR')}</td>
                      <td>
                        <span className={`badge-acao badge-acao-${a.acao}`}>{rotulosAuditoria[a.acao]}</span>
                      </td>
                      <td>{a.motivo || '—'}</td>
                      <td>
                        <small>{a.autorUid}</small>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        <div className="rodape-painel">
          <button type="button" className="botao secundario" onClick={onFechar}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}

function ModalEditarCaixinha({
  caixinha,
  ocupado,
  onCancelar,
  onConfirmar,
}: {
  caixinha: CaixinhaCompleta;
  ocupado: boolean;
  onCancelar: () => void;
  onConfirmar: (nome: string, finalidade: string, motivo: string) => void;
}) {
  const [nome, setNome] = useState(caixinha.nome);
  const [finalidade, setFinalidade] = useState(caixinha.finalidade);
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nome.trim()) {
      setErro('Informe o nome da caixinha.');
      return;
    }
    if (!motivo.trim()) {
      setErro('Informe o motivo da alteração para registro na auditoria.');
      return;
    }
    onConfirmar(nome.trim(), finalidade.trim(), motivo.trim());
  };

  return (
    <div className="overlay-modal" role="dialog" aria-modal="true" aria-labelledby="modal-editar-titulo">
      <div className="modal-conteudo painel">
        <h3 id="modal-editar-titulo">Editar caixinha</h3>
        <p className="ajuda">
          ID permanente: <code>{caixinha.id}</code>. Os lançamentos históricos preservam os nomes registrados na época.
        </p>

        <form onSubmit={submit} className="pilha compacta">
          <label className="campo">
            <span>Nome da caixinha *</span>
            <input
              type="text"
              required
              value={nome}
              onChange={e => setNome(e.target.value)}
              maxLength={120}
              autoFocus
            />
          </label>

          <label className="campo">
            <span>Finalidade / Descrição do objetivo</span>
            <textarea
              value={finalidade}
              onChange={e => setFinalidade(e.target.value)}
              maxLength={300}
              rows={3}
            />
          </label>

          <label className="campo">
            <span>Motivo da alteração (obrigatório para auditoria) *</span>
            <textarea
              required
              placeholder="Ex.: Correção ortográfica, mudança de finalidade da reserva…"
              value={motivo}
              onChange={e => setMotivo(e.target.value)}
              maxLength={300}
              rows={2}
            />
          </label>

          {erro && (
            <p role="alert" className="mensagem erro">
              {erro}
            </p>
          )}

          <div className="acoes">
            <button type="button" className="botao secundario" onClick={onCancelar} disabled={ocupado}>
              Cancelar
            </button>
            <button type="submit" className="botao primario" disabled={ocupado}>
              {ocupado ? 'Salvando…' : 'Salvar alterações'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ModalArquivarCaixinha({
  caixinha,
  ocupado,
  onCancelar,
  onConfirmar,
}: {
  caixinha: CaixinhaCompleta;
  ocupado: boolean;
  onCancelar: () => void;
  onConfirmar: (motivo: string) => void;
}) {
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState('');

  const bloqueio = !caixinha.podeArquivar;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!motivo.trim()) {
      setErro('Informe o motivo da desativação.');
      return;
    }
    onConfirmar(motivo.trim());
  };

  return (
    <div className="overlay-modal" role="dialog" aria-modal="true" aria-labelledby="modal-arquivar-titulo">
      <div className="modal-conteudo painel">
        <h3 id="modal-arquivar-titulo">Desativar caixinha: {caixinha.nome}</h3>
        <p className="ajuda">
          ID permanente: <code>{caixinha.id}</code> · Saldo atual: <strong>{moeda(caixinha.saldo)}</strong>
        </p>

        {bloqueio ? (
          <div className="pilha compacta">
            <div className="mensagem erro" role="alert">
              <strong>Desativação bloqueada</strong>
              <p style={{ marginTop: '6px' }}>{caixinha.motivoBloqueioArquivamento}</p>
            </div>
            <p className="ajuda">
              Para desativar uma caixinha, o saldo deve estar zerado e os vínculos pendentes precisam ser revisados. Se houver saldo positivo, registre uma retirada em &quot;Entrada ou saída
              avulsa&quot;.
            </p>
            <div className="acoes">
              <button type="button" className="botao secundario" onClick={onCancelar}>
                Voltar
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="pilha compacta">
            <p>
              Ao desativar, a caixinha deixará de receber novas reservas nos turnos, mas seu histórico de movimentações e
              auditoria permanecerá integralmente preservado. Ela poderá ser reativada a qualquer momento.
            </p>

            <label className="campo">
              <span>Motivo da desativação (obrigatório para auditoria) *</span>
              <textarea
                required
                placeholder="Ex.: Meta atingida, caixinha descontinuada com saldo zerado…"
                value={motivo}
                onChange={e => setMotivo(e.target.value)}
                maxLength={300}
                rows={3}
                autoFocus
              />
            </label>

            {erro && (
              <p role="alert" className="mensagem erro">
                {erro}
              </p>
            )}

            <div className="acoes">
              <button type="button" className="botao secundario" onClick={onCancelar} disabled={ocupado}>
                Cancelar
              </button>
              <button type="submit" className="botao primario" disabled={ocupado}>
                {ocupado ? 'Desativando…' : 'Desativar caixinha'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function ModalReativarCaixinha({
  caixinha,
  ocupado,
  onCancelar,
  onConfirmar,
}: {
  caixinha: CaixinhaCompleta;
  ocupado: boolean;
  onCancelar: () => void;
  onConfirmar: (motivo: string) => void;
}) {
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!motivo.trim()) {
      setErro('Informe o motivo da reativação para auditoria.');
      return;
    }
    onConfirmar(motivo.trim());
  };

  return (
    <div className="overlay-modal" role="dialog" aria-modal="true" aria-labelledby="modal-reativar-titulo">
      <div className="modal-conteudo painel">
        <h3 id="modal-reativar-titulo">Reativar caixinha: {caixinha.nome}</h3>
        <p className="ajuda">
          ID permanente: <code>{caixinha.id}</code>
        </p>

        <form onSubmit={submit} className="pilha compacta">
          <p>
            Ao reativar, a caixinha voltará à lista de caixinhas ativas e ficará disponível para receber reservas nos
            próximos turnos e movimentações avulsas.
          </p>

          <label className="campo">
            <span>Motivo da reativação (obrigatório para auditoria) *</span>
            <textarea
              required
              placeholder="Ex.: Retomada do planejamento para este objetivo…"
              value={motivo}
              onChange={e => setMotivo(e.target.value)}
              maxLength={300}
              rows={3}
              autoFocus
            />
          </label>

          {erro && (
            <p role="alert" className="mensagem erro">
              {erro}
            </p>
          )}

          <div className="acoes">
            <button type="button" className="botao secundario" onClick={onCancelar} disabled={ocupado}>
              Cancelar
            </button>
            <button type="submit" className="botao primario" disabled={ocupado}>
              {ocupado ? 'Reativando…' : 'Reativar caixinha'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ModalExcluirCaixinha({
  caixinha,
  ocupado,
  onCancelar,
  onConfirmar,
}: {
  caixinha: CaixinhaCompleta;
  ocupado: boolean;
  onCancelar: () => void;
  onConfirmar: (motivo: string) => void;
}) {
  const [motivo, setMotivo] = useState('');
  const bloqueio = !caixinha.podeExcluir;

  return (
    <div className="overlay-modal" role="dialog" aria-modal="true" aria-labelledby="modal-excluir-titulo">
      <div className="modal-conteudo painel">
        <h3 id="modal-excluir-titulo">Excluir caixinha: {caixinha.nome}</h3>
        <p className="ajuda">
          ID permanente: <code>{caixinha.id}</code>
        </p>

        {bloqueio ? (
          <div className="pilha compacta">
            <div className="mensagem erro" role="alert">
              <strong>Exclusão física bloqueada:</strong>
              <p style={{ marginTop: '6px' }}>{caixinha.motivoBloqueioExclusao}</p>
            </div>
            <p className="ajuda">
              Caixinhas com histórico de movimentações (turnos, rateios, retiradas) não podem ser excluídas para manter
              a rastreabilidade e integridade contábil. Use <strong>Desativar</strong> quando o saldo estiver
              zerado.
            </p>
            <div className="acoes">
              <button type="button" className="botao secundario" onClick={onCancelar}>
                Entendido, voltar
              </button>
            </div>
          </div>
        ) : (
          <form
            onSubmit={e => {
              e.preventDefault();
              onConfirmar(motivo.trim() || 'Exclusão de caixinha sem histórico');
            }}
            className="pilha compacta"
          >
            <div className="mensagem aviso">
              <p>
                <strong>Atenção: </strong>
                Esta caixinha foi criada recentemente e nunca teve movimentações registradas. Sua exclusão permanente é
                segura e não afetará nenhum lançamento financeiro.
              </p>
            </div>

            <label className="campo">
              <span>Motivo da exclusão (opcional)</span>
              <input
                type="text"
                placeholder="Ex.: Criada por engano"
                value={motivo}
                onChange={e => setMotivo(e.target.value)}
                maxLength={200}
              />
            </label>

            <div className="acoes">
              <button type="button" className="botao secundario" onClick={onCancelar} disabled={ocupado}>
                Cancelar
              </button>
              <button type="submit" className="botao perigo" disabled={ocupado}>
                {ocupado ? 'Excluindo…' : 'Excluir definitivamente'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function ModalConciliarVinculo({
  pendencia,
  caixinhas,
  ocupado,
  onCancelar,
  onConfirmar,
}: {
  pendencia: PendenciaRevisao;
  caixinhas: CaixinhaCompleta[];
  ocupado: boolean;
  onCancelar: () => void;
  onConfirmar: (caixinhaId: IdCaixinha, motivo: string) => void;
}) {
  const candidatoInicial = pendencia.candidatos[0]?.id || caixinhas[0]?.id || '';
  const [caixinhaEscolhida, setCaixinhaEscolhida] = useState<IdCaixinha>(candidatoInicial as IdCaixinha);
  const [motivo, setMotivo] = useState(
    pendencia.candidatos[0]
      ? `Vínculo confirmado com base no nome original "${pendencia.descricao}".`
      : '',
  );
  const [erro, setErro] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!caixinhaEscolhida) {
      setErro('Selecione a caixinha permanente para vincular.');
      return;
    }
    if (!motivo.trim()) {
      setErro('Informe por que esta movimentação pertence à caixinha escolhida.');
      return;
    }
    onConfirmar(caixinhaEscolhida, motivo.trim());
  };

  return (
    <div className="overlay-modal" role="dialog" aria-modal="true" aria-labelledby="modal-conciliar-titulo">
      <div className="modal-conteudo painel">
        <h3 id="modal-conciliar-titulo">Revisar vínculo</h3>
        <p className="ajuda">
          Associe este lançamento histórico à sua caixinha permanente correta. O registro original no histórico
          permanecerá inalterado.
        </p>

        {/* Detalhes da Evidência Original */}
        <div className="caixa-evidencia-original">
          <h4>Registro original analisado:</h4>
          <dl className="detalhes">
            <div>
              <dt>Fonte</dt>
              <dd>{pendencia.fonteDescricao}</dd>
            </div>
            <div>
              <dt>Motivo da pendência</dt>
              <dd>{pendencia.motivoDescricao}</dd>
            </div>
            {pendencia.data && (
              <div>
                <dt>Data</dt>
                <dd>{pendencia.data}</dd>
              </div>
            )}
            <div>
              <dt>Valor</dt>
              <dd>
                <strong>{moeda(pendencia.valor)}</strong>
              </dd>
            </div>
            <div>
              <dt>Descrição original</dt>
              <dd>{pendencia.descricao}</dd>
            </div>
            <div>
              <dt>Referência registrada</dt>
              <dd>
                <code>{pendencia.referenciaOriginal || 'Sem referência'}</code>
              </dd>
            </div>
          </dl>
        </div>

        <form onSubmit={submit} className="pilha compacta">
          <label className="campo">
            <span>Caixinha de destino permanente *</span>
            <select
              value={caixinhaEscolhida}
              onChange={e => setCaixinhaEscolhida(e.target.value as IdCaixinha)}
              required
            >
              {caixinhas.map(c => (
                <option key={c.id} value={c.id}>
                  {c.nome} ({c.id}) · Saldo: {moeda(c.saldo)}
                </option>
              ))}
            </select>
          </label>

          <label className="campo">
            <span>Justificativa / Motivo da decisão *</span>
            <textarea
              required
              placeholder="Ex.: Confirmado que esta retirada de alimentação refere-se à caixinha de Alimentação…"
              value={motivo}
              onChange={e => setMotivo(e.target.value)}
              maxLength={300}
              rows={3}
            />
          </label>

          {erro && (
            <p role="alert" className="mensagem erro">
              {erro}
            </p>
          )}

          <div className="acoes">
            <button type="button" className="botao secundario" onClick={onCancelar} disabled={ocupado}>
              Cancelar
            </button>
            <button type="submit" className="botao primario" disabled={ocupado}>
              {ocupado ? 'Confirmando…' : 'Confirmar vínculo'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
