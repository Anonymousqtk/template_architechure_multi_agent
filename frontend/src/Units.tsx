import { useEffect, useState, type FormEvent } from 'react';
import { errorText, request, type Profile } from './api';
import { DashIcon } from './DashboardShell';
import './org.css';

type Unit = { id: string; name: string; code: string | null; description: string | null; isActive: boolean;
  role: string | null; current: boolean; canSelect: boolean; canEdit: boolean };
type Listing = { items: Unit[]; canCreate: boolean; canArchive: boolean };

export function Units({ onSelected }: { onSelected: (profile: Profile) => void }) {
  const [listing,setListing]=useState<Listing | null>(null);
  const [editor,setEditor]=useState<Unit | 'new' | null>(null);
  const [revision,setRevision]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const [showArchived,setShowArchived]=useState(false);
  useEffect(()=>{let live=true;request<Listing>('/api/units').then(value=>{if(live)setListing(value);}).catch(cause=>{if(live)setError(errorText(cause));});return()=>{live=false;};},[revision]);
  async function act(action:()=>Promise<unknown>,notice:string) {
    if(busy)return;
    setBusy(true);setError('');setMessage('');
    try {await action();setMessage(notice);setRevision(value=>value+1);}
    catch(cause){setError(errorText(cause));}
    finally{setBusy(false);}
  }
  async function select(unit:Unit) {
    await act(async()=>{
      await request('/api/units/'+unit.id+'/select',{},'POST');
      // Fetch the server profile after rotation; the parent clears tenant-specific component state.
      onSelected(await request<Profile>('/api/auth/me'));
    },'Đã chuyển đơn vị làm việc.');
  }
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data=new FormData(event.currentTarget);
    const body={name:String(data.get('name')??'').trim(),code:String(data.get('code')??'').trim().toUpperCase()||null,
      description:String(data.get('description')??'').trim()||null};
    await act(async()=>{
      if(editor==='new')await request('/api/units',{...body,adminEmail:String(data.get('adminEmail')??'').trim()},'POST');
      else if(editor){
        await request('/api/units/'+editor.id,body,'PATCH');
        if(editor.current)onSelected(await request<Profile>('/api/auth/me'));
      }
      setEditor(null);
    },'Đã lưu đơn vị.');
  }
  return <section className="org-view" aria-labelledby="units-heading">
    <div className="org-header-row">
      <div>
        <h1 id="units-heading">Đơn vị</h1>
        <p>Các công ty và tổ chức độc lập. Mỗi đơn vị có nhân viên, phòng ban và dữ liệu chấm công riêng.</p>
      </div>
      <div className="org-action-cell">
        {listing?.canArchive&&<label className="org-archive-check"><input type="checkbox" checked={showArchived} onChange={event=>setShowArchived(event.target.checked)}/> Hiện đơn vị đã lưu trữ</label>}
        {listing?.canCreate&&<button type="button" className="primary" disabled={busy} onClick={()=>{setEditor('new');setError('');}}>Tạo đơn vị</button>}
      </div>
    </div>

    {listing && (
      <div className="org-stats-grid">
        <div className="org-stat-card">
          <div className="org-stat-icon"><DashIcon name="building" /></div>
          <div>
            <div className="org-stat-value">{listing.items.length}</div>
            <div className="org-stat-label">Tổng số đơn vị</div>
          </div>
        </div>
        <div className="org-stat-card">
          <div className="org-stat-icon green"><DashIcon name="shield" /></div>
          <div>
            <div className="org-stat-value">{listing.items.filter(u=>u.isActive).length}</div>
            <div className="org-stat-label">Đang hoạt động</div>
          </div>
        </div>
        <div className="org-stat-card">
          <div className="org-stat-icon blue"><DashIcon name="user" /></div>
          <div>
            <div className="org-stat-value" style={{fontSize:'16px',fontWeight:600}}>{listing.items.find(u=>u.current)?.name || 'Chưa chọn'}</div>
            <div className="org-stat-label">Đơn vị hiện tại</div>
          </div>
        </div>
      </div>
    )}

    {error&&<p role="alert" className="notice error">{error}</p>}
    {message&&<p role="status" className="notice success">{message}</p>}
    {editor&&<form key={editor==='new'?'new':editor.id} onSubmit={event=>void submit(event)} className="org-form" aria-label={editor==='new'?'Tạo đơn vị':'Sửa đơn vị'}>
      <h2>{editor==='new'?'Tạo đơn vị':'Sửa đơn vị'}</h2>
      <fieldset disabled={busy}>
        <label className="field">Tên đơn vị<input name="name" defaultValue={editor==='new'?'':editor.name} required maxLength={100}/></label>
        <label className="field">Mã đơn vị<input name="code" defaultValue={editor==='new'?'':editor.code??''} maxLength={30} pattern="[A-Za-z0-9_.\-]+"/></label>
        <label className="field">Mô tả<textarea name="description" defaultValue={editor==='new'?'':editor.description??''} maxLength={500}/></label>
        {editor==='new'&&<><label className="field">Email Admin ban đầu<input name="adminEmail" type="email" required/></label>
          <p>Chỉ định một tài khoản đang hoạt động và đã xác minh email. Tài khoản này sẽ có quyền Admin trong đơn vị mới.</p></>}
        <div className="org-action-cell"><button type="submit" className="primary">{busy?'Đang lưu…':'Lưu đơn vị'}</button><button type="button" className="secondary" onClick={()=>setEditor(null)}>Hủy</button></div>
      </fieldset>
    </form>}
    {!listing&&!error&&<p role="status">Đang tải đơn vị…</p>}
    {listing&&<div className="table-wrap"><table>
      <caption>Danh sách đơn vị</caption><thead><tr><th scope="col">Đơn vị</th><th scope="col">Vai trò của bạn</th><th scope="col">Trạng thái</th><th scope="col" style={{textAlign:'right'}}>Thao tác</th></tr></thead>
      <tbody>{listing.items.filter(unit=>showArchived||unit.isActive).map(unit=><tr key={unit.id}>
        <td><strong>{unit.name}</strong>{unit.code&&<p className="org-code-sub">{unit.code}</p>}{unit.description&&<p className="muted">{unit.description}</p>}</td>
        <td><span className="badge">{({ADMIN:'Admin',HR:'Nhân sự',MANAGER:'Quản lý',EMPLOYEE:'Nhân viên'} as Record<string,string>)[unit.role??'']??'Quản trị hệ thống'}</span></td>
        <td><span className={'badge ' + (unit.current ? 'emp-badge-linked' : unit.isActive ? 'emp-badge-active' : 'emp-badge-draft')}>{unit.current?'Đang làm việc':unit.isActive?'Hoạt động':'Đã lưu trữ'}</span></td>
        <td><div className="org-action-cell" style={{justifyContent:'flex-end'}}>
          {unit.canSelect&&!unit.current&&<button type="button" className="primary" disabled={busy} onClick={()=>void select(unit)}>Chọn đơn vị</button>}
          {unit.canEdit&&<button type="button" className="secondary" disabled={busy} onClick={()=>{setEditor(unit);setError('');}}>Sửa</button>}
          {listing.canArchive&&!unit.current&&unit.isActive&&<button type="button" className="secondary" disabled={busy} onClick={()=>{
            if(window.confirm('Xóa đơn vị '+unit.name+' khỏi danh sách hoạt động? Dữ liệu được giữ để khôi phục; các phiên của đơn vị sẽ bị đăng xuất.'))void act(()=>request('/api/units/'+unit.id,{},'DELETE'),'Đã lưu trữ đơn vị.');
          }}>Xóa / lưu trữ</button>}
          {listing.canArchive&&!unit.isActive&&<button type="button" className="secondary" disabled={busy} onClick={()=>void act(()=>request('/api/units/'+unit.id,{name:unit.name,code:unit.code,description:unit.description,isActive:true},'PATCH'),'Đã khôi phục đơn vị.')}>Khôi phục</button>}
        </div></td>
      </tr>)}</tbody>
    </table></div>}
  </section>;
}
