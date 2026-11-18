'use client';

import Compartilhamento, { SeletorEspacos, type EspacoSelecionado } from '@/components/Compartilhamento';
import type { EstadoCompartilhamento } from '@/lib/useCompartilhamento';

export default function ContaCompartilhamento({ estado, selecionado, onSelecionar, onVoltar }: {
  estado: EstadoCompartilhamento;
  selecionado: EspacoSelecionado;
  onSelecionar: (ownerUid: EspacoSelecionado) => void;
  onVoltar: () => void;
}) {
  return <section className="conta-compartilhamento" aria-labelledby="conta-compartilhamento-titulo">
    <div className="conta-compartilhamento-topo">
      <div><p className="sobretitulo">CONTA</p><h1 id="conta-compartilhamento-titulo">Conta e compartilhamento</h1><p className="ajuda">Escolha o espaço que deseja consultar e gerencie convites sem misturar os dados de cada conta.</p></div>
      <button type="button" className="botao secundario" onClick={onVoltar}>Voltar ao painel</button>
    </div>
    <div className="conta-compartilhamento-corpo">
      <SeletorEspacos estado={estado} selecionado={selecionado} onSelecionar={onSelecionar} />
      {selecionado === 'proprio'
        ? <Compartilhamento estado={estado} />
        : <p className="mensagem aviso">Você está consultando um espaço compartilhado. Para convidar ou gerenciar uma parceira da sua própria conta, selecione <strong>Meus dados</strong>.</p>}
    </div>
  </section>;
}
