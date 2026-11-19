export type DeliveryMode = 'SMTP' | 'DEV_ONLY';
export interface Profile {
  user: { id: string; email: string; fullName: string };
  organization: { id: string; name: string; role: 'EMPLOYEE' | 'HR' | 'MANAGER' | 'ADMIN' };
  permissions: { invite: boolean; grantHR: boolean; readUsers?: boolean; manageUsers?: boolean; assignRoles?: boolean; viewAudit?: boolean };
  deliveryMode: DeliveryMode;
  security?: {mfaRequired:boolean;mfaEnabled:boolean;mfaVerified:boolean};
}
export interface Invitation {
  id: string; email: string; role: string; expiresAt: string;
  consumedAt: string | null; revokedAt: string | null; deliveryStatus: string;
}
export class ApiError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}
let csrfToken = '';
export async function initialize(): Promise<{ csrfToken: string; deliveryMode: DeliveryMode }> {
  const result = await request<{ csrfToken: string; deliveryMode: DeliveryMode }>('/api/auth/csrf');
  csrfToken = result.csrfToken;
  return result;
}
export async function request<T = void>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({ code: 'REQUEST_FAILED' })) as { code?: string };
    throw new ApiError(response.status, data.code || 'REQUEST_FAILED');
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}
export function errorText(error: unknown): string {
  if(error instanceof ApiError && error.code==='MFA_REQUIRED')return 'Hãy hoàn tất xác thực hai bước tại trang Bảo mật.';
  if(error instanceof ApiError && error.code==='REAUTH_REQUIRED')return 'Hãy xác thực lại tại trang Bảo mật trước khi thực hiện thao tác này.';
  if(error instanceof ApiError && error.code==='INVALID_FACTOR')return 'Mã không hợp lệ hoặc đã dùng. Chờ mã mới hoặc dùng mã khôi phục chưa sử dụng.';
  if (error instanceof ApiError && error.code === 'LAST_ADMIN_REQUIRED') return 'Tổ chức phải còn ít nhất một quản trị viên đang hoạt động.';
  if (error instanceof ApiError && error.code === 'SELF_CHANGE_FORBIDDEN') return 'Bạn không thể tự thay đổi vai trò hoặc khóa tài khoản của mình.';
  if (error instanceof ApiError && error.code === 'INVALID_MANAGER') return 'Hãy chọn người quản lý đang hoạt động trong cùng tổ chức.';
  if (!(error instanceof ApiError)) return 'Không thể kết nối. Vui lòng thử lại.';
  if (error.status === 429) return 'Có quá nhiều yêu cầu. Vui lòng thử lại sau 15 phút.';
  if (error.code === 'INVALID_CREDENTIALS') return 'Email hoặc mật khẩu không chính xác.';
  if (error.code === 'CSRF_REJECTED') return 'Phiên biểu mẫu đã hết hạn. Hãy tải lại trang và thử lại.';
  if (error.status === 410) return 'Liên kết không còn hiệu lực. Vui lòng yêu cầu liên kết mới.';
  if (error.status === 403) return 'Tài khoản không có quyền thực hiện thao tác này.';
  if (error.status === 401) return 'Vui lòng đăng nhập bằng tài khoản được mời.';
  if (error.status === 409) return 'Không thể thực hiện yêu cầu với trạng thái tài khoản hiện tại.';
  if (error.status === 400) return 'Thông tin chưa hợp lệ. Vui lòng kiểm tra lại biểu mẫu.';
  return 'Chưa thể hoàn tất yêu cầu. Vui lòng thử lại.';
}
