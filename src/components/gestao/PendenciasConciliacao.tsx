import { revisarPendenciasCaixinhas } from '@/lib/catalogoCaixinhas';
import { moeda, type DadosPersistidos } from '@/lib/gestao';

const motivos = {
  'sem-id': 'Registro sem identificador',
  'id-duplicado': 'Identificador duplicado',
  'origem-por-nome': 'Referência legada por nome',
  'origem-sem-vinculo': 'Origem sem vínculo comprovável',
  'origem-em-conflito': 'Referência em conflito',
};

const fontes = {
  configuracao: 'Configuração',
  rateio: 'Rateio de custo fixo',
  'reserva-fixa': 'Reserva fixa',
  'reserva-diaria': 'Reserva diária',
  retirada: 'Retirada',
};

export default function PendenciasConciliacao({ dados }: { dados: DadosPersistidos }) {
  const pendencias = revisarPendenciasCaixinhas(dados);
  return (
    <section className="painel" aria-labelledby="pendencias-conciliacao-titulo">
      <h2 id="pendencias-conciliacao-titulo">Pendências de conciliação</h2>
      {pendencias.length === 0 ? <p className="ajuda">Nenhuma pendência identificada.</p> : <>
        <p className="ajuda">Consulta de todo o histórico. As possíveis relações servem apenas para revisão e não alteram os saldos.</p>
        <ul className="pilha compacta lista-conciliacao">
          {pendencias.map(({ motivo, evidencia, referenciaOriginal, candidatos }, indice) => (
            <li key={JSON.stringify([motivo, referenciaOriginal, evidencia, indice])}>
              <details className="custo-item">
                <summary>
                  <strong>{fontes[evidencia.fonte]}</strong>
                  {' · '}{motivos[motivo]}
                  {'data' in evidencia && evidencia.data && <> · {evidencia.data}</>}
                  {evidencia.valor !== undefined && <> · {moeda(evidencia.valor)}</>}
                </summary>
                <dl className="detalhes-conciliacao">
                  {'nome' in evidencia && evidencia.nome && <><dt>Descrição original</dt><dd>{evidencia.nome}</dd></>}
                  <dt>Referência original</dt><dd>{referenciaOriginal?.trim() ? referenciaOriginal : 'Indisponível'}</dd>
                  {'lancamentoId' in evidencia && evidencia.lancamentoId && <><dt>ID do lançamento</dt><dd>{evidencia.lancamentoId}</dd></>}
                  {evidencia.fonte === 'retirada' && evidencia.retiradaId && <><dt>ID da retirada</dt><dd>{evidencia.retiradaId}</dd></>}
                  <dt>Situação</dt><dd>Pendente de revisão</dd>
                </dl>
                <h3>Possíveis caixinhas relacionadas</h3>
                {candidatos.length === 0 ? <p>Nenhuma candidata identificada.</p> : (
                  <ul className="candidatas-conciliacao">
                    {candidatos.map(({ caixinha, criterio }) => (
                      <li key={caixinha.id}>
                        <strong>{caixinha.nomeConfigurado || [...new Set(caixinha.evidencias.flatMap(e =>
                          e.fonte === 'reserva-diaria' && e.nome ? [e.nome] : [],
                        ))].join(' / ') || 'Caixinha do histórico'}</strong>
                        {' · '}{caixinha.id}{' · '}{criterio === 'nome' ? 'Mesmo nome encontrado' : 'Referência em comum'}
                      </li>
                    ))}
                  </ul>
                )}
              </details>
            </li>
          ))}
        </ul>
      </>}
    </section>
  );
}
