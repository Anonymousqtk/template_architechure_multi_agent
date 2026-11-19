import { browserSupportsWebAuthn, startRegistration, type PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser';
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, errorText, request } from './api';

const endpoint = '/api/auth/passkeys';
type Passkey = { id: string; createdAt: string; lastUsedAt: string | null };
type Action = { type: 'add' } | { type: 'remove'; id: string };

export function PasskeySettings({ onContinue }: { onContinue?: () => void }) {
  const [items, setItems] = useState<Passkey[] | null>(null);
  const [pending, setPending] = useState<Action | null>(null);
  const [backup, setBackup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const supported = browserSupportsWebAuthn();

  useEffect(() => {
    let active = true;
    request<{ items: Passkey[] }>(endpoint).then(
      result => { if (active) setItems(result.items); },
      cause => { if (active) setError(errorText(cause)); },
    );
    return () => { active = false; };
  }, []);

  async function perform(action: Action, proof?: { password: FormDataEntryValue | null; code: string }) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (proof) await request('/api/auth/reauthenticate', proof);
      setPending(null);
      if (action.type === 'add') {
        const optionsJSON = await request<PublicKeyCredentialCreationOptionsJSON>(endpoint + '/register/options', {});
        const response = await startRegistration({ optionsJSON });
        await request(endpoint + '/register/verify', { challenge: optionsJSON.challenge, response });
        setNotice('Đã thêm passkey.');
      } else {
        await request(endpoint + '/remove', { id: action.id });
        setNotice('Đã xóa passkey và đăng xuất các phiên khác.');
      }
      setItems((await request<{ items: Passkey[] }>(endpoint)).items);
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'REAUTH_REQUIRED') {
        setPending(action);
        setBackup(false);
      } else {
        setError(cause instanceof ApiError ? errorText(cause) : 'Không thể tạo passkey. Hãy kiểm tra yêu cầu xác minh trên thiết bị và thử lại.');
      }
    } finally {
      setBusy(false);
    }
  }

  function reauthenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    event.currentTarget.reset();
    if (pending) void perform(pending, { password: form.get('password'), code: String(form.get('code')).trim() });
  }

  return <section className={onContinue ? 'sign-in-verification' : 'profile-editor'}>
    {onContinue ? <h1>Đăng nhập nhanh hơn với passkey</h1> : <h2>Passkey</h2>}
    <p>Dùng vân tay, khuôn mặt hoặc PIN thiết bị để đăng nhập lần sau.</p>
    {error && <p role="alert" className="notice error">{error}</p>}
    {notice && <p role="status" className="notice success">{notice}</p>}
    {!onContinue && items?.length === 0 && <p>Chưa có passkey cho trang này.</p>}
    {!onContinue && Boolean(items?.length) && <ul className="session-list">{items?.map(item => <li key={item.id}>
      <strong>Passkey tạo ngày {new Date(item.createdAt).toLocaleDateString('vi-VN')}</strong>
      <p>{item.lastUsedAt ? 'Dùng lần cuối ' + new Date(item.lastUsedAt).toLocaleString('vi-VN') : 'Chưa dùng để đăng nhập'}</p>
      <button type="button" className="secondary" disabled={busy || Boolean(pending)}
        onClick={() => { if (window.confirm('Xóa passkey này và đăng xuất các phiên khác?')) void perform({ type: 'remove', id: item.id }); }}>Xóa passkey</button>
    </li>)}</ul>}
    {supported && !pending && !notice && <button type="button" className={onContinue ? 'primary' : 'secondary'}
      disabled={busy || !items} onClick={() => void perform({ type: 'add' })}>{busy ? 'Đang thiết lập…' : 'Tạo passkey'}</button>}
    {supported && !pending && notice && !onContinue && <button type="button" className="secondary" disabled={busy}
      onClick={() => void perform({ type: 'add' })}>Tạo passkey</button>}
    {!supported && <p>Trình duyệt này chưa hỗ trợ tạo passkey.</p>}
    {pending && <form onSubmit={reauthenticate} aria-busy={busy}>
      <h3>Xác minh để {pending.type === 'add' ? 'tạo' : 'xóa'} passkey</h3>
      <fieldset disabled={busy}>
        <label className="field">Mật khẩu<input name="password" type="password" autoComplete="current-password" maxLength={128} required /></label>
        <label className="field">{backup ? 'Mã dự phòng' : 'Mã 6 số từ Authenticator'}
          <input key={String(backup)} name="code" autoComplete="one-time-code" inputMode={backup ? 'text' : 'numeric'}
            pattern={backup ? undefined : '[0-9]{6}'} maxLength={backup ? 64 : 6} required />
        </label>
        <button className="primary" type="submit">Xác minh và tiếp tục</button>
        <button className="secondary" type="button" onClick={() => setBackup(!backup)}>{backup ? 'Dùng Authenticator' : 'Dùng mã dự phòng'}</button>
        <button className="secondary" type="button" onClick={() => setPending(null)}>Hủy</button>
      </fieldset>
    </form>}
    {onContinue && <div className="verification-actions"><button type="button" disabled={busy} onClick={onContinue}>{notice ? 'Tiếp tục' : 'Để sau'}</button></div>}
  </section>;
}
