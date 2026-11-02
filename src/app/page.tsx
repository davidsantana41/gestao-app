'use client';

import { useState, useMemo } from 'react';

interface SaidaItem {
  id: string;
  nome: string;
  valor: number;
}

interface Lancamento {
  id: string;
  data: string; // Formato DD/MM/AAAA
  diaSemana: string;
  faturamentoBruto: number;
  combustivel: number;
  litros: number;
  kmTrabalhado: number;
  kmTotal: number;
  reservaFevereiro: number;
  reservaInvestimento: number;
  reservaAcidente: number;
  custosFixosDia: number; // Armazena o rateio total do dia (prestacao + ipva + seguro)
  saidas: SaidaItem[];
  totalDespesas: number;
  liquido: number;
}

export default function Home() {
  const [abaAtiva, setAbaAtiva] = useState<'lancamento' | 'relatorios'>('lancamento');

  // Configurações Fixas Mensais Editáveis
  const [valorPrestacaoMes, setValorPrestacaoMes] = useState<number>(2876.40);
  const [valorIpvaMes, setValorIpvaMes] = useState<number>(111.00);
  const [valorSeguroMes, setValorSeguroMes] = useState<number>(236.85);

  // Estados para os lançamentos do dia
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

  const [saidas, setSaidas] = useState<SaidaItem[]>([]);
  const [lembrete, setLembrete] = useState<string>('');

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

  const { diasUteisMes, prestacaoDia, ipvaDia, seguroDia } = useMemo(() => {
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

    const diasJaTrabalhados = historico.length;
    const diasRestantes = Math.max(totalDiasUteisMes - diasJaTrabalhados, 1);

    return {
      diasUteisMes: diasRestantes,
      prestacaoDia: valorPrestacaoMes / diasRestantes,
      ipvaDia: valorIpvaMes / diasRestantes,
      seguroDia: valorSeguroMes / diasRestantes,
    };
  }, [valorPrestacaoMes, valorIpvaMes, valorSeguroMes, historico.length]);

  const handleAdicionarSaida = () => {
    setSaidas([...saidas, { id: Date.now().toString(), nome: '', valor: 0 }]);
  };

  const handleRemoverSaida = (id: string) => {
    setSaidas(saidas.filter(s => s.id !== id));
  };

  const handleAtualizarSaida = (id: string, campo: 'nome' | 'valor', valor: string | number) => {
    setSaidas(saidas.map(s => s.id === id ? { ...s, [campo]: valor } : s));
  };

  const totalReservasTurno = (Number(valReserva1) || 0) + (Number(valReserva2) || 0) + valReservaAcidente;
  const totalSaidasTurno = saidas.reduce((acc, curr) => acc + (Number(curr.valor) || 0), 0);

  const precoLitroMedio = litros > 0 ? valorCombustivel / litros : 0;
  const consumoKmL = litros > 0 ? kmTrabalhado / litros : 0;
  
  const temMovimentoNoTurno = faturamentoBruto > 0 || valorCombustivel > 0 || totalReservasTurno > 0 || totalSaidasTurno > 0 || idEditando !== null;

  const prestacaoTurno = temMovimentoNoTurno ? prestacaoDia : 0;
  const ipvaTurno = temMovimentoNoTurno ? ipvaDia : 0;
  const seguroTurno = temMovimentoNoTurno ? seguroDia : 0;

  const totalDespesasDia = valorCombustivel + totalReservasTurno + totalSaidasTurno + prestacaoTurno + ipvaTurno + seguroTurno;
  const saldoLiquidoDia = faturamentoBruto - totalDespesasDia;

  const handleSalvarDia = () => {
    if (faturamentoBruto === 0 && valorCombustivel === 0 && totalReservasTurno === 0 && totalSaidasTurno === 0) {
      alert('Preencha ao menos o faturamento, combustível, reservas ou saídas antes de salvar.');
      return;
    }

    const custosFixosTotaisSalvar = prestacaoDia + ipvaDia + seguroDia;
    const totalDespesasSalvar = valorCombustivel + totalReservasTurno + totalSaidasTurno + custosFixosTotaisSalvar;
    const liquidoSalvar = faturamentoBruto - totalDespesasSalvar;
    const saidasSnapshot = saidas.map(s => ({ ...s }));

    if (idEditando) {
      setHistorico(historico.map(item => item.id === idEditando ? {
        ...item,
        faturamentoBruto,
        combustivel: valorCombustivel,
        litros,
        kmTrabalhado,
        kmTotal,
        reservaFevereiro: Number(valReserva1) || 0,
        reservaInvestimento: Number(valReserva2) || 0,
        reservaAcidente: valReservaAcidente,
        custosFixosDia: custosFixosTotaisSalvar,
        saidas: saidasSnapshot,
        totalDespesas: totalDespesasSalvar,
        liquido: liquidoSalvar,
      } : item));
      setIdEditando(null);
    } else {
      const novoLancamento: Lancamento = {
        id: Date.now().toString(),
        data: new Date().toLocaleDateString('pt-BR'),
        diaSemana: infoDataAtual.diaSemanaTexto,
        faturamentoBruto,
        combustivel: valorCombustivel,
        litros,
        kmTrabalhado,
        kmTotal,
        reservaFevereiro: Number(valReserva1) || 0,
        reservaInvestimento: Number(valReserva2) || 0,
        reservaAcidente: valReservaAcidente,
        custosFixosDia: custosFixosTotaisSalvar,
        saidas: saidasSnapshot,
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
    setSaidas([]);
  };

  const handleCarregarParaEdicao = (item: Lancamento) => {
    setIdEditando(item.id);
    setFaturamentoBruto(item.faturamentoBruto);
    setValorCombustivel(item.combustivel);
    setLitros(item.litros || 0);
    setKmTrabalhado(item.kmTrabalhado || 0);
    setKmTotal(item.kmTotal || 0);
    setValReserva1(item.reservaFevereiro || 0);
    setValReserva2(item.reservaInvestimento || 0);
    setSaidas(item.saidas ? item.saidas.map(s => ({ ...s })) : []);
    setAbaAtiva('lancamento');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // --- CÁLCULOS DE RELATÓRIOS E ACUMULADOS DETALHADOS ---
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
    let totalPrestacaoGeral = 0;
    let totalIpvaGeral = 0;
    let totalSeguroGeral = 0;

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

      // Como o custosFixosDia guarda o total do rateio do dia, dividimos proporcionalmente ou acumulamos baseado nos valores mensais configurados
      const partPrestacao = (valorPrestacaoMes / 25); // aproximação do rateio diário salvo
      const partIpva = (valorIpvaMes / 25);
      const partSeguro = (valorSeguroMes / 25);

      totalPrestacaoGeral += partPrestacao;
      totalIpvaGeral += partIpva;
      totalSeguroGeral += partSeguro;

      const partesData = item.data.split('/');
      if (partesData.length === 3) {
        const mesAnoKey = `${partesData[1]}/${partesData[2]}`;
        const anoKey = partesData[2];

        if (!porMes[mesAnoKey]) {
          porMes[mesAnoKey] = { fat: 0, desp: 0, liq: 0, dias: 0, comb: 0, res1: 0, res2: 0, resAc: 0, prest: 0, ipva: 0, seg: 0 };
        }
        porMes[mesAnoKey].fat += item.faturamentoBruto;
        porMes[mesAnoKey].desp += item.totalDespesas;
        porMes[mesAnoKey].liq += item.liquido;
        porMes[mesAnoKey].comb += item.combustivel;
        porMes[mesAnoKey].res1 += (item.reservaFevereiro || 0);
        porMes[mesAnoKey].res2 += (item.reservaInvestimento || 0);
        porMes[mesAnoKey].resAc += (item.reservaAcidente || 0);
        porMes[mesAnoKey].prest += partPrestacao;
        porMes[mesAnoKey].ipva += partIpva;
        porMes[mesAnoKey].seg += partSeguro;
        porMes[mesAnoKey].dias += 1;

        if (!porAno[anoKey]) {
          porAno[anoKey] = { fat: 0, desp: 0, liq: 0, dias: 0, comb: 0, res1: 0, res2: 0, resAc: 0, prest: 0, ipva: 0, seg: 0 };
        }
        porAno[anoKey].fat += item.faturamentoBruto;
        porAno[anoKey].desp += item.totalDespesas;
        porAno[anoKey].liq += item.liquido;
        porAno[anoKey].comb += item.combustivel;
        porAno[anoKey].res1 += (item.reservaFevereiro || 0);
        porAno[anoKey].res2 += (item.reservaInvestimento || 0);
        porAno[anoKey].resAc += (item.reservaAcidente || 0);
        porAno[anoKey].prest += partPrestacao;
        porAno[anoKey].ipva += partIpva;
        porAno[anoKey].seg += partSeguro;
        porAno[anoKey].dias += 1;
      }
    });

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
      totalPrestacaoGeral,
      totalIpvaGeral,
      totalSeguroGeral,
      porMes,
      porAno,
      totalDiasRegistrados: historico.length
    };
  }, [historico, valorPrestacaoMes, valorIpvaMes, valorSeguroMes]);

  return (
    <main className="min-h-screen bg-slate-100 p-6 md:p-8">
      <div className="max-w-6xl mx-auto">
        
        {/* Cabeçalho */}
        <header className="mb-6 flex flex-col md:flex-row justify-between items-center bg-white p-6 rounded-xl shadow-sm border border-slate-200 gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-slate-800">
              Gestão Financeira - Argo
            </h1>
            <p className="text-slate-500 text-sm mt-1 capitalize">
              📅 {infoDataAtual.dataCompleta} • Mês de referência: <strong className="text-slate-700">{infoDataAtual.mesAno}</strong>
            </p>
          </div>
          
          <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200">
            <button
              onClick={() => setAbaAtiva('lancamento')}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition ${abaAtiva === 'lancamento' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              📝 Lançamento Diário
            </button>
            <button
              onClick={() => setAbaAtiva('relatorios')}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition ${abaAtiva === 'relatorios' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              📊 Relatórios & Acumulados
            </button>
          </div>
        </header>

        {/* ABA LANÇAMENTO DIÁRIO */}
        {abaAtiva === 'lancamento' && (
          <>
            <div className="mb-8 bg-white p-5 rounded-xl shadow-sm border border-slate-200">
              <h2 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
                ⚙️ Custos Fixos Mensais (Valores Brutos Editáveis)
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Prestação do Carro (Mês)</label>
                  <input 
                    type="number" 
                    value={valorPrestacaoMes} 
                    onChange={(e) => setValorPrestacaoMes(parseFloat(e.target.value) || 0)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg text-slate-800 font-semibold bg-slate-50 focus:bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">IPVA (Mês)</label>
                  <input 
                    type="number" 
                    value={valorIpvaMes} 
                    onChange={(e) => setValorIpvaMes(parseFloat(e.target.value) || 0)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg text-slate-800 font-semibold bg-slate-50 focus:bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Seguro (Mês)</label>
                  <input 
                    type="number" 
                    value={valorSeguroMes} 
                    onChange={(e) => setValorSeguroMes(parseFloat(e.target.value) || 0)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg text-slate-800 font-semibold bg-slate-50 focus:bg-white"
                  />
                </div>
              </div>
            </div>

            {idEditando && (
              <div className="mb-6 bg-amber-50 border border-amber-300 p-4 rounded-xl flex justify-between items-center text-amber-900">
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
                    setSaidas([]);
                  }}
                  className="text-xs bg-amber-200 hover:bg-amber-300 px-3 py-1 rounded font-semibold transition"
                >
                  Cancelar Edição
                </button>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                <h3 className="text-sm font-medium text-slate-500">Faturamento Bruto (Turno)</h3>
                <p className="text-2xl font-bold text-emerald-600 mt-2">R$ {faturamentoBruto.toFixed(2)}</p>
              </div>
              <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                <h3 className="text-sm font-medium text-slate-500">Despesas Totais (Turno)</h3>
                <p className="text-2xl font-bold text-rose-600 mt-2">R$ {totalDespesasDia.toFixed(2)}</p>
              </div>
              <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                <h3 className="text-sm font-medium text-slate-500">Total Líquido (Turno)</h3>
                <p className={`text-2xl font-bold mt-2 ${saldoLiquidoDia >= 0 ? 'text-blue-600' : 'text-rose-600'}`}>
                  R$ {saldoLiquidoDia.toFixed(2)}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
              <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                <h2 className="text-lg font-semibold text-slate-800 mb-4">
                  {idEditando ? '✏️ Editar Registo Selecionado' : 'Registo do Turno / Dia'}
                </h2>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Faturamento Bruto (R$)</label>
                    <input 
                      type="number" 
                      value={faturamentoBruto || ''} 
                      onChange={(e) => setFaturamentoBruto(parseFloat(e.target.value) || 0)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-800"
                      placeholder="0.00"
                    />
                  </div>

                  <div className="p-4 bg-slate-50 rounded-lg border border-slate-200 space-y-3">
                    <h3 className="text-sm font-semibold text-slate-700">Abastecimento & Combustível</h3>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">Valor Gasto (R$)</label>
                        <input 
                          type="number" 
                          value={valorCombustivel || ''} 
                          onChange={(e) => setValorCombustivel(parseFloat(e.target.value) || 0)}
                          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white text-slate-800"
                          placeholder="0.00"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">Litros</label>
                        <input 
                          type="number" 
                          value={litros || ''} 
                          onChange={(e) => setLitros(parseFloat(e.target.value) || 0)}
                          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white text-slate-800"
                          placeholder="0.00"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">KM Trabalhado (Líquido)</label>
                        <input 
                          type="number" 
                          value={kmTrabalhado || ''} 
                          onChange={(e) => setKmTrabalhado(parseFloat(e.target.value) || 0)}
                          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white text-slate-800"
                          placeholder="Ex: 150"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">KM Total do Carro</label>
                        <input 
                          type="number" 
                          value={kmTotal || ''} 
                          onChange={(e) => setKmTotal(parseFloat(e.target.value) || 0)}
                          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white text-slate-800"
                          placeholder="Ex: 180"
                        />
                      </div>
                    </div>
                    <div className="text-xs text-slate-600 pt-2 border-t border-slate-200 flex justify-between">
                      <span>Preço Médio: <strong>R$ {precoLitroMedio.toFixed(2)}/L</strong></span>
                      <span>Consumo: <strong>{consumoKmL.toFixed(2)} Km/L</strong></span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <input 
                        type="text" 
                        value={nomeReserva1} 
                        onChange={(e) => setNomeReserva1(e.target.value)}
                        className="text-xs font-medium text-slate-600 bg-slate-100 px-2 py-1 rounded w-full mb-1 border border-slate-200"
                      />
                      <input 
                        type="number" 
                        value={valReserva1 || ''} 
                        onChange={(e) => setValReserva1(parseFloat(e.target.value) || 0)}
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg text-slate-800"
                        placeholder="0.00"
                      />
                    </div>
                    <div>
                      <input 
                        type="text" 
                        value={nomeReserva2} 
                        onChange={(e) => setNomeReserva2(e.target.value)}
                        className="text-xs font-medium text-slate-600 bg-slate-100 px-2 py-1 rounded w-full mb-1 border border-slate-200"
                      />
                      <input 
                        type="number" 
                        value={valReserva2 || ''} 
                        onChange={(e) => setValReserva2(parseFloat(e.target.value) || 0)}
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg text-slate-800"
                        placeholder="0.00"
                      />
                    </div>
                    <div>
                      <input 
                        type="text" 
                        value={nomeReserva3} 
                        onChange={(e) => setNomeReserva3(e.target.value)}
                        className="text-xs font-medium text-slate-600 bg-slate-100 px-2 py-1 rounded w-full mb-1 border border-slate-200"
                      />
                      <div className="w-full px-3 py-2 text-sm border border-slate-200 bg-slate-100 rounded-lg text-slate-700 font-semibold flex items-center h-[38px]">
                        R$ {valReservaAcidente.toFixed(2)}
                      </div>
                      <span className="text-[10px] text-slate-400 block mt-0.5">Auto: R$ 0,038 x KM Total</span>
                    </div>
                  </div>

                  <div className="p-4 bg-slate-50 rounded-lg border border-slate-200 space-y-3">
                    <div className="flex justify-between items-center">
                      <h3 className="text-sm font-semibold text-slate-700">📤 Saídas / Despesas Extras</h3>
                      <button 
                        type="button"
                        onClick={handleAdicionarSaida}
                        className="text-xs bg-slate-800 hover:bg-slate-900 text-white font-medium px-3 py-1.5 rounded-lg transition"
                      >
                        ＋ Adicionar Saída
                      </button>
                    </div>
                    {saidas.length > 0 && (
                      <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                        {saidas.map((s) => (
                          <div key={s.id} className="flex items-center gap-2 bg-white p-2 rounded-lg border border-slate-200">
                            <input 
                              type="text" 
                              value={s.nome} 
                              onChange={(e) => handleAtualizarSaida(s.id, 'nome', e.target.value)}
                              className="text-xs font-medium text-slate-700 bg-slate-50 px-2 py-1.5 rounded border border-slate-300 flex-1"
                              placeholder="Nome da saída..."
                            />
                            <input 
                              type="number" 
                              value={s.valor || ''} 
                              onChange={(e) => handleAtualizarSaida(s.id, 'valor', parseFloat(e.target.value) || 0)}
                              className="w-24 px-2 py-1.5 text-xs border border-slate-300 rounded-lg bg-slate-50 text-slate-800 font-semibold"
                              placeholder="0.00"
                            />
                            <button 
                              type="button"
                              onClick={() => handleRemoverSaida(s.id)}
                              className="text-rose-500 font-bold text-sm px-1"
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <button 
                    onClick={handleSalvarDia}
                    className={`w-full font-semibold py-3 rounded-lg transition text-white ${idEditando ? 'bg-amber-600 hover:bg-amber-700' : 'bg-blue-600 hover:bg-blue-700'}`}
                  >
                    {idEditando ? '🔄 Atualizar Registo' : '💾 Registar e Salvar Dia'}
                  </button>
                </div>
              </div>

              <div className="space-y-6">
                <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                  <h2 className="text-lg font-semibold text-slate-800 mb-2">Detalhamento dos Custos (Rateio Diário)</h2>
                  <p className="text-xs text-slate-500 mb-4">
                    {temMovimentoNoTurno ? `Calculado com base em ${diasUteisMes} dias restantes.` : 'Insira dados no turno para exibir o rateio.'}
                  </p>
                  
                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between py-2 border-b border-slate-100">
                      <span className="text-slate-600">Combustível:</span>
                      <span className="font-semibold text-slate-800">R$ {valorCombustivel.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between py-2 border-b border-slate-100">
                      <span className="text-slate-600">{nomeReserva1}:</span>
                      <span className="font-semibold text-slate-800">R$ {(Number(valReserva1) || 0).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between py-2 border-b border-slate-100">
                      <span className="text-slate-600">{nomeReserva2}:</span>
                      <span className="font-semibold text-slate-800">R$ {(Number(valReserva2) || 0).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between py-2 border-b border-slate-100">
                      <span className="text-slate-600">{nomeReserva3} (R$ 0,038/KM):</span>
                      <span className="font-semibold text-slate-800">R$ {valReservaAcidente.toFixed(2)}</span>
                    </div>

                    {saidas.map((s) => (
                      <div key={s.id} className="flex justify-between py-2 border-b border-slate-100 text-amber-900 bg-amber-50/50 px-2 rounded">
                        <span className="text-slate-700">📤 {s.nome || 'Saída sem nome'}:</span>
                        <span className="font-semibold text-rose-600">R$ {(Number(s.valor) || 0).toFixed(2)}</span>
                      </div>
                    ))}

                    <div className="flex justify-between py-2 border-b border-slate-100">
                      <span className="text-slate-600">Prestação (Rateio):</span>
                      <span className="font-semibold text-slate-800">R$ {prestacaoTurno.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between py-2 border-b border-slate-100">
                      <span className="text-slate-600">IPVA (Rateio):</span>
                      <span className="font-semibold text-slate-800">R$ {ipvaTurno.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between py-2 border-b border-slate-100">
                      <span className="text-slate-600">Seguro (Rateio):</span>
                      <span className="font-semibold text-slate-800">R$ {seguroTurno.toFixed(2)}</span>
                    </div>
                  </div>
                </div>

                <div className="bg-amber-50 border border-amber-200 p-6 rounded-xl shadow-sm">
                  <h3 className="text-amber-900 font-semibold mb-2 flex items-center gap-2">
                    📝 Bloco de Lembretes do Dia
                  </h3>
                  <textarea 
                    value={lembrete}
                    onChange={(e) => setLembrete(e.target.value)}
                    placeholder="Ex: Trocar óleo com 68.000 km..."
                    className="w-full h-24 p-3 text-sm bg-white border border-amber-200 rounded-lg focus:outline-none text-slate-800 resize-none"
                  />
                </div>
              </div>
            </div>

            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
              <h2 className="text-lg font-semibold text-slate-800 mb-2">Histórico de Lançamentos Recentes</h2>
              <p className="text-xs text-slate-500 mb-4">💡 Clique em qualquer linha da tabela para carregar os dados de volta para edição.</p>
              
              {historico.length === 0 ? (
                <p className="text-slate-500 text-sm py-4 text-center">Nenhum registo efetuado ainda.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead>
                      <tr className="bg-slate-100 text-slate-700 border-b border-slate-200">
                        <th className="p-3">Data</th>
                        <th className="p-3">Dia</th>
                        <th className="p-3">Faturamento</th>
                        <th className="p-3">Combustível</th>
                        <th className="p-3">{nomeReserva1}</th>
                        <th className="p-3">{nomeReserva2}</th>
                        <th className="p-3">{nomeReserva3}</th>
                        <th className="p-3">Saídas Extras</th>
                        <th className="p-3">Total Líquido</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historico.map((item) => (
                        <tr 
                          key={item.id} 
                          onClick={() => handleCarregarParaEdicao(item)}
                          className="border-b border-slate-100 hover:bg-blue-50 cursor-pointer transition"
                        >
                          <td className="p-3 font-medium text-slate-700">{item.data}</td>
                          <td className="p-3 text-slate-600 capitalize">{item.diaSemana}</td>
                          <td className="p-3 text-emerald-600 font-semibold">R$ {item.faturamentoBruto.toFixed(2)}</td>
                          <td className="p-3 text-slate-600">R$ {item.combustivel.toFixed(2)}</td>
                          <td className="p-3 text-slate-600">R$ {item.reservaFevereiro.toFixed(2)}</td>
                          <td className="p-3 text-slate-600">R$ {item.reservaInvestimento.toFixed(2)}</td>
                          <td className="p-3 text-slate-600">R$ {item.reservaAcidente.toFixed(2)}</td>
                          <td className="p-3 text-rose-600 font-medium text-xs">
                            {item.saidas && item.saidas.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {item.saidas.map(s => (
                                  <span key={s.id} className="bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
                                    {s.nome}: <strong>R$ {(Number(s.valor) || 0).toFixed(2)}</strong>
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span>Nenhuma</span>
                            )}
                          </td>
                          <td className={`p-3 font-bold ${item.liquido >= 0 ? 'text-blue-600' : 'text-rose-600'}`}>
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

        {/* ABA RELATÓRIOS & ACUMULADOS (COM DETALHAMENTO COMPLETO) */}
        {abaAtiva === 'relatorios' && (
          <div className="space-y-8">
            
            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
              <h2 className="text-xl font-bold text-slate-800 mb-1">📈 Desempenho Consolidado</h2>
              <p className="text-xs text-slate-500 mb-6">Balanço total acumulado de todos os {relatoriosAcumulados.totalDiasRegistrados} dias registados.</p>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                <div className="bg-slate-50 p-5 rounded-xl border border-slate-200">
                  <span className="text-xs font-medium text-slate-500 block">Faturamento Bruto Acumulado</span>
                  <span className="text-2xl font-bold text-emerald-600 mt-2 block">R$ {relatoriosAcumulados.totalFatGeral.toFixed(2)}</span>
                </div>
                <div className="bg-slate-50 p-5 rounded-xl border border-slate-200">
                  <span className="text-xs font-medium text-slate-500 block">Despesas Totais Acumuladas</span>
                  <span className="text-2xl font-bold text-rose-600 mt-2 block">R$ {relatoriosAcumulados.totalDespGeral.toFixed(2)}</span>
                </div>
                <div className="bg-slate-50 p-5 rounded-xl border border-slate-200">
                  <span className="text-xs font-medium text-slate-500 block">Resultado Líquido Geral</span>
                  <span className={`text-2xl font-bold mt-2 block ${relatoriosAcumulados.totalLiqGeral >= 0 ? 'text-blue-600' : 'text-rose-600'}`}>
                    R$ {relatoriosAcumulados.totalLiqGeral.toFixed(2)}
                  </span>
                </div>
              </div>

              {/* DETALHAMENTO DISCRIMINADO DOS CUSTOS E RESERVAS NO CONSOLIDADO */}
              <div className="mb-6">
                <h3 className="text-sm font-bold text-slate-700 mb-3">🔍 Discriminação de Gastos e Reservas Acumuladas</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-sm">
                  <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                    <span className="text-slate-500 text-[11px] block">Combustível</span>
                    <strong className="text-slate-800 text-xs">R$ {relatoriosAcumulados.totalCombGeral.toFixed(2)}</strong>
                  </div>
                  <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                    <span className="text-slate-500 text-[11px] block">{nomeReserva1}</span>
                    <strong className="text-slate-800 text-xs">R$ {relatoriosAcumulados.totalRes1Geral.toFixed(2)}</strong>
                  </div>
                  <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                    <span className="text-slate-500 text-[11px] block">{nomeReserva2}</span>
                    <strong className="text-slate-800 text-xs">R$ {relatoriosAcumulados.totalRes2Geral.toFixed(2)}</strong>
                  </div>
                  <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                    <span className="text-slate-500 text-[11px] block">{nomeReserva3}</span>
                    <strong className="text-slate-800 text-xs">R$ {relatoriosAcumulados.totalResAcidenteGeral.toFixed(2)}</strong>
                  </div>
                  <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                    <span className="text-slate-500 text-[11px] block">Prestação (Acumulada)</span>
                    <strong className="text-slate-800 text-xs">R$ {relatoriosAcumulados.totalPrestacaoGeral.toFixed(2)}</strong>
                  </div>
                  <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                    <span className="text-slate-500 text-[11px] block">IPVA & Seguro</span>
                    <strong className="text-slate-800 text-xs">R$ {(relatoriosAcumulados.totalIpvaGeral + relatoriosAcumulados.totalSeguroGeral).toFixed(2)}</strong>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm bg-slate-50 p-4 rounded-xl border border-slate-200">
                <div>
                  <span className="text-slate-500 text-xs block">KM Trabalhado:</span>
                  <strong className="text-slate-800">{relatoriosAcumulados.totalKmTrabGeral.toFixed(0)} km</strong>
                </div>
                <div>
                  <span className="text-slate-500 text-xs block">KM Total Rodado:</span>
                  <strong className="text-slate-800">{relatoriosAcumulados.totalKmTotalGeral.toFixed(0)} km</strong>
                </div>
                <div>
                  <span className="text-slate-500 text-xs block">Média Líquida / Dia:</span>
                  <strong className="text-slate-800">
                    R$ {relatoriosAcumulados.totalDiasRegistrados > 0 ? (relatoriosAcumulados.totalLiqGeral / relatoriosAcumulados.totalDiasRegistrados).toFixed(2) : '0.00'}
                  </strong>
                </div>
                <div>
                  <span className="text-slate-500 text-xs block">Total Dias:</span>
                  <strong className="text-slate-800">{relatoriosAcumulados.totalDiasRegistrados} dias</strong>
                </div>
              </div>
            </div>

            {/* Acumulado por Mês */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
              <h3 className="text-lg font-semibold text-slate-800 mb-4">📅 Acumulado por Mês</h3>
              {Object.keys(relatoriosAcumulados.porMes).length === 0 ? (
                <p className="text-slate-500 text-sm py-4 text-center">Nenhum dado mensal registado ainda.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead>
                      <tr className="bg-slate-100 text-slate-700 border-b border-slate-200">
                        <th className="p-3">Mês/Ano</th>
                        <th className="p-3">Dias</th>
                        <th className="p-3">Faturamento</th>
                        <th className="p-3">Combustível</th>
                        <th className="p-3">Reservas (Total)</th>
                        <th className="p-3">Despesas Totais</th>
                        <th className="p-3">Saldo Líquido</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(relatoriosAcumulados.porMes).map(([mesAno, dados]) => (
                        <tr key={mesAno} className="border-b border-slate-100 hover:bg-slate-50">
                          <td className="p-3 font-semibold text-slate-800">{mesAno}</td>
                          <td className="p-3 text-slate-600">{dados.dias} dias</td>
                          <td className="p-3 text-emerald-600 font-semibold">R$ {dados.fat.toFixed(2)}</td>
                          <td className="p-3 text-slate-600">R$ {dados.comb.toFixed(2)}</td>
                          <td className="p-3 text-slate-600">R$ {(dados.res1 + dados.res2 + dados.resAc).toFixed(2)}</td>
                          <td className="p-3 text-rose-600">R$ {dados.desp.toFixed(2)}</td>
                          <td className={`p-3 font-bold ${dados.liq >= 0 ? 'text-blue-600' : 'text-rose-600'}`}>
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
            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
              <h3 className="text-lg font-semibold text-slate-800 mb-4">🏆 Acumulado por Ano</h3>
              {Object.keys(relatoriosAcumulados.porAno).length === 0 ? (
                <p className="text-slate-500 text-sm py-4 text-center">Nenhum dado anual registado ainda.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead>
                      <tr className="bg-slate-100 text-slate-700 border-b border-slate-200">
                        <th className="p-3">Ano</th>
                        <th className="p-3">Dias</th>
                        <th className="p-3">Faturamento</th>
                        <th className="p-3">Combustível</th>
                        <th className="p-3">Reservas (Total)</th>
                        <th className="p-3">Despesas Totais</th>
                        <th className="p-3">Saldo Líquido Anual</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(relatoriosAcumulados.porAno).map(([ano, dados]) => (
                        <tr key={ano} className="border-b border-slate-100 hover:bg-slate-50">
                          <td className="p-3 font-semibold text-slate-800">{ano}</td>
                          <td className="p-3 text-slate-600">{dados.dias} dias</td>
                          <td className="p-3 text-emerald-600 font-semibold">R$ {dados.fat.toFixed(2)}</td>
                          <td className="p-3 text-slate-600">R$ {dados.comb.toFixed(2)}</td>
                          <td className="p-3 text-slate-600">R$ {(dados.res1 + dados.res2 + dados.resAc).toFixed(2)}</td>
                          <td className="p-3 text-rose-600">R$ {dados.desp.toFixed(2)}</td>
                          <td className={`p-3 font-bold ${dados.liq >= 0 ? 'text-blue-600' : 'text-rose-600'}`}>
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