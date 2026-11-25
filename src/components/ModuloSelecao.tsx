'use client';

import AppcarLogo from './AppcarLogo';

export default function ModuloSelecao({
  email,
  onSelecionar,
  onSair,
  saindo = false,
}: {
  email: string | null;
  onSelecionar: (modulo: 'motorista' | 'familiar') => void;
  onSair: () => Promise<void>;
  saindo?: boolean;
}) {
  return (
    <main className="app escuro selecao-modulo-layout">
      <header className="cabecalho">
        <div className="container cabecalho-conteudo">
          <AppcarLogo subtitulo="Plataforma de gestão financeira" />
          <div className="usuario">
            <span>{email}</span>
            <button
              type="button"
              className="botao secundario"
              disabled={saindo}
              onClick={() => void onSair()}
            >
              {saindo ? 'Aguarde…' : 'Sair'}
            </button>
          </div>
        </div>
      </header>

      <div className="container conteudo selecao-modulo-container">
        <div className="selecao-modulo-intro">
          <p className="sobretitulo">PLATAFORMA INTEGRADA</p>
          <h1>O que você deseja gerenciar hoje?</h1>
          <p className="ajuda">
            Escolha o módulo de trabalho ou planejamento familiar. Você pode alternar entre eles a qualquer momento.
          </p>
        </div>

        <div className="selecao-cards-grid">
          {/* Card Gestão do Motorista */}
          <section className="painel selecao-card selecao-card-motorista" aria-labelledby="card-motorista-titulo">
            <div className="selecao-card-icone-wrapper motorista-cor">
              <svg className="selecao-icone" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.5 2.8C2.1 10.9 2 11.2 2 11.5V16c0 .6.4 1 1 1h2" />
                <circle cx="7" cy="17" r="2" />
                <path d="M9 17h6" />
                <circle cx="17" cy="17" r="2" />
              </svg>
            </div>
            <div className="selecao-card-badge">Operacional & Financeiro</div>
            <h2 id="card-motorista-titulo">Gestão do Motorista</h2>
            <p className="selecao-card-desc">
              Controle completo do seu dia a dia: turnos de trabalho, faturamento bruto e líquido, combustível e consumo km/L, custos fixos rateados por dias úteis, caixinhas e relatórios detalhados.
            </p>
            <ul className="selecao-card-lista">
              <li>✓ Registro e edição de turnos diários</li>
              <li>✓ Consumo médio e preço por litro em tempo real</li>
              <li>✓ Rateio automático de custos fixos mensais</li>
              <li>✓ Reservas e caixinhas para emergências</li>
            </ul>
            <div className="selecao-card-acao">
              <button
                type="button"
                className="botao primario largo"
                onClick={() => onSelecionar('motorista')}
              >
                Acessar gestão do motorista
              </button>
            </div>
          </section>

          {/* Card Gestão Familiar */}
          <section className="painel selecao-card selecao-card-familiar" aria-labelledby="card-familiar-titulo">
            <div className="selecao-card-icone-wrapper familiar-cor">
              <svg className="selecao-icone" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
            </div>
            <div className="selecao-card-badge badge-destaque">Novo Módulo</div>
            <h2 id="card-familiar-titulo">Gestão Familiar</h2>
            <p className="selecao-card-desc">
              Organização das finanças da sua casa e planejamento da família: orçamento doméstico mensal, controle de contas e despesas do lar, metas de economia e visão compartilhada.
            </p>
            <ul className="selecao-card-lista">
              <li>✓ Orçamento doméstico mensal da residência</li>
              <li>✓ Planejamento e acompanhamento de contas da casa</li>
              <li>✓ Metas de poupança e caixinhas da família</li>
              <li>✓ Gestão separada do trabalho para total clareza</li>
            </ul>
            <div className="selecao-card-acao">
              <button
                type="button"
                className="botao secundario largo"
                onClick={() => onSelecionar('familiar')}
              >
                Acessar gestão familiar
              </button>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
