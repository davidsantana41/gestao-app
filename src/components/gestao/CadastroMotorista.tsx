'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { doc, getDocFromServer, setDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { dataLocal } from '@/lib/gestao';
import { combustiveisDemonstracao, type PerfilDemonstracao, type VeiculoDemonstracao } from '@/lib/demonstracaoLocal';
import ContaDemonstracao from './ContaDemonstracao';

type Tela = 'Meu perfil' | 'Meus veículos';
type Cadastro = { perfil?: PerfilDemonstracao; veiculo?: Omit<VeiculoDemonstracao, 'id'> };

export default function CadastroMotorista({ uid, email, tema }: {
  uid: string; email: string | null; tema: 'escuro' | 'claro';
}) {
  const [cadastro, setCadastro] = useState<Cadastro>();
  const [tela, setTela] = useState<Tela>();
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');
  const [mensagem, setMensagem] = useState('');
  const [tentativa, setTentativa] = useState(0);
  const menu = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (auth.currentUser?.uid !== uid) return;
    let ativo = true;
    void Promise.all([
      getDocFromServer(doc(db, 'users', uid, 'cadastro', 'perfil')),
      getDocFromServer(doc(db, 'users', uid, 'cadastro', 'veiculo')),
    ]).then(([perfil, veiculo]) => {
      if (ativo) setCadastro({ perfil: perfil.data() as Cadastro['perfil'], veiculo: veiculo.data() as Cadastro['veiculo'] });
    }).catch(() => { if (ativo) setErro('Não foi possível carregar o cadastro.'); });
    return () => { ativo = false; };
  }, [uid, tentativa]);

  function fechar() {
    setTela(undefined);
    setErro('');
    setMensagem('');
    requestAnimationFrame(() => menu.current?.querySelector('summary')?.focus());
  }

  async function salvar(evento: FormEvent<HTMLFormElement>, tipo: 'perfil' | 'veiculo') {
    evento.preventDefault();
    if (ocupado || !cadastro || auth.currentUser?.uid !== uid) return;
    const campos = new FormData(evento.currentTarget);
    const texto = (nome: string) => String(campos.get(nome) ?? '').trim();
    setErro('');
    setMensagem('');
    setOcupado(true);
    try {
      const referencia = doc(db, 'users', uid, 'cadastro', tipo);
      if (tipo === 'perfil') {
        const perfil = { nome: texto('nome'), email: texto('email'), nascimento: texto('nascimento'),
          celular: texto('celular').replace(/[ ()+-]/g, '') };
        if (perfil.nome.length < 2 || perfil.nascimento > dataLocal() || !/^\d{10,13}$/.test(perfil.celular)) {
          throw new Error('Confira o nome, a data de nascimento e o celular.');
        }
        await setDoc(referencia, perfil);
        setCadastro(atual => ({ ...atual, perfil }));
      } else {
        const veiculo = { marca: texto('marca'), modelo: texto('modelo'), versao: texto('versao'),
          placa: texto('placa').toUpperCase().replace('-', ''), cor: texto('cor'), combustivel: texto('combustivel'),
          km: Number(texto('km')), anoFabricacao: Number(texto('anoFabricacao')), anoModelo: Number(texto('anoModelo')) };
        if (![veiculo.marca, veiculo.modelo, veiculo.versao, veiculo.cor].every(Boolean)
            || !/^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(veiculo.placa)
            || !combustiveisDemonstracao.some(item => item === veiculo.combustivel)
            || veiculo.anoModelo < veiculo.anoFabricacao || veiculo.anoModelo > veiculo.anoFabricacao + 1) {
          throw new Error('Confira a placa, o combustível e os anos de fabricação e modelo.');
        }
        await setDoc(referencia, veiculo);
        setCadastro(atual => ({ ...atual, veiculo }));
      }
      setMensagem(tipo === 'perfil' ? 'Perfil salvo.' : 'Veículo salvo.');
    } catch (falha) {
      setErro(falha instanceof Error && !('code' in falha) ? falha.message : 'Não foi possível salvar o cadastro. Tente novamente.');
    } finally {
      setOcupado(false);
    }
  }

  const nome = cadastro?.perfil?.nome || auth.currentUser?.displayName || email || 'Minha conta';
  return <><details ref={menu} className="demo-conta-menu">
    <summary className="botao secundario" aria-label={`Menu da conta: ${nome}`}>{nome} <span aria-hidden="true">▾</span></summary>
    <div className="painel demo-conta-opcoes">
      {!cadastro && <p role="status">{erro || 'Carregando cadastro…'}</p>}
      {!cadastro && erro && <button type="button" className="botao secundario" onClick={() => {
        setErro('');
        setTentativa(atual => atual + 1);
      }}>Tentar novamente</button>}
      {(['Meu perfil', 'Meus veículos'] as const).map(item => <button key={item} type="button" className="botao secundario"
        disabled={!cadastro} onClick={() => { if (menu.current) menu.current.open = false; setTela(item); }}>{item}</button>)}
    </div>
  </details>
    {tela && cadastro && <ContaDemonstracao tela={tela} demonstracao={false} tema={tema}
      dados={{ perfil: cadastro.perfil ?? { email: email ?? '', nome: auth.currentUser?.displayName ?? '' },
        veiculos: cadastro.veiculo ? [{ ...cadastro.veiculo, id: 'principal' }] : [] }}
      ocupado={ocupado} fechar={fechar} salvar={(evento, tipo) => void salvar(evento, tipo)} erro={erro}
      mensagem={mensagem} mudarTema={() => {}} />}
  </>;
}
