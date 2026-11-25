import {
  browserSupportsWebAuthn,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
} from '@simplewebauthn/browser';
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, errorText, request } from '../../../services/api';
import { useTranslation } from '../../../i18n';

const endpoint = '/api/auth/passkeys';
type Passkey = { id: string; createdAt: string; lastUsedAt: string | null };
type Action = { type: 'add' } | { type: 'remove'; id: string };

export function PasskeySettings({ onContinue }: { onContinue?: () => void }) {
  const { t, locale } = useTranslation();
  const [items, setItems] = useState<Passkey[] | null>(null);
  const [pending, setPending] = useState<Action | null>(null);
  const [backup, setBackup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [registrationFailure, setRegistrationFailure] = useState(false);
  const [notice, setNotice] = useState<'added' | 'removed' | null>(null);
  const supported = browserSupportsWebAuthn();

  useEffect(() => {
    let active = true;
    request<{ items: Passkey[] }>(endpoint).then(
      (result) => {
        if (active) setItems(result.items);
      },
      (cause) => {
        if (active) setError(cause);
      },
    );
    return () => {
      active = false;
    };
  }, []);

  async function perform(
    action: Action,
    proof?: { password: FormDataEntryValue | null; code: string },
  ) {
    setBusy(true);
    setError('');
    setNotice(null);
    setRegistrationFailure(false);
    try {
      if (proof) await request('/api/auth/reauthenticate', proof);
      setPending(null);
      if (action.type === 'add') {
        const optionsJSON = await request<PublicKeyCredentialCreationOptionsJSON>(
          endpoint + '/register/options',
          {},
        );
        const response = await startRegistration({ optionsJSON });
        await request(endpoint + '/register/verify', {
          challenge: optionsJSON.challenge,
          response,
        });
        setNotice('added');
      } else {
        await request(endpoint + '/remove', { id: action.id });
        setNotice('removed');
      }
      setItems((await request<{ items: Passkey[] }>(endpoint)).items);
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'REAUTH_REQUIRED') {
        setPending(action);
        setBackup(false);
      } else {
        setError(cause);
        setRegistrationFailure(!(cause instanceof ApiError));
      }
    } finally {
      setBusy(false);
    }
  }

  function reauthenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    event.currentTarget.reset();
    if (pending)
      void perform(pending, {
        password: form.get('password'),
        code: String(form.get('code')).trim(),
      });
  }

  return (
    <section className={onContinue ? 'sign-in-verification' : 'profile-editor'}>
      {onContinue ? <h1>{t('passkeyFaster')}</h1> : <h2>Passkey</h2>}
      <p>{t('passkeyIntro')}</p>
      {Boolean(error) && (
        <p role="alert" className="notice error">
          {registrationFailure ? t('passkeyFailed') : errorText(error)}
        </p>
      )}
      {notice && (
        <p role="status" className="notice success">
          {t(notice === 'added' ? 'passkeyAdded' : 'passkeyRemoved')}
        </p>
      )}
      {!onContinue && items?.length === 0 && <p>{t('noPasskeys')}</p>}
      {!onContinue && Boolean(items?.length) && (
        <ul className="session-list">
          {items?.map((item) => (
            <li key={item.id}>
              <strong>
                {t('passkeyCreated')}{' '}
                {new Date(item.createdAt).toLocaleDateString(locale === 'en' ? 'en-US' : 'vi-VN')}
              </strong>
              <p>
                {item.lastUsedAt
                  ? t('lastUsed') +
                    ' ' +
                    new Date(item.lastUsedAt).toLocaleString(locale === 'en' ? 'en-US' : 'vi-VN')
                  : t('neverUsed')}
              </p>
              <button
                type="button"
                className="secondary"
                disabled={busy || Boolean(pending)}
                onClick={() => {
                  if (window.confirm(t('removePasskeyConfirm')))
                    void perform({ type: 'remove', id: item.id });
                }}
              >
                {t('removePasskey')}
              </button>
            </li>
          ))}
        </ul>
      )}
      {supported && !pending && !notice && (
        <button
          type="button"
          className={onContinue ? 'primary' : 'secondary'}
          disabled={busy || !items}
          onClick={() => void perform({ type: 'add' })}
        >
          {busy ? t('settingUp') : t('createPasskey')}
        </button>
      )}
      {supported && !pending && notice && !onContinue && (
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => void perform({ type: 'add' })}
        >
          {t('createPasskey')}
        </button>
      )}
      {!supported && <p>{t('unsupportedPasskey')}</p>}
      {pending && (
        <form onSubmit={reauthenticate} aria-busy={busy}>
          <h3>{t(pending.type === 'add' ? 'verifyCreatePasskey' : 'verifyRemovePasskey')}</h3>
          <fieldset disabled={busy}>
            <label className="field">
              {t('password')}
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                maxLength={128}
                required
              />
            </label>
            <label className="field">
              {backup ? t('backupCode') : t('authenticatorCode')}
              <input
                key={String(backup)}
                name="code"
                autoComplete="one-time-code"
                inputMode={backup ? 'text' : 'numeric'}
                pattern={backup ? undefined : '[0-9]{6}'}
                maxLength={backup ? 64 : 6}
                required
              />
            </label>
            <button className="primary" type="submit">
              {t('verifyAndContinue')}
            </button>
            <button className="secondary" type="button" onClick={() => setBackup(!backup)}>
              {backup ? t('useAuthenticator') : t('useBackupCode')}
            </button>
            <button className="secondary" type="button" onClick={() => setPending(null)}>
              {t('cancel')}
            </button>
          </fieldset>
        </form>
      )}
      {onContinue && (
        <div className="verification-actions">
          <button type="button" disabled={busy} onClick={onContinue}>
            {notice ? t('continue') : t('later')}
          </button>
        </div>
      )}
    </section>
  );
}
