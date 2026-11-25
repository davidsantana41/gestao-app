import type { InputHTMLAttributes } from 'react';

export function Campo({ label, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return <label className="campo"><span>{label}</span><input {...props} /></label>;
}

export function CampoSenha({
  label,
  mostrar,
  onAlternarMostrar,
  disabled,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  mostrar: boolean;
  onAlternarMostrar: () => void;
}) {
  return (
    <label className="campo">
      <span>{label}</span>
      <div className="campo-senha-wrapper">
        <input {...props} type={mostrar ? 'text' : 'password'} disabled={disabled} />
        <button
          type="button"
          className="botao-olho"
          aria-label={mostrar ? 'Ocultar senha' : 'Mostrar senha'}
          title={mostrar ? 'Ocultar senha' : 'Mostrar senha'}
          disabled={disabled}
          onClick={onAlternarMostrar}
        >
          <span className="somente-leitor">{mostrar ? 'Ocultar senha' : 'Mostrar senha'}</span>
          {mostrar ? (
            <svg className="icone-olho" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" width="20" height="20">
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
              <line x1="1" y1="1" x2="23" y2="23" />
            </svg>
          ) : (
            <svg className="icone-olho" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" width="20" height="20">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
        </button>
      </div>
    </label>
  );
}

export function Valor({ label, value, onChange, required = false, disabled = false }: {
  label: string; value: string; onChange: (texto: string) => void; required?: boolean; disabled?: boolean;
}) {
  return <Campo label={label} type="text" inputMode="decimal" placeholder="0,00" value={value} required={required}
    disabled={disabled} onChange={event => onChange(event.currentTarget.value)} />;
}
