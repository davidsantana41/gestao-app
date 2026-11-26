export type ModoGravacaoFinanceira = 'direto' | 'fila' | 'bloqueado';

export type EstadoGravacaoFinanceira = {
  gravavel: boolean;
  somenteLeitura: boolean;
  ocupado: boolean;
  aguardandoLeitura: boolean;
  temPendenciasFila: boolean;
  producao: boolean;
  conectada: boolean;
  filaLocalVerificada: boolean;
  quantidadeFilasLocais: number;
  filaEstaAberta: boolean;
  filaAtualAberta: boolean;
};

export function decidirEstadoGravacao(estado: EstadoGravacaoFinanceira): {
  modo: ModoGravacaoFinanceira;
  podeSalvar: boolean;
  motivo?: string;
} {
  if (!estado.gravavel) return {
    modo: 'bloqueado', podeSalvar: false,
    motivo: estado.somenteLeitura ? 'Este espaço está em modo somente visualização.' : 'A gravação está suspensa pelo serviço financeiro.',
  };
  if (estado.ocupado) return { modo: 'bloqueado', podeSalvar: false, motivo: 'Uma operação está sendo processada.' };
  if (estado.aguardandoLeitura) return { modo: 'bloqueado', podeSalvar: false, motivo: 'Aguarde a confirmação da última revisão financeira.' };
  if (estado.temPendenciasFila) return {
    modo: 'bloqueado', podeSalvar: false,
    motivo: 'Existe uma operação local aguardando confirmação. Retome o envio antes de iniciar outra.',
  };
  if (estado.filaAtualAberta) return { modo: 'fila', podeSalvar: true };
  if (estado.filaEstaAberta) return {
    modo: 'bloqueado', podeSalvar: false,
    motivo: 'A fila aberta pertence a uma geração anterior. Bloqueie essa fila e confira as cópias locais antes de continuar.',
  };
  if (!estado.filaLocalVerificada) return {
    modo: 'bloqueado', podeSalvar: false, motivo: 'Aguarde a verificação da fila financeira neste dispositivo.',
  };
  if (estado.producao && !estado.somenteLeitura && estado.conectada && !estado.filaEstaAberta && estado.quantidadeFilasLocais === 0) {
    return { modo: 'direto', podeSalvar: true };
  }
  if (estado.producao && !estado.conectada) return {
    modo: 'bloqueado', podeSalvar: false, motivo: 'Sem conexão. Conecte-se ou desbloqueie a fila local para trabalhar offline.',
  };
  if (estado.quantidadeFilasLocais > 0) return {
    modo: 'bloqueado', podeSalvar: false,
    motivo: 'Há uma fila local protegida neste dispositivo. Desbloqueie-a para conferir as operações pendentes antes de continuar.',
  };
  return { modo: 'bloqueado', podeSalvar: false, motivo: 'Desbloqueie a fila financeira local para continuar neste modo.' };
}
