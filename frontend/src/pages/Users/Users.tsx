import { auditEnglish } from './auditMessages';
import { userEnglish } from './userMessages';
import { AccountDetailDrawer } from '../../features/users/components/AccountDetailDrawer';
import { roleLabel,roleLabels,statusLabel,type Account } from '../../features/users/account-types';
import { useEffect, useState, type FormEvent } from 'react';
import { errorText, request, type Profile } from '../../services/api';
import { Avatar } from '../../components/common/Avatar';

export { roleLabels } from '../../features/users/account-types';
type Page<T> = {items:T[];total:number;page:number;limit:number};
function ErrorMessage({text}:{text:string}) { return text ? <p className="notice error" role="alert">{text}</p> : null; }

export function ProfileEditor({profile}:{profile:Profile}) {
  const { t } = useTranslation();
  const [name,setName]=useState(profile.user.fullName),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false);
  async function save(event:FormEvent) {event.preventDefault();setBusy(true);setError('');setSaved(false);try{await request('/api/auth/profile',{fullName:name});setSaved(true);}catch(e){setError(errorText(e));}finally{setBusy(false);}}
  return <form className="profile-editor" onSubmit={save}><h2>{t('profile')}</h2><ErrorMessage text={error}/>{saved&&<p role="status" className="notice success">{t('displayNameSaved')}</p>}<label className="field">{t('displayName')}<input value={name} onChange={e=>setName(e.target.value)} required maxLength={120} disabled={busy}/></label><button className="primary" disabled={busy}>{busy?t('saving'):t('saveProfile')}</button></form>;
}

export function UsersPanel({profile}:{profile:Profile}) {
  const { locale } = useTranslation();
  const tr = (text: string) => locale === 'en' ? (userEnglish[text] ?? text) : text;
  const [q,setQ]=useState(()=>new URLSearchParams(window.location.search).get('q')?.slice(0,100)||''),[search,setSearch]=useState(()=>new URLSearchParams(window.location.search).get('q')?.slice(0,100)||''),[role,setRole]=useState(''),[status,setStatus]=useState(''),[page,setPage]=useState(1),[revision,setRevision]=useState(0);
  const [result,setResult]=useState<Page<Account>>({items:[],total:0,page:1,limit:10}),[selectedId,setSelectedId]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(true);
  const base=`/api/organizations/${encodeURIComponent(profile.organization.id)}/users`;
  useEffect(()=>{if(!profile.permissions.readUsers)return;let alive=true;setLoading(true);setError('');const params=new URLSearchParams({q:search,page:String(page),limit:'10'});if(role)params.set('role',role);if(status)params.set('status',status);request<Page<Account>>(`${base}?${params}`).then(r=>{if(alive)setResult(r);}).catch(e=>{if(alive)setError(errorText(e));}).finally(()=>{if(alive)setLoading(false);});return()=>{alive=false;};},[base,page,search,role,status,revision,profile.permissions.readUsers]);
  if(!profile.permissions.readUsers)return <><h1>{tr("Quản lý tài khoản")}</h1><p role="alert" className="notice error">{tr("Bạn không có quyền xem danh sách tài khoản.")}</p></>;
  return <section aria-labelledby="users-heading">
    <div className="dash-header-row">
      <div>
        <div className="eyebrow">{locale === 'en' ? 'ORGANIZATION' : 'TỔ CHỨC'} · {profile.organization.name}</div>
        <h1 id="users-heading" tabIndex={-1}>{profile.organization.role==='MANAGER'?tr("Nhóm của tôi"):tr("Quản lý tài khoản")}</h1>
        <p className="muted">{tr("Danh sách được giới hạn theo vai trò và phạm vi quản lý của bạn.")}</p>
      </div>
      <div className="dash-header-actions">
        <span className="badge" style={{padding:'6px 12px',fontSize:'13px'}}>{result.total} {locale === 'en' ? 'accounts' : 'tài khoản'}</span>
      </div>
    </div>
    <ErrorMessage text={error}/>
    <form className="user-filters" onSubmit={e=>{e.preventDefault();setSearch(q);setPage(1);}}>
      <label className="field">{tr("Tìm tài khoản")}<input type="search" value={q} onChange={e=>setQ(e.target.value)} placeholder={tr("Tên hoặc email")} maxLength={100}/></label>
      <label className="field">{tr("Vai trò")}<select value={role} onChange={e=>{setRole(e.target.value);setPage(1);}}><option value="">{tr("Tất cả vai trò")}</option>{Object.entries(roleLabels).map(([value])=><option key={value} value={value}>{roleLabel(value, locale)}</option>)}</select></label>
      <label className="field">{tr("Trạng thái")}<select value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}><option value="">{tr("Tất cả trạng thái")}</option><option value="active">{tr("Đang hoạt động")}</option><option value="locked">{tr("Đã khóa")}</option><option value="inactive">{tr("Không hoạt động")}</option></select></label>
      <button className="primary" type="submit">{tr("Tìm kiếm")}</button>
    </form>
    <div className="table-wrap" aria-busy={loading}><table><caption>{loading?tr("Đang tải…"):(locale === 'en' ? `${result.total} accounts in your scope` : `${result.total} tài khoản trong phạm vi của bạn`)}</caption><thead><tr><th scope="col">{tr("Tài khoản")}</th><th scope="col">{tr("Vai trò")}</th><th scope="col">{tr("Trạng thái")}</th><th scope="col" style={{textAlign:'right'}}>{tr("Chi tiết")}</th></tr></thead><tbody>{result.items.map(user=><tr key={user.id}><td><div className="user-list-identity"><Avatar src={user.avatarUrl} name={user.fullName} className="user-list-avatar"/><div><strong>{user.fullName}</strong><small className="muted">{user.email}</small></div></div></td><td><span className="badge">{roleLabel(user.role, locale)}</span></td><td><span className={'badge ' + (user.isActive ? 'emp-badge-active' : 'emp-badge-draft')}>{tr(statusLabel(user))}</span></td><td style={{textAlign:'right'}}><button className="secondary" onClick={()=>setSelectedId(user.id)}>{tr("Xem chi tiết")}<span className="sr-only"> {user.email}</span></button></td></tr>)}{!loading&&!result.items.length&&<tr><td colSpan={4}>{tr("Không tìm thấy tài khoản phù hợp.")}</td></tr>}</tbody></table></div>
    <div className="pagination"><button disabled={page===1||loading} onClick={()=>setPage(x=>x-1)}>{tr("← Trước")}</button><span>{locale === 'en' ? 'Page' : 'Trang'} {page} / {Math.max(1,Math.ceil(result.total/10))}</span><button disabled={page*10>=result.total||loading} onClick={()=>setPage(x=>x+1)}>{tr("Sau →")}</button></div>
    {selectedId&&<AccountDetailDrawer key={profile.organization.id+':'+selectedId} id={selectedId} profile={profile} onClose={()=>setSelectedId('')} onSaved={()=>setRevision(value=>value+1)}/>}
  </section>;
}

type Audit={id:string;eventType:string;actorUserId:string|null;subjectUserId:string|null;createdAt:string;metadata:{outcome?:string;before?:{role?:string;isActive?:boolean};after?:{role?:string;isActive?:boolean}}};
const events:Record<string,string>={USER_ROLE_CHANGED:'Đổi vai trò',USER_STATUS_CHANGED:'Khóa / mở khóa tài khoản',USER_MANAGER_CHANGED:'Phân công quản lý',PROFILE_UPDATED:'Cập nhật thông tin cá nhân',ADMIN_ACTION_DENIED:'Từ chối thao tác quản trị',LOGIN:'Đăng nhập',LOGOUT:'Đăng xuất',INVITATION_CREATED:'Tạo lời mời',INVITATION_ACCEPTED:'Chấp nhận lời mời',PASSWORD_RESET:'Đặt lại mật khẩu'};
export function AuditPanel({profile}:{profile:Profile}) {
  const { locale } = useTranslation();
  const tr = (text: string) => locale === 'en' ? (auditEnglish[text] ?? text) : text;
  const [page,setPage]=useState(1),[result,setResult]=useState<Page<Audit>>({items:[],total:0,page:1,limit:20}),[error,setError]=useState(''),[loading,setLoading]=useState(true);
  useEffect(()=>{if(!profile.permissions.viewAudit)return;let alive=true;setLoading(true);request<Page<Audit>>(`/api/organizations/${profile.organization.id}/audit-events?page=${page}&limit=20`).then(r=>{if(alive){setResult(r);setError('');}}).catch(e=>{if(alive)setError(errorText(e));}).finally(()=>{if(alive)setLoading(false);});return()=>{alive=false;};},[page,profile.organization.id,profile.permissions.viewAudit]);
  if(!profile.permissions.viewAudit)return <p role="alert" className="notice error">{tr("Bạn không có quyền xem nhật ký.")}</p>;
  return <section aria-label={tr("Nhật ký quản trị")}>
    <div className="dash-header-row">
      <div>
        <h1 className="dash-page-title">{tr("Nhật ký quản trị")}</h1>
        <p className="dash-page-subtitle">{tr("Hoạt động và kết quả trong tổ chức của bạn. Định danh giúp đối chiếu người thực hiện và tài khoản liên quan.")}</p>
      </div>
      <div className="dash-header-actions">
        <span className="badge" style={{padding:'6px 12px',fontSize:'13px'}}>{result.total} {locale === 'en' ? 'events' : 's\u1ef1 ki\u1ec7n'}</span>
      </div>
    </div>
    <ErrorMessage text={error}/>
    <div className="table-wrap"><table aria-busy={loading}><caption>{result.total} {locale === 'en' ? 'events' : 's\u1ef1 ki\u1ec7n'}</caption><thead><tr><th scope="col" style={{width:'180px'}}>{tr("Thời gian")}</th><th scope="col" style={{width:'220px'}}>{tr("Hành động")}</th><th scope="col">{tr("Người thực hiện / đối tượng")}</th><th scope="col" style={{width:'140px',textAlign:'right'}}>{tr("Kết quả")}</th></tr></thead><tbody>{result.items.map(item=><tr key={item.id}><td>{new Date(item.createdAt).toLocaleString(locale === 'en' ? 'en-US' : 'vi-VN')}</td><td><strong>{events[item.eventType] ? tr(events[item.eventType]) : item.eventType}</strong>{item.metadata.after?.role&&<small className="muted">{roleLabel(item.metadata.before?.role || '', locale)} → {roleLabel(item.metadata.after.role, locale)}</small>}</td><td><small>{item.actorUserId||tr("Hệ thống")}</small><small className="muted">{item.subjectUserId||'—'}</small></td><td style={{textAlign:'right'}}><span className={'dash-status '+(item.metadata?.outcome==='DENIED'?'denied':'')}>{item.metadata?.outcome==='DENIED'?tr("Từ chối"):tr("Thành công")}</span></td></tr>)}{!loading&&!result.items.length&&<tr><td colSpan={4}>{tr("Chưa có hoạt động.")}</td></tr>}</tbody></table></div>
    <div className="pagination"><button disabled={page===1||loading} onClick={()=>setPage(x=>x-1)}>{tr("← Trước")}</button><span>{locale === 'en' ? 'Page' : 'Trang'} {page} / {Math.max(1,Math.ceil(result.total/20))}</span><button disabled={page*20>=result.total||loading} onClick={()=>setPage(x=>x+1)}>{tr("Sau →")}</button></div>
  </section>;
}
import { useTranslation } from '../../i18n';
