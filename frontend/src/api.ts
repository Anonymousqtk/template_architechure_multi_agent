export type DeliveryMode = 'SMTP' | 'DEV_ONLY';
export interface Profile {
  user: { id: string; email: string; fullName: string };
  organization: { id: string; name: string; role: 'EMPLOYEE' | 'HR' | 'MANAGER' | 'ADMIN' };
  permissions: { invite: boolean; grantHR: boolean; readUsers?: boolean; manageUsers?: boolean; assignRoles?: boolean; viewAudit?: boolean; manageOrg?: boolean };
  deliveryMode: DeliveryMode;
  security?: {mfaRequired:boolean;mfaEnabled:boolean;mfaVerified:boolean};
}
export interface OrgDetails {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  parentOrganizationId: string | null;
  parentOrganization: { id: string; name: string; code: string | null } | null;
  isActive: boolean;
  createdAt: string;
}
export interface Department {
  id: string;
  organizationId: string;
  parentId: string | null;
  parentName: string | null;
  code: string;
  name: string;
  description: string | null;
  managerUserId: string | null;
  managerName: string | null;
  managerEmail: string | null;
  isActive: boolean;
  memberCount: number;
  childCount: number;
  createdAt: string;
  updatedAt: string;
}
export interface Position {
  id: string;
  organizationId: string;
  departmentId: string | null;
  departmentName: string | null;
  code: string;
  title: string;
  description: string | null;
  isActive: boolean;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}
export interface OrgChartMember {
  userId: string;
  fullName: string;
  email: string;
  role: string;
  positionId: string | null;
  positionTitle: string | null;
  managerUserId: string | null;
  managerName: string | null;
}
export interface OrgChartNode {
  id: string;
  parentId: string | null;
  code: string;
  name: string;
  description: string | null;
  manager: { userId: string; fullName: string; email: string } | null;
  members: OrgChartMember[];
  memberCount: number;
  children: OrgChartNode[];
}
export interface OrgChartData {
  organization: {
    id: string;
    name: string;
    code: string | null;
    description: string | null;
  };
  departmentTree: OrgChartNode[];
  unassignedMembers: OrgChartMember[];
  totalDepartments: number;
  totalPositions: number;
  totalMembers: number;
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
export async function request<T = void>(path: string, body?: unknown, methodOverride?: 'GET' | 'POST' | 'PATCH' | 'DELETE'): Promise<T> {
  const method = methodOverride || (body === undefined ? 'GET' : 'POST');
  const response = await fetch(path, {
    method, credentials: 'same-origin',
    headers: method === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
    ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({ code: 'REQUEST_FAILED' })) as { code?: string };
    throw new ApiError(response.status, data.code || 'REQUEST_FAILED');
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}
export function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    const messages:Record<string,string>={EMPLOYEE_NOT_FOUND:'Không tìm thấy hồ sơ trong phạm vi được phép.',EMPLOYEE_CODE_EXISTS:'Mã nhân viên đã tồn tại trong tổ chức.',EMPLOYEE_ACCOUNT_EXISTS:'Tài khoản đã được liên kết với một hồ sơ.',INVALID_EMPLOYEE_ACCOUNT:'Tài khoản phải đang hoạt động trong cùng tổ chức.',ACCOUNT_ASSIGNMENT_MISMATCH:'Phân công của hồ sơ liên kết phải khớp với tài khoản hiện có.',INVALID_EMPLOYEE_DATES:'Kiểm tra ngày vào làm và ngày sinh. Ngày vào làm không được ở tương lai.',STALE_RECORD:'Dữ liệu đã thay đổi. Hãy tải lại hồ sơ trước khi lưu.',INVALID_HISTORY_DATE:'Ngày công tác phải từ ngày vào làm, không ở tương lai và không trước mốc đã ghi nhận.',ASSIGNMENT_UNCHANGED:'Phòng ban, chức danh và quản lý chưa có thay đổi.',CONTRACT_NUMBER_EXISTS:'Số hợp đồng đã tồn tại trong tổ chức.',CONTRACT_NOT_FOUND:'Không tìm thấy hợp đồng.',INVALID_CONTRACT_DATES:'Kiểm tra thời hạn, ngày ký và ngày chấm dứt hợp đồng.',CONTRACT_IMMUTABLE:'Nội dung hợp đồng đã được khóa. Hãy tạo hợp đồng mới để ghi nhận thay đổi.',INVALID_CONTRACT_TRANSITION:'Không thể chuyển sang trạng thái hợp đồng này.',ACTIVE_CONTRACT_EXISTS:'Nhân viên đã có một hợp đồng đang thực hiện.',CONTRACT_SIGNATURE_DATE_REQUIRED:'Cần ghi ngày ký hợp lệ trước khi hoàn tất hợp đồng.'};
    if(messages[error.code])return messages[error.code];
    if (error.code === 'MFA_REQUIRED') return 'Hãy hoàn tất xác thực hai bước tại trang Bảo mật.';
    if (error.code === 'REAUTH_REQUIRED') return 'Hãy xác thực lại tại trang Bảo mật trước khi thực hiện thao tác này.';
    if (error.code === 'INVALID_FACTOR') return 'Mã không hợp lệ hoặc đã dùng. Chờ mã mới hoặc dùng mã khôi phục chưa sử dụng.';
    if (error.code === 'LAST_ADMIN_REQUIRED') return 'Tổ chức phải còn ít nhất một quản trị viên đang hoạt động.';
    if (error.code === 'SELF_CHANGE_FORBIDDEN') return 'Bạn không thể tự thay đổi vai trò hoặc khóa tài khoản của mình.';
    if (error.code === 'INVALID_MANAGER') return 'Hãy chọn người quản lý đang hoạt động trong cùng tổ chức.';
    if (error.code === 'DEPARTMENT_CODE_EXISTS') return 'Mã phòng ban đã tồn tại trong tổ chức.';
    if (error.code === 'POSITION_CODE_EXISTS') return 'Mã chức danh đã tồn tại trong tổ chức.';
    if (error.code === 'ORGANIZATION_CODE_EXISTS') return 'Mã tổ chức đã tồn tại trên hệ thống.';
    if (error.code === 'CIRCULAR_HIERARCHY') return 'Không thể chọn đơn vị con hoặc chính đơn vị này làm đơn vị cha (gây lặp vòng).';
    if (error.code === 'CIRCULAR_REPORTING') return 'Không thể thiết lập quan hệ quản lý vòng lặp.';
    if (error.code === 'DEPARTMENT_IN_USE_HAS_CHILDREN') return 'Không thể xóa phòng ban đang có đơn vị trực thuộc. Vui lòng chuyển hoặc xóa đơn vị con trước.';
    if (error.code === 'DEPARTMENT_IN_USE_HAS_MEMBERS') return 'Không thể xóa phòng ban đang có nhân viên trực thuộc.';
    if (error.code === 'DEPARTMENT_IN_USE_HAS_POSITIONS') return 'Không thể xóa phòng ban đang có chức danh liên kết.';
    if (error.code === 'POSITION_IN_USE_HAS_MEMBERS') return 'Không thể xóa chức danh đang được phân công cho nhân viên.';
    if (error.code === 'POSITION_DEPARTMENT_MISMATCH') return 'Chức danh được chọn không thuộc phòng ban đã chỉ định.';
    if (error.code === 'INVALID_CODE') return 'Mã chỉ được chứa chữ cái, số, gạch nối (-) hoặc gạch dưới (_).';
    if (error.code === 'INVALID_PARENT') return 'Đơn vị cha không hợp lệ hoặc không thuộc tổ chức.';
    if (error.code === 'INVALID_DEPARTMENT') return 'Phòng ban được chọn không hợp lệ hoặc không thuộc tổ chức.';
    if (error.code === 'INVALID_POSITION') return 'Chức danh được chọn không hợp lệ hoặc không thuộc tổ chức.';
    if (error.code === 'DEPARTMENT_NOT_FOUND') return 'Không tìm thấy phòng ban hoặc phòng ban đã bị xóa.';
    if (error.code === 'POSITION_NOT_FOUND') return 'Không tìm thấy chức danh hoặc chức danh đã bị xóa.';
    if (error.code === 'ORGANIZATION_NOT_FOUND') return 'Không tìm thấy thông tin tổ chức.';
    if (error.code === 'PARENT_ORGANIZATION_NOT_FOUND') return 'Không tìm thấy tổ chức cấp trên đã chỉ định.';
    if (error.code === 'USER_NOT_FOUND') return 'Không tìm thấy người dùng hoặc tài khoản không tồn tại.';
    if (error.code === 'INVITATION_NOT_FOUND') return 'Lời mời không tồn tại hoặc đã hết hiệu lực.';
    if (error.code === 'SESSION_NOT_FOUND') return 'Phiên đăng nhập không tồn tại hoặc đã bị thu hồi.';
    if (error.code === 'SERVICE_NOT_READY') return 'Dịch vụ dữ liệu chưa sẵn sàng. Vui lòng liên hệ quản trị viên để kiểm tra cấu hình và cập nhật hệ thống.';
    if (error.code === 'SERVICE_UNAVAILABLE' || error.status === 503) return 'Tạm thời không thể kết nối dịch vụ dữ liệu. Vui lòng thử tải lại sau.';
    if (error.code === 'INTERNAL_ERROR' || error.status === 500) return 'Không thể hoàn tất yêu cầu. Hãy thử lại; nếu lỗi tiếp diễn, vui lòng liên hệ quản trị viên.';
    if (error.code === 'NOT_FOUND' || error.status === 404) return 'Không tìm thấy dữ liệu hoặc liên kết yêu cầu.';
    if (error.status === 429) return 'Có quá nhiều yêu cầu. Vui lòng thử lại sau 15 phút.';
    if (error.code === 'INVALID_CREDENTIALS') return 'Email hoặc mật khẩu không chính xác.';
    if (error.code === 'CSRF_REJECTED') return 'Phiên biểu mẫu đã hết hạn. Hãy tải lại trang và thử lại.';
    if (error.status === 410) return 'Liên kết không còn hiệu lực. Vui lòng yêu cầu liên kết mới.';
    if (error.status === 403) return 'Tài khoản không có quyền thực hiện thao tác này.';
    if (error.status === 401) return 'Vui lòng đăng nhập bằng tài khoản được mời.';
    if (error.status === 409) return 'Không thể thực hiện yêu cầu với trạng thái hiện tại.';
    if (error.status === 400) return 'Thông tin chưa hợp lệ. Vui lòng kiểm tra lại biểu mẫu.';
    if (error.status >= 502 && error.status <= 504) return 'Máy chủ dịch vụ tạm thời không phản hồi. Vui lòng thử lại sau.';
    return `Chưa thể hoàn tất yêu cầu (${error.code || error.status}). Vui lòng thử lại.`;
  }
  if (!(error instanceof ApiError)) return 'Không thể kết nối. Vui lòng thử lại.';
  return 'Chưa thể hoàn tất yêu cầu. Vui lòng thử lại.';
}
