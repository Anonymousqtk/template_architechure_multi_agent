import type { Profile } from './api';
import { ProfileEditor, roleLabels } from './Users';

export function AccountProfile({profile}:{profile:Profile}) {
  return <><div className="eyebrow">KHÔNG GIAN LÀM VIỆC</div><h1>Xin chào, {profile.user.fullName}</h1><p className="muted">Quản lý thông tin cá nhân và bảo vệ tài khoản của bạn tại đây.</p><dl className="profile-details"><div><dt>Tổ chức</dt><dd>{profile.organization.name}</dd></div><div><dt>Email</dt><dd>{profile.user.email}</dd></div><div><dt>Vai trò</dt><dd>{roleLabels[profile.organization.role]}</dd></div></dl><ProfileEditor profile={profile} /></>;
}
