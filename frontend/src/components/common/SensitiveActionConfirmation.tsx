import { useEffect, useRef, useState, type FormEvent } from 'react';
import { errorText, registerSensitiveActionConfirmation, request } from '../../services/api';
import { useTranslation } from '../../i18n';

export function SensitiveActionConfirmation({ useCode }: { useCode: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [backup, setBackup] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const pending = useRef<((confirmed: boolean) => void) | null>(null);

  useEffect(() => {
    const unregister = registerSensitiveActionConfirmation(() => new Promise(resolve => {
      if (pending.current) { resolve(false); return; }
      pending.current = resolve;
      setOpen(true);
    }));
    return () => { unregister(); pending.current?.(false); pending.current = null; };
  }, []);

  useEffect(() => {
    if (open) dialog.current?.showModal();
  }, [open]);

  function finish(confirmed: boolean) {
    dialog.current?.close();
    pending.current?.(confirmed);
    pending.current = null;
    setOpen(false);
    setError('');
    setBackup(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    event.currentTarget.reset();
    setBusy(true);
    setError('');
    try {
      await request('/api/auth/reauthenticate', {
        password: form.get('password'),
        ...(useCode ? { code: String(form.get('code')).trim() } : {}),
      });
      finish(true);
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;
  return <dialog ref={dialog} className="sensitive-action-dialog" aria-labelledby="sensitive-action-title"
    onCancel={event => { event.preventDefault(); if (!busy) finish(false); }}>
    <h2 id="sensitive-action-title">{t('verifyToContinue')}</h2>
    <p>{t('enterCredentials')}</p>
    <form onSubmit={submit} aria-busy={busy}>
      <fieldset disabled={busy}>
        <label className="field">{t('password')}<input name="password" type="password" autoComplete="current-password" maxLength={128} required /></label>
        {useCode && <label className="field">{backup ? t('backupCode') : t('authenticatorCode')}
          <input key={String(backup)} name="code" autoComplete="one-time-code" inputMode={backup ? 'text' : 'numeric'}
            pattern={backup ? undefined : '[0-9]{6}'} maxLength={backup ? 64 : 6} required />
        </label>}
        {Boolean(error) && <p role="alert" className="notice error">{errorText(error)}</p>}
        <button type="submit" className="primary">{busy ? t('verifying') : t('verifyAndContinue')}</button>
        <div className="verification-actions">
          {useCode && <button type="button" onClick={() => { setError(''); setBackup(!backup); }}>{backup ? t('useAuthenticator') : t('useBackupCode')}</button>}
          <button type="button" onClick={() => finish(false)}>{t('cancel')}</button>
        </div>
      </fieldset>
    </form>
  </dialog>;
}
