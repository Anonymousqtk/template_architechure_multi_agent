import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';

type Props = {
  src?: string | null;
  name: string;
  className: string;
};

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(-2).map(part => part[0]).join('').toUpperCase() || '?';
}

export function Avatar({ src, name, className }: Props) {
  const [failedSrc, setFailedSrc] = useState('');
  const [open, setOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const imageSrc = src && failedSrc !== src ? src : null;

  useEffect(() => {
    if (!open || !imageSrc) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus = triggerRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (!dialog.open) dialog.showModal();
    closeRef.current?.focus();

    return () => {
      if (dialog.open) dialog.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [open, imageSrc]);

  function changeZoom(amount: number) {
    setZoom(current => Math.min(3, Math.max(0.5, Math.round((current + amount) * 100) / 100)));
  }

  const viewer = open && imageSrc ? createPortal(
      <dialog
        ref={dialogRef}
        className="avatar-viewer-dialog"
        aria-modal="true"
        aria-label={`Ảnh đại diện của ${name}`}
        onCancel={event => {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
        }}
        onClick={event => {
          if (event.target === event.currentTarget) setOpen(false);
        }}
      >
        <header className="avatar-viewer-header">
          <strong>Ảnh đại diện</strong>
          <button ref={closeRef} type="button" aria-label="Đóng ảnh" onClick={() => setOpen(false)}>×</button>
        </header>
        <div className="avatar-viewer-controls" aria-label="Điều khiển thu phóng">
          <button type="button" aria-label="Thu nhỏ ảnh" disabled={zoom <= 0.5} onClick={() => changeZoom(-0.25)}>−</button>
          <output aria-live="polite">{Math.round(zoom * 100)}%</output>
          <button type="button" aria-label="Phóng to ảnh" disabled={zoom >= 3} onClick={() => changeZoom(0.25)}>+</button>
          <button type="button" aria-label="Kích thước ban đầu" onClick={() => setZoom(1)}>100%</button>
        </div>
        <div className="avatar-viewer-stage">
          <img
            src={imageSrc}
            alt={`Ảnh đại diện của ${name}`}
            className="avatar-viewer-image"
            style={{ transform: `scale(${zoom})` }}
          />
        </div>
      </dialog>,
    document.body,
  ) : null;

  if (!imageSrc) {
    return <span className={`avatar-fallback ${className}`} role="img" aria-label={`Ảnh đại diện của ${name}`}>{initials(name)}</span>;
  }

  return <>
    <button
      type="button"
      ref={triggerRef}
      className={`avatar-trigger ${className}`}
      aria-label={`Xem ảnh đại diện của ${name}`}
      onClick={() => {
        setZoom(1);
        setOpen(true);
      }}
    >
      <img src={imageSrc} alt="" className="avatar-thumbnail" onError={() => setFailedSrc(imageSrc)} />
    </button>
    {viewer}
  </>;
}
