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
  jobTitleId?: string | null;
  jobTitleName?: string | null;
  managerPositionId?: string | null;
  managerPositionTitle?: string | null;
  description: string | null;
  isActive: boolean;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}
export interface JobTitle {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
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
  consumedAt: string | null; revokedAt: string | null; deliveryStatus: string; avatarUrl?: string | null;
}
export class ApiError extends Error {
  constructor(public status: number, public code: string, public fields: string[] = []) { super(code); }
}
let csrfToken = '';
let confirmSensitiveAction: (() => Promise<boolean>) | undefined;

export function registerSensitiveActionConfirmation(confirm: () => Promise<boolean>) {
  confirmSensitiveAction = confirm;
  return () => { if (confirmSensitiveAction === confirm) confirmSensitiveAction = undefined; };
}

export async function initialize(): Promise<{ csrfToken: string; deliveryMode: DeliveryMode; passkeysAvailable?: boolean }> {
  const result = await request<{ csrfToken: string; deliveryMode: DeliveryMode; passkeysAvailable?: boolean }>('/api/auth/csrf');
  csrfToken = result.csrfToken;
  return result;
}
export async function request<T = void>(path: string, body?: unknown, methodOverride?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'): Promise<T> {
  try {
    return await send<T>(path, body, methodOverride);
  } catch (cause) {
    if (cause instanceof ApiError && cause.code === 'REAUTH_REQUIRED' && (path.startsWith('/api/organizations/') || path==='/api/units' || path.startsWith('/api/units/')) &&
      (methodOverride ? methodOverride !== 'GET' : body !== undefined) && confirmSensitiveAction) {
      if (await confirmSensitiveAction()) return send<T>(path, body, methodOverride);
      throw new ApiError(403, 'REAUTH_CANCELLED');
    }
    throw cause;
  }
}

async function send<T>(path: string, body?: unknown, methodOverride?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'): Promise<T> {
  const method = methodOverride || (body === undefined ? 'GET' : 'POST');
  const response = await fetch(path, {
    method, credentials: 'same-origin',
    headers: method === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
    ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({ code: 'REQUEST_FAILED' })) as { code?: string; fields?: unknown };
    const fields = Array.isArray(data.fields) ? data.fields.filter((field): field is string => typeof field === 'string') : [];
    throw new ApiError(response.status, data.code || 'REQUEST_FAILED', fields);
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}
export function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'INVALID_INPUT' && error.fields.length) {
      const fieldLabels: Record<string, string> = {
        employeeCode: 'Mã nhân viên',
        fullName: 'Họ và tên hồ sơ',
        hireDate: 'Ngày vào làm',
        birthDate: 'Ngày sinh',
        phone: 'Số điện thoại cá nhân',
        personalEmail: 'Email cá nhân',
        address: 'Địa chỉ liên hệ',
        bankName: 'Tên ngân hàng',
        bankAccountNumber: 'Số tài khoản ngân hàng',
        bankAccountName: 'Tên chủ tài khoản',
        userId: 'Tài khoản liên kết',
      };
      const invalidFields = [...new Set(error.fields.map(field => fieldLabels[field]).filter(Boolean))];
      if (invalidFields.length) return `Vui lòng kiểm tra lại: ${invalidFields.join(', ')}.`;
    }
    const attendanceMessages: Record<string, string> = {
      ATT_EMPLOYEE_NOT_FOUND: 'Không tìm thấy nhân viên trong phạm vi được phép.',
      ATT_EMPLOYEE_INACTIVE: 'Hồ sơ nhân viên đã kết thúc công tác.',
      ATT_SCHEDULE_NOT_FOUND: 'Không tìm thấy lịch làm việc.',
      ATT_SHIFT_NOT_FOUND: 'Ca làm việc không tồn tại hoặc đã ngừng sử dụng.',
      ATT_INVALID_ZONE: 'Múi giờ IANA không hợp lệ.',
      ATT_INVALID_RANGE: 'Kiểm tra ngày hoặc thứ tự giờ bắt đầu và kết thúc.',
      ATT_AMBIGUOUS_SCHEDULE: 'Giờ ca không tồn tại hoặc xuất hiện hai lần. Hãy kiểm tra múi giờ và độ lệch giờ.',
      ATT_SCHEDULE_STARTED: 'Chỉ có thể thay đổi lịch tương lai chưa ghi giờ.',
      ATT_SCHEDULE_CONFLICT: 'Lịch mới trùng với ca hoặc ngày nghỉ đã phân.',
      ATT_DUPLICATE_NAME: 'Tên đã tồn tại trong danh mục.',
      ATT_PUNCH_UNAVAILABLE: 'Ca này không thể ghi giờ.',
      ATT_DUPLICATE_PUNCH: 'Dấu giờ này đã được ghi hoặc chưa có giờ vào.',
      ATT_OPEN_PUNCH: 'Bạn còn một ca chưa ghi giờ ra. Hãy hoàn tất hoặc đề nghị điều chỉnh công.',
      ATT_PUNCH_WINDOW: 'Chưa đến hoặc đã hết thời gian check-in của ca.',
      ATT_LEAVE_CONFLICT: 'Thời gian trùng với đơn nghỉ đang chờ hoặc đã duyệt.',
      ATT_WORK_CONFLICT: 'Thời gian trùng với giờ công đã ghi nhận.',
      ATT_PENDING_CORRECTION: 'Ca này đã có đề nghị điều chỉnh đang chờ duyệt.',
      ATT_STALE_CORRECTION: 'Dấu giờ gốc đã thay đổi. Từ chối đề nghị cũ trước khi lập đề nghị mới.',
      ATT_REQUEST_NOT_FOUND: 'Không tìm thấy đơn trong phạm vi được phép.',
      ATT_ALREADY_REVIEWED: 'Đơn đã đổi trạng thái. Hãy làm mới danh sách.',
      ATT_SELF_REVIEW: 'Cần người có thẩm quyền khác xử lý yêu cầu này.',
      ATT_LEAVE_TYPE_UNAVAILABLE: 'Loại phép không khả dụng hoặc không cho đổi cách theo dõi số dư.',
      ATT_INSUFFICIENT_BALANCE: 'Số dư phép không đủ hoặc chưa được cấp.',
      ATT_CHARGE_REQUIRED: 'Nhập số phút trừ theo chính sách đã duyệt.',
      ATT_INVALID_CHARGE: 'Số phút trừ không phù hợp với loại phép hoặc khoảng thời gian đã yêu cầu.',
      ATT_OFFICE_NO_SHIFT: 'Phòng ban này chấm công giờ hành chính, không cần phân ca. Bạn vẫn có thể gán ngày nghỉ.',
      ATT_DEPARTMENT_NOT_FOUND: 'Không tìm thấy phòng ban đang hoạt động trong tổ chức.',
      UNIT_NOT_FOUND: 'Không tìm thấy đơn vị hoặc bạn chưa có quyền truy cập.',
      UNIT_ADMIN_UNAVAILABLE: 'Email Admin phải thuộc tài khoản đang hoạt động và đã xác minh email.',
      UNIT_CURRENT: 'Hãy chuyển sang đơn vị khác trước khi lưu trữ đơn vị đang làm việc.',
    };
    if (attendanceMessages[error.code]) return attendanceMessages[error.code];
    const messages:Record<string,string>={FILE_TOO_LARGE:'Tệp vượt quá dung lượng tối đa cho phép. Vui lòng chọn tệp nhỏ hơn.',EMPLOYEE_NOT_FOUND:'Không tìm thấy hồ sơ trong phạm vi được phép.',EMPLOYEE_CODE_EXISTS:'Mã nhân viên đã tồn tại trong tổ chức.',EMPLOYEE_ACCOUNT_EXISTS:'Tài khoản đã được liên kết với một hồ sơ.',INVALID_EMPLOYEE_ACCOUNT:'Tài khoản phải đang hoạt động trong cùng tổ chức.',ACCOUNT_ASSIGNMENT_MISMATCH:'Phân công của hồ sơ liên kết phải khớp với tài khoản hiện có.',INVALID_EMPLOYEE_DATES:'Kiểm tra ngày vào làm và ngày sinh. Ngày vào làm không được ở tương lai.',STALE_RECORD:'Dữ liệu đã thay đổi. Hãy tải lại hồ sơ trước khi lưu.',INVALID_HISTORY_DATE:'Ngày công tác phải từ ngày vào làm, không ở tương lai và không trước mốc đã ghi nhận.',ASSIGNMENT_UNCHANGED:'Phòng ban, vị trí và quản lý chưa có thay đổi.',CONTRACT_NUMBER_EXISTS:'Số hợp đồng đã tồn tại trong tổ chức.',CONTRACT_NOT_FOUND:'Không tìm thấy hợp đồng.',INVALID_CONTRACT_DATES:'Kiểm tra thời hạn, ngày ký và ngày chấm dứt hợp đồng.',CONTRACT_IMMUTABLE:'Nội dung hợp đồng đã được khóa. Hãy tạo hợp đồng mới để ghi nhận thay đổi.',INVALID_CONTRACT_TRANSITION:'Không thể chuyển sang trạng thái hợp đồng này.',ACTIVE_CONTRACT_EXISTS:'Nhân viên đã có một hợp đồng đang thực hiện.',CONTRACT_SIGNATURE_DATE_REQUIRED:'Cần ghi ngày ký hợp lệ trước khi hoàn tất hợp đồng.'};
    if(messages[error.code])return messages[error.code];
    if (error.code === 'INVALID_PASSKEY') return 'Không thể xác minh passkey. Hãy thử lại hoặc dùng mật khẩu.';
    if (error.code === 'PASSKEY_CHALLENGE_EXPIRED') return 'Yêu cầu xác minh đã hết hạn. Hãy thử lại.';
    if (error.code === 'PASSKEY_LIMIT') return 'Tài khoản đã có 10 passkey. Hãy xóa một passkey trước khi thêm.';
    if (error.code === 'PASSKEY_EXISTS') return 'Passkey này đã được đăng ký.';
    if (error.code === 'MFA_REQUIRED') return 'Hãy hoàn tất xác thực hai bước tại trang Bảo mật.';
    if (error.code === 'REAUTH_REQUIRED') return 'Hãy xác thực lại tại trang Bảo mật trước khi thực hiện thao tác này.';
    if (error.code === 'REAUTH_CANCELLED') return 'Đã hủy xác minh. Thao tác chưa được thực hiện.';
    if (error.code === 'INVALID_FACTOR') return 'Mã không hợp lệ hoặc đã dùng. Chờ mã mới hoặc dùng mã khôi phục chưa sử dụng.';
    if (error.code === 'LAST_ADMIN_REQUIRED') return 'Tổ chức phải còn ít nhất một quản trị viên đang hoạt động.';
    if (error.code === 'SELF_CHANGE_FORBIDDEN') return 'Bạn không thể tự thay đổi vai trò hoặc khóa tài khoản của mình.';
    if (error.code === 'INVALID_MANAGER') return 'Hãy chọn người quản lý đang hoạt động trong cùng tổ chức.';
    if (error.code === 'DEPARTMENT_CODE_EXISTS') return 'Mã phòng ban đã tồn tại trong tổ chức.';
    if (error.code === 'POSITION_CODE_EXISTS') return 'Mã vị trí đã tồn tại trong tổ chức.';
    if (error.code === 'ORGANIZATION_CODE_EXISTS') return 'Mã tổ chức đã tồn tại trên hệ thống.';
    if (error.code === 'CIRCULAR_HIERARCHY') return 'Không thể chọn đơn vị con hoặc chính đơn vị này làm đơn vị cha (gây lặp vòng).';
    if (error.code === 'CIRCULAR_REPORTING') return 'Không thể thiết lập quan hệ quản lý vòng lặp.';
    if (error.code === 'DEPARTMENT_IN_USE_HAS_CHILDREN') return 'Không thể xóa phòng ban đang có đơn vị trực thuộc. Vui lòng chuyển hoặc xóa đơn vị con trước.';
    if (error.code === 'DEPARTMENT_IN_USE_HAS_MEMBERS') return 'Không thể xóa phòng ban đang có nhân viên trực thuộc.';
    if (error.code === 'DEPARTMENT_IN_USE_HAS_POSITIONS') return 'Không thể xóa phòng ban đang có vị trí liên kết.';
    if (error.code === 'POSITION_IN_USE_HAS_MEMBERS') return 'Không thể xóa vị trí đang được phân công cho nhân viên.';
    if (error.code === 'POSITION_DEPARTMENT_MISMATCH') return 'Vị trí được chọn không thuộc phòng ban đã chỉ định.';
    if (error.code === 'INVALID_CODE') return 'Mã chỉ được chứa chữ cái, số, gạch nối (-) hoặc gạch dưới (_).';
    if (error.code === 'INVALID_PARENT') return 'Đơn vị cha không hợp lệ hoặc không thuộc tổ chức.';
    if (error.code === 'INVALID_DEPARTMENT') return 'Phòng ban được chọn không hợp lệ hoặc không thuộc tổ chức.';
    if (error.code === 'INVALID_POSITION') return 'Vị trí được chọn không hợp lệ hoặc không thuộc tổ chức.';
    if (error.code === 'INVALID_JOB_TITLE') return 'Chọn chức danh đang hoạt động trong tổ chức.';
    if (error.code === 'JOB_TITLE_CODE_EXISTS') return 'Mã chức danh đã tồn tại trong tổ chức.';
    if (error.code === 'JOB_TITLE_NOT_FOUND') return 'Không tìm thấy chức danh.';
    if (error.code === 'INVALID_MANAGER_POSITION') return 'Chọn vị trí cấp trên đang hoạt động trong tổ chức.';
    if (error.code === 'CIRCULAR_POSITION_REPORTING') return 'Không thể chọn chính vị trí này hoặc một vị trí cấp dưới làm cấp trên.';
    if (error.code === 'POSITION_HAS_REPORTS') return 'Hãy chuyển các vị trí cấp dưới sang cấp trên khác trước khi xóa.';
    if (error.code === 'DEPARTMENT_NOT_FOUND') return 'Không tìm thấy phòng ban hoặc phòng ban đã bị xóa.';
    if (error.code === 'POSITION_NOT_FOUND') return 'Không tìm thấy vị trí hoặc vị trí đã bị xóa.';
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
