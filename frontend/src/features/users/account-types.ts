export type Account = {
  id: string;
  email: string;
  fullName: string;
  role: string;
  isActive: boolean;
  userIsActive: boolean;
  emailVerified: boolean;
  managerUserId: string | null;
  avatarUrl?: string | null;
  departmentId?: string | null;
  positionId?: string | null;
  departmentName?: string | null;
  positionTitle?: string | null;
  createdAt: string;
};
export const roleLabels: Record<string, string> = {
  ADMIN: 'Quản trị viên',
  HR: 'Nhân sự',
  MANAGER: 'Quản lý',
  EMPLOYEE: 'Nhân viên',
};
const englishRoleLabels: Record<string, string> = {
  ADMIN: 'Administrator',
  HR: 'Human resources',
  MANAGER: 'Manager',
  EMPLOYEE: 'Employee',
};

export function roleLabel(role: string, locale: 'vi' | 'en'): string {
  const labels = locale === 'en' ? englishRoleLabels : roleLabels;
  return labels[role] ?? role;
}
export const statusLabel = (user: Account) =>
  !user.userIsActive ? 'Không hoạt động' : user.isActive ? 'Đang hoạt động' : 'Đã khóa';
