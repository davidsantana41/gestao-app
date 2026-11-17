// Preencher com informações reais do controlador antes de disponibilizar o app ao público.
export const privacidade = {
  responsavel: 'santatec',
  email: 'davidangelosantana@gmail.com',
  versao: '2026-11-16',
};

export function baixarJson(nome: string, dados: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(dados, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = nome;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
