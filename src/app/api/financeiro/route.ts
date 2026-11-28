import { consultarFinanceiroReal, gravarFinanceiroReal } from '@/lib/financeiroProducaoServidor';
import { ErroServico } from '@/lib/executorFinanceiroServidor';
import { createHash, randomUUID } from 'node:crypto';

export const runtime = 'nodejs';

const responder = (dados: unknown, status = 200) => Response.json(dados, {
  status, headers: { 'Cache-Control': 'no-store' },
});

function falha(erro: unknown) {
  if (erro instanceof ErroServico) return responder({ erro: erro.message, codigo: erro.codigo }, erro.status);
  const nome = erro instanceof Error ? erro.name : typeof erro;
  const message = erro instanceof Error ? erro.message : String(erro);
  const requestId = randomUUID();
  console.error('[api/financeiro] falha não classificada', {
    requestId,
    errorName: nome.slice(0, 80),
    errorHash: createHash('sha256').update(message).digest('hex'),
    stack: erro instanceof Error ? erro.stack?.split('\n').slice(0, 8).join('\n') : undefined,
  });
  return responder({ erro: 'Serviço financeiro indisponível.', requestId }, 503);
}

async function lerComando(req: Request) {
  if (req.headers.get('content-type')?.split(';')[0].trim() !== 'application/json' || !req.body) {
    throw new ErroServico(400, 'Envie um comando JSON.');
  }
  const leitor = req.body.getReader();
  const decoder = new TextDecoder();
  let tamanho = 0;
  let texto = '';
  try {
    for (;;) {
      const { value, done } = await leitor.read();
      if (done) break;
      tamanho += value.byteLength;
      if (tamanho > 32_768) {
        await leitor.cancel().catch(() => {});
        throw new ErroServico(413, 'Comando acima do limite.');
      }
      texto += decoder.decode(value, { stream: true });
    }
  } finally { leitor.releaseLock(); }
  try { return JSON.parse(texto + decoder.decode()) as unknown; }
  catch { throw new ErroServico(400, 'Comando JSON inválido.'); }
}

export async function GET(req: Request) {
  try {
    const params = new URL(req.url).searchParams;
    return responder(await consultarFinanceiroReal(req.headers.get('authorization') ?? undefined,
      params.get('titular'), params.get('destino') === '1'));
  } catch (erro) { return falha(erro); }
}

export async function POST(req: Request) {
  try {
    const comando = await lerComando(req);
    return responder(await gravarFinanceiroReal(req.headers.get('authorization') ?? undefined,
      req.headers.get('x-appcar-conta-fila'), new URL(req.url).searchParams.get('espaco') ?? '', comando));
  } catch (erro) { return falha(erro); }
}
