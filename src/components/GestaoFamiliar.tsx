'use client';

import AppcarLogo from './AppcarLogo';

export default function GestaoFamiliar({
  email,
  onVoltar,
  onSair,
  saindo = false,
}: {
  email: string | null;
  onVoltar: () => void;
  onSair: () => Promise<void>;
  saindo?: boolean;
}) {
  return (
    <main className="app escuro">
      <header className="cabecalho">
        <div className="container cabecalho-conteudo">
          <AppcarLogo subtitulo="Gestão Familiar" />
          <div className="usuario">
            <span>{email}</span>
            <button
              type="button"
              className="botao secundario"
              onClick={onVoltar}
            >
              Voltar aos módulos
            </button>
            <button
              type="button"
              className="botao discreto"
              disabled={saindo}
              onClick={() => void onSair()}
            >
              {saindo ? 'Aguarde…' : 'Sair'}
            </button>
          </div>
        </div>
      </header>

      <div className="container conteudo">
        <div className="familiar-container">
          <div className="familiar-nav">
            <button
              type="button"
              className="botao discreto"
              onClick={onVoltar}
            >
              ← Voltar para seleção de módulos
            </button>
          </div>

          <section className="painel familiar-painel-apresentacao" aria-labelledby="familiar-titulo">
            <div className="familiar-header-bloco">
              <div className="familiar-icone-destaque">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                  <polyline points="9 22 9 12 15 12 15 22" />
                </svg>
              </div>
              <span className="selo familiar-selo">Em desenvolvimento</span>
              <h1 id="familiar-titulo">Gestão Familiar — Em desenvolvimento</h1>
              <p className="ajuda familiar-subtitulo">
                Estamos preparando um módulo exclusivo para você organizar o orçamento doméstico e as contas da sua casa com a mesma clareza e controle do seu trabalho.
              </p>
            </div>

            <div className="grade-custos familiar-preview-grid">
              <div className="custo-item">
                <h3>Orçamento da Casa</h3>
                <p>Categorize despesas fixas da residência (aluguel, condomínio, luz, internet, supermercado) e acompanhe o teto de gastos do mês.</p>
              </div>
              <div className="custo-item">
                <h3>Metas da Família</h3>
                <p>Crie caixinhas e reservas para objetivos conjuntos, como reformas, férias, reserva de emergência e compras planejadas.</p>
              </div>
              <div className="custo-item">
                <h3>Separação Total</h3>
                <p>Suas finanças domésticas ficam completamente separadas do painel do motorista, garantindo que o dinheiro do carro não se misture com as contas de casa.</p>
              </div>
            </div>

            <div className="familiar-rodape-acoes">
              <button
                type="button"
                className="botao primario"
                onClick={onVoltar}
              >
                Voltar para seleção de módulos
              </button>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
