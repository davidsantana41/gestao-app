import { getApps, initializeApp } from 'firebase/app';
import { collection, connectFirestoreEmulator, doc, getDocFromServer, getDocsFromServer, getFirestore, runTransaction, setDoc, type Timestamp } from 'firebase/firestore';
import { enderecoCiclo, executarCicloEmulador, projetoCiclo } from '@/lib/cicloCaixinhasEmulador';
import { dadosPadrao, criarTurno, dataLocal, lerDados } from '@/lib/gestao';
import { saldoVerificavelEmCentavos } from '@/lib/integridadeCaixinhas';
import { combustiveisDemonstracao, type EstadoDemonstracao, type PerfilDemonstracao, type VeiculoDemonstracao } from '@/lib/demonstracaoLocal';

export const runtime = 'nodejs';
const proprietario = 'ficticio-motorista-demo';
const parceiro = 'ficticio-parceiro-demo';
const zero = '00000000-0000-4000-8000-000000000041';
const positivo = '00000000-0000-4000-8000-000000000042';

function banco(papel: 'admin' | 'ciclo' | 'parceiro') {
  const nome = `appcar-demonstracao-${papel}`;
  const existente = getApps().find(app => app.name === nome);
  if (existente) return getFirestore(existente);
  const db = getFirestore(initializeApp({ projectId: projetoCiclo }, nome));
  connectFirestoreEmulator(db, '127.0.0.1', 8089, {
    mockUserToken: papel === 'admin' ? 'owner' : {
      sub: papel === 'parceiro' ? parceiro : proprietario,
      firebase: { sign_in_provider: 'password' }, cicloWorker: papel === 'ciclo',
    },
  });
  return db;
}

async function inicializar() {
  const db = banco('admin');
  const ref = doc(db, 'users', proprietario, 'demoPerfil', 'main');
  await runTransaction(db, async tx => {
    if ((await tx.get(ref)).exists()) return;
    const reservasDiarias = [{ id: zero, nome: 'Revisão', valor: 0 }, { id: positivo, nome: 'Combustível', valor: 0 }];
    const turno = criarTurno({ data: '2026-11-24', faturamento: '280', combustivel: '45', litros: '9',
      kmTrabalhado: '118', kmTotal: '134', reserva1: '0', reserva2: '0',
      reservas: [{ id: positivo, nome: 'Abastecimento na época', valor: '80' }, { id: '', nome: 'Reserva sem identificação', valor: '12' }],
    }, [], 'turno-ficticio');
    tx.set(ref, { perfil: { email: 'motorista@appcar.test' } });
    tx.set(doc(db, 'users', proprietario, 'appData', 'main'), {
      ...dadosPadrao(), custosFixos: [], reservasDiarias, historico: [turno], _sync: { generation: 0, revision: 1 },
    });
    tx.set(doc(db, 'users', proprietario, 'caixinhasControle', 'piloto'), { ativo: true });
    tx.set(doc(db, 'shareInvites', proprietario), { ownerUid: proprietario, partnerUid: parceiro, status: 'active' });
    for (const reserva of reservasDiarias) {
      const id = `diaria:${reserva.id}`;
      tx.set(doc(db, 'users', proprietario, 'caixinhasCatalogo', id), {
        id, proprietarioUid: proprietario, nome: reserva.nome, finalidade: '', estado: 'ativa', versao: 1,
        criadoEm: new Date(), atualizadoEm: new Date(), operacaoId: reserva.id,
      });
    }
  });
}

function permitido(req: Request) {
  const porta = process.env.APPCAR_DEMO_PORTA ?? '3212';
  const host = req.headers.get('host');
  return process.env.APPCAR_DEMO_LOCAL === '1'
    && process.env.FIRESTORE_EMULATOR_HOST === enderecoCiclo
    && process.env.FIREBASE_EMULATOR_HUB === '127.0.0.1:4413'
    && (host === `127.0.0.1:${porta}` || host === `localhost:${porta}`)
    && (req.method !== 'POST' || req.headers.get('origin') === `http://${host}`);
}

type Cadastro = { perfil: PerfilDemonstracao; veiculo?: Omit<VeiculoDemonstracao, 'id'>; veiculos?: VeiculoDemonstracao[] };
function veiculosDoCadastro(cadastro: Partial<Cadastro>) {
  return cadastro.veiculos ?? (cadastro.veiculo ? [{ ...cadastro.veiculo, id: 'principal' }] : []);
}

function responder(dados: unknown, status = 200) {
  return Response.json(dados, { status, headers: { 'Cache-Control': 'no-store' } });
}

async function estado(): Promise<EstadoDemonstracao> {
  const db = banco('ciclo');
  const [perfil, financeiroBruto, catalogo, trilha] = await Promise.all([
    getDocFromServer(doc(banco('admin'), 'users', proprietario, 'demoPerfil', 'main')),
    getDocFromServer(doc(db, 'users', proprietario, 'appData', 'main')),
    getDocsFromServer(collection(db, 'users', proprietario, 'caixinhasCatalogo')),
    getDocsFromServer(collection(db, 'users', proprietario, 'caixinhasAuditoria')),
  ]);
  const financeiro = lerDados(financeiroBruto.data());
  const cadastro = perfil.data() as Cadastro;
  return {
    perfil: cadastro.perfil, veiculos: veiculosDoCadastro(cadastro), financeiro,
    caixinhas: catalogo.docs.map(item => {
      const { id, nome, finalidade, estado, versao } = item.data() as EstadoDemonstracao['caixinhas'][number];
      let saldo: number | null = null;
      try { saldo = saldoVerificavelEmCentavos(financeiro, id) / 100; } catch { /* Conciliação pendente. */ }
      return { id, nome, finalidade, estado, versao, saldo };
    }),
    eventos: trilha.docs.map(item => {
      const evento = item.data() as Omit<EstadoDemonstracao['eventos'][number], 'confirmadoEm'> & { confirmadoEm: Timestamp };
      return { ...evento, confirmadoEm: evento.confirmadoEm.toDate().toISOString() };
    }).sort((a, b) => b.confirmadoEm.localeCompare(a.confirmadoEm) || a.id.localeCompare(b.id)),
  };
}

export async function GET(req: Request) {
  if (!permitido(req)) return responder({ erro: 'Demonstração indisponível.' }, 404);
  try {
    await inicializar();
    if (new URL(req.url).searchParams.has('compartilhado')) {
      const db = banco('parceiro');
      const snapshot = await getDocFromServer(doc(db, 'users', proprietario, 'appData', 'main'));
      return responder(lerDados(snapshot.data()));
    }
    return responder(await estado());
  } catch {
    return responder({ erro: 'Não foi possível consultar o emulador local.' }, 503);
  }
}

function campo(valor: unknown, limite: number) {
  if (typeof valor !== 'string' || valor.length > limite) throw new Error('Campo inválido.');
  return valor.trim();
}

export async function POST(req: Request) {
  if (!permitido(req)) return responder({ erro: 'Demonstração indisponível.' }, 404);
  try {
    const corpo = await req.text();
    if (corpo.length > 4096) return responder({ erro: 'Solicitação extensa.' }, 413);
    const valor = JSON.parse(corpo);
    await inicializar();
    const cadastro = doc(banco('admin'), 'users', proprietario, 'demoPerfil', 'main');
    if (valor.tipo === 'perfil') {
      const nome = campo(valor.nome, 120);
      const nascimento = campo(valor.nascimento, 10);
      const email = campo(valor.email, 120).toLowerCase();
      const celular = campo(valor.celular, 24).replace(/[ ()+-]/g, '');
      const data = new Date(nascimento + 'T00:00:00Z');
      if (nome.length < 2 || !/^\d{4}-\d{2}-\d{2}$/.test(nascimento) || !Number.isFinite(+data)
          || data.toISOString().slice(0, 10) !== nascimento || nascimento > dataLocal() || nascimento < '1900-01-01'
          || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@appcar\.test$/.test(email) || !/^\d{10,13}$/.test(celular)) {
        throw new Error('Confira nome, nascimento, e-mail fictício @appcar.test e celular.');
      }
      await setDoc(cadastro, { perfil: { nome, nascimento, email, celular } }, { merge: true });
    } else if (valor.tipo === 'veiculo') {
      const placa = campo(valor.placa, 8).toUpperCase().replace('-', '');
      const marca = campo(valor.marca, 50), modelo = campo(valor.modelo, 70), versao = campo(valor.versao, 70);
      const cor = campo(valor.cor, 40), combustivel = campo(valor.combustivel, 20);
      const { anoFabricacao, anoModelo, km } = valor;
      const anoMaximo = Number(dataLocal().slice(0, 4)) + 1;
      if (![marca, modelo, versao, cor].every(Boolean) || !combustiveisDemonstracao.some(item => item === combustivel)
          || ![anoFabricacao, anoModelo].every(ano => Number.isSafeInteger(ano) && ano >= 1900 && ano <= anoMaximo)
          || anoModelo < anoFabricacao || anoModelo > anoFabricacao + 1
          || !/^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(placa) || !Number.isSafeInteger(km) || km < 0 || km > 9_999_999) {
        throw new Error('Confira os dados do veículo. O ano do modelo pode ser igual ao de fabricação ou um ano posterior.');
      }
      const veiculo = { id: 'principal', placa, km, marca, modelo, versao, cor, combustivel, anoFabricacao, anoModelo };
      await runTransaction(cadastro.firestore, async tx => {
        const atuais = veiculosDoCadastro((await tx.get(cadastro)).data() as Cadastro);
        tx.update(cadastro, { veiculos: atuais.some(item => item.id === veiculo.id)
          ? atuais.map(item => item.id === veiculo.id ? veiculo : item) : [...atuais, veiculo] });
      });
    } else if (valor.tipo === 'ciclo') {
      await executarCicloEmulador(banco('ciclo'), proprietario, valor.comando);
    } else throw new Error('Operação indisponível.');
    return responder(await estado());
  } catch (erro) {
    return responder({ erro: erro instanceof Error ? erro.message : 'Operação não confirmada.' }, 422);
  }
}
