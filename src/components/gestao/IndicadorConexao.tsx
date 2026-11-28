'use client';

export type EstadoConexao = 'conectado' | 'sincronizando' | 'offline' | 'indisponivel';

export default function IndicadorConexao({ estado }: { estado: EstadoConexao }) {
  const rotulos: Record<EstadoConexao, string> = {
    conectado: 'Conectado', sincronizando: 'Sincronizando', offline: 'Sem conexão', indisponivel: 'Serviço indisponível',
  };
  return <span className={`indicador-conexao indicador-${estado}`} role="status" aria-live="polite" title={rotulos[estado]}>
    <span className="indicador-conexao-ponto" aria-hidden="true" />{rotulos[estado]}
  </span>;
}
