const limiteSeguro = BigInt(Number.MAX_SAFE_INTEGER);

export function somarCentavos(valores: Iterable<number>): number {
  let total = BigInt(0);
  for (const valor of valores) {
    if (!Number.isSafeInteger(valor)) throw new Error('Valor em centavos inválido.');
    total += BigInt(valor);
  }
  if (total < -limiteSeguro || total > limiteSeguro) throw new Error('Total em centavos fora do limite seguro.');
  return Number(total);
}

/** Mantém a precisão dos rateios legados e arredonda apenas o total, em centavos. */
export function somarHistoricoEmCentavos(valores: Iterable<number>): number {
  let total = BigInt(0);
  let escala = 0;
  for (const valor of valores) {
    const partes = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(String(valor));
    if (!partes || !Number.isSafeInteger(Math.round(valor * 100))) throw new Error('Valor histórico inválido.');
    const [, sinal, inteiro, decimal = '', notacao = '0'] = partes;
    const expoente = Number(notacao) - decimal.length + 2;
    if (Math.abs(expoente) > 308) throw new Error('Precisão histórica fora do limite seguro.');
    if (expoente < escala) {
      total *= BigInt(10) ** BigInt(escala - expoente);
      escala = expoente;
    }
    total += BigInt(sinal + inteiro + decimal) * BigInt(10) ** BigInt(expoente - escala);
  }
  const divisor = BigInt(10) ** BigInt(-escala);
  const absoluto = total < BigInt(0) ? -total : total;
  const arredondado = (absoluto + divisor / BigInt(2)) / divisor;
  if (arredondado > limiteSeguro) throw new Error('Total histórico fora do limite seguro.');
  return Number(total < BigInt(0) ? -arredondado : arredondado);
}

/** Aceita apenas valores cujo decimal armazenado já representa centavos exatos. */
export function reaisParaCentavos(valor: unknown): number {
  const decimal = typeof valor === 'number' ? /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(String(valor)) : null;
  if (!decimal) {
    throw new Error('Valor monetário inválido ou fracionário. Conciliação necessária.');
  }
  const [, sinal, inteira, fracao = ''] = decimal;
  const centavos = Number(sinal + inteira + fracao.padEnd(2, '0'));
  if (!Number.isSafeInteger(centavos) || centavos / 100 !== valor
      || (centavos - 1) / 100 === valor || (centavos + 1) / 100 === valor) {
    throw new Error('Valor monetário fora do limite seguro. Conciliação necessária.');
  }
  return centavos || 0;
}

export function centavosParaReais(centavos: number): number {
  const reais = centavos / 100;
  if (!Number.isSafeInteger(centavos) || reaisParaCentavos(reais) !== centavos) {
    throw new Error('Total em reais fora do limite seguro.');
  }
  return reais;
}

/** Para numerador e denominador inteiros, arredonda empates para longe de zero. */
export function arredondarRazaoEmCentavos(numerador: number, denominador: number): number {
  if (!Number.isSafeInteger(numerador) || !Number.isSafeInteger(denominador) || denominador <= 0) {
    throw new Error('Razão monetária inválida.');
  }
  const absoluto = BigInt(Math.abs(numerador));
  const divisor = BigInt(denominador);
  const parte = Number(absoluto / divisor + BigInt((absoluto % divisor) * BigInt(2) >= divisor));
  return numerador < 0 && parte > 0 ? -parte : parte;
}

export function distribuirCentavos(total: number, parcelas: number): number[] {
  if (!Number.isSafeInteger(total) || total < 0 || !Number.isSafeInteger(parcelas) || parcelas < 1 || parcelas > 31) {
    throw new Error('Rateio em centavos inválido.');
  }
  const resto = total % parcelas;
  const parte = (total - resto) / parcelas;
  return Array.from({ length: parcelas }, (_, indice) => parte + Number(indice < resto));
}
