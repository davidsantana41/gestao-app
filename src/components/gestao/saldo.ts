export function sinalSaldo(valor: number) {
  if (valor < 0) return 'negativo';
  if (valor > 0) return 'positivo';
  return 'neutro';
}
