export type EstadoGravacaoFinanceira = {
  gravavel: boolean;
  somenteLeitura: boolean;
  ocupado: boolean;
  aguardandoLeitura: boolean;
  conectada: boolean;
  servicoDisponivel: boolean | null;
  filaLegadaVerificada: boolean;
  filaLegadaBloqueia: boolean;
};

export function decidirEstadoGravacao(estado: EstadoGravacaoFinanceira): {
  podeSalvar: boolean;
  motivo?: string;
} {
  if (estado.somenteLeitura) return { podeSalvar: false, motivo: 'Este espaço está em modo somente visualização.' };
  if (!estado.gravavel) return { podeSalvar: false, motivo: 'A gravação está suspensa pelo serviço financeiro.' };
  if (!estado.conectada) return { podeSalvar: false, motivo: 'Sem conexão. Seus campos foram preservados; reconecte-se para salvar.' };
  if (estado.servicoDisponivel === false) return { podeSalvar: false, motivo: 'Serviço financeiro indisponível. Tentando reconectar…' };
  if (estado.servicoDisponivel === null) return { podeSalvar: false, motivo: 'Conferindo conexão com o serviço financeiro…' };
  if (estado.ocupado) return { podeSalvar: false, motivo: 'Aguarde a confirmação da operação em andamento.' };
  if (estado.aguardandoLeitura) return { podeSalvar: false, motivo: 'Aguarde a sincronização da última confirmação.' };
  if (!estado.filaLegadaVerificada) return { podeSalvar: false, motivo: 'Verificando operações antigas deste dispositivo.' };
  if (estado.filaLegadaBloqueia) return { podeSalvar: false, motivo: 'Recupere ou confira as operações antigas deste dispositivo antes de iniciar outra.' };
  return { podeSalvar: true };
}
