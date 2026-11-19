import type { Profile } from './api';

type Props={profile:Profile;path:string};
export function WorkspaceNav({profile,path}:Props) {
  const organization=path.startsWith('/admin/');
  const links=organization?[
    ...(profile.permissions.readUsers?[{href:'/admin/users',label:profile.organization.role==='MANAGER'?'Nhóm của tôi':'Thành viên'}]:[]),
    ...(profile.permissions.invite?[{href:'/admin/invitations',label:'Lời mời'}]:[]),
    ...(profile.permissions.viewAudit?[{href:'/admin/audit',label:'Nhật ký hoạt động'}]:[]),
  ]:[{href:'/app',label:'Thông tin cá nhân'},{href:'/security',label:'Bảo mật & thiết bị'}];
  if(!links.length)return null;
  return <nav className="section-nav" aria-label={organization?'Quản lý tổ chức':'Cài đặt tài khoản'}>{links.map(link=><a key={link.href} href={link.href} aria-current={path===link.href?'page':undefined}>{link.label}</a>)}</nav>;
}
