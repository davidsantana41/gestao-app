import type { HTMLAttributes } from 'react';

export interface AppcarLogoProps extends HTMLAttributes<HTMLDivElement> {
  subtitulo?: string;
  tamanho?: 'pequeno' | 'normal' | 'grande';
  centralizado?: boolean;
}

export default function AppcarLogo({
  subtitulo,
  tamanho = 'normal',
  centralizado = false,
  className = '',
  ...props
}: AppcarLogoProps) {
  return (
    <div
      className={`appcar-marca marca ${tamanho !== 'normal' ? `tamanho-${tamanho}` : ''} ${centralizado ? 'centralizado' : ''} ${className}`.trim()}
      {...props}
    >
      <span className="appcar-palavra">
        <span className="appcar-letra-a">A</span>
        <span className="appcar-letras-resto">PPCAR</span>
      </span>
      {subtitulo && <small className="appcar-subtitulo">{subtitulo}</small>}
    </div>
  );
}
