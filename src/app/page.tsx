'use client';

import { useState, useMemo, useEffect } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import AuthGate from '@/components/AuthGate';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';

// Aceita valores brasileiros com vírgula decimal (ex.: 100,87 e 28,5).
const lerNumero = (texto: string): number => {
  const limpo = texto.trim().replace(/\s/g, '');
  if (!limpo) return 0;
  const normalizado = limpo.includes(',') ? limpo.replace(/\./g, '').replace(',', '.') : limpo;
  const numero = Number(normalizado);
  return Number.isFinite(numero) && numero >= 0 ? numero : 0;
};

interface SaidaItem {
  id: string;
  nome: string;
  valor: number;
  origem: string; // 'principal', id da caixinha, 'reserva1', 'reserva2' ou 'reserva3'
}

interface CustoFixoItem {
  id: string;
  nome: string;
  valorMensal: number;
  cor?: string;
}

interface DadosPersistidos {
  custosFixos: CustoFixoItem[];
  nomeReserva1: string;
  nomeReserva2: string;
  nomeReserva3: string;
  lembrete: string;
  historico: Lancamento[];
  modoEscuro: boolean;
}

interface Lancamento {
  id: string;
  data: string; // Formato DD/MM/AAAA
  diaSemana: string;
  tipo: 'turno' | 'avulso_saida' | 'avulso_entrada';
  faturamentoBruto: number;
  combustivel: number;
  litros: number;
  kmTrabalhado: number;
  kmTotal: number;
  reservaFevereiro: number;
  reservaInvestimento: number;
  reservaAcidente: number;
  custosFixosDia: number; 
  detalheCustosFixosDia?: { [id: string]: number };
  saidas: SaidaItem[];
  totalDespesas: number;
  liquido: number;
}

function Dashboard({ uid, usuarioEmail }: { uid: string; usuarioEmail: string | null }) {
  const [abaAtiva, setAbaAtiva] = useState<'lancamento' | 'relatorios'>('lancamento');
  const [modoEscuro, setModoEscuro] = useState<boolean>(true);

  // Custos Fixos Mensais Dinâmicos com suporte a cores
  const [custosFixos, setCustosFixos] = useState<CustoFixoItem[]>([
    { id: '1', nome: 'Prestação do Carro', valorMensal: 2876.40, cor: '#3b82f6' },
    { id: '2', nome: 'IPVA', valorMensal: 111.00, cor: '#10b981' },
    { id: '3', nome: 'Seguro', valorMensal: 236.85, cor: '#8b5cf6' },
    { id: '4', nome: 'Troca de Óleo', valorMensal: 300.00, cor: '#f59e0b' },
    { id: '5', nome: 'violão', valorMensal: 200.00, cor: '#ec4899' }
  ]);

  // Estados para os lançamentos do dia (Turno)
  const [faturamentoBruto, setFaturamentoBruto] = useState<number>(0);
  const [texto_faturamentoBruto, setTexto_faturamentoBruto] = useState('');
  const [litros, setLitros] = useState<number>(0);
  const [texto_litros, setTexto_litros] = useState('');
  const [valorCombustivel, setValorCombustivel] = useState<number>(0);
  const [texto_valorCombustivel, setTexto_valorCombustivel] = useState('');
  const [kmTrabalhado, setKmTrabalhado] = useState<number>(0);
  const [texto_kmTrabalhado, setTexto_kmTrabalhado] = useState('');
  const [kmTotal, setKmTotal] = useState<number>(0);
  const [texto_kmTotal, setTexto_kmTotal] = useState('');

  // Nomes e valores das reservas
  const [nomeReserva1, setNomeReserva1] = useState<string>('Reserva Para Fevereiro');
  const [nomeReserva2, setNomeReserva2] = useState<string>('Reserva Para Investimento');
  const [nomeReserva3, setNomeReserva3] = useState<string>('Reserva de Acidente');

  const [valReserva1, setValReserva1] = useState<number>(0);
  const [valReserva2, setValReserva2] = useState<number>(0);

  const valReservaAcidente = useMemo(() => {
    return (Number(kmTotal) || 0) * 0.038;
  }, [kmTotal]);

  const [lembrete, setLembrete] = useState<string>('');

  // Estados para Lançamentos Avulsos Rápidos (Fora do Turno)
  const [tipoAvulso, setTipoAvulso] = useState<'saida' | 'entrada'>('saida');
  const [nomeAvulso, setNomeAvulso] = useState<string>('');
  const [valorAvulso, setValorAvulso] = useState<number>(0);
  const [origemAvulsa, setOrigemAvulsa] = useState<string>('principal');

  const [historico, setHistorico] = useState<Lancamento[]>([]);
  const [idEditando, setIdEditando] = useState<string | null>(null);
  const [dadosCarregados, setDadosCarregados] = useState(false);
  const [firebasePronto, setFirebasePronto] = useState(false);
  const [statusPersistencia, setStatusPersistencia] = useState('Conectando ao armazenamento...');

  const STORAGE_KEY = uid ? `gestao-app-dados-v2-${uid}` : '';

  const aplicarDados = (dados: Partial<DadosPersistidos>) => {
    if (Array.isArray(dados.custosFixos)) setCustosFixos(dados.custosFixos);
    if (typeof dados.nomeReserva1 === 'string') setNomeReserva1(dados.nomeReserva1);
    if (typeof dados.nomeReserva2 === 'string') setNomeReserva2(dados.nomeReserva2);
    if (typeof dados.nomeReserva3 === 'string') setNomeReserva3(dados.nomeReserva3);
    if (typeof dados.lembrete === 'string') setLembrete(dados.lembrete);
    if (Array.isArray(dados.historico)) setHistorico(dados.historico);
    if (typeof dados.modoEscuro === 'boolean') setModoEscuro(dados.modoEscuro);
  };

  const capturarDados = (): DadosPersistidos => ({
    custosFixos,
    nomeReserva1,
    nomeReserva2,
    nomeReserva3,
    lembrete,
    historico,
    modoEscuro,
  });

  // Recupera a cópia da nuvem; na primeira utilização, migra os dados locais para o Firestore.
  useEffect(() => {
    if (!uid) return;
    let ativo = true;

    const carregar = async () => {
      try {
        const referencia = doc(db, 'users', uid, 'appData', 'main');
        const snapshot = await getDoc(referencia);

        if (snapshot.exists()) {
          if (ativo) aplicarDados(snapshot.data() as Partial<DadosPersistidos>);
        } else {
          let dadosIniciais: DadosPersistidos = capturarDados();
          try {
            const locais = localStorage.getItem(STORAGE_KEY);
            if (locais) {
              const parseados = JSON.parse(locais) as Partial<DadosPersistidos>;
              dadosIniciais = { ...dadosIniciais, ...parseados };
              if (ativo) aplicarDados(parseados);
            }
          } catch (erro) {
            console.warn('Não foi possível recuperar os dados locais antigos:', erro);
          }
          await setDoc(referencia, dadosIniciais);
        }

        if (ativo) {
          setFirebasePronto(true);
          setDadosCarregados(true);
          setStatusPersistencia('Dados sincronizados com a nuvem.');
        }
      } catch (erro) {
        console.error('Falha ao carregar dados do Firestore:', erro);
        if (ativo) {
          try {
            const locais = localStorage.getItem(STORAGE_KEY);
            if (locais) aplicarDados(JSON.parse(locais) as Partial<DadosPersistidos>);
          } catch (erroLocal) {
            console.warn('Não foi possível recuperar o backup local:', erroLocal);
          }
          setFirebasePronto(false);
          setDadosCarregados(true);
          setStatusPersistencia('Salvamento local ativo; verifique a configuração do Firebase para sincronizar.');
        }
      }
    };

    carregar();
    return () => { ativo = false; };
  }, [uid]);

  // Mantém um backup no navegador e sincroniza alterações com o Firestore.
  useEffect(() => {
    if (!dadosCarregados || !uid) return;

    const dados = capturarDados();
    try {
      if (STORAGE_KEY) localStorage.setItem(STORAGE_KEY, JSON.stringify(dados));
    } catch (erro) {
      console.error('Não foi possível salvar os dados neste navegador:', erro);
    }

    if (!firebasePronto || !uid) return;

    setStatusPersistencia('Salvando alterações...');
    const temporizador = window.setTimeout(async () => {
      try {
        await setDoc(doc(db, 'users', uid, 'appData', 'main'), dados);
        setStatusPersistencia('Dados sincronizados com a nuvem.');
      } catch (erro) {
        console.error('Falha ao sincronizar dados com o Firestore:', erro);
        setStatusPersistencia('Backup local salvo; falha na sincronização com a nuvem.');
      }
    }, 700);

    return () => window.clearTimeout(temporizador);
  }, [custosFixos, nomeReserva1, nomeReserva2, nomeReserva3, lembrete, historico, modoEscuro, dadosCarregados, firebasePronto, uid]);

  const infoDataAtual = useMemo(() => {
    const hoje = new Date();
    return {
      dataCompleta: hoje.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' }),
      diaSemanaTexto: hoje.toLocaleDateString('pt-BR', { weekday: 'long' }),
      mesAno: hoje.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
    };
  }, []);

  const { diasUteisMes, custoFixoDiarioPorItem, totalCustoFixoDiario } = useMemo(() => {
    const hoje = new Date();
    const ano = hoje.getFullYear();
    const mes = hoje.getMonth();
    const ultimoDia = new Date(ano, mes + 1, 0).getDate();
    
    let totalDiasUteisMes = 0;
    for (let dia = 1; dia <= ultimoDia; dia++) {
      const dataAtual = new Date(ano, mes, dia);
      if (dataAtual.getDay() !== 0) {
        totalDiasUteisMes++;
      }
    }

    // O custo mensal é distribuído pelos dias de trabalho previstos no mês inteiro.
    // Não subtraímos dias já registrados: isso faria o custo por dia aumentar ao longo do mês.
    const diasRestantes = Math.max(totalDiasUteisMes, 1);

    let somaDiaria = 0;
    const porItem: { [id: string]: number } = {};

    custosFixos.forEach(c => {
      const valorDiario = (c.valorMensal || 0) / diasRestantes;
      porItem[c.id] = valorDiario;
      somaDiaria += valorDiario;
    });

    return {
      diasUteisMes: diasRestantes,
      custoFixoDiarioPorItem: porItem,
      totalCustoFixoDiario: somaDiaria
    };
  }, [custosFixos, historico]);

  const handleAdicionarCustoFixo = () => {
    setCustosFixos([...custosFixos, { id: Date.now().toString(), nome: '', valorMensal: 0, cor: '#64748b' }]);
  };

  const handleRemoverCustoFixo = (id: string) => {
    setCustosFixos(custosFixos.filter(c => c.id !== id));
  };

  const handleAtualizarCustoFixo = (id: string, campo: 'nome' | 'valorMensal' | 'cor', valor: string | number) => {
    setCustosFixos(custosFixos.map(c => c.id === id ? { ...c, [campo]: valor } : c));
  };

  const totalReservasTurno = valReservaAcidente;

  // O painel usa os valores visíveis digitados, inclusive quando há vírgula decimal.
  const litrosCalculados = lerNumero(texto_litros);
  const gastoCalculado = lerNumero(texto_valorCombustivel);
  const kmCalculados = lerNumero(texto_kmTrabalhado);
  const precoLitroMedio = litrosCalculados > 0 ? gastoCalculado / litrosCalculados : 0;
  const consumoKmL = litrosCalculados > 0 ? kmCalculados / litrosCalculados : 0;
  
  const temMovimentoNoTurno = faturamentoBruto > 0 || valorCombustivel > 0 || totalReservasTurno > 0 || idEditando !== null;

  const custosFixosTurno = temMovimentoNoTurno ? totalCustoFixoDiario : 0;

  const totalDespesasDia = valorCombustivel + totalReservasTurno + custosFixosTurno;
  const saldoLiquidoDia = faturamentoBruto - totalDespesasDia;

  const handleSalvarDia = () => {
    if (faturamentoBruto === 0 && valorCombustivel === 0 && totalReservasTurno === 0) {
      alert('Preencha ao menos o faturamento, combustível ou reservas antes de salvar o dia de trabalho.');
      return;
    }

    const totalDespesasSalvar = valorCombustivel + totalReservasTurno + totalCustoFixoDiario;
    const liquidoSalvar = faturamentoBruto - totalDespesasSalvar;
    const detalheFixosSnapshot = { ...custoFixoDiarioPorItem };

    if (idEditando) {
      setHistorico(historico.map(item => item.id === idEditando ? {
        ...item,
        tipo: 'turno',
        faturamentoBruto,
        combustivel: valorCombustivel,
        litros,
        kmTrabalhado,
        kmTotal,
        reservaFevereiro: 0,
        reservaInvestimento: 0,
        reservaAcidente: valReservaAcidente,
        custosFixosDia: totalCustoFixoDiario,
        detalheCustosFixosDia: detalheFixosSnapshot,
        saidas: [],
        totalDespesas: totalDespesasSalvar,
        liquido: liquidoSalvar,
      } : item));
      setIdEditando(null);
    } else {
      const novoLancamento: Lancamento = {
        id: Date.now().toString(),
        data: new Date().toLocaleDateString('pt-BR'),
        diaSemana: infoDataAtual.diaSemanaTexto,
        tipo: 'turno',
        faturamentoBruto,
        combustivel: valorCombustivel,
        litros,
        kmTrabalhado,
        kmTotal,
        reservaFevereiro: 0,
        reservaInvestimento: 0,
        reservaAcidente: valReservaAcidente,
        custosFixosDia: totalCustoFixoDiario,
        detalheCustosFixosDia: detalheFixosSnapshot,
        saidas: [],
        totalDespesas: totalDespesasSalvar,
        liquido: liquidoSalvar,
      };
      setHistorico([novoLancamento, ...historico]);
    }

    setFaturamentoBruto(0); setTexto_faturamentoBruto('');
    setValorCombustivel(0); setTexto_valorCombustivel('');
    setLitros(0); setTexto_litros('');
    setKmTrabalhado(0); setTexto_kmTrabalhado('');
    setKmTotal(0); setTexto_kmTotal('');
    setValReserva1(0);
    setValReserva2(0);
  };

  const handleRegistarAvulso = () => {
    if (!nomeAvulso.trim()) {
      alert('Digite uma descrição para o lançamento avulso.');
      return;
    }
    if (valorAvulso <= 0) {
      alert('Digite um valor válido maior que zero.');
      return;
    }

    const isEntrada = tipoAvulso === 'entrada';
    const novoAvulso: Lancamento = {
      id: Date.now().toString(),
      data: new Date().toLocaleDateString('pt-BR'),
      diaSemana: infoDataAtual.diaSemanaTexto,
      tipo: isEntrada ? 'avulso_entrada' : 'avulso_saida',
      faturamentoBruto: isEntrada ? valorAvulso : 0,
      combustivel: 0,
      litros: 0,
      kmTrabalhado: 0,
      kmTotal: 0,
      reservaFevereiro: 0,
      reservaInvestimento: 0,
      reservaAcidente: 0,
      custosFixosDia: 0,
      detalheCustosFixosDia: {},
      saidas: isEntrada ? [] : [{ id: Date.now().toString(), nome: nomeAvulso, valor: valorAvulso, origem: origemAvulsa }],
      totalDespesas: isEntrada ? 0 : valorAvulso,
      liquido: isEntrada ? valorAvulso : -valorAvulso,
    };

    setHistorico([novoAvulso, ...historico]);
    setNomeAvulso('');
    setValorAvulso(0);
    setOrigemAvulsa('principal');
  };

  const handleCarregarParaEdicao = (item: Lancamento) => {
    if (item.tipo !== 'turno') {
      alert('Apenas registos de turnos de trabalho completos são carregados para edição.');
      return;
    }
    setIdEditando(item.id);
    setFaturamentoBruto(item.faturamentoBruto); setTexto_faturamentoBruto(String(item.faturamentoBruto));
    setValorCombustivel(item.combustivel); setTexto_valorCombustivel(String(item.combustivel));
    setLitros(item.litros || 0); setTexto_litros(String(item.litros || 0));
    setKmTrabalhado(item.kmTrabalhado || 0); setTexto_kmTrabalhado(String(item.kmTrabalhado || 0));
    setKmTotal(item.kmTotal || 0); setTexto_kmTotal(String(item.kmTotal || 0));
    setValReserva1(item.reservaFevereiro || 0);
    setValReserva2(item.reservaInvestimento || 0);
    setAbaAtiva('lancamento');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // --- CÁLCULOS DE RELATÓRIOS E ACUMULADOS ---
  const relatoriosAcumulados = useMemo(() => {
    let totalFatGeral = 0;
    let totalDespGeral = 0;
    let totalLiqGeral = 0;
    let totalLiqTurnos = 0;
    let totalCombGeral = 0;
    let totalKmTrabGeral = 0;
    let totalKmTotalGeral = 0;
    let totalRes1Geral = 0;
    let totalRes2Geral = 0;
    let totalResAcidenteGeral = 0;

    const acumuladoCustosFixos: { [id: string]: number } = {};
    custosFixos.forEach(c => { acumuladoCustosFixos[c.id] = 0; });

    const porMes: { [key: string]: any } = {};
    const porAno: { [key: string]: any } = {};

    historico.forEach(item => {
      totalFatGeral += item.faturamentoBruto;
      totalDespGeral += item.totalDespesas;
      totalLiqGeral += item.liquido;
      if (item.tipo === 'turno') totalLiqTurnos += item.liquido;
      totalCombGeral += item.combustivel;
      totalKmTrabGeral += (item.kmTrabalhado || 0);
      totalKmTotalGeral += (item.kmTotal || 0);
      
      // Soma inicial das reservas do turno
      totalRes1Geral += (item.reservaFevereiro || 0);
      totalRes2Geral += (item.reservaInvestimento || 0);
      totalResAcidenteGeral += (item.reservaAcidente || 0);

      // Soma inicial das caixinhas baseada no rateio
      if (item.detalheCustosFixosDia) {
        Object.entries(item.detalheCustosFixosDia).forEach(([idCusto, val]) => {
          acumuladoCustosFixos[idCusto] = (acumuladoCustosFixos[idCusto] || 0) + Number(val);
        });
      }

      // Preparar chaves de data
      const partesData = item.data.split('/');
      let mesAnoKey = '';
      let anoKey = '';
      if (partesData.length === 3) {
        mesAnoKey = `${partesData[1]}/${partesData[2]}`;
        anoKey = partesData[2];

        if (!porMes[mesAnoKey]) {
          porMes[mesAnoKey] = { fat: 0, desp: 0, liq: 0, diasTrabalho: 0, comb: 0, res1: 0, res2: 0, resAc: 0 };
        }
        porMes[mesAnoKey].fat += item.faturamentoBruto;
        porMes[mesAnoKey].desp += item.totalDespesas;
        porMes[mesAnoKey].liq += item.liquido;
        porMes[mesAnoKey].comb += item.combustivel;
        porMes[mesAnoKey].res1 += (item.reservaFevereiro || 0);
        porMes[mesAnoKey].res2 += (item.reservaInvestimento || 0);
        porMes[mesAnoKey].resAc += (item.reservaAcidente || 0);
        if (item.tipo === 'turno') porMes[mesAnoKey].diasTrabalho += 1;

        if (!porAno[anoKey]) {
          porAno[anoKey] = { fat: 0, desp: 0, liq: 0, diasTrabalho: 0, comb: 0, res1: 0, res2: 0, resAc: 0 };
        }
        porAno[anoKey].fat += item.faturamentoBruto;
        porAno[anoKey].desp += item.totalDespesas;
        porAno[anoKey].liq += item.liquido;
        porAno[anoKey].comb += item.combustivel;
        porAno[anoKey].res1 += (item.reservaFevereiro || 0);
        porAno[anoKey].res2 += (item.reservaInvestimento || 0);
        porAno[anoKey].resAc += (item.reservaAcidente || 0);
        if (item.tipo === 'turno') porAno[anoKey].diasTrabalho += 1;
      }

      // Subtrações das retiradas avulsas
      if (item.saidas) {
        item.saidas.forEach(s => {
          const valorSaida = Number(s.valor) || 0;
          
          // Subtrai do acumulado geral correspondente
          if (s.origem === 'reserva1') totalRes1Geral -= valorSaida;
          else if (s.origem === 'reserva2') totalRes2Geral -= valorSaida;
          else if (s.origem === 'reserva3') totalResAcidenteGeral -= valorSaida;
          else if (s.origem !== 'principal' && acumuladoCustosFixos[s.origem] !== undefined) {
            acumuladoCustosFixos[s.origem] -= valorSaida;
          }

          // Subtrai dos relatórios mensais e anuais
          if (partesData.length === 3) {
            if (s.origem === 'reserva1') {
              porMes[mesAnoKey].res1 -= valorSaida;
              porAno[anoKey].res1 -= valorSaida;
            } else if (s.origem === 'reserva2') {
              porMes[mesAnoKey].res2 -= valorSaida;
              porAno[anoKey].res2 -= valorSaida;
            } else if (s.origem === 'reserva3') {
              porMes[mesAnoKey].resAc -= valorSaida;
              porAno[anoKey].resAc -= valorSaida;
            }
          }
        });
      }
    });

    const totalDiasTrabalho = historico.filter(h => h.tipo === 'turno').length;
    const historicoAvulso = historico.filter(h => h.tipo !== 'turno');

    return {
      totalFatGeral,
      totalDespGeral,
      totalLiqGeral,
      totalLiqTurnos,
      totalCombGeral,
      totalKmTrabGeral,
      totalKmTotalGeral,
      totalRes1Geral,
      totalRes2Geral,
      totalResAcidenteGeral,
      acumuladoCustosFixos,
      porMes,
      porAno,
      totalDiasRegistrados: historico.length,
      totalDiasTrabalho,
      historicoAvulso
    };
  }, [historico, custosFixos]);

  return (
    <main className={`min-h-screen p-6 md:p-8 transition-colors duration-200 ${modoEscuro ? 'bg-black text-slate-100' : 'bg-slate-100 text-slate-800'}`}>
      <div className="max-w-6xl mx-auto">
        
        <div className="flex justify-end items-center gap-3 mb-3 text-xs text-slate-400"><span>{usuarioEmail}</span><button type="button" onClick={() => signOut(auth)} className="rounded-lg bg-slate-800 px-3 py-2 text-white hover:bg-slate-700">Sair</button></div>
        {/* Cabeçalho */}
        <header className={`mb-6 flex flex-col md:flex-row justify-between items-center p-6 rounded-2xl shadow-lg border gap-4 transition-all duration-300 ${modoEscuro ? 'bg-white/5 backdrop-blur-lg border-white/10' : 'bg-white border-slate-200'}`}>
          <div>
            <h1 className={`text-2xl md:text-3xl font-bold text-center ${modoEscuro ? 'text-white' : 'text-slate-800'}`}>
              Painel de Controle
            </h1>
            <p className={`text-sm mt-1 capitalize ${modoEscuro ? 'text-white/60' : 'text-slate-500'}`}>
              📅 {infoDataAtual.dataCompleta} • Mês de referência: <strong className={modoEscuro ? 'text-white/90' : 'text-slate-700'}>{infoDataAtual.mesAno}</strong>
            </p>
          </div>
          
          <div className="flex items-center gap-3">
            <button
              onClick={() => setModoEscuro(!modoEscuro)}
              className={`px-3 py-2 text-sm font-semibold rounded-xl border transition-all ${modoEscuro ? 'bg-white/10 border-white/20 text-amber-400 hover:bg-white/20 hover:scale-105' : 'bg-slate-100 border-slate-200 text-slate-700 hover:bg-slate-200'}`}
              title="Alternar Modo Escuro"
            >
              {modoEscuro ? '☀️ Claro' : '🌙 Escuro'}
            </button>

            <div className={`flex p-1 rounded-xl border ${modoEscuro ? 'bg-black/40 border-white/10' : 'bg-slate-100 border-slate-200'}`}>
              <button
                onClick={() => setAbaAtiva('lancamento')}
                className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all ${abaAtiva === 'lancamento' ? (modoEscuro ? 'bg-white/10 text-blue-400 shadow-sm' : 'bg-white text-blue-600 shadow-sm') : (modoEscuro ? 'text-white/50 hover:text-white' : 'text-slate-600 hover:text-slate-900')}`}
              >
                📝 Lançamento Diário
              </button>
              <button
                onClick={() => setAbaAtiva('relatorios')}
                className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all ${abaAtiva === 'relatorios' ? (modoEscuro ? 'bg-white/10 text-blue-400 shadow-sm' : 'bg-white text-blue-600 shadow-sm') : (modoEscuro ? 'text-white/50 hover:text-white' : 'text-slate-600 hover:text-slate-900')}`}
              >
                📊 Relatórios & Acumulados
              </button>
            </div>
          </div>
        </header>

        <p role="status" aria-live="polite" className={`mb-4 text-xs ${modoEscuro ? 'text-white/50' : 'text-slate-500'}`}>
          {dadosCarregados ? statusPersistencia : 'Carregando seus dados com segurança...'}
        </p>

        {/* ABA LANÇAMENTO DIÁRIO */}
        {abaAtiva === 'lancamento' && (
          <>
            {/* CUSTOS FIXOS DINÂMICOS / CAIXINHAS */}
            <div className={`mb-8 p-6 rounded-2xl shadow-lg border transition-all duration-300 ${modoEscuro ? 'bg-white/5 backdrop-blur-lg border-white/10' : 'bg-white border-slate-200'}`}>
              <div className="flex justify-between items-center mb-5">
                <h2 className={`text-sm font-bold flex items-center gap-2 ${modoEscuro ? 'text-white/90' : 'text-slate-700'}`}>
                  ⚙️ Custos Fixos Mensais e Caixinhas Personalizadas
                </h2>
                <button 
                  type="button"
                  onClick={handleAdicionarCustoFixo}
                  className="text-xs bg-blue-600 hover:bg-blue-500 text-white font-semibold px-4 py-2 rounded-xl transition-all shadow-sm"
                >
                  ＋ Adicionar Custo
                </button>
              </div>

              {custosFixos.length === 0 ? (
                <p className="text-xs text-white/50 italic py-2">Nenhum custo fixo registado. Adicione acima.</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {custosFixos.map((c) => (
                    <div 
                      key={c.id} 
                      className={`p-4 rounded-xl border relative transition-all ${modoEscuro ? 'bg-black/30 border-white/10 hover:bg-black/40' : 'bg-slate-50 border-slate-200'}`}
                      style={{ borderLeftWidth: '5px', borderLeftColor: c.cor || '#3b82f6' }}
                    >
                      <div className="flex justify-between items-center mb-3 gap-2">
                        <input 
                          type="color" 
                          value={c.cor || '#3b82f6'} 
                          onChange={(e) => handleAtualizarCustoFixo(c.id, 'cor', e.target.value)}
                          className="w-7 h-7 rounded border-0 cursor-pointer bg-transparent"
                          title="Escolher cor da caixinha"
                        />
                        <input 
                          type="text" 
                          value={c.nome} 
                          onChange={(e) => handleAtualizarCustoFixo(c.id, 'nome', e.target.value)}
                          className={`text-xs font-medium px-3 py-1.5 rounded-lg flex-1 outline-none transition-colors ${modoEscuro ? 'bg-white/5 border border-white/10 text-white/90 focus:border-white/30' : 'bg-white border-slate-300 text-slate-700'}`}
                          placeholder="Nome do custo..."
                        />
                        <button 
                          type="button"
                          onClick={() => handleRemoverCustoFixo(c.id)}
                          className="text-rose-400 font-bold text-lg px-1 hover:text-rose-500 transition-colors"
                          title="Remover custo"
                        >
                          ✕
                        </button>
                      </div>
                      <div>
                        <label className={`block text-[10px] font-medium mb-1 ${modoEscuro ? 'text-white/60' : 'text-slate-500'}`}>Valor Mensal (R$)</label>
                        <input 
                          type="number" 
                          value={c.valorMensal || ''} 
                          onChange={(e) => handleAtualizarCustoFixo(c.id, 'valorMensal', parseFloat(e.target.value) || 0)}
                          className={`w-full px-3 py-2 text-sm border rounded-lg font-semibold outline-none transition-colors ${modoEscuro ? 'bg-black/50 border-white/10 text-white placeholder-white/30 focus:border-blue-500/50' : 'bg-white border-slate-300 text-slate-800'}`}
                          placeholder="0.00"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* PAINEL DE LANÇAMENTOS AVULSOS */}
            <div className={`mb-8 p-6 rounded-2xl shadow-lg border transition-all duration-300 ${modoEscuro ? 'bg-white/5 backdrop-blur-lg border-white/10' : 'bg-white border-slate-200'}`}>
              <h2 className={`text-sm font-bold mb-4 flex items-center gap-2 ${modoEscuro ? 'text-white/90' : 'text-slate-700'}`}>
                ⚡ Lançamento Avulso Rápido (Entrada ou Saída fora do Turno)
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-5 gap-4 items-end">
                <div>
                  <label className={`block text-xs font-medium mb-1.5 ${modoEscuro ? 'text-white/60' : 'text-slate-600'}`}>Tipo</label>
                  <select
                    value={tipoAvulso}
                    onChange={(e) => setTipoAvulso(e.target.value as 'saida' | 'entrada')}
                    className={`w-full px-3 py-2.5 text-sm border rounded-xl font-medium outline-none transition-colors ${modoEscuro ? 'bg-black/50 border-white/10 text-white' : 'bg-slate-50 border-slate-300 text-slate-800'}`}
                  >
                    <option value="saida">📤 Saída / Despesa</option>
                    <option value="entrada">📥 Entrada Extra</option>
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className={`block text-xs font-medium mb-1.5 ${modoEscuro ? 'text-white/60' : 'text-slate-600'}`}>Descrição</label>
                  <input 
                    type="text" 
                    value={nomeAvulso} 
                    onChange={(e) => setNomeAvulso(e.target.value)}
                    placeholder={tipoAvulso === 'saida' ? 'Ex: Compra de violão, peça...' : 'Ex: Venda extra, bônus...'} 
                    className={`w-full px-3 py-2.5 text-sm border rounded-xl outline-none transition-colors ${modoEscuro ? 'bg-black/50 border-white/10 text-white placeholder-white/30' : 'bg-slate-50 border-slate-300 text-slate-800'}`}
                  />
                </div>
                <div>
                  <label className={`block text-xs font-medium mb-1.5 ${modoEscuro ? 'text-white/60' : 'text-slate-600'}`}>Valor (R$)</label>
                  <input 
                    type="number" 
                    value={valorAvulso || ''} 
                    onChange={(e) => setValorAvulso(parseFloat(e.target.value) || 0)}
                    placeholder="0.00" 
                    className={`w-full px-3 py-2.5 text-sm border rounded-xl font-semibold outline-none transition-colors ${modoEscuro ? 'bg-black/50 border-white/10 text-white placeholder-white/30' : 'bg-slate-50 border-slate-300 text-slate-800'}`}
                  />
                </div>
                <div>
                  {tipoAvulso === 'saida' ? (
                    <div className="space-y-1.5">
                      <label className={`block text-[10px] font-medium ${modoEscuro ? 'text-white/60' : 'text-slate-600'}`}>Retirar de:</label>
                      <select
                        value={origemAvulsa}
                        onChange={(e) => setOrigemAvulsa(e.target.value)}
                        className={`w-full px-2 py-2.5 text-xs border rounded-xl outline-none transition-colors ${modoEscuro ? 'bg-black/50 border-white/10 text-white' : 'bg-slate-50 border-slate-300 text-slate-800'}`}
                      >
                        <option value="principal">Saldo Principal</option>
                        {/* Novas opções de reservas adicionadas aqui */}
                        <option value="reserva1">Reserva: {nomeReserva1}</option>
                        <option value="reserva2">Reserva: {nomeReserva2}</option>
                        <option value="reserva3">Reserva: {nomeReserva3}</option>
                        {custosFixos.map(cf => (
                          <option key={cf.id} value={cf.id}>Caixinha: {cf.nome || 'Sem nome'}</option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <span className="block text-xs text-emerald-400 font-semibold mb-3">Vai para o Saldo Principal</span>
                  )}
                  <button 
                    onClick={handleRegistarAvulso}
                    className={`w-full mt-1.5 py-2.5 text-xs font-bold rounded-xl text-white shadow-sm transition-all hover:scale-[1.02] ${tipoAvulso === 'saida' ? 'bg-rose-600 hover:bg-rose-500' : 'bg-emerald-600 hover:bg-emerald-500'}`}
                  >
                    Registar {tipoAvulso === 'saida' ? 'Saída' : 'Entrada'}
                  </button>
                </div>
              </div>
            </div>

            {idEditando && (
              <div className="mb-6 bg-amber-500/10 border border-amber-500/20 backdrop-blur-sm p-4 rounded-xl flex justify-between items-center text-amber-400">
                <span className="font-medium text-sm">⚠️ A editar um registo do histórico. Altere os dados abaixo e clique em Atualizar.</span>
                <button 
                  onClick={() => { 
                    setIdEditando(null); 
                    setFaturamentoBruto(0); setTexto_faturamentoBruto(''); setValorCombustivel(0); setTexto_valorCombustivel(''); setLitros(0); setTexto_litros(''); 
                    setKmTrabalhado(0); setTexto_kmTrabalhado(''); setKmTotal(0); setTexto_kmTotal(''); setValReserva1(0); setValReserva2(0);
                  }}
                  className="text-xs bg-amber-500/20 hover:bg-amber-500/30 px-4 py-2 rounded-lg font-bold transition-all"
                >
                  Cancelar
                </button>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              <div className={`p-6 rounded-2xl shadow-lg border transition-all duration-300 ${modoEscuro ? 'bg-white/5 backdrop-blur-lg border-white/10' : 'bg-white border-slate-200'}`}>
                <h3 className={`text-sm font-medium ${modoEscuro ? 'text-white/60' : 'text-slate-500'}`}>Faturamento Bruto (Turno)</h3>
                <p className="text-3xl font-bold text-emerald-400 mt-2">R$ {faturamentoBruto.toFixed(2)}</p>
              </div>
              <div className={`p-6 rounded-2xl shadow-lg border transition-all duration-300 ${modoEscuro ? 'bg-white/5 backdrop-blur-lg border-white/10' : 'bg-white border-slate-200'}`}>
                <h3 className={`text-sm font-medium ${modoEscuro ? 'text-white/60' : 'text-slate-500'}`}>Despesas Totais (Turno)</h3>
                <p className="text-3xl font-bold text-rose-400 mt-2">R$ {totalDespesasDia.toFixed(2)}</p>
              </div>
              <div className={`p-6 rounded-2xl shadow-lg border transition-all duration-300 ${modoEscuro ? 'bg-white/5 backdrop-blur-lg border-white/10' : 'bg-white border-slate-200'}`}>
                <h3 className={`text-sm font-medium ${modoEscuro ? 'text-white/60' : 'text-slate-500'}`}>Total Líquido (Turno)</h3>
                <p className={`text-3xl font-bold mt-2 ${saldoLiquidoDia >= 0 ? (modoEscuro ? 'text-blue-400' : 'text-blue-500') : 'text-rose-400'}`}>
                  R$ {saldoLiquidoDia.toFixed(2)}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
              <div className={`p-6 rounded-2xl shadow-lg border transition-all duration-300 ${modoEscuro ? 'bg-white/5 backdrop-blur-lg border-white/10' : 'bg-white border-slate-200'}`}>
                <h2 className={`text-xl font-bold mb-5 ${modoEscuro ? 'text-white/90' : 'text-slate-800'}`}>
                  {idEditando ? '✏️ Editar Registo Selecionado' : 'Registo do Turno / Dia'}
                </h2>
                
                <div className="space-y-5">
                  <div>
                    <label className={`block text-sm font-medium mb-1.5 ${modoEscuro ? 'text-white/80' : 'text-slate-700'}`}>Faturamento Bruto (R$)</label>
                    <input 
                      type="text" inputMode="decimal" 
                      value={texto_faturamentoBruto} 
                      onChange={(e) => { setTexto_faturamentoBruto(e.target.value); setFaturamentoBruto(lerNumero(e.target.value)); }}
                      className={`w-full px-4 py-3 border rounded-xl outline-none transition-colors ${modoEscuro ? 'bg-black/50 border-white/10 text-white placeholder-white/30 focus:border-blue-500/50' : 'border-slate-300 text-slate-800'}`}
                      placeholder="0.00"
                    />
                  </div>

                  <div className={`p-5 rounded-xl border space-y-4 transition-all ${modoEscuro ? 'bg-black/30 border-white/10' : 'bg-slate-50 border-slate-200'}`}>
                    <h3 className={`text-sm font-bold ${modoEscuro ? 'text-white/90' : 'text-slate-700'}`}>Abastecimento & Combustível</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className={`block text-xs font-medium mb-1.5 ${modoEscuro ? 'text-white/60' : 'text-slate-600'}`}>Valor Gasto (R$)</label>
                        <input 
                          type="text" inputMode="decimal" 
                          value={texto_valorCombustivel} 
                          onChange={(e) => { setTexto_valorCombustivel(e.target.value); setValorCombustivel(lerNumero(e.target.value)); }}
                          className={`w-full px-3 py-2.5 text-sm border rounded-lg outline-none transition-colors ${modoEscuro ? 'bg-black/50 border-white/10 text-white placeholder-white/30' : 'bg-white border-slate-300 text-slate-800'}`}
                          placeholder="0.00"
                        />
                      </div>
                      <div>
                        <label className={`block text-xs font-medium mb-1.5 ${modoEscuro ? 'text-white/60' : 'text-slate-600'}`}>Litros</label>
                        <input 
                          type="text" inputMode="decimal" 
                          value={texto_litros} 
                          onChange={(e) => { setTexto_litros(e.target.value); setLitros(lerNumero(e.target.value)); }}
                          className={`w-full px-3 py-2.5 text-sm border rounded-lg outline-none transition-colors ${modoEscuro ? 'bg-black/50 border-white/10 text-white placeholder-white/30' : 'bg-white border-slate-300 text-slate-800'}`}
                          placeholder="0.00"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className={`block text-xs font-medium mb-1.5 ${modoEscuro ? 'text-white/60' : 'text-slate-600'}`}>KM Trabalhado (Líquido)</label>
                        <input 
                          type="text" inputMode="decimal" 
                          value={texto_kmTrabalhado} 
                          onChange={(e) => { setTexto_kmTrabalhado(e.target.value); setKmTrabalhado(lerNumero(e.target.value)); }}
                          className={`w-full px-3 py-2.5 text-sm border rounded-lg outline-none transition-colors ${modoEscuro ? 'bg-black/50 border-white/10 text-white placeholder-white/30' : 'bg-white border-slate-300 text-slate-800'}`}
                          placeholder="Ex: 150"
                        />
                      </div>
                      <div>
                        <label className={`block text-xs font-medium mb-1.5 ${modoEscuro ? 'text-white/60' : 'text-slate-600'}`}>KM Total do Carro</label>
                        <input 
                          type="text" inputMode="decimal" 
                          value={texto_kmTotal} 
                          onChange={(e) => { setTexto_kmTotal(e.target.value); setKmTotal(lerNumero(e.target.value)); }}
                          className={`w-full px-3 py-2.5 text-sm border rounded-lg outline-none transition-colors ${modoEscuro ? 'bg-black/50 border-white/10 text-white placeholder-white/30' : 'bg-white border-slate-300 text-slate-800'}`}
                          placeholder="Ex: 180"
                        />
                      </div>
                    </div>
                    <div aria-live="polite" className={`text-xs pt-3 border-t grid grid-cols-2 gap-3 ${modoEscuro ? 'border-white/10 text-white/60' : 'border-slate-200 text-slate-600'}`}>
                      <div>Preço médio por litro:
                        <strong className={`block text-base mt-1 ${modoEscuro ? 'text-white' : 'text-slate-800'}`}>
                          {litrosCalculados > 0 ? precoLitroMedio.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : 'R$ 0,00'}/L
                        </strong>
                        <span className="block mt-1 opacity-70">{gastoCalculado.toLocaleString('pt-BR', {minimumFractionDigits:2})} ÷ {litrosCalculados.toLocaleString('pt-BR')} L</span>
                      </div>
                      <div className="text-right">Consumo médio:
                        <strong className={`block text-base mt-1 ${modoEscuro ? 'text-white' : 'text-slate-800'}`}>
                          {consumoKmL.toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2})} km/L
                        </strong>
                        <span className="block mt-1 opacity-70">{kmCalculados.toLocaleString('pt-BR')} km ÷ {litrosCalculados.toLocaleString('pt-BR')} L</span>
                      </div>
                    </div>
                  </div>

                  <div className="max-w-sm mx-auto w-full text-center">
                    <label className={`block text-sm font-semibold mb-2 ${modoEscuro ? 'text-white/80' : 'text-slate-700'}`}>Reserva de Acidente</label>
                    <div aria-live="polite" className={`w-full px-4 py-3 rounded-lg border font-bold ${modoEscuro ? 'bg-black/50 border-white/10 text-white' : 'bg-slate-100 border-slate-200 text-slate-800'}`}>
                      {valReservaAcidente.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                    </div>
                    <p className={`text-xs mt-2 ${modoEscuro ? 'text-white/60' : 'text-slate-600'}`}>Automático: R$ 0,038 × KM Total do Carro</p>
                  </div>

                  <button 
                    onClick={handleSalvarDia}
                    className={`w-full font-bold py-3.5 rounded-xl transition-all hover:scale-[1.01] shadow-lg text-white ${idEditando ? 'bg-amber-600 hover:bg-amber-500 shadow-amber-500/20' : 'bg-blue-600 hover:bg-blue-500 shadow-blue-500/20'}`}
                  >
                    {idEditando ? '🔄 Atualizar Registo' : '💾 Registar e Salvar Dia de Trabalho'}
                  </button>
                </div>
              </div>

              <div className="space-y-6">
                <div className={`p-6 rounded-2xl shadow-lg border transition-all duration-300 ${modoEscuro ? 'bg-white/5 backdrop-blur-lg border-white/10' : 'bg-white border-slate-200'}`}>
                  <h2 className={`text-lg font-bold mb-2 ${modoEscuro ? 'text-white/90' : 'text-slate-800'}`}>Detalhamento dos Custos (Rateio Diário)</h2>
                  <p className={`text-xs mb-5 ${modoEscuro ? 'text-white/50' : 'text-slate-500'}`}>
                    {temMovimentoNoTurno ? `Calculado com base em ${diasUteisMes} dias restantes.` : 'Insira dados no turno para exibir o rateio.'}
                  </p>
                  
                  <div className={`space-y-3 text-sm ${modoEscuro ? 'divide-white/10' : 'divide-slate-100'}`}>
                    <div className={`flex justify-between py-2.5 border-b ${modoEscuro ? 'border-white/10' : 'border-slate-100'}`}>
                      <span className={modoEscuro ? 'text-white/70' : 'text-slate-600'}>Combustível:</span>
                      <span className={`font-bold ${modoEscuro ? 'text-white' : 'text-slate-800'}`}>R$ {valorCombustivel.toFixed(2)}</span>
                    </div>
                    <div className={`flex justify-between py-2.5 border-b ${modoEscuro ? 'border-white/10' : 'border-slate-100'}`}>
                      <span className={modoEscuro ? 'text-white/70' : 'text-slate-600'}>{nomeReserva1}:</span>
                      <span className={`font-bold ${modoEscuro ? 'text-white' : 'text-slate-800'}`}>R$ {(Number(valReserva1) || 0).toFixed(2)}</span>
                    </div>
                    <div className={`flex justify-between py-2.5 border-b ${modoEscuro ? 'border-white/10' : 'border-slate-100'}`}>
                      <span className={modoEscuro ? 'text-white/70' : 'text-slate-600'}>{nomeReserva2}:</span>
                      <span className={`font-bold ${modoEscuro ? 'text-white' : 'text-slate-800'}`}>R$ {(Number(valReserva2) || 0).toFixed(2)}</span>
                    </div>
                    <div className={`flex justify-between py-2.5 border-b ${modoEscuro ? 'border-white/10' : 'border-slate-100'}`}>
                      <span className={modoEscuro ? 'text-white/70' : 'text-slate-600'}>{nomeReserva3} (R$ 0,038/KM):</span>
                      <span className={`font-bold ${modoEscuro ? 'text-white' : 'text-slate-800'}`}>R$ {valReservaAcidente.toFixed(2)}</span>
                    </div>

                    {custosFixos.map((c) => {
                      const valorDiarioItem = custoFixoDiarioPorItem[c.id] || 0;
                      return (
                        <div key={c.id} className={`flex justify-between py-2.5 border-b ${modoEscuro ? 'border-white/10' : 'border-slate-100'}`}>
                          <span className={modoEscuro ? 'text-white/70' : 'text-slate-600'}>{c.nome || 'Custo sem nome'} (Rateio):</span>
                          <span className={`font-bold ${modoEscuro ? 'text-white' : 'text-slate-800'}`}>R$ {valorDiarioItem.toFixed(2)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className={`p-6 rounded-2xl shadow-lg border transition-all duration-300 ${modoEscuro ? 'bg-amber-500/5 backdrop-blur-lg border-amber-500/20' : 'bg-amber-50 border-amber-200'}`}>
                  <h3 className={`font-bold mb-3 flex items-center gap-2 ${modoEscuro ? 'text-amber-400' : 'text-amber-900'}`}>
                    📝 Bloco de Lembretes do Dia
                  </h3>
                  <textarea 
                    value={lembrete}
                    onChange={(e) => setLembrete(e.target.value)}
                    placeholder="Ex: Trocar óleo com 68.000 km..."
                    className={`w-full h-24 p-4 text-sm border rounded-xl outline-none resize-none transition-colors ${modoEscuro ? 'bg-black/40 border-amber-500/30 text-white placeholder-white/30 focus:border-amber-400/50' : 'bg-white border-amber-200 text-slate-800'}`}
                  />
                </div>
              </div>
            </div>

            <div className={`p-6 rounded-2xl shadow-lg border transition-all duration-300 ${modoEscuro ? 'bg-white/5 backdrop-blur-lg border-white/10' : 'bg-white border-slate-200'}`}>
              <h2 className={`text-xl font-bold mb-2 ${modoEscuro ? 'text-white/90' : 'text-slate-800'}`}>Histórico de Lançamentos Recentes</h2>
              <p className={`text-xs mb-5 ${modoEscuro ? 'text-white/50' : 'text-slate-500'}`}>💡 Clique em qualquer linha de turno para carregar os dados de volta para edição.</p>
              
              {historico.length === 0 ? (
                <p className={`text-sm py-4 text-center ${modoEscuro ? 'text-white/40' : 'text-slate-500'}`}>Nenhum registo efetuado ainda.</p>
              ) : (
                <div className="overflow-x-auto rounded-xl">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead>
                      <tr className={`border-b transition-colors ${modoEscuro ? 'bg-white/10 text-slate-200 border-white/10' : 'bg-slate-100 text-slate-700 border-slate-200'}`}>
                        <th className="p-4 font-semibold">Data</th>
                        <th className="p-4 font-semibold">Tipo / Dia</th>
                        <th className="p-4 font-semibold">Faturamento</th>
                        <th className="p-4 font-semibold">Combustível</th>
                        <th className="p-4 font-semibold">{nomeReserva1}</th>
                        <th className="p-4 font-semibold">{nomeReserva2}</th>
                        <th className="p-4 font-semibold">{nomeReserva3}</th>
                        <th className="p-4 font-semibold">Total Líquido</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historico.map((item) => (
                        <tr 
                          key={item.id} 
                          onClick={() => item.tipo === 'turno' && handleCarregarParaEdicao(item)}
                          className={`border-b transition-colors ${item.tipo === 'turno' ? (modoEscuro ? 'border-white/5 hover:bg-white/5 cursor-pointer' : 'border-slate-100 hover:bg-blue-50 cursor-pointer') : (modoEscuro ? 'border-white/5 bg-black/30' : 'border-slate-100 bg-slate-50/50')} ${item.tipo !== 'turno' ? 'opacity-85' : ''}`}
                        >
                          <td className={`p-4 font-medium ${modoEscuro ? 'text-white/90' : 'text-slate-700'}`}>{item.data}</td>
                          <td className={`p-4 capitalize ${modoEscuro ? 'text-white/70' : 'text-slate-600'}`}>
                            {item.tipo === 'turno' ? (
                              item.diaSemana
                            ) : item.tipo === 'avulso_entrada' ? (
                              <span className="text-emerald-400 font-bold text-xs bg-emerald-400/10 px-2 py-1 rounded">📥 Entrada Avulsa</span>
                            ) : (
                              <span className="text-rose-400 font-bold text-xs bg-rose-400/10 px-2 py-1 rounded">📤 Saída Avulsa</span>
                            )}
                          </td>
                          <td className="p-4 text-emerald-400 font-bold">R$ {item.faturamentoBruto.toFixed(2)}</td>
                          <td className={`p-4 ${modoEscuro ? 'text-white/70' : 'text-slate-600'}`}>R$ {item.combustivel.toFixed(2)}</td>
                          <td className={`p-4 ${modoEscuro ? 'text-white/70' : 'text-slate-600'}`}>R$ {item.reservaFevereiro.toFixed(2)}</td>
                          <td className={`p-4 ${modoEscuro ? 'text-white/70' : 'text-slate-600'}`}>R$ {item.reservaInvestimento.toFixed(2)}</td>
                          <td className={`p-4 ${modoEscuro ? 'text-white/70' : 'text-slate-600'}`}>R$ {item.reservaAcidente.toFixed(2)}</td>
                          <td className={`p-4 font-bold ${item.liquido >= 0 ? (modoEscuro ? 'text-blue-400' : 'text-blue-500') : 'text-rose-400'}`}>
                            R$ {item.liquido.toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}

        {/* ABA RELATÓRIOS & ACUMULADOS */}
        {abaAtiva === 'relatorios' && (
          <div className="space-y-8">
            
            <div className={`p-6 rounded-2xl shadow-lg border transition-all duration-300 ${modoEscuro ? 'bg-white/5 backdrop-blur-lg border-white/10' : 'bg-white border-slate-200'}`}>
              <h2 className={`text-2xl font-bold mb-2 ${modoEscuro ? 'text-white' : 'text-slate-800'}`}>📈 Desempenho Consolidado</h2>
              <p className={`text-sm mb-6 ${modoEscuro ? 'text-white/50' : 'text-slate-500'}`}>Balanço total acumulado de todos os registos.</p>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <div className={`p-6 rounded-xl border transition-all ${modoEscuro ? 'bg-black/30 border-white/10' : 'bg-slate-50 border-slate-200'}`}>
                  <span className={`text-sm font-medium block ${modoEscuro ? 'text-white/60' : 'text-slate-500'}`}>Faturamento Bruto Acumulado</span>
                  <span className="text-3xl font-bold text-emerald-400 mt-2 block">R$ {relatoriosAcumulados.totalFatGeral.toFixed(2)}</span>
                </div>
                <div className={`p-6 rounded-xl border transition-all ${modoEscuro ? 'bg-black/30 border-white/10' : 'bg-slate-50 border-slate-200'}`}>
                  <span className={`text-sm font-medium block ${modoEscuro ? 'text-white/60' : 'text-slate-500'}`}>Despesas Totais Acumuladas</span>
                  <span className="text-3xl font-bold text-rose-400 mt-2 block">R$ {relatoriosAcumulados.totalDespGeral.toFixed(2)}</span>
                </div>
                <div className={`p-6 rounded-xl border transition-all ${modoEscuro ? 'bg-black/30 border-white/10' : 'bg-slate-50 border-slate-200'}`}>
                  <span className={`text-sm font-medium block ${modoEscuro ? 'text-white/60' : 'text-slate-500'}`}>Resultado Líquido Geral</span>
                  <span className={`text-3xl font-bold mt-2 block ${relatoriosAcumulados.totalLiqGeral >= 0 ? (modoEscuro ? 'text-blue-400' : 'text-blue-500') : 'text-rose-400'}`}>
                    R$ {relatoriosAcumulados.totalLiqGeral.toFixed(2)}
                  </span>
                </div>
              </div>

              {/* DETALHAMENTO DISCRIMINADO: CAIXINHAS E RESERVAS */}
              <div className="mb-8">
                <h3 className={`text-base font-bold mb-4 ${modoEscuro ? 'text-white/90' : 'text-slate-700'}`}>🔍 Discriminação de Gastos, Reservas e Caixinhas Acumuladas</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 text-sm">
                  
                  <div className={`p-4 rounded-xl border transition-all ${modoEscuro ? 'bg-black/30 border-white/10' : 'bg-slate-50 border-slate-200'}`} style={{ borderLeftWidth: '5px', borderLeftColor: '#f97316' }}>
                    <span className={`text-xs block mb-1 ${modoEscuro ? 'text-white/60' : 'text-slate-500'}`}>Combustível</span>
                    <strong className={`text-sm ${modoEscuro ? 'text-white/90' : 'text-slate-800'}`}>R$ {relatoriosAcumulados.totalCombGeral.toFixed(2)}</strong>
                  </div>

                  <div className={`p-4 rounded-xl border transition-all ${modoEscuro ? 'bg-black/30 border-white/10' : 'bg-slate-50 border-slate-200'}`} style={{ borderLeftWidth: '5px', borderLeftColor: '#06b6d4' }}>
                    <span className={`text-xs block mb-1 ${modoEscuro ? 'text-white/60' : 'text-slate-500'}`}>{nomeReserva1}</span>
                    <strong className={`text-sm ${modoEscuro ? 'text-white/90' : 'text-slate-800'}`}>R$ {relatoriosAcumulados.totalRes1Geral.toFixed(2)}</strong>
                  </div>

                  <div className={`p-4 rounded-xl border transition-all ${modoEscuro ? 'bg-black/30 border-white/10' : 'bg-slate-50 border-slate-200'}`} style={{ borderLeftWidth: '5px', borderLeftColor: '#84cc16' }}>
                    <span className={`text-xs block mb-1 ${modoEscuro ? 'text-white/60' : 'text-slate-500'}`}>{nomeReserva2}</span>
                    <strong className={`text-sm ${modoEscuro ? 'text-white/90' : 'text-slate-800'}`}>R$ {relatoriosAcumulados.totalRes2Geral.toFixed(2)}</strong>
                  </div>

                  <div className={`p-4 rounded-xl border transition-all ${modoEscuro ? 'bg-black/30 border-white/10' : 'bg-slate-50 border-slate-200'}`} style={{ borderLeftWidth: '5px', borderLeftColor: '#ef4444' }}>
                    <span className={`text-xs block mb-1 ${modoEscuro ? 'text-white/60' : 'text-slate-500'}`}>{nomeReserva3}</span>
                    <strong className={`text-sm ${modoEscuro ? 'text-white/90' : 'text-slate-800'}`}>R$ {relatoriosAcumulados.totalResAcidenteGeral.toFixed(2)}</strong>
                  </div>

                  {custosFixos.map((c) => {
                    const valorAcumuladoItem = relatoriosAcumulados.acumuladoCustosFixos[c.id] || 0;
                    return (
                      <div 
                        key={c.id} 
                        className={`p-4 rounded-xl border transition-all ${modoEscuro ? 'bg-black/30 border-white/10' : 'bg-slate-50 border-slate-200'}`}
                        style={{ borderLeftWidth: '5px', borderLeftColor: c.cor || '#3b82f6' }}
                      >
                        <span className={`text-xs block truncate mb-1 ${modoEscuro ? 'text-white/60' : 'text-slate-500'}`}>{c.nome || 'Custo'} (Acumulado)</span>
                        <strong className={`text-sm ${modoEscuro ? 'text-white/90' : 'text-slate-800'}`}>R$ {valorAcumuladoItem.toFixed(2)}</strong>
                      </div>
                    );
                  })}

                </div>
              </div>

              <div className={`grid grid-cols-2 md:grid-cols-4 gap-6 text-sm p-5 rounded-xl border transition-all ${modoEscuro ? 'bg-black/30 border-white/10' : 'bg-slate-50 border-slate-200'}`}>
                <div>
                  <span className={`text-xs block mb-1 ${modoEscuro ? 'text-white/60' : 'text-slate-500'}`}>KM Trabalhado:</span>
                  <strong className={`text-base ${modoEscuro ? 'text-white/90' : 'text-slate-800'}`}>{relatoriosAcumulados.totalKmTrabGeral.toFixed(0)} km</strong>
                </div>
                <div>
                  <span className={`text-xs block mb-1 ${modoEscuro ? 'text-white/60' : 'text-slate-500'}`}>KM Total Rodado:</span>
                  <strong className={`text-base ${modoEscuro ? 'text-white/90' : 'text-slate-800'}`}>{relatoriosAcumulados.totalKmTotalGeral.toFixed(0)} km</strong>
                </div>
                <div>
                  <span className={`text-xs block mb-1 ${modoEscuro ? 'text-white/60' : 'text-slate-500'}`}>Média Líq / Dia:</span>
                  <strong className={`text-base ${modoEscuro ? 'text-white/90' : 'text-slate-800'}`}>
                    R$ {relatoriosAcumulados.totalDiasTrabalho > 0 ? (relatoriosAcumulados.totalLiqTurnos / relatoriosAcumulados.totalDiasTrabalho).toFixed(2) : '0.00'}
                  </strong>
                </div>
                <div>
                  <span className={`text-xs block mb-1 ${modoEscuro ? 'text-white/60' : 'text-slate-500'}`}>Dias Trabalhados:</span>
                  <strong className={`text-base ${modoEscuro ? 'text-white/90' : 'text-slate-800'}`}>{relatoriosAcumulados.totalDiasTrabalho} dias</strong>
                </div>
              </div>
            </div>

            {/* HISTÓRICO DE LANÇAMENTOS AVULSOS */}
            <div className={`p-6 rounded-2xl shadow-lg border transition-all duration-300 ${modoEscuro ? 'bg-white/5 backdrop-blur-lg border-white/10' : 'bg-white border-slate-200'}`}>
              <h3 className={`text-xl font-bold mb-5 ${modoEscuro ? 'text-white' : 'text-slate-800'}`}>⚡ Histórico de Movimentações Avulsas</h3>
              {relatoriosAcumulados.historicoAvulso.length === 0 ? (
                <p className={`text-sm py-4 text-center ${modoEscuro ? 'text-white/40' : 'text-slate-500'}`}>Nenhuma movimentação avulsa registada ainda.</p>
              ) : (
                <div className="overflow-x-auto rounded-xl">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead>
                      <tr className={`border-b transition-colors ${modoEscuro ? 'bg-white/10 text-slate-200 border-white/10' : 'bg-slate-100 text-slate-700 border-slate-200'}`}>
                        <th className="p-4 font-semibold">Data</th>
                        <th className="p-4 font-semibold">Tipo</th>
                        <th className="p-4 font-semibold">Descrição</th>
                        <th className="p-4 font-semibold">Origem / Destino</th>
                        <th className="p-4 font-semibold">Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {relatoriosAcumulados.historicoAvulso.map((item) => {
                        const isEntrada = item.tipo === 'avulso_entrada';
                        const saidaDetalhe = item.saidas[0];
                        const cOrigem = saidaDetalhe ? custosFixos.find(cf => cf.id === saidaDetalhe.origem) : null;
                        
                        // Lógica de mapeamento dos nomes de origem incluindo as novas opções de reserva
                        let nomeOrigemDestino = 'Saldo Principal';
                        if (!isEntrada && saidaDetalhe) {
                          if (saidaDetalhe.origem === 'principal') nomeOrigemDestino = 'Saldo Principal';
                          else if (saidaDetalhe.origem === 'reserva1') nomeOrigemDestino = nomeReserva1;
                          else if (saidaDetalhe.origem === 'reserva2') nomeOrigemDestino = nomeReserva2;
                          else if (saidaDetalhe.origem === 'reserva3') nomeOrigemDestino = nomeReserva3;
                          else nomeOrigemDestino = cOrigem?.nome || 'Caixinha';
                        }

                        return (
                          <tr key={item.id} className={`border-b transition-colors ${modoEscuro ? 'border-white/5 hover:bg-white/5' : 'border-slate-100 hover:bg-slate-50'}`}>
                            <td className={`p-4 font-medium ${modoEscuro ? 'text-white/90' : 'text-slate-800'}`}>{item.data}</td>
                            <td className="p-4">
                              {isEntrada ? (
                                <span className="px-2 py-1 rounded text-xs font-bold bg-emerald-500/20 text-emerald-400">📥 Entrada Extra</span>
                              ) : (
                                <span className="px-2 py-1 rounded text-xs font-bold bg-rose-500/20 text-rose-400">📤 Saída Avulsa</span>
                              )}
                            </td>
                            <td className={`p-4 ${modoEscuro ? 'text-white/80' : 'text-slate-700'}`}>
                              {isEntrada ? 'Entrada de Dinheiro Extra' : (saidaDetalhe?.nome || 'Despesa Avulsa')}
                            </td>
                            <td className={`p-4 text-xs font-medium ${modoEscuro ? 'text-white/60' : 'text-slate-600'}`}>{nomeOrigemDestino}</td>
                            <td className={`p-4 font-bold ${isEntrada ? 'text-emerald-400' : 'text-rose-400'}`}>
                              {isEntrada ? '+' : '-'} R$ {Math.abs(item.liquido).toFixed(2)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Acumulado por Mês */}
            <div className={`p-6 rounded-2xl shadow-lg border transition-all duration-300 ${modoEscuro ? 'bg-white/5 backdrop-blur-lg border-white/10' : 'bg-white border-slate-200'}`}>
              <h3 className={`text-xl font-bold mb-5 ${modoEscuro ? 'text-white' : 'text-slate-800'}`}>📅 Acumulado por Mês</h3>
              {Object.keys(relatoriosAcumulados.porMes).length === 0 ? (
                <p className={`text-sm py-4 text-center ${modoEscuro ? 'text-white/40' : 'text-slate-500'}`}>Nenhum dado mensal registado ainda.</p>
              ) : (
                <div className="overflow-x-auto rounded-xl">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead>
                      <tr className={`border-b transition-colors ${modoEscuro ? 'bg-white/10 text-slate-200 border-white/10' : 'bg-slate-100 text-slate-700 border-slate-200'}`}>
                        <th className="p-4 font-semibold">Mês/Ano</th>
                        <th className="p-4 font-semibold">Dias Trabalho</th>
                        <th className="p-4 font-semibold">Faturamento</th>
                        <th className="p-4 font-semibold">Combustível</th>
                        <th className="p-4 font-semibold">Reservas (Total)</th>
                        <th className="p-4 font-semibold">Despesas Totais</th>
                        <th className="p-4 font-semibold">Saldo Líquido</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(relatoriosAcumulados.porMes).map(([mesAno, dados]) => (
                        <tr key={mesAno} className={`border-b transition-colors ${modoEscuro ? 'border-white/5 hover:bg-white/5' : 'border-slate-100 hover:bg-slate-50'}`}>
                          <td className={`p-4 font-bold ${modoEscuro ? 'text-white/90' : 'text-slate-800'}`}>{mesAno}</td>
                          <td className={`p-4 ${modoEscuro ? 'text-white/70' : 'text-slate-600'}`}>{dados.diasTrabalho} dias</td>
                          <td className="p-4 text-emerald-400 font-bold">R$ {dados.fat.toFixed(2)}</td>
                          <td className={`p-4 ${modoEscuro ? 'text-white/70' : 'text-slate-600'}`}>R$ {dados.comb.toFixed(2)}</td>
                          <td className={`p-4 ${modoEscuro ? 'text-white/70' : 'text-slate-600'}`}>R$ {(dados.res1 + dados.res2 + dados.resAc).toFixed(2)}</td>
                          <td className="p-4 text-rose-400 font-medium">R$ {dados.desp.toFixed(2)}</td>
                          <td className={`p-4 font-bold ${dados.liq >= 0 ? (modoEscuro ? 'text-blue-400' : 'text-blue-500') : 'text-rose-400'}`}>
                            R$ {dados.liq.toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Acumulado por Ano */}
            <div className={`p-6 rounded-2xl shadow-lg border transition-all duration-300 ${modoEscuro ? 'bg-white/5 backdrop-blur-lg border-white/10' : 'bg-white border-slate-200'}`}>
              <h3 className={`text-xl font-bold mb-5 ${modoEscuro ? 'text-white' : 'text-slate-800'}`}>🏆 Acumulado por Ano</h3>
              {Object.keys(relatoriosAcumulados.porAno).length === 0 ? (
                <p className={`text-sm py-4 text-center ${modoEscuro ? 'text-white/40' : 'text-slate-500'}`}>Nenhum dado anual registado ainda.</p>
              ) : (
                <div className="overflow-x-auto rounded-xl">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead>
                      <tr className={`border-b transition-colors ${modoEscuro ? 'bg-white/10 text-slate-200 border-white/10' : 'bg-slate-100 text-slate-700 border-slate-200'}`}>
                        <th className="p-4 font-semibold">Ano</th>
                        <th className="p-4 font-semibold">Dias Trabalho</th>
                        <th className="p-4 font-semibold">Faturamento</th>
                        <th className="p-4 font-semibold">Combustível</th>
                        <th className="p-4 font-semibold">Reservas (Total)</th>
                        <th className="p-4 font-semibold">Despesas Totais</th>
                        <th className="p-4 font-semibold">Saldo Líquido Anual</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(relatoriosAcumulados.porAno).map(([ano, dados]) => (
                        <tr key={ano} className={`border-b transition-colors ${modoEscuro ? 'border-white/5 hover:bg-white/5' : 'border-slate-100 hover:bg-slate-50'}`}>
                          <td className={`p-4 font-bold ${modoEscuro ? 'text-white/90' : 'text-slate-800'}`}>{ano}</td>
                          <td className={`p-4 ${modoEscuro ? 'text-white/70' : 'text-slate-600'}`}>{dados.diasTrabalho} dias</td>
                          <td className="p-4 text-emerald-400 font-bold">R$ {dados.fat.toFixed(2)}</td>
                          <td className={`p-4 ${modoEscuro ? 'text-white/70' : 'text-slate-600'}`}>R$ {dados.comb.toFixed(2)}</td>
                          <td className={`p-4 ${modoEscuro ? 'text-white/70' : 'text-slate-600'}`}>R$ {(dados.res1 + dados.res2 + dados.resAc).toFixed(2)}</td>
                          <td className="p-4 text-rose-400 font-medium">R$ {dados.desp.toFixed(2)}</td>
                          <td className={`p-4 font-bold ${dados.liq >= 0 ? (modoEscuro ? 'text-blue-400' : 'text-blue-500') : 'text-rose-400'}`}>
                            R$ {dados.liq.toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

          </div>
        )}

      </div>
    </main>
  );
}

export default function Home() {
  const [usuario, setUsuario] = useState<{ uid: string; email: string | null } | null>(null);
  const [carregando, setCarregando] = useState(true);
  useEffect(() => onAuthStateChanged(auth, (atual) => {
    setUsuario(atual && !atual.isAnonymous ? { uid: atual.uid, email: atual.email } : null);
    setCarregando(false);
  }), []);
  if (carregando) return <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center">Verificando acesso...</div>;
  if (!usuario) return <AuthGate />;
  return <Dashboard key={usuario.uid} uid={usuario.uid} usuarioEmail={usuario.email} />;
}
