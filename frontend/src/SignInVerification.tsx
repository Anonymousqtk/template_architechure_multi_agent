import { useEffect, useRef, useState, type FormEvent } from 'react';
import { errorText, request } from './api';

export function SignInVerification({ email, onVerified, onCancel }: {
  email: string;
  onVerified: () => Promise<void>;
  onCancel: () => void;
}) {
  const [method, setMethod] = useState<'totp' | 'backup' | 'recover'>('totp');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
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
      setError(errorText(cause));
      if (input.current) input.current.value = '';
      requestAnimationFrame(() => input.current?.focus());
    } finally {
      setBusy(false);
    }
  }

  const totp = method === 'totp';
  const recover = method === 'recover';
  return <section className="sign-in-verification">
    <span className="eyebrow">Bước 2/2</span>
    <h1>{recover ? 'Thiết lập lại xác thực hai bước' : 'Xác minh đăng nhập'}</h1>
    <p className="muted">{email}</p>
    <p>{totp ? 'Nhập mã hiện tại từ ứng dụng Authenticator.' :
      recover ? 'Nhập mật khẩu và một mã dự phòng. Các phiên, phương thức xác thực và mã cũ sẽ bị thu hồi.' :
        'Nhập một mã dự phòng chưa sử dụng.'}</p>
    <form key={method} onSubmit={submit} aria-busy={busy}>
      <fieldset disabled={busy}>
        {recover && <label className="field" htmlFor="verify-password"><span>Mật khẩu</span>
          <input id="verify-password" name="password" type="password" autoComplete="current-password" maxLength={128} required />
        </label>}
        <label className="field" htmlFor="verification-code">
          <span>{totp ? 'Mã 6 số từ Authenticator' : 'Mã dự phòng'}</span>
          <input ref={input} id="verification-code" name="code" type="text"
            autoComplete="one-time-code" inputMode={totp ? 'numeric' : 'text'} spellCheck={false}
            pattern={totp ? '[0-9]{6}' : undefined} maxLength={totp ? 6 : 64} required
            aria-invalid={Boolean(error)} aria-describedby={error ? 'verification-error' : undefined} />
        </label>
        {error && <p id="verification-error" role="alert" className="notice error">{error}</p>}
        <button className="primary" type="submit">{busy ? 'Đang xác minh…' : recover ? 'Thu hồi và thiết lập lại' : 'Xác minh và tiếp tục'}</button>
      </fieldset>
    </form>
    <div className="verification-actions">
      <button type="button" disabled={busy} onClick={() => select(totp ? 'backup' : 'totp')}>
        {totp ? 'Dùng mã dự phòng' : 'Dùng Authenticator'}
      </button>
      {method === 'backup' && <button type="button" disabled={busy} onClick={() => select('recover')}>Thiết lập lại Authenticator</button>}
      <button type="button" disabled={busy} onClick={onCancel}>Quay lại đăng nhập</button>
    </div>
  </section>;
}
