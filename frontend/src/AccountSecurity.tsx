import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, errorText, request, type Profile } from './api';
type FactorStatus={enabled:boolean;required:boolean;verified:boolean;recoveryCodesRemaining:number};
type Session={id:string;deviceLabel:string;createdAt:string;lastSeenAt:string;expiresAt:string;current:boolean};
export function AccountSecurity({profile}:{profile:Profile}) {
  const [status,setStatus]=useState<FactorStatus|null>(null),[sessions,setSessions]=useState<Session[]>([]),[password,setPassword]=useState(''),[code,setCode]=useState('');
  const [secret,setSecret]=useState(''),[recovery,setRecovery]=useState<string[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const [operation,setOperation]=useState<'reauth'|'replace'|'disable'|''>('');
  const [useBackup,setUseBackup]=useState(false);
  const [sessionsLoaded,setSessionsLoaded]=useState(false),[pendingSession,setPendingSession]=useState(''),[sessionPassword,setSessionPassword]=useState(''),[sessionCode,setSessionCode]=useState(''),[sessionBackup,setSessionBackup]=useState(false);
  const canAdminister=Boolean(profile.permissions.manageUsers||profile.permissions.assignRoles||profile.permissions.invite);
  const limited=Boolean(profile.security?.mfaRequired&&!profile.security?.mfaVerified);
  useEffect(()=>{let alive=true;request<FactorStatus>('/api/auth/mfa/status').then(r=>{if(alive)setStatus(r);}).catch(e=>{if(alive)setError(errorText(e));});if(!limited)request<{items:Session[]}>('/api/auth/sessions').then(r=>{if(alive){setSessions(r.items);setSessionsLoaded(true);}}).catch(e=>{if(alive)setError(errorText(e));});return()=>{alive=false;};},[limited]);
  async function action(path:string,body:unknown) {setBusy(true);setError('');setMessage('');try{await request(path,body);setPassword('');setCode('');window.location.assign(path==='/api/auth/mfa/verify'?'/app':'/security');}catch(e){setError(errorText(e));}finally{setBusy(false);}}
  async function revokeSession(path:string,afterProof=false) {
    setBusy(true);setError('');setMessage('');
    try {
      if(afterProof)await request('/api/auth/reauthenticate',{password:sessionPassword,...(status?.enabled?{code:sessionCode}:{})});
      await request(path,{});
      setPendingSession('');setSessionsLoaded(false);
      setMessage('Đã đăng xuất các phiên đã chọn. Phiên hiện tại vẫn được giữ.');
      try {const result=await request<{items:Session[]}>('/api/auth/sessions');setSessions(result.items);setSessionsLoaded(true);}catch {setError('Đã đăng xuất thành công nhưng chưa tải lại được danh sách. Hãy tải lại trang.');}
    } catch(e) {
      if(!afterProof&&e instanceof ApiError&&e.code==='REAUTH_REQUIRED') {setPendingSession(path);setSessionBackup(false);setOperation('');}
      else setError(errorText(e));
    } finally {setSessionPassword('');setSessionCode('');setBusy(false);}
  }
  function chooseSession(path:string) {
    if(window.confirm('Đăng xuất các phiên đã chọn của bạn? Phiên hiện tại vẫn được giữ.'))void revokeSession(path);
  }
  async function begin(e:FormEvent) {e.preventDefault();setBusy(true);setError('');try{const result=await request<{secret:string}>('/api/auth/mfa/enroll',{password});setSecret(result.secret);setPassword('');}catch(e){setError(errorText(e));}finally{setBusy(false);}}
  async function confirm(e:FormEvent) {e.preventDefault();setBusy(true);setError('');try{const result=await request<{recoveryCodes:string[]}>('/api/auth/mfa/confirm',{code});setRecovery(result.recoveryCodes);setSecret('');setCode('');}catch(e){setError(errorText(e));}finally{setBusy(false);}}
  async function replaceRecovery() {setBusy(true);setError('');try{const result=await request<{recoveryCodes:string[]}>('/api/auth/mfa/recovery-codes',{password,code});setRecovery(result.recoveryCodes);setPassword('');setCode('');}catch(e){setError(errorText(e));}finally{setBusy(false);}}
  function downloadRecovery() {
    const blob=new Blob(['ManagerHR — Mã dự phòng\nGiữ kín. Mỗi mã dùng một lần khi không có Authenticator.\n\n'+recovery.join('\n')],{type:'text/plain;charset=utf-8'});
    const url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download='managerhr-ma-du-phong.txt';document.body.appendChild(link);
    try {link.click();} finally {link.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1000);}
  }
  const passwordField=<label className="field">Mật khẩu hiện tại<input type="password" autoComplete="current-password" value={password} maxLength={128} required onChange={e=>setPassword(e.target.value)} disabled={busy}/></label>;
  const codeField=<label className="field">Mã xác thực hoặc mã khôi phục<input autoComplete="one-time-code" value={code} maxLength={64} required onChange={e=>setCode(e.target.value.trim())} disabled={busy}/></label>;
  const authenticatorField=<label className="field">Mã 6 số từ Authenticator<input autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" minLength={6} maxLength={6} value={code} required onChange={e=>setCode(e.target.value.trim())} disabled={busy}/></label>;
  const proofField=<>{useBackup?codeField:authenticatorField}<button type="button" className="secondary" disabled={busy} onClick={()=>{setUseBackup(!useBackup);setCode('');}}>{useBackup?'Dùng ứng dụng Authenticator':'Không dùng được ứng dụng? Dùng mã dự phòng'}</button><p>Chỉ nhập một mã. Mã dự phòng chỉ dùng khi không có ứng dụng Authenticator.</p></>;
  const recoveryHelp=<details className="profile-editor"><summary>Mất thiết bị xác thực?</summary><p>Chỉ dùng để thiết lập lại MFA khi mất thiết bị, không phải để lưu mã dự phòng. Nhập mật khẩu và một mã khôi phục chưa dùng. Tất cả phiên, khóa MFA và mã cũ sẽ bị thu hồi; Admin/HR phải thiết lập MFA mới.</p><form onSubmit={e=>{e.preventDefault();if(window.confirm('Khôi phục MFA và thu hồi mọi phiên đăng nhập?'))void action('/api/auth/mfa/recover',{password,code});}}>{passwordField}{codeField}<button className="primary" disabled={busy}>Khôi phục bằng mã dự phòng</button></form></details>;
  if(recovery.length)return <><h1>Lưu mã khôi phục</h1><p>Thiết lập đã hoàn tất. Lưu toàn bộ danh sách ở nơi riêng tư. Không cần nhập lại bất kỳ mã nào để xác nhận lưu. Mỗi mã chỉ dùng một lần khi không có ứng dụng Authenticator.</p><ul className="recovery-codes">{recovery.map(value=><li key={value}><code>{value}</code></li>)}</ul><p>Danh sách chỉ hiển thị lần này. Lưu tệp ở nơi riêng tư hoặc trong trình quản lý mật khẩu; không gửi qua tin nhắn.</p><button className="secondary" onClick={downloadRecovery}>Tải bộ mã dự phòng</button><button className="primary" onClick={()=>window.location.assign('/app')}>Tôi đã lưu mã khôi phục</button></>;
  return <><div className="eyebrow">BẢO VỆ TÀI KHOẢN</div><h1>{limited?'Xác minh tài khoản':'Bảo mật & thiết bị'}</h1>{error&&<p role="alert" className="notice error">{error}</p>}{message&&<p role="status" className="notice success">{message}</p>}
    {limited&&<p className="notice success">Tài khoản cần hoàn tất xác thực hai bước trước khi truy cập chức năng khác.</p>}{!status&&<p role="status">Đang tải cấu hình bảo mật…</p>}
    {status&&!status.enabled&&!secret&&<form className="profile-editor" onSubmit={begin}><h2>Bật xác thực hai bước</h2><p>Dùng ứng dụng Authenticator hỗ trợ TOTP. Admin và HR bắt buộc bật tính năng này.</p>{passwordField}<button className="primary" disabled={busy}>Bắt đầu thiết lập</button></form>}
    {secret&&<form className="profile-editor" onSubmit={confirm}><h2>Thêm khóa vào Authenticator</h2><p>Chọn nhập khóa thủ công, loại mã theo thời gian (TOTP), tên tài khoản ManagerHR.</p><label className="field">Khóa thiết lập<input readOnly value={secret} autoComplete="off"/></label><p>Không chia sẻ khóa này. Nhập một mã 6 số từ ứng dụng để hoàn tất.</p>{authenticatorField}<button className="primary" disabled={busy}>Xác nhận thiết lập</button></form>}
    {status?.enabled&&limited&&<form className="profile-editor" onSubmit={e=>{e.preventDefault();void action('/api/auth/mfa/verify',{code});}}><h2>Xác thực hai bước</h2><p>Chỉ nhập một mã, không nhập toàn bộ mã dự phòng.</p>{proofField}<button className="primary" disabled={busy}>Xác thực</button></form>}
    {status?.enabled&&!limited&&<><p className="notice success">Tài khoản đã được bảo vệ bằng xác thực hai bước.</p>
      {(canAdminister||!status.required)&&<label className="field">Thao tác bảo mật<select value={operation} disabled={busy} onChange={e=>{setOperation(e.target.value as typeof operation);setPassword('');setCode('');setUseBackup(false);setError('');}}><option value="">Chọn khi cần thay đổi</option>{operation==='replace'&&<option value="replace">Tạo bộ mã dự phòng mới</option>}{canAdminister&&<option value="reauth">Xác thực lại cho thao tác nhạy cảm</option>}{!status.required&&<option value="disable">Tắt xác thực hai bước</option>}</select></label>}
      <details className="profile-editor"><summary>Khôi phục tài khoản</summary><p>Còn {status.recoveryCodesRemaining} mã dự phòng. Chỉ dùng khi không dùng được ứng dụng Authenticator; mỗi lần chỉ nhập một mã.</p><p>Không thể xem hoặc tải lại bộ mã đã tạo. Nếu còn giữ bộ mã, bạn không cần tạo lại.</p>{status.recoveryCodesRemaining===0&&<p role="alert">Bạn đã hết mã dự phòng. Khi còn truy cập Authenticator, hãy tạo bộ mới và lưu lại.</p>}<button className="secondary" disabled={busy} onClick={()=>{setOperation('replace');setPassword('');setCode('');setUseBackup(false);setError('');}}>Tạo bộ mã dự phòng mới</button>{!operation&&recoveryHelp}</details>
      {operation&&<form className="profile-editor" onSubmit={e=>{e.preventDefault();if(operation==='replace'){if(window.confirm('Bộ mã cũ và các phiên khác sẽ bị thu hồi. Tiếp tục?'))void replaceRecovery();}else if(operation==='disable'){if(window.confirm('Tắt xác thực hai bước?'))void action('/api/auth/mfa/disable',{password,code});}else void action('/api/auth/reauthenticate',{password,code});}}>
        <h2>{operation==='replace'?'Tạo mã khôi phục mới':operation==='disable'?'Tắt xác thực hai bước':'Xác thực lại'}</h2>
        <p>{operation==='replace'?'Chỉ tạo bộ mới khi cần thay bộ cũ. Nhập một mã; không cần xác thực ở biểu mẫu khác trước bước này.':'Nhập mật khẩu và một mã mới. Mã vừa dùng không thể dùng lại; hãy đợi mã tiếp theo từ ứng dụng.'}</p>
        {passwordField}{proofField}<button className="primary" disabled={busy}>{operation==='replace'?'Tạo mã khôi phục mới':operation==='disable'?'Tắt MFA':'Xác thực lại'}</button>
      </form>}
    </>}
    {canAdminister&&!limited&&status&&!status.enabled&&<form className="profile-editor" onSubmit={e=>{e.preventDefault();void action('/api/auth/reauthenticate',{password});}}><h2>Xác thực lại</h2>{passwordField}<button className="primary" disabled={busy}>Xác thực lại</button></form>}
    {status?.enabled&&limited&&recoveryHelp}
    {!limited&&<details className="user-detail"><summary>Thiết bị & đăng nhập</summary>
      <p>Bạn chỉ xem và đăng xuất các phiên của chính mình. Phiên hiện tại vẫn được giữ. Tên trình duyệt chỉ hỗ trợ nhận biết, không xác minh danh tính thiết bị.</p>
      <p>Phiên tự hết hạn sau 30 phút không hoạt động, tối đa 8 giờ.</p>
      {!sessionsLoaded?<p role="status">Chưa có danh sách phiên. Hãy tải lại trang nếu dữ liệu không xuất hiện.</p>:<>
        {!sessions.some(session=>!session.current)&&<p>Không có phiên đăng nhập nào khác.</p>}
        {sessions.some(session=>!session.current)&&<button className="secondary" disabled={busy||Boolean(pendingSession)} onClick={()=>chooseSession('/api/auth/sessions/revoke-others')}>Đăng xuất khỏi các phiên khác của bạn</button>}
        <ul className="session-list">{sessions.map(session=><li key={session.id}><strong>{session.deviceLabel}{session.current?' · Phiên hiện tại':''}</strong><p>Hoạt động gần nhất: {new Date(session.lastSeenAt).toLocaleString('vi-VN')}<br/>Hết hạn tối đa: {new Date(session.expiresAt).toLocaleString('vi-VN')}</p>{!session.current&&<button className="secondary" disabled={busy||Boolean(pendingSession)} onClick={()=>chooseSession('/api/auth/sessions/'+encodeURIComponent(session.id)+'/revoke')}>Đăng xuất phiên {session.deviceLabel}</button>}</li>)}</ul>
      </>}
      {pendingSession&&<form className="profile-editor" aria-busy={busy} onSubmit={e=>{e.preventDefault();void revokeSession(pendingSession,true);}}><h2>Xác nhận đăng xuất các phiên khác</h2><p>Để bảo vệ tài khoản, hãy xác thực lại một lần. Sau đó hệ thống sẽ tiếp tục thao tác bạn vừa chọn.</p>
        <label className="field">Mật khẩu để xác nhận đăng xuất<input autoFocus type="password" autoComplete="current-password" maxLength={128} required disabled={busy} value={sessionPassword} onChange={e=>setSessionPassword(e.target.value)}/></label>
        {status?.enabled&&<><label className="field">{sessionBackup?'Một mã dự phòng':'Mã Authenticator để xác nhận đăng xuất'}<input autoComplete="one-time-code" inputMode={sessionBackup?'text':'numeric'} pattern={sessionBackup?undefined:'[0-9]{6}'} minLength={sessionBackup?undefined:6} maxLength={sessionBackup?64:6} required disabled={busy} value={sessionCode} onChange={e=>setSessionCode(e.target.value.trim())}/></label><button className="secondary" type="button" disabled={busy} onClick={()=>{setSessionBackup(!sessionBackup);setSessionCode('');}}>{sessionBackup?'Dùng Authenticator':'Không dùng được ứng dụng? Dùng một mã dự phòng'}</button></>}
        <button className="primary" disabled={busy||!status}>Xác nhận và đăng xuất phiên đã chọn</button><button className="secondary" type="button" disabled={busy} onClick={()=>{setPendingSession('');setSessionPassword('');setSessionCode('');setError('');}}>Hủy đăng xuất</button>
      </form>}
    </details>}
  </>;
}
