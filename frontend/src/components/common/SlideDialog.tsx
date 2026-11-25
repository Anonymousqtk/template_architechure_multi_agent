import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from '../../i18n';
import '../../assets/styles/slide-dialog.css';

export function SlideDialog({
  children,
  label,
  onClose,
  closeDisabled = false,
  action,
}: {
  children: ReactNode;
  label: string;
  onClose: () => void;
  closeDisabled?: boolean;
  action?: ReactNode;
}) {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (typeof element.showModal === 'function') element.showModal();
    else element.setAttribute('open', '');
    return () => {
      if (element.open && typeof element.close === 'function') element.close();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="slide-dialog"
      aria-label={label}
      onCancel={(event) => {
        event.preventDefault();
        if (!closeDisabled) onClose();
      }}
    >
      <div className="slide-dialog-close-row">
        <button
          type="button"
          className="slide-dialog-close"
          aria-label={t('closeDialog')}
          disabled={closeDisabled}
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <div className="slide-dialog-body">{children}</div>
      <footer className="slide-dialog-footer">
        <button type="button" className="secondary" disabled={closeDisabled} onClick={onClose}>
          {t('cancel')}
        </button>
        {action}
      </footer>
    </dialog>
  );
}
