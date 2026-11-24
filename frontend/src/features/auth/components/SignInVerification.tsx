import { useEffect, useRef, useState, type FormEvent } from 'react';
import { errorText, request } from '../../../services/api';
import { useTranslation } from '../../../i18n';

export function SignInVerification({ email, onVerified, onCancel }: {
  email: string;
  onVerified: () => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [method, setMethod] = useState<'totp' | 'backup' | 'recover'>('totp');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus({ preventScroll: true }); }, [method]);

  function select(next: typeof method) {
    setMethod(next);
    setError('');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const code = String(form.get('code')).trim();
    setBusy(true);
    setError('');
    try {
      if (method === 'recover') {
        await request('/api/auth/mfa/recover', { password: form.get('password'), code });
        window.location.reload();
      } else {
        await request('/api/auth/mfa/verify', { code });
        await onVerified();
      }
    } catch (cause) {
      setError(cause);
      if (input.current) input.current.value = '';
      requestAnimationFrame(() => input.current?.focus());
    } finally {
      setBusy(false);
    }
  }

  const totp = method === 'totp';
  const recover = method === 'recover';
  return <section className="sign-in-verification">
    <span className="eyebrow">{t('stepTwo')}</span>
    <h1>{recover ? t('resetTwoFactor') : t('verifySignIn')}</h1>
    <p className="muted">{email}</p>
    <p>{totp ? t('enterCurrentCode') : recover ? t('recoverInstructions') : t('enterUnusedBackup')}</p>
    <form key={method} onSubmit={submit} aria-busy={busy}>
      <fieldset disabled={busy}>
        {recover && <label className="field" htmlFor="verify-password"><span>{t('password')}</span>
          <input id="verify-password" name="password" type="password" autoComplete="current-password" maxLength={128} required />
        </label>}
        <label className="field" htmlFor="verification-code">
          <span>{totp ? t('authenticatorCode') : t('backupCode')}</span>
          <input ref={input} id="verification-code" name="code" type="text"
            autoComplete="one-time-code" inputMode={totp ? 'numeric' : 'text'} spellCheck={false}
            pattern={totp ? '[0-9]{6}' : undefined} maxLength={totp ? 6 : 64} required
            aria-invalid={Boolean(error)} aria-describedby={error ? 'verification-error' : undefined} />
        </label>
        {Boolean(error) && <p id="verification-error" role="alert" className="notice error">{errorText(error)}</p>}
        <button className="primary" type="submit">{busy ? t('verifying') : recover ? t('revokeAndReset') : t('verifyAndContinue')}</button>
      </fieldset>
    </form>
    <div className="verification-actions">
      <button type="button" disabled={busy} onClick={() => select(totp ? 'backup' : 'totp')}>
        {totp ? t('useBackupCode') : t('useAuthenticator')}
      </button>
      {method === 'backup' && <button type="button" disabled={busy} onClick={() => select('recover')}>{t('resetAuthenticator')}</button>}
      <button type="button" disabled={busy} onClick={onCancel}>{t('backToSignIn')}</button>
    </div>
  </section>;
}
