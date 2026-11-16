import type { InputHTMLAttributes } from 'react';

export function Campo({ label, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return <label className="campo"><span>{label}</span><input {...props} /></label>;
}
export function Valor({ label, value, onChange, required = false }: {
  label: string; value: string; onChange: (texto: string) => void; required?: boolean;
}) {
  return <Campo label={label} type="text" inputMode="decimal" placeholder="0,00" value={value} required={required}
    onChange={event => onChange(event.currentTarget.value)} />;
}
