'use client';

import { useState, useMemo } from 'react';

interface SaidaItem {
  id: string;
  nome: string;
  valor: number;
  origem: string; // 'principal' ou o ID/nome da caixinha
}

interface CustoFixoItem {
  id: string;
  nome: string;
  valorMensal: number;
  cor?: string;
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

export default function Home() {
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
  const [litros, setLitros] = useState<number>(0);
  const [valorCombustivel, setValorCombustivel] = useState<number>(0);
  const [kmTrabalhado, setKmTrabalhado] = useState<number>(0);
  const [kmTotal, setKmTotal] = useState<number>(0);

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

    const diasTrabalhoRegistrados = historico.filter(h => h.tipo === 'turno').length;
    const diasRestantes = Math.max(totalDiasUteisMes - diasTrabalhoRegistrados, 1);

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

  const totalReservasTurno = (Number(valReserva1) || 0) + (Number(valReserva2) || 0) + valReservaAcidente;

  const precoLitroMedio = litros > 0 ? valorCombustivel / litros : 0;
  const consumoKmL = litros > 0 ? kmTrabalhado / litros : 0;
  
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
        reservaFevereiro: Number(valReserva1) || 0,
        reservaInvestimento: Number(valReserva2) || 0,
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
        reservaFevereiro: Number(valReserva1) || 0,
        reservaInvestimento: Number(valReserva2) || 0,
        reservaAcidente: valReservaAcidente,
        custosFixosDia: totalCustoFixoDiario,
        detalheCustosFixosDia: detalheFixosSnapshot,
        saidas: [],
        totalDespesas: totalDespesasSalvar,
        liquido: liquidoSalvar,
      };
      setHistorico([novoLancamento, ...historico]);
    }

    setFaturamentoBruto(0);
    setValorCombustivel(0);
    setLitros(0);
    setKmTrabalhado(0);
    setKmTotal(0);
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
    setFaturamentoBruto(item.faturamentoBruto);
    setValorCombustivel(item.combustivel);
    setLitros(item.litros || 0);
    setKmTrabalhado(item.kmTrabalhado || 0);
    setKmTotal(item.kmTotal || 0);
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
      totalCombGeral += item.combustivel;
      totalKmTrabGeral += (item.kmTrabalhado || 0);
      totalKmTotalGeral += (item.kmTotal || 0);
      totalRes1Geral += (item.reservaFevereiro || 0);
      totalRes2Geral += (item.reservaInvestimento || 0);
      totalResAcidenteGeral += (item.reservaAcidente || 0);

      if (item.detalheCustosFixosDia) {
        Object.entries(item.detalheCustosFixosDia).forEach(([idCusto, val]) => {
          acumuladoCustosFixos[idCusto] = (acumuladoCustosFixos[idCusto] || 0) + Number(val);
        });
      }

      if (item.saidas) {
        item.saidas.forEach(s => {
          if (s.origem !== 'principal' && acumuladoCustosFixos[s.origem] !== undefined) {
            acumuladoCustosFixos[s.origem] -= Number(s.valor) || 0;
          }
        });
      }

      const partesData = item.data.split('/');
      if (partesData.length === 3) {
        const mesAnoKey = `${partesData[1]}/${partesData[2]}`;
        const anoKey = partesData[2];

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
    });

    const totalDiasTrabalho = historico.filter(h => h.tipo === 'turno').length;
    const historicoAvulso = historico.filter(h => h.tipo !== 'turno');

    return {
      totalFatGeral,
      totalDespGeral,
      totalLiqGeral,
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
    <main className={`min-h-screen p-6 md:p-8 transition-colors duration-200 ${modoEscuro ? 'bg-slate-900 text-slate-100' : 'bg-slate-100 text-slate-800'}`}>
      <div className="max-w-6xl mx-auto">
        
        {/* Cabeçalho */}
        <header className={`mb-6 flex flex-col md:flex-row justify-between items-center p-6 rounded-xl shadow-sm border gap-4 transition-colors ${modoEscuro ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}`}>
          <div>
            <h1 className={`text-2xl md:text-3xl font-bold ${modoEscuro ? 'text-white' : 'text-slate-800'}`}>
              Painel de Controle
            </h1>
            <p className={`text-sm mt-1 capitalize ${modoEscuro ? 'text-slate-400' : 'text-slate-500'}`}>
              📅 {infoDataAtual.dataCompleta} • Mês de referência: <strong className={modoEscuro ? 'text-slate-200' : 'text-slate-700'}>{infoDataAtual.mesAno}</strong>
            </p>
          </div>
          
          <div className="flex items-center gap-3">
            <button
              onClick={() => setModoEscuro(!modoEscuro)}
              className={`px-3 py-2 text-sm font-semibold rounded-lg border transition ${modoEscuro ? 'bg-slate-700 border-slate-600 text-amber-400 hover:bg-slate-600' : 'bg-slate-100 border-slate-200 text-slate-700 hover:bg-slate-200'}`}
              title="Alternar Modo Escuro"
            >
              {modoEscuro ? '☀️ Modo Claro' : '🌙 Modo Escuro'}
            </button>

            <div className={`flex p-1 rounded-xl border ${modoEscuro ? 'bg-slate-900 border-slate-700' : 'bg-slate-100 border-slate-200'}`}>
              <button
                onClick={() => setAbaAtiva('lancamento')}
                className={`px-4 py-2 text-sm font-semibold rounded-lg transition ${abaAtiva === 'lancamento' ? (modoEscuro ? 'bg-slate-800 text-blue-400 shadow-sm' : 'bg-white text-blue-600 shadow-sm') : (modoEscuro ? 'text-slate-400 hover:text-white' : 'text-slate-600 hover:text-slate-900')}`}
              >
                📝 Lançamento Diário
              </button>
              <button
                onClick={() => setAbaAtiva('relatorios')}
                className={`px-4 py-2 text-sm font-semibold rounded-lg transition ${abaAtiva === 'relatorios' ? (modoEscuro ? 'bg-slate-800 text-blue-400 shadow-sm' : 'bg-white text-blue-600 shadow-sm') : (modoEscuro ? 'text-slate-400 hover:text-white' : 'text-slate-600 hover:text-slate-900')}`}
              >
                📊 Relatórios & Acumulados
              </button>
            </div>
          </div>
        </header>

        {/* ABA LANÇAMENTO DIÁRIO */}
        {abaAtiva === 'lancamento' && (
          <>
            {/* CUSTOS FIXOS DINÂMICOS / CAIXINHAS COM COR */}
            <div className={`mb-8 p-5 rounded-xl shadow-sm border transition-colors ${modoEscuro ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}`}>
              <div className="flex justify-between items-center mb-4">
                <h2 className={`text-sm font-bold flex items-center gap-2 ${modoEscuro ? 'text-slate-200' : 'text-slate-700'}`}>
                  ⚙️ Custos Fixos Mensais e Caixinhas Personalizadas (Valores e Cores)
                </h2>
                <button 
                  type="button"
                  onClick={handleAdicionarCustoFixo}
                  className="text-xs bg-blue-600 hover:bg-blue-500 text-white font-semibold px-3 py-1.5 rounded-lg transition"
                >
                  ＋ Adicionar Custo / Caixa
                </button>
              </div>

              {custosFixos.length === 0 ? (
                <p className="text-xs text-slate-500 italic py-2">Nenhum custo fixo registado. Adicione acima.</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {custosFixos.map((c) => (
                    <div 
                      key={c.id} 
                      className={`p-3 rounded-lg border relative transition-colors ${modoEscuro ? 'bg-slate-900/50 border-slate-700' : 'bg-slate-50 border-slate-200'}`}
                      style={{ borderLeftWidth: '5px', borderLeftColor: c.cor || '#3b82f6' }}
                    >
                      <div className="flex justify-between items-center mb-2 gap-2">
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
                          className={`text-xs font-medium px-2 py-1 rounded border flex-1 transition ${modoEscuro ? 'bg-slate-800 border-slate-700 text-slate-200' : 'bg-white border-slate-300 text-slate-700'}`}
                          placeholder="Nome do custo ou projeto..."
                        />
                        <button 
                          type="button"
                          onClick={() => handleRemoverCustoFixo(c.id)}
                          className="text-rose-400 font-bold text-sm px-1 hover:text-rose-600"
                          title="Remover custo"
                        >
                          ✕
                        </button>
                      </div>
                      <div>
                        <label className={`block text-[10px] font-medium mb-0.5 ${modoEscuro ? 'text-slate-400' : 'text-slate-500'}`}>Valor Mensal (R$)</label>
                        <input 
                          type="number" 
                          value={c.valorMensal || ''} 
                          onChange={(e) => handleAtualizarCustoFixo(c.id, 'valorMensal', parseFloat(e.target.value) || 0)}
                          className={`w-full px-3 py-1.5 text-sm border rounded-lg font-semibold transition ${modoEscuro ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-slate-300 text-slate-800'}`}
                          placeholder="0.00"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* PAINEL DE LANÇAMENTOS AVULSOS */}
            <div className={`mb-8 p-5 rounded-xl shadow-sm border transition-colors ${modoEscuro ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}`}>
              <h2 className={`text-sm font-bold mb-3 flex items-center gap-2 ${modoEscuro ? 'text-slate-200' : 'text-slate-700'}`}>
                ⚡ Lançamento Avulso Rápido (Entrada ou Saída fora do Turno)
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-5 gap-3 items-end">
                <div>
                  <label className={`block text-xs font-medium mb-1 ${modoEscuro ? 'text-slate-400' : 'text-slate-600'}`}>Tipo</label>
                  <select
                    value={tipoAvulso}
                    onChange={(e) => setTipoAvulso(e.target.value as 'saida' | 'entrada')}
                    className={`w-full px-3 py-2 text-sm border rounded-lg font-medium transition ${modoEscuro ? 'bg-slate-900 border-slate-700 text-white' : 'bg-slate-50 border-slate-300 text-slate-800'}`}
                  >
                    <option value="saida">📤 Saída / Despesa</option>
                    <option value="entrada">📥 Entrada Extra</option>
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className={`block text-xs font-medium mb-1 ${modoEscuro ? 'text-slate-400' : 'text-slate-600'}`}>Descrição</label>
                  <input 
                    type="text" 
                    value={nomeAvulso} 
                    onChange={(e) => setNomeAvulso(e.target.value)}
                    placeholder={tipoAvulso === 'saida' ? 'Ex: Compra de violão, peça...' : 'Ex: Venda extra, bônus...'} 
                    className={`w-full px-3 py-2 text-sm border rounded-lg transition ${modoEscuro ? 'bg-slate-900 border-slate-700 text-white' : 'bg-slate-50 border-slate-300 text-slate-800'}`}
                  />
                </div>
                <div>
                  <label className={`block text-xs font-medium mb-1 ${modoEscuro ? 'text-slate-400' : 'text-slate-600'}`}>Valor (R$)</label>
                  <input 
                    type="number" 
                    value={valorAvulso || ''} 
                    onChange={(e) => setValorAvulso(parseFloat(e.target.value) || 0)}
                    placeholder="0.00" 
                    className={`w-full px-3 py-2 text-sm border rounded-lg font-semibold transition ${modoEscuro ? 'bg-slate-900 border-slate-700 text-white' : 'bg-slate-50 border-slate-300 text-slate-800'}`}
                  />
                </div>
                <div>
                  {tipoAvulso === 'saida' ? (
                    <div className="space-y-1">
                      <label className={`block text-[10px] font-medium ${modoEscuro ? 'text-slate-400' : 'text-slate-600'}`}>Retirar de:</label>
                      <select
                        value={origemAvulsa}
                        onChange={(e) => setOrigemAvulsa(e.target.value)}
                        className={`w-full px-2 py-2 text-xs border rounded-lg transition ${modoEscuro ? 'bg-slate-900 border-slate-700 text-white' : 'bg-slate-50 border-slate-300 text-slate-800'}`}
                      >
                        <option value="principal">Saldo Principal</option>
                        {custosFixos.map(cf => (
                          <option key={cf.id} value={cf.id}>Caixinha: {cf.nome || 'Sem nome'}</option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <span className="block text-[10px] text-emerald-500 font-semibold mb-2">Vai para o Saldo Principal</span>
                  )}
                  <button 
                    onClick={handleRegistarAvulso}
                    className={`w-full mt-1 py-2 text-xs font-semibold rounded-lg text-white transition ${tipoAvulso === 'saida' ? 'bg-rose-600 hover:bg-rose-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}
                  >
                    Registar {tipoAvulso === 'saida' ? 'Saída' : 'Entrada'}
                  </button>
                </div>
              </div>
            </div>

            {idEditando && (
              <div className="mb-6 bg-amber-500/10 border border-amber-500/30 p-4 rounded-xl flex justify-between items-center text-amber-400">
                <span>⚠️ A editar um registo existente do histórico. Altere os dados em cima e clique em Atualizar.</span>
                <button 
                  onClick={() => { 
                    setIdEditando(null); 
                    setFaturamentoBruto(0); 
                    setValorCombustivel(0); 
                    setLitros(0); 
                    setKmTrabalhado(0); 
                    setKmTotal(0); 
                    setValReserva1(0);
                    setValReserva2(0);
                  }}
                  className="text-xs bg-amber-500/20 hover:bg-amber-500/30 px-3 py-1 rounded font-semibold transition text-amber-300"
                >
                  Cancelar Edição
                </button>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              <div className={`p-6 rounded-xl shadow-sm border transition-colors ${modoEscuro ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}`}>
                <h3 className={`text-sm font-medium ${modoEscuro ? 'text-slate-400' : 'text-slate-500'}`}>Faturamento Bruto (Turno)</h3>
                <p className="text-2xl font-bold text-emerald-500 mt-2">R$ {faturamentoBruto.toFixed(2)}</p>
              </div>
              <div className={`p-6 rounded-xl shadow-sm border transition-colors ${modoEscuro ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}`}>
                <h3 className={`text-sm font-medium ${modoEscuro ? 'text-slate-400' : 'text-slate-500'}`}>Despesas Totais (Turno)</h3>
                <p className="text-2xl font-bold text-rose-500 mt-2">R$ {totalDespesasDia.toFixed(2)}</p>
              </div>
              <div className={`p-6 rounded-xl shadow-sm border transition-colors ${modoEscuro ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}`}>
                <h3 className={`text-sm font-medium ${modoEscuro ? 'text-slate-400' : 'text-slate-500'}`}>Total Líquido (Turno)</h3>
                <p className={`text-2xl font-bold mt-2 ${saldoLiquidoDia >= 0 ? 'text-blue-500' : 'text-rose-500'}`}>
                  R$ {saldoLiquidoDia.toFixed(2)}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
              <div className={`p-6 rounded-xl shadow-sm border transition-colors ${modoEscuro ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}`}>
                <h2 className={`text-lg font-semibold mb-4 ${modoEscuro ? 'text-white' : 'text-slate-800'}`}>
                  {idEditando ? '✏️ Editar Registo Selecionado' : 'Registo do Turno / Dia'}
                </h2>
                
                <div className="space-y-4">
                  <div>
                    <label className={`block text-sm font-medium mb-1 ${modoEscuro ? 'text-slate-300' : 'text-slate-700'}`}>Faturamento Bruto (R$)</label>
                    <input 
                      type="number" 
                      value={faturamentoBruto || ''} 
                      onChange={(e) => setFaturamentoBruto(parseFloat(e.target.value) || 0)}
                      className={`w-full px-3 py-2 border rounded-lg transition ${modoEscuro ? 'bg-slate-900 border-slate-700 text-white' : 'border-slate-300 text-slate-800'}`}
                      placeholder="0.00"
                    />
                  </div>

                  <div className={`p-4 rounded-lg border space-y-3 transition-colors ${modoEscuro ? 'bg-slate-900/50 border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
                    <h3 className={`text-sm font-semibold ${modoEscuro ? 'text-slate-200' : 'text-slate-700'}`}>Abastecimento & Combustível</h3>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={`block text-xs font-medium mb-1 ${modoEscuro ? 'text-slate-400' : 'text-slate-600'}`}>Valor Gasto (R$)</label>
                        <input 
                          type="number" 
                          value={valorCombustivel || ''} 
                          onChange={(e) => setValorCombustivel(parseFloat(e.target.value) || 0)}
                          className={`w-full px-3 py-2 text-sm border rounded-lg transition ${modoEscuro ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-300 text-slate-800'}`}
                          placeholder="0.00"
                        />
                      </div>
                      <div>
                        <label className={`block text-xs font-medium mb-1 ${modoEscuro ? 'text-slate-400' : 'text-slate-600'}`}>Litros</label>
                        <input 
                          type="number" 
                          value={litros || ''} 
                          onChange={(e) => setLitros(parseFloat(e.target.value) || 0)}
                          className={`w-full px-3 py-2 text-sm border rounded-lg transition ${modoEscuro ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-300 text-slate-800'}`}
                          placeholder="0.00"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={`block text-xs font-medium mb-1 ${modoEscuro ? 'text-slate-400' : 'text-slate-600'}`}>KM Trabalhado (Líquido)</label>
                        <input 
                          type="number" 
                          value={kmTrabalhado || ''} 
                          onChange={(e) => setKmTrabalhado(parseFloat(e.target.value) || 0)}
                          className={`w-full px-3 py-2 text-sm border rounded-lg transition ${modoEscuro ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-300 text-slate-800'}`}
                          placeholder="Ex: 150"
                        />
                      </div>
                      <div>
                        <label className={`block text-xs font-medium mb-1 ${modoEscuro ? 'text-slate-400' : 'text-slate-600'}`}>KM Total do Carro</label>
                        <input 
                          type="number" 
                          value={kmTotal || ''} 
                          onChange={(e) => setKmTotal(parseFloat(e.target.value) || 0)}
                          className={`w-full px-3 py-2 text-sm border rounded-lg transition ${modoEscuro ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-300 text-slate-800'}`}
                          placeholder="Ex: 180"
                        />
                      </div>
                    </div>
                    <div className={`text-xs pt-2 border-t flex justify-between ${modoEscuro ? 'border-slate-700 text-slate-400' : 'border-slate-200 text-slate-600'}`}>
                      <span>Preço Médio: <strong className={modoEscuro ? 'text-white' : 'text-slate-800'}>R$ {precoLitroMedio.toFixed(2)}/L</strong></span>
                      <span>Consumo: <strong className={modoEscuro ? 'text-white' : 'text-slate-800'}>{consumoKmL.toFixed(2)} Km/L</strong></span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <input 
                        type="text" 
                        value={nomeReserva1} 
                        onChange={(e) => setNomeReserva1(e.target.value)}
                        className={`text-xs font-medium px-2 py-1 rounded w-full mb-1 border transition ${modoEscuro ? 'bg-slate-900 border-slate-700 text-slate-300' : 'bg-slate-100 border-slate-200 text-slate-600'}`}
                      />
                      <input 
                        type="number" 
                        value={valReserva1 || ''} 
                        onChange={(e) => setValReserva1(parseFloat(e.target.value) || 0)}
                        className={`w-full px-3 py-2 text-sm border rounded-lg transition ${modoEscuro ? 'bg-slate-900 border-slate-700 text-white' : 'border-slate-300 text-slate-800'}`}
                        placeholder="0.00"
                      />
                    </div>
                    <div>
                      <input 
                        type="text" 
                        value={nomeReserva2} 
                        onChange={(e) => setNomeReserva2(e.target.value)}
                        className={`text-xs font-medium px-2 py-1 rounded w-full mb-1 border transition ${modoEscuro ? 'bg-slate-900 border-slate-700 text-slate-300' : 'bg-slate-100 border-slate-200 text-slate-600'}`}
                      />
                      <input 
                        type="number" 
                        value={valReserva2 || ''} 
                        onChange={(e) => setValReserva2(parseFloat(e.target.value) || 0)}
                        className={`w-full px-3 py-2 text-sm border rounded-lg transition ${modoEscuro ? 'bg-slate-900 border-slate-700 text-white' : 'border-slate-300 text-slate-800'}`}
                        placeholder="0.00"
                      />
                    </div>
                    <div>
                      <input 
                        type="text" 
                        value={nomeReserva3} 
                        onChange={(e) => setNomeReserva3(e.target.value)}
                        className={`text-xs font-medium px-2 py-1 rounded w-full mb-1 border transition ${modoEscuro ? 'bg-slate-900 border-slate-700 text-slate-300' : 'bg-slate-100 border-slate-200 text-slate-600'}`}
                      />
                      <div className={`w-full px-3 py-2 text-sm border rounded-lg font-semibold flex items-center h-[38px] transition ${modoEscuro ? 'bg-slate-900 border-slate-700 text-slate-200' : 'bg-slate-100 border-slate-200 text-slate-700'}`}>
                        R$ {valReservaAcidente.toFixed(2)}
                      </div>
                      <span className="text-[10px] text-slate-400 block mt-0.5">Auto: R$ 0,038 x KM Total</span>
                    </div>
                  </div>

                  <button 
                    onClick={handleSalvarDia}
                    className={`w-full font-semibold py-3 rounded-lg transition text-white ${idEditando ? 'bg-amber-600 hover:bg-amber-700' : 'bg-blue-600 hover:bg-blue-700'}`}
                  >
                    {idEditando ? '🔄 Atualizar Registo' : '💾 Registar e Salvar Dia de Trabalho'}
                  </button>
                </div>
              </div>

              <div className="space-y-6">
                <div className={`p-6 rounded-xl shadow-sm border transition-colors ${modoEscuro ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}`}>
                  <h2 className={`text-lg font-semibold mb-2 ${modoEscuro ? 'text-white' : 'text-slate-800'}`}>Detalhamento dos Custos (Rateio Diário)</h2>
                  <p className={`text-xs mb-4 ${modoEscuro ? 'text-slate-400' : 'text-slate-500'}`}>
                    {temMovimentoNoTurno ? `Calculado com base em ${diasUteisMes} dias restantes.` : 'Insira dados no turno para exibir o rateio.'}
                  </p>
                  
                  <div className={`space-y-3 text-sm ${modoEscuro ? 'divide-slate-700' : 'divide-slate-100'}`}>
                    <div className={`flex justify-between py-2 border-b ${modoEscuro ? 'border-slate-700' : 'border-slate-100'}`}>
                      <span className={modoEscuro ? 'text-slate-400' : 'text-slate-600'}>Combustível:</span>
                      <span className={`font-semibold ${modoEscuro ? 'text-slate-200' : 'text-slate-800'}`}>R$ {valorCombustivel.toFixed(2)}</span>
                    </div>
                    <div className={`flex justify-between py-2 border-b ${modoEscuro ? 'border-slate-700' : 'border-slate-100'}`}>
                      <span className={modoEscuro ? 'text-slate-400' : 'text-slate-600'}>{nomeReserva1}:</span>
                      <span className={`font-semibold ${modoEscuro ? 'text-slate-200' : 'text-slate-800'}`}>R$ {(Number(valReserva1) || 0).toFixed(2)}</span>
                    </div>
                    <div className={`flex justify-between py-2 border-b ${modoEscuro ? 'border-slate-700' : 'border-slate-100'}`}>
                      <span className={modoEscuro ? 'text-slate-400' : 'text-slate-600'}>{nomeReserva2}:</span>
                      <span className={`font-semibold ${modoEscuro ? 'text-slate-200' : 'text-slate-800'}`}>R$ {(Number(valReserva2) || 0).toFixed(2)}</span>
                    </div>
                    <div className={`flex justify-between py-2 border-b ${modoEscuro ? 'border-slate-700' : 'border-slate-100'}`}>
                      <span className={modoEscuro ? 'text-slate-400' : 'text-slate-600'}>{nomeReserva3} (R$ 0,038/KM):</span>
                      <span className={`font-semibold ${modoEscuro ? 'text-slate-200' : 'text-slate-800'}`}>R$ {valReservaAcidente.toFixed(2)}</span>
                    </div>

                    {custosFixos.map((c) => {
                      const valorDiarioItem = custoFixoDiarioPorItem[c.id] || 0;
                      return (
                        <div key={c.id} className={`flex justify-between py-2 border-b ${modoEscuro ? 'border-slate-700' : 'border-slate-100'}`}>
                          <span className={modoEscuro ? 'text-slate-400' : 'text-slate-600'}>{c.nome || 'Custo sem nome'} (Rateio):</span>
                          <span className={`font-semibold ${modoEscuro ? 'text-slate-200' : 'text-slate-800'}`}>R$ {valorDiarioItem.toFixed(2)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className={`p-6 rounded-xl shadow-sm border transition-colors ${modoEscuro ? 'bg-slate-800 border-slate-700' : 'bg-amber-50 border-amber-200'}`}>
                  <h3 className={`font-semibold mb-2 flex items-center gap-2 ${modoEscuro ? 'text-amber-400' : 'text-amber-900'}`}>
                    📝 Bloco de Lembretes do Dia
                  </h3>
                  <textarea 
                    value={lembrete}
                    onChange={(e) => setLembrete(e.target.value)}
                    placeholder="Ex: Trocar óleo com 68.000 km..."
                    className={`w-full h-24 p-3 text-sm border rounded-lg focus:outline-none resize-none transition ${modoEscuro ? 'bg-slate-900 border-slate-700 text-white placeholder-slate-500' : 'bg-white border-amber-200 text-slate-800'}`}
                  />
                </div>
              </div>
            </div>

            <div className={`p-6 rounded-xl shadow-sm border transition-colors ${modoEscuro ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}`}>
              <h2 className={`text-lg font-semibold mb-2 ${modoEscuro ? 'text-white' : 'text-slate-800'}`}>Histórico de Lançamentos Recentes</h2>
              <p className={`text-xs mb-4 ${modoEscuro ? 'text-slate-400' : 'text-slate-500'}`}>💡 Clique em qualquer linha de turno para carregar os dados de volta para edição.</p>
              
              {historico.length === 0 ? (
                <p className={`text-sm py-4 text-center ${modoEscuro ? 'text-slate-400' : 'text-slate-500'}`}>Nenhum registo efetuado ainda.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead>
                      <tr className={`border-b transition-colors ${modoEscuro ? 'bg-slate-900 text-slate-300 border-slate-700' : 'bg-slate-100 text-slate-700 border-slate-200'}`}>
                        <th className="p-3">Data</th>
                        <th className="p-3">Tipo / Dia</th>
                        <th className="p-3">Faturamento</th>
                        <th className="p-3">Combustível</th>
                        <th className="p-3">{nomeReserva1}</th>
                        <th className="p-3">{nomeReserva2}</th>
                        <th className="p-3">{nomeReserva3}</th>
                        <th className="p-3">Total Líquido</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historico.map((item) => (
                        <tr 
                          key={item.id} 
                          onClick={() => item.tipo === 'turno' && handleCarregarParaEdicao(item)}
                          className={`border-b transition-colors ${item.tipo === 'turno' ? (modoEscuro ? 'border-slate-700 hover:bg-slate-700/50 cursor-pointer' : 'border-slate-100 hover:bg-blue-50 cursor-pointer') : (modoEscuro ? 'border-slate-700 bg-slate-800/40' : 'border-slate-100 bg-slate-50/50')} ${item.tipo !== 'turno' ? 'opacity-85' : ''}`}
                        >
                          <td className={`p-3 font-medium ${modoEscuro ? 'text-slate-200' : 'text-slate-700'}`}>{item.data}</td>
                          <td className={`p-3 capitalize ${modoEscuro ? 'text-slate-400' : 'text-slate-600'}`}>
                            {item.tipo === 'turno' ? (
                              item.diaSemana
                            ) : item.tipo === 'avulso_entrada' ? (
                              <span className="text-emerald-400 font-semibold text-xs">📥 Entrada Avulsa</span>
                            ) : (
                              <span className="text-rose-400 font-semibold text-xs">📤 Saída Avulsa</span>
                            )}
                          </td>
                          <td className="p-3 text-emerald-500 font-semibold">R$ {item.faturamentoBruto.toFixed(2)}</td>
                          <td className={`p-3 ${modoEscuro ? 'text-slate-400' : 'text-slate-600'}`}>R$ {item.combustivel.toFixed(2)}</td>
                          <td className={`p-3 ${modoEscuro ? 'text-slate-400' : 'text-slate-600'}`}>R$ {item.reservaFevereiro.toFixed(2)}</td>
                          <td className={`p-3 ${modoEscuro ? 'text-slate-400' : 'text-slate-600'}`}>R$ {item.reservaInvestimento.toFixed(2)}</td>
                          <td className={`p-3 ${modoEscuro ? 'text-slate-400' : 'text-slate-600'}`}>R$ {item.reservaAcidente.toFixed(2)}</td>
                          <td className={`p-3 font-bold ${item.liquido >= 0 ? 'text-blue-500' : 'text-rose-500'}`}>
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
            
            <div className={`p-6 rounded-xl shadow-sm border transition-colors ${modoEscuro ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}`}>
              <h2 className={`text-xl font-bold mb-1 ${modoEscuro ? 'text-white' : 'text-slate-800'}`}>📈 Desempenho Consolidado</h2>
              <p className={`text-xs mb-6 ${modoEscuro ? 'text-slate-400' : 'text-slate-500'}`}>Balanço total acumulado de todos os registos.</p>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                <div className={`p-5 rounded-xl border transition-colors ${modoEscuro ? 'bg-slate-900 border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
                  <span className={`text-xs font-medium block ${modoEscuro ? 'text-slate-400' : 'text-slate-500'}`}>Faturamento Bruto Acumulado</span>
                  <span className="text-2xl font-bold text-emerald-500 mt-2 block">R$ {relatoriosAcumulados.totalFatGeral.toFixed(2)}</span>
                </div>
                <div className={`p-5 rounded-xl border transition-colors ${modoEscuro ? 'bg-slate-900 border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
                  <span className={`text-xs font-medium block ${modoEscuro ? 'text-slate-400' : 'text-slate-500'}`}>Despesas Totais Acumuladas</span>
                  <span className="text-2xl font-bold text-rose-500 mt-2 block">R$ {relatoriosAcumulados.totalDespGeral.toFixed(2)}</span>
                </div>
                <div className={`p-5 rounded-xl border transition-colors ${modoEscuro ? 'bg-slate-900 border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
                  <span className={`text-xs font-medium block ${modoEscuro ? 'text-slate-400' : 'text-slate-500'}`}>Resultado Líquido Geral</span>
                  <span className={`text-2xl font-bold mt-2 block ${relatoriosAcumulados.totalLiqGeral >= 0 ? 'text-blue-500' : 'text-rose-500'}`}>
                    R$ {relatoriosAcumulados.totalLiqGeral.toFixed(2)}
                  </span>
                </div>
              </div>

              {/* DETALHAMENTO DISCRIMINADO: CAIXINHAS */}
              <div className="mb-6">
                <h3 className={`text-sm font-bold mb-3 ${modoEscuro ? 'text-slate-200' : 'text-slate-700'}`}>🔍 Discriminação de Gastos, Reservas e Caixinhas Acumuladas</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 text-sm">
                  
                  <div className={`p-3 rounded-lg border transition-colors ${modoEscuro ? 'bg-slate-900 border-slate-700' : 'bg-slate-50 border-slate-200'}`} style={{ borderLeftWidth: '5px', borderLeftColor: '#f97316' }}>
                    <span className={`text-[11px] block ${modoEscuro ? 'text-slate-400' : 'text-slate-500'}`}>Combustível</span>
                    <strong className={`text-xs ${modoEscuro ? 'text-slate-200' : 'text-slate-800'}`}>R$ {relatoriosAcumulados.totalCombGeral.toFixed(2)}</strong>
                  </div>

                  <div className={`p-3 rounded-lg border transition-colors ${modoEscuro ? 'bg-slate-900 border-slate-700' : 'bg-slate-50 border-slate-200'}`} style={{ borderLeftWidth: '5px', borderLeftColor: '#06b6d4' }}>
                    <span className={`text-[11px] block ${modoEscuro ? 'text-slate-400' : 'text-slate-500'}`}>{nomeReserva1}</span>
                    <strong className={`text-xs ${modoEscuro ? 'text-slate-200' : 'text-slate-800'}`}>R$ {relatoriosAcumulados.totalRes1Geral.toFixed(2)}</strong>
                  </div>

                  <div className={`p-3 rounded-lg border transition-colors ${modoEscuro ? 'bg-slate-900 border-slate-700' : 'bg-slate-50 border-slate-200'}`} style={{ borderLeftWidth: '5px', borderLeftColor: '#84cc16' }}>
                    <span className={`text-[11px] block ${modoEscuro ? 'text-slate-400' : 'text-slate-500'}`}>{nomeReserva2}</span>
                    <strong className={`text-xs ${modoEscuro ? 'text-slate-200' : 'text-slate-800'}`}>R$ {relatoriosAcumulados.totalRes2Geral.toFixed(2)}</strong>
                  </div>

                  <div className={`p-3 rounded-lg border transition-colors ${modoEscuro ? 'bg-slate-900 border-slate-700' : 'bg-slate-50 border-slate-200'}`} style={{ borderLeftWidth: '5px', borderLeftColor: '#ef4444' }}>
                    <span className={`text-[11px] block ${modoEscuro ? 'text-slate-400' : 'text-slate-500'}`}>{nomeReserva3}</span>
                    <strong className={`text-xs ${modoEscuro ? 'text-slate-200' : 'text-slate-800'}`}>R$ {relatoriosAcumulados.totalResAcidenteGeral.toFixed(2)}</strong>
                  </div>

                  {custosFixos.map((c) => {
                    const valorAcumuladoItem = relatoriosAcumulados.acumuladoCustosFixos[c.id] || 0;
                    return (
                      <div 
                        key={c.id} 
                        className={`p-3 rounded-lg border transition-colors ${modoEscuro ? 'bg-slate-900 border-slate-700' : 'bg-slate-50 border-slate-200'}`}
                        style={{ borderLeftWidth: '5px', borderLeftColor: c.cor || '#3b82f6' }}
                      >
                        <span className={`text-[11px] block truncate ${modoEscuro ? 'text-slate-400' : 'text-slate-500'}`}>{c.nome || 'Custo'} (Acumulado)</span>
                        <strong className={`text-xs ${modoEscuro ? 'text-slate-200' : 'text-slate-800'}`}>R$ {valorAcumuladoItem.toFixed(2)}</strong>
                      </div>
                    );
                  })}

                </div>
              </div>

              <div className={`grid grid-cols-2 md:grid-cols-4 gap-4 text-sm p-4 rounded-xl border transition-colors ${modoEscuro ? 'bg-slate-900 border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
                <div>
                  <span className={`text-xs block ${modoEscuro ? 'text-slate-400' : 'text-slate-500'}`}>KM Trabalhado:</span>
                  <strong className={modoEscuro ? 'text-slate-200' : 'text-slate-800'}>{relatoriosAcumulados.totalKmTrabGeral.toFixed(0)} km</strong>
                </div>
                <div>
                  <span className={`text-xs block ${modoEscuro ? 'text-slate-400' : 'text-slate-500'}`}>KM Total Rodado:</span>
                  <strong className={modoEscuro ? 'text-slate-200' : 'text-slate-800'}>{relatoriosAcumulados.totalKmTotalGeral.toFixed(0)} km</strong>
                </div>
                <div>
                  <span className={`text-xs block ${modoEscuro ? 'text-slate-400' : 'text-slate-500'}`}>Média Líquida / Dia Trabalho:</span>
                  <strong className={modoEscuro ? 'text-slate-200' : 'text-slate-800'}>
                    R$ {relatoriosAcumulados.totalDiasTrabalho > 0 ? (relatoriosAcumulados.totalLiqGeral / relatoriosAcumulados.totalDiasTrabalho).toFixed(2) : '0.00'}
                  </strong>
                </div>
                <div>
                  <span className={`text-xs block ${modoEscuro ? 'text-slate-400' : 'text-slate-500'}`}>Dias de Trabalho:</span>
                  <strong className={modoEscuro ? 'text-slate-200' : 'text-slate-800'}>{relatoriosAcumulados.totalDiasTrabalho} dias</strong>
                </div>
              </div>
            </div>

            {/* HISTÓRICO DE LANÇAMENTOS AVULSOS */}
            <div className={`p-6 rounded-xl shadow-sm border transition-colors ${modoEscuro ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}`}>
              <h3 className={`text-lg font-semibold mb-4 ${modoEscuro ? 'text-white' : 'text-slate-800'}`}>⚡ Histórico de Movimentações Avulsas (Entradas e Saídas)</h3>
              {relatoriosAcumulados.historicoAvulso.length === 0 ? (
                <p className={`text-sm py-4 text-center ${modoEscuro ? 'text-slate-400' : 'text-slate-500'}`}>Nenhuma movimentação avulsa registada ainda.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead>
                      <tr className={`border-b transition-colors ${modoEscuro ? 'bg-slate-900 text-slate-300 border-slate-700' : 'bg-slate-100 text-slate-700 border-slate-200'}`}>
                        <th className="p-3">Data</th>
                        <th className="p-3">Tipo</th>
                        <th className="p-3">Descrição</th>
                        <th className="p-3">Origem / Destino</th>
                        <th className="p-3">Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {relatoriosAcumulados.historicoAvulso.map((item) => {
                        const isEntrada = item.tipo === 'avulso_entrada';
                        const saidaDetalhe = item.saidas[0];
                        const cOrigem = saidaDetalhe ? custosFixos.find(cf => cf.id === saidaDetalhe.origem) : null;
                        const nomeOrigemDestino = isEntrada ? 'Saldo Principal' : (saidaDetalhe?.origem === 'principal' ? 'Saldo Principal' : (cOrigem?.nome || 'Caixinha'));

                        return (
                          <tr key={item.id} className={`border-b transition-colors ${modoEscuro ? 'border-slate-700 hover:bg-slate-700/50' : 'border-slate-100 hover:bg-slate-50'}`}>
                            <td className={`p-3 font-medium ${modoEscuro ? 'text-slate-200' : 'text-slate-800'}`}>{item.data}</td>
                            <td className="p-3">
                              {isEntrada ? (
                                <span className="px-2 py-0.5 rounded text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">📥 Entrada Extra</span>
                              ) : (
                                <span className="px-2 py-0.5 rounded text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/30">📤 Saída Avulsa</span>
                              )}
                            </td>
                            <td className={`p-3 ${modoEscuro ? 'text-slate-300' : 'text-slate-700'}`}>
                              {isEntrada ? 'Entrada de Dinheiro Extra' : (saidaDetalhe?.nome || 'Despesa Avulsa')}
                            </td>
                            <td className={`p-3 text-xs ${modoEscuro ? 'text-slate-400' : 'text-slate-600'}`}>{nomeOrigemDestino}</td>
                            <td className={`p-3 font-bold ${isEntrada ? 'text-emerald-500' : 'text-rose-500'}`}>
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
            <div className={`p-6 rounded-xl shadow-sm border transition-colors ${modoEscuro ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}`}>
              <h3 className={`text-lg font-semibold mb-4 ${modoEscuro ? 'text-white' : 'text-slate-800'}`}>📅 Acumulado por Mês</h3>
              {Object.keys(relatoriosAcumulados.porMes).length === 0 ? (
                <p className={`text-sm py-4 text-center ${modoEscuro ? 'text-slate-400' : 'text-slate-500'}`}>Nenhum dado mensal registado ainda.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead>
                      <tr className={`border-b transition-colors ${modoEscuro ? 'bg-slate-900 text-slate-300 border-slate-700' : 'bg-slate-100 text-slate-700 border-slate-200'}`}>
                        <th className="p-3">Mês/Ano</th>
                        <th className="p-3">Dias Trabalho</th>
                        <th className="p-3">Faturamento</th>
                        <th className="p-3">Combustível</th>
                        <th className="p-3">Reservas (Total)</th>
                        <th className="p-3">Despesas Totais</th>
                        <th className="p-3">Saldo Líquido</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(relatoriosAcumulados.porMes).map(([mesAno, dados]) => (
                        <tr key={mesAno} className={`border-b transition-colors ${modoEscuro ? 'border-slate-700 hover:bg-slate-700/50' : 'border-slate-100 hover:bg-slate-50'}`}>
                          <td className={`p-3 font-semibold ${modoEscuro ? 'text-slate-200' : 'text-slate-800'}`}>{mesAno}</td>
                          <td className={`p-3 ${modoEscuro ? 'text-slate-400' : 'text-slate-600'}`}>{dados.diasTrabalho} dias</td>
                          <td className="p-3 text-emerald-500 font-semibold">R$ {dados.fat.toFixed(2)}</td>
                          <td className={`p-3 ${modoEscuro ? 'text-slate-400' : 'text-slate-600'}`}>R$ {dados.comb.toFixed(2)}</td>
                          <td className={`p-3 ${modoEscuro ? 'text-slate-400' : 'text-slate-600'}`}>R$ {(dados.res1 + dados.res2 + dados.resAc).toFixed(2)}</td>
                          <td className="p-3 text-rose-500">R$ {dados.desp.toFixed(2)}</td>
                          <td className={`p-3 font-bold ${dados.liq >= 0 ? 'text-blue-500' : 'text-rose-500'}`}>
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
            <div className={`p-6 rounded-xl shadow-sm border transition-colors ${modoEscuro ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}`}>
              <h3 className={`text-lg font-semibold mb-4 ${modoEscuro ? 'text-white' : 'text-slate-800'}`}>🏆 Acumulado por Ano</h3>
              {Object.keys(relatoriosAcumulados.porAno).length === 0 ? (
                <p className={`text-sm py-4 text-center ${modoEscuro ? 'text-slate-400' : 'text-slate-500'}`}>Nenhum dado anual registado ainda.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead>
                      <tr className={`border-b transition-colors ${modoEscuro ? 'bg-slate-900 text-slate-300 border-slate-700' : 'bg-slate-100 text-slate-700 border-slate-200'}`}>
                        <th className="p-3">Ano</th>
                        <th className="p-3">Dias Trabalho</th>
                        <th className="p-3">Faturamento</th>
                        <th className="p-3">Combustível</th>
                        <th className="p-3">Reservas (Total)</th>
                        <th className="p-3">Despesas Totais</th>
                        <th className="p-3">Saldo Líquido Anual</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(relatoriosAcumulados.porAno).map(([ano, dados]) => (
                        <tr key={ano} className={`border-b transition-colors ${modoEscuro ? 'border-slate-700 hover:bg-slate-700/50' : 'border-slate-100 hover:bg-slate-50'}`}>
                          <td className={`p-3 font-semibold ${modoEscuro ? 'text-slate-200' : 'text-slate-800'}`}>{ano}</td>
                          <td className={`p-3 ${modoEscuro ? 'text-slate-400' : 'text-slate-600'}`}>{dados.diasTrabalho} dias</td>
                          <td className="p-3 text-emerald-500 font-semibold">R$ {dados.fat.toFixed(2)}</td>
                          <td className={`p-3 ${modoEscuro ? 'text-slate-400' : 'text-slate-600'}`}>R$ {dados.comb.toFixed(2)}</td>
                          <td className={`p-3 ${modoEscuro ? 'text-slate-400' : 'text-slate-600'}`}>R$ {(dados.res1 + dados.res2 + dados.resAc).toFixed(2)}</td>
                          <td className="p-3 text-rose-500">R$ {dados.desp.toFixed(2)}</td>
                          <td className={`p-3 ${modoEscuro ? 'text-blue-500 font-bold' : 'text-rose-500 font-bold'}`}>
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