import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { act,cleanup,fireEvent,render,screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { DashboardShell } from './DashboardShell';
import { setLocale } from '../../i18n';
import type { Profile } from '../../services/api';
const profile:Profile={user:{id:'employee',email:'employee@example.test',fullName:'Test Employee'},organization:{id:'org',name:'Company',role:'EMPLOYEE'},permissions:{invite:false,grantHR:false},deliveryMode:'DEV_ONLY'};
it('updates workspace navigation when changing language', () => {
 const admin:Profile={...profile,organization:{...profile.organization,role:'ADMIN'},permissions:{invite:true,grantHR:true,readUsers:true,manageOrg:true,viewAudit:true}};
 setLocale('vi');
 render(<DashboardShell profile={admin} path="/admin/units" profileView={false} busy={false} onLogout={()=>{}}>Content</DashboardShell>);
 fireEvent.change(screen.getByLabelText('Ngôn ngữ'), {target:{value:'en'}});
 expect(screen.getByRole('link',{name:'Home'})).toBeVisible();
 expect(screen.getByRole('button',{name:'Catalog'})).toBeVisible();
 expect(screen.getByRole('link',{name:'Units'})).toBeVisible();
 expect(screen.getByText(/Company · Administrator/)).toBeVisible();
 fireEvent.change(screen.getByLabelText('Language'), {target:{value:'vi'}});
 expect(screen.getByRole('link',{name:'Đơn vị'})).toBeVisible();
});
it('groups reference catalogs, highlights the active page and reopens the correct group on navigation',()=>{
 const admin:Profile={...profile,organization:{...profile.organization,role:'ADMIN'},permissions:{invite:true,grantHR:true,readUsers:true,manageOrg:true,viewAudit:true}};
 const view=render(<DashboardShell profile={admin} path="/admin/units" profileView={false} busy={false} onLogout={()=>{}}>Units</DashboardShell>);
 expect(screen.getByRole('button',{name:'Danh mục'})).toHaveAttribute('aria-expanded','true');
 expect(screen.getByRole('link',{name:'Đơn vị'})).toHaveAttribute('aria-current','page');
 for(const name of ['Phòng ban','Chức danh và vị trí','Ca làm việc','Loại nghỉ phép','Chế độ chấm công'])expect(screen.getByRole('link',{name})).toBeVisible();
 expect(screen.getByRole('link',{name:'Đơn vị'}).querySelector('svg')).toBeInTheDocument();
 view.rerender(<DashboardShell profile={admin} path="/admin/attendance" profileView={false} busy={false} onLogout={()=>{}}>Attendance</DashboardShell>);
 expect(screen.getByRole('button',{name:'Hồ sơ nhân viên'})).toHaveAttribute('aria-expanded','true');
 expect(screen.getByRole('button',{name:'Danh mục'})).toHaveAttribute('aria-expanded','false');
 expect(screen.getByRole('link',{name:'Chấm công và nghỉ phép'})).toHaveAttribute('aria-current','page');
});

it('keeps organization selection available without exposing management catalogs to employees',()=>{
 render(<DashboardShell profile={profile} path="/admin/units" profileView={false} busy={false} onLogout={()=>{}}>Units</DashboardShell>);
 expect(screen.getByRole('link',{name:'Đơn vị'})).toBeVisible();
 expect(screen.queryByRole('link',{name:'Phòng ban'})).not.toBeInTheDocument();
 expect(screen.queryByRole('link',{name:'Ca làm việc'})).not.toBeInTheDocument();
});
it('Managers can discover scoped chart, departments and positions without mutation privileges',()=>{
 const manager:Profile={...profile,organization:{...profile.organization,role:'MANAGER'},permissions:{invite:false,grantHR:false,readUsers:true,manageOrg:false}};
 render(<DashboardShell profile={manager} path="/admin/org-chart" profileView={false} busy={false} onLogout={()=>{}}>Chart</DashboardShell>);
 expect(screen.getByRole('link',{name:'Sơ đồ tổ chức'})).toHaveAttribute('href','/admin/org-chart');
 fireEvent.click(screen.getByRole('button',{name:'Danh mục'}));
 expect(screen.getByRole('link',{name:'Phòng ban'})).toBeVisible();
 expect(screen.getByRole('link',{name:'Chức danh và vị trí'})).toBeVisible();
 expect(screen.queryByRole('link',{name:'Ca làm việc'})).not.toBeInTheDocument();
 expect(screen.queryByRole('link',{name:'Lời mời'})).not.toBeInTheDocument();
});
beforeEach(()=>{Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(this:HTMLDialogElement){this.setAttribute('open','');}});Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value:function(this:HTMLDialogElement){this.removeAttribute('open');}});});afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('opens the employee navigation when loading attendance directly', () => {
 render(<DashboardShell profile={profile} path="/admin/attendance" profileView={false} busy={false} onLogout={()=>{}}>Attendance</DashboardShell>);
 expect(screen.getByRole('link', { name: 'Chấm công và nghỉ phép' })).toHaveAttribute('aria-current', 'page');
});
it('mobile navigation restores body scrolling and opener focus on Escape',()=>{render(<DashboardShell profile={profile} path="/app" profileView={false} busy={false} onLogout={()=>{}}>Dashboard</DashboardShell>);const opener=screen.getByRole('button',{name:'Mở điều hướng'});opener.focus();fireEvent.click(opener);expect(document.body.style.overflow).toBe('hidden');const modal=screen.getByRole('dialog',{name:'Điều hướng'});fireEvent(modal,new Event('cancel',{cancelable:true}));expect(document.body.style.overflow).toBe('');expect(opener).toHaveFocus();expect(screen.queryByRole('dialog')).not.toBeInTheDocument();});
it('does not leave scroll locked if the shell unmounts with navigation open',()=>{const view=render(<DashboardShell profile={profile} path="/app" profileView={false} busy={false} onLogout={()=>{}}>Dashboard</DashboardShell>);fireEvent.click(screen.getByRole('button',{name:'Mở điều hướng'}));view.unmount();expect(document.body.style.overflow).toBe('');});
it('closes mobile menu when resizing to desktop',()=>{let resized:()=>void=()=>{};const media={matches:false,addEventListener:vi.fn((_name:string,handler:()=>void)=>{resized=handler;}),removeEventListener:vi.fn()};vi.stubGlobal('matchMedia',()=>media);render(<DashboardShell profile={profile} path="/app" profileView={false} busy={false} onLogout={()=>{}}>Dashboard</DashboardShell>);fireEvent.click(screen.getByRole('button',{name:'Mở điều hướng'}));media.matches=true;act(resized);expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(document.body.style.overflow).toBe('');});

it('previews an unpinned desktop rail without changing the compact workspace',()=>{render(<DashboardShell profile={profile} path="/app" profileView={false} busy={false} onLogout={()=>{}}>Dashboard</DashboardShell>);fireEvent.click(screen.getByRole('button',{name:'Thu gọn thanh điều hướng'}));const sidebar=document.querySelector('.dash-sidebar')!;expect(sidebar).toHaveAttribute('data-expanded','false');fireEvent.pointerEnter(sidebar,{pointerType:'mouse'});expect(sidebar).toHaveAttribute('data-expanded','true');expect(sidebar).toHaveAttribute('data-preview','true');expect(document.querySelector('.hr-workspace')).toHaveClass('is-compact');fireEvent.pointerLeave(sidebar);expect(sidebar).toHaveAttribute('data-expanded','false');});
it('uses one accordion group and removes collapsed links from interaction',()=>{const adminProfile:Profile={...profile,permissions:{readUsers:true,invite:true,grantHR:true,manageUsers:true,viewAudit:true}};render(<DashboardShell profile={adminProfile} path="/admin/users" profileView={false} busy={false} onLogout={()=>{}}>Dashboard</DashboardShell>);const org=screen.getByRole('button',{name:'Quản lý tổ chức'}),account=screen.getByRole('button',{name:'Tài khoản'});expect(org).toHaveAttribute('aria-expanded','true');expect(account).toHaveAttribute('aria-expanded','false');fireEvent.click(account);expect(org).toHaveAttribute('aria-expanded','false');expect(account).toHaveAttribute('aria-expanded','true');expect(document.getElementById('desktop-nav-organization')).toHaveAttribute('inert');expect(screen.getByRole('link',{name:'Thông tin cá nhân'})).toBeVisible();fireEvent.click(account);expect(account).toHaveAttribute('aria-expanded','false');expect(screen.queryByRole('link',{name:'Thông tin cá nhân'})).not.toBeInTheDocument();});
it('expands the rail for keyboard navigation',()=>{render(<DashboardShell profile={profile} path="/app" profileView={false} busy={false} onLogout={()=>{}}>Dashboard</DashboardShell>);fireEvent.click(screen.getByRole('button',{name:'Thu gọn thanh điều hướng'}));const sidebar=document.querySelector('.dash-sidebar')!;fireEvent.keyDown(window,{key:'Tab'});fireEvent.focus(screen.getByRole('link',{name:'Trang chủ'}));expect(sidebar).toHaveAttribute('data-expanded','true');});
it('merges dashboard and overview into a single Trang chủ link',()=>{render(<DashboardShell profile={profile} path="/app" profileView={false} busy={false} onLogout={()=>{}}>Dashboard</DashboardShell>);const home=screen.getByRole('link',{name:'Trang chủ'});expect(home).toBeVisible();expect(home).toHaveAttribute('href','/app');expect(home).toHaveAttribute('aria-current','page');expect(screen.queryByRole('button',{name:'Bảng điều khiển'})).not.toBeInTheDocument();expect(screen.queryByRole('link',{name:'Tổng quan'})).not.toBeInTheDocument();});
