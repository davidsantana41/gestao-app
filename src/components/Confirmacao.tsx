'use client';

import { useEffect, useId, useRef } from 'react';

export default function Confirmacao({ titulo, descricao, confirmar, onConfirmar, onCancelar }: {
  titulo: string; descricao: string; confirmar: string;
  onConfirmar: () => void; onCancelar: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const elemento = dialog.current;
    const anterior = document.activeElement;
    elemento?.showModal();
    return () => {
      elemento?.close();
      if (anterior instanceof HTMLElement && anterior.isConnected) anterior.focus();
    };
  }, []);
  return <dialog ref={dialog} className="confirmacao" aria-labelledby={`${id}-titulo`} aria-describedby={`${id}-descricao`} onCancel={onCancelar}>
    <h2 id={`${id}-titulo`}>{titulo}</h2>
    <p id={`${id}-descricao`}>{descricao}</p>
    <div className="acoes">
      <button type="button" className="botao secundario" autoFocus onClick={onCancelar}>Cancelar</button>
      <button type="button" className="botao primario" onClick={onConfirmar}>{confirmar}</button>
    </div>
  </dialog>;
}
