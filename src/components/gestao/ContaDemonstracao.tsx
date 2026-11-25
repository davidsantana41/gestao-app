'use client';

import { useEffect, useRef, type FormEvent } from 'react';
import { combustiveisDemonstracao, type EstadoDemonstracao } from '@/lib/demonstracaoLocal';

export type TelaContaDemo = 'Meu perfil' | 'Meus veículos' | 'Configurações';

export default function ContaDemonstracao({ tela, dados, ocupado, fechar, salvar, tema, mudarTema, erro, mensagem, demonstracao = true }: {
  tela: TelaContaDemo; dados: Pick<EstadoDemonstracao, 'perfil' | 'veiculos'>; ocupado: boolean; fechar: () => void; erro: string; mensagem: string;
  demonstracao?: boolean;
  salvar: (evento: FormEvent<HTMLFormElement>, tipo: 'perfil' | 'veiculo') => void;
  tema: 'escuro' | 'claro'; mudarTema: (tema: 'escuro' | 'claro') => void;
}) {
  const dialogo = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const elemento = dialogo.current;
    elemento?.showModal();
    return () => { elemento?.close(); };
  }, []);
  const carro = dados.veiculos.find(item => item.id === 'principal');
  const anoMaximo = new Date().getFullYear() + 1;
  return <dialog ref={dialogo} className={`painel demo-conta-dialogo ${tema}`} aria-labelledby="demo-conta-titulo"
    onCancel={evento => { evento.preventDefault(); if (!ocupado) fechar(); }}>
    <div className="titulo-linha"><h2 id="demo-conta-titulo">{tela}</h2>
      <button type="button" className="botao secundario" onClick={fechar} disabled={ocupado}>Fechar</button>
    </div>
    {erro && <p className="mensagem erro" role="alert">{erro}</p>}
    {mensagem && <p className="mensagem sucesso" role="status">{mensagem}</p>}
    {tela === 'Meu perfil' && <form className="pilha compacta" onSubmit={evento => salvar(evento, 'perfil')}>
      <p className="ajuda">{demonstracao ? 'Use um e-mail fictício @appcar.test.' : 'O e-mail de contato é independente do seu e-mail de acesso.'}</p>
      <div className="demo-conta-grade">
        <label className="campo"><span>Nome completo</span><input name="nome" autoComplete="off" required minLength={2} maxLength={120} defaultValue={dados.perfil.nome} /></label>
        <label className="campo"><span>Nascimento</span><input name="nascimento" type="date" autoComplete="off" min="1900-01-01" required defaultValue={dados.perfil.nascimento} /></label>
        <label className="campo"><span>{demonstracao ? 'E-mail fictício' : 'E-mail de contato'}</span><input name="email" type="email" autoComplete={demonstracao ? 'off' : 'email'} maxLength={120} required defaultValue={dados.perfil.email} /></label>
        <label className="campo"><span>{demonstracao ? 'Celular fictício' : 'Celular'}</span><input name="celular" type="tel" autoComplete={demonstracao ? 'off' : 'tel'} maxLength={24} required defaultValue={dados.perfil.celular} /></label>
      </div>
      <div><button className="botao primario" disabled={ocupado}>Salvar perfil</button></div>
    </form>}
    {tela === 'Meus veículos' && <form className="pilha compacta" onSubmit={evento => salvar(evento, 'veiculo')}>
      <p className="ajuda">{demonstracao ? 'Use placa e dados fictícios.' : 'Veículo principal da sua conta.'}</p>
      <div className="demo-conta-grade">
        <label className="campo"><span>Marca</span><input name="marca" required maxLength={50} defaultValue={carro?.marca} /></label>
        <label className="campo"><span>Modelo</span><input name="modelo" required maxLength={70} defaultValue={carro?.modelo} /></label>
        <label className="campo"><span>Versão</span><input name="versao" required maxLength={70} defaultValue={carro?.versao} /></label>
        <label className="campo"><span>Ano de fabricação</span><input name="anoFabricacao" type="number" min={1900} max={anoMaximo} required defaultValue={carro?.anoFabricacao} /></label>
        <label className="campo"><span>Ano do modelo</span><input name="anoModelo" type="number" min={1900} max={anoMaximo} required defaultValue={carro?.anoModelo} /></label>
        <label className="campo"><span>{demonstracao ? 'Placa fictícia' : 'Placa'}</span><input name="placa" placeholder="ABC1D23" maxLength={8} required defaultValue={carro?.placa} /></label>
        <label className="campo"><span>Quilometragem atual (km)</span><input name="km" type="number" min={0} max={9999999} step={1} required defaultValue={carro?.km} /></label>
        <label className="campo"><span>Combustível</span><select name="combustivel" required defaultValue={carro?.combustivel ?? ''}>
          <option value="" disabled>Selecione</option>
          {combustiveisDemonstracao.map(item => <option key={item}>{item}</option>)}
        </select></label>
        <label className="campo"><span>Cor</span><input name="cor" required maxLength={40} defaultValue={carro?.cor} /></label>
      </div>
      <div><button className="botao primario" disabled={ocupado}>Salvar veículo</button></div>
    </form>}
    {tela === 'Configurações' && <label className="campo">
      <span>Tema neste navegador</span>
      <select value={tema} onChange={evento => mudarTema(evento.target.value === 'claro' ? 'claro' : 'escuro')}>
        <option value="escuro">Escuro</option><option value="claro">Claro</option>
      </select>
    </label>}
  </dialog>;
}
