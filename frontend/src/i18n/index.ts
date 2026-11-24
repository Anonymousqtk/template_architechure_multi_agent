import { useSyncExternalStore } from 'react';

export type Locale = 'vi' | 'en';

const messages = {
  vi: {
    language: 'Ngôn ngữ',
    home: 'Trang chủ',
    catalog: 'Danh mục',
    organization: 'Quản lý tổ chức',
    employees: 'Hồ sơ nhân viên',
    account: 'Cài đặt tài khoản',
    signOut: 'Đăng xuất',
    openNavigation: 'Mở điều hướng',
    securitySettings: 'Mở cài đặt bảo mật',
    personalAccount: 'Mở tài khoản cá nhân',
    units: 'Đơn vị', departments: 'Phòng ban', positions: 'Chức danh và vị trí',
    shifts: 'Ca làm việc', leaveTypes: 'Loại nghỉ phép', attendancePolicy: 'Chế độ chấm công', salaryComponents: 'Cấu phần lương',
    sharedData: 'DỮ LIỆU DÙNG CHUNG', myTeam: 'Nhóm của tôi', teamMembers: 'Thành viên nhóm', members: 'Thành viên',
    invitations: 'Lời mời', audit: 'Nhật ký hoạt động', orgChart: 'Sơ đồ tổ chức', hrApps: 'ỨNG DỤNG NHÂN SỰ',
    myProfile: 'Hồ sơ của tôi', employeeList: 'Danh sách nhân viên', attendance: 'Chấm công và nghỉ phép', payroll: 'Tiền lương & Bảng lương',
    accounting: 'Hạch toán & Đối chiếu', payslips: 'Phiếu lương của tôi', reports: 'Báo cáo & Thống kê', hrManagement: 'QUẢN LÝ NHÂN SỰ',
    accountTitle: 'Tài khoản', profile: 'Thông tin cá nhân', security: 'Bảo mật & thiết bị', settings: 'THIẾT LẬP',
    overview: 'TỔNG QUAN', greeting: 'Xin chào,', teamOverview: 'Theo dõi chỉ số và hoạt động của đội ngũ trong phạm vi truy cập.',
    personalOverview: 'Quản lý thông tin tài khoản, bảo mật và thiết bị của bạn.', totalAccounts: 'Tổng tài khoản',
    authorizedScope: 'Trong phạm vi được phân quyền', activeAccounts: 'Đang hoạt động', lockedAccounts: 'Đã khóa',
    reviewAccounts: 'Tài khoản cần được rà soát', loginSessions: 'Phiên đăng nhập', sessionDetails: 'Thiết bị đang đăng nhập tài khoản của bạn',
    twoFactor: 'Xác thực hai bước', enabled: 'Đã bật', disabled: 'Chưa bật', accountProtection: 'Trạng thái bảo vệ tài khoản',
    quickStart: 'BẮT ĐẦU NHANH', commonActions: 'Thao tác thường dùng', viewMembers: 'Xem thành viên', inviteColleagues: 'Mời đồng nghiệp',
    loadingOverview: 'Đang tải dữ liệu tổng quan…', roleBreakdown: 'Cơ cấu vai trò', yourAccount: 'Tài khoản của bạn',
    avatar: 'Ảnh đại diện', avatarOf: 'Ảnh đại diện của', viewAvatarOf: 'Xem ảnh đại diện của',
    closeImage: 'Đóng ảnh', zoomControls: 'Điều khiển thu phóng', zoomOut: 'Thu nhỏ ảnh', zoomIn: 'Phóng to ảnh', originalSize: 'Kích thước ban đầu',
    displayName: 'Tên hiển thị', displayNameSaved: 'Đã lưu tên hiển thị.', saving: 'Đang lưu…', saveProfile: 'Lưu thông tin',
    verifyToContinue: 'Xác minh để tiếp tục', enterCredentials: 'Nhập thông tin xác thực để hoàn tất thao tác vừa chọn.',
    password: 'Mật khẩu', backupCode: 'Mã dự phòng', authenticatorCode: 'Mã 6 số từ Authenticator',
    verifying: 'Đang xác minh…', verifyAndContinue: 'Xác minh và tiếp tục', useAuthenticator: 'Dùng Authenticator', useBackupCode: 'Dùng mã dự phòng', cancel: 'Hủy',
    welcomeBack: 'CHÀO MỪNG TRỞ LẠI', confirmAccount: 'Xác nhận tài khoản của bạn', signIn: 'Đăng nhập', loginIntro: 'Một ngày làm việc hiệu quả bắt đầu từ đây.',
    signInPasskey: 'Đăng nhập bằng passkey', workEmail: 'Email công việc', forgotPassword: 'Quên mật khẩu?', signingIn: 'Đang đăng nhập…', signInArrow: 'Đăng nhập →',
    newMember: 'Bạn là thành viên mới?', invitationHelp: 'Hãy mở liên kết lời mời từ HR hoặc quản trị viên để tham gia.', passkeyRetry: 'Bạn có thể thử passkey lại hoặc dùng mật khẩu.',
    backToLogin: '← Đăng nhập', forgotPrompt: 'Nhập email công việc để yêu cầu liên kết đặt lại mật khẩu.', resetEmailSent: 'Nếu tài khoản tồn tại, hướng dẫn đặt lại mật khẩu sẽ được gửi qua email.',
    processing: 'Đang xử lý…', requestLink: 'Yêu cầu liên kết', passwordMismatch: 'Hai mật khẩu chưa trùng khớp.', passwordUpdated: 'Mật khẩu đã được cập nhật',
    sessionsRevoked: 'Các phiên đăng nhập trước đã bị thu hồi. Hãy đăng nhập bằng mật khẩu mới.', goToLogin: 'Đến trang đăng nhập →', missingResetLink: 'Thiếu liên kết đặt lại',
    openResetLink: 'Hãy mở liên kết trong email hoặc yêu cầu một liên kết mới.', requestNewLink: 'Yêu cầu liên kết mới', protectAccount: 'BẢO VỆ TÀI KHOẢN',
    resetPassword: 'Đặt lại mật khẩu', passwordGuidance: 'Dùng từ 12 đến 128 ký tự. Không chia sẻ mật khẩu với bất kỳ ai.', newPassword: 'Mật khẩu mới', confirmPassword: 'Nhập lại mật khẩu', updating: 'Đang cập nhật…', saveNewPassword: 'Lưu mật khẩu mới',
    welcome: 'Chào mừng bạn!', invitationAccepted: 'Lời mời đã được chấp nhận. Đăng nhập để truy cập tổ chức của bạn.', checkingInvitation: 'Đang kiểm tra lời mời…',
    invitationUnavailable: 'Lời mời không khả dụng', invalidInvitation: 'Liên kết không hợp lệ, đã hết hạn hoặc đã được sử dụng. Vui lòng liên hệ HR để nhận lời mời mới.', returnToLogin: 'Về trang đăng nhập',
    noAccount: 'Tôi chưa có tài khoản', invitationHeading: 'LỜI MỜI THAM GIA', newStart: 'Sẵn sàng khởi đầu mới', invitationScope: 'Lời mời xác định tổ chức và vai trò của bạn. Không thể tự thay đổi các thông tin này.',
    confirmingAs: 'Bạn đang xác nhận bằng tài khoản', passwordRetained: 'Mật khẩu hiện tại sẽ được giữ nguyên.', fullName: 'Họ và tên', createPassword: 'Tạo mật khẩu (12–128 ký tự)', confirming: 'Đang xác nhận…', acceptInvitation: 'Chấp nhận lời mời →', hasAccount: 'Tôi đã có tài khoản ManagerHR',
    stepTwo: 'Bước 2/2', resetTwoFactor: 'Thiết lập lại xác thực hai bước', verifySignIn: 'Xác minh đăng nhập',
    enterCurrentCode: 'Nhập mã hiện tại từ ứng dụng Authenticator.', recoverInstructions: 'Nhập mật khẩu và một mã dự phòng. Các phiên, phương thức xác thực và mã cũ sẽ bị thu hồi.',
    enterUnusedBackup: 'Nhập một mã dự phòng chưa sử dụng.', revokeAndReset: 'Thu hồi và thiết lập lại', resetAuthenticator: 'Thiết lập lại Authenticator', backToSignIn: 'Quay lại đăng nhập',
    passkeyFaster: 'Đăng nhập nhanh hơn với passkey', passkeyIntro: 'Dùng vân tay, khuôn mặt hoặc PIN thiết bị để đăng nhập lần sau.', passkeyAdded: 'Đã thêm passkey.', passkeyRemoved: 'Đã xóa passkey và đăng xuất các phiên khác.',
    passkeyFailed: 'Không thể tạo passkey. Hãy kiểm tra yêu cầu xác minh trên thiết bị và thử lại.', noPasskeys: 'Chưa có passkey cho trang này.', passkeyCreated: 'Passkey tạo ngày', lastUsed: 'Dùng lần cuối', neverUsed: 'Chưa dùng để đăng nhập',
    removePasskeyConfirm: 'Xóa passkey này và đăng xuất các phiên khác?', removePasskey: 'Xóa passkey', settingUp: 'Đang thiết lập…', createPasskey: 'Tạo passkey', unsupportedPasskey: 'Trình duyệt này chưa hỗ trợ tạo passkey.',
    verifyCreatePasskey: 'Xác minh để tạo passkey', verifyRemovePasskey: 'Xác minh để xóa passkey', continue: 'Tiếp tục', later: 'Để sau',
  },
  en: {
    language: 'Language',
    home: 'Home',
    catalog: 'Catalog',
    organization: 'Organization management',
    employees: 'Employee records',
    account: 'Account settings',
    signOut: 'Sign out',
    openNavigation: 'Open navigation',
    securitySettings: 'Open security settings',
    personalAccount: 'Open personal account',
    units: 'Units', departments: 'Departments', positions: 'Job titles and positions',
    shifts: 'Work shifts', leaveTypes: 'Leave types', attendancePolicy: 'Attendance policy', salaryComponents: 'Salary components',
    sharedData: 'SHARED DATA', myTeam: 'My team', teamMembers: 'Team members', members: 'Members',
    invitations: 'Invitations', audit: 'Activity log', orgChart: 'Organization chart', hrApps: 'HR APPLICATIONS',
    myProfile: 'My employee profile', employeeList: 'Employees', attendance: 'Attendance and leave', payroll: 'Payroll',
    accounting: 'Accounting and reconciliation', payslips: 'My payslips', reports: 'Reports and analytics', hrManagement: 'HR MANAGEMENT',
    accountTitle: 'Account', profile: 'Personal information', security: 'Security and devices', settings: 'SETTINGS',
    overview: 'OVERVIEW', greeting: 'Hello,', teamOverview: 'Track team metrics and activity within your access scope.',
    personalOverview: 'Manage your account information, security and devices.', totalAccounts: 'Total accounts',
    authorizedScope: 'Within your access scope', activeAccounts: 'Active', lockedAccounts: 'Locked',
    reviewAccounts: 'Accounts requiring review', loginSessions: 'Sign-in sessions', sessionDetails: 'Devices signed in to your account',
    twoFactor: 'Two-factor authentication', enabled: 'Enabled', disabled: 'Disabled', accountProtection: 'Account protection status',
    quickStart: 'QUICK START', commonActions: 'Common actions', viewMembers: 'View members', inviteColleagues: 'Invite colleagues',
    loadingOverview: 'Loading overview…', roleBreakdown: 'Role breakdown', yourAccount: 'Your account',
    avatar: 'Profile photo', avatarOf: 'Profile photo of', viewAvatarOf: 'View profile photo of',
    closeImage: 'Close image', zoomControls: 'Zoom controls', zoomOut: 'Zoom out', zoomIn: 'Zoom in', originalSize: 'Original size',
    displayName: 'Display name', displayNameSaved: 'Display name saved.', saving: 'Saving…', saveProfile: 'Save information',
    verifyToContinue: 'Verify to continue', enterCredentials: 'Enter your credentials to complete the selected action.',
    password: 'Password', backupCode: 'Recovery code', authenticatorCode: '6-digit Authenticator code',
    verifying: 'Verifying…', verifyAndContinue: 'Verify and continue', useAuthenticator: 'Use Authenticator', useBackupCode: 'Use a recovery code', cancel: 'Cancel',
    welcomeBack: 'WELCOME BACK', confirmAccount: 'Confirm your account', signIn: 'Sign in', loginIntro: 'A productive workday starts here.',
    signInPasskey: 'Sign in with a passkey', workEmail: 'Work email', forgotPassword: 'Forgot password?', signingIn: 'Signing in…', signInArrow: 'Sign in →',
    newMember: 'New member?', invitationHelp: 'Open the invitation link from HR or an administrator to join.', passkeyRetry: 'Try your passkey again or use your password.',
    backToLogin: '← Sign in', forgotPrompt: 'Enter your work email to request a password reset link.', resetEmailSent: 'If the account exists, password reset instructions will be sent by email.',
    processing: 'Processing…', requestLink: 'Request link', passwordMismatch: 'The passwords do not match.', passwordUpdated: 'Password updated',
    sessionsRevoked: 'Previous sign-in sessions have been revoked. Sign in with your new password.', goToLogin: 'Go to sign in →', missingResetLink: 'Reset link missing',
    openResetLink: 'Open the link in your email or request a new link.', requestNewLink: 'Request a new link', protectAccount: 'PROTECT YOUR ACCOUNT',
    resetPassword: 'Reset password', passwordGuidance: 'Use 12 to 128 characters. Do not share your password.', newPassword: 'New password', confirmPassword: 'Confirm password', updating: 'Updating…', saveNewPassword: 'Save new password',
    welcome: 'Welcome!', invitationAccepted: 'Your invitation has been accepted. Sign in to access your organization.', checkingInvitation: 'Checking invitation…',
    invitationUnavailable: 'Invitation unavailable', invalidInvitation: 'The link is invalid, expired or already used. Contact HR for a new invitation.', returnToLogin: 'Return to sign in',
    noAccount: 'I do not have an account', invitationHeading: 'INVITATION', newStart: 'Ready for a new start', invitationScope: 'Your invitation determines your organization and role. You cannot change these details yourself.',
    confirmingAs: 'You are confirming with account', passwordRetained: 'Your existing password will be retained.', fullName: 'Full name', createPassword: 'Create password (12–128 characters)', confirming: 'Confirming…', acceptInvitation: 'Accept invitation →', hasAccount: 'I already have a ManagerHR account',
    stepTwo: 'Step 2 of 2', resetTwoFactor: 'Reset two-factor authentication', verifySignIn: 'Verify sign-in',
    enterCurrentCode: 'Enter the current code from your Authenticator app.', recoverInstructions: 'Enter your password and a recovery code. Existing sessions, authentication methods and recovery codes will be revoked.',
    enterUnusedBackup: 'Enter an unused recovery code.', revokeAndReset: 'Revoke and reset', resetAuthenticator: 'Reset Authenticator', backToSignIn: 'Back to sign in',
    passkeyFaster: 'Sign in faster with a passkey', passkeyIntro: 'Use your device fingerprint, face or PIN to sign in next time.', passkeyAdded: 'Passkey added.', passkeyRemoved: 'Passkey removed and other sessions signed out.',
    passkeyFailed: 'Could not create a passkey. Check the verification request on your device and try again.', noPasskeys: 'No passkeys are registered for this site.', passkeyCreated: 'Passkey created on', lastUsed: 'Last used', neverUsed: 'Never used to sign in',
    removePasskeyConfirm: 'Remove this passkey and sign out other sessions?', removePasskey: 'Remove passkey', settingUp: 'Setting up…', createPasskey: 'Create passkey', unsupportedPasskey: 'This browser does not support creating passkeys.',
    verifyCreatePasskey: 'Verify to create a passkey', verifyRemovePasskey: 'Verify to remove a passkey', continue: 'Continue', later: 'Later',
  },
} as const;

type MessageKey = keyof typeof messages.vi;
const storageKey = 'managerhr.locale';
const listeners = new Set<() => void>();

function initialLocale(): Locale {
  try {
    return window.localStorage.getItem(storageKey) === 'en' ? 'en' : 'vi';
  } catch {
    return 'vi';
  }
}

let locale: Locale = initialLocale();

export function getLocale(): Locale {
  return locale;
}

export function setLocale(next: Locale): void {
  locale = next;
  try {
    window.localStorage.setItem(storageKey, next);
  } catch {
    // Language selection still works when browser storage is unavailable.
  }
  listeners.forEach((listener) => listener());
}

export function useTranslation() {
  const current = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => locale,
    () => 'vi' as Locale,
  );
  return {
    locale: current,
    t: (key: MessageKey) => messages[current][key],
  };
}
