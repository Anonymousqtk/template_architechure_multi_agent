// Shared reporting constants, types and helpers (split from reporting.ts, behavior unchanged).
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { managementScope } from './management-scope.js';
import type { PitBracket } from './payroll-compliance.js';
import type { Identity } from './types.js';

export const uuid = z.string().uuid();
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const DEFAULT_PIT_BRACKETS: PitBracket[] = [
  { upTo: 5000000.0, rate: 0.05, quickDeduction: 0 },
  { upTo: 10000000.0, rate: 0.1, quickDeduction: 250000.0 },
  { upTo: 18000000.0, rate: 0.15, quickDeduction: 750000.0 },
  { upTo: 32000000.0, rate: 0.2, quickDeduction: 1650000.0 },
  { upTo: 52000000.0, rate: 0.25, quickDeduction: 3250000.0 },
  { upTo: 80000000.0, rate: 0.3, quickDeduction: 5850000.0 },
  { upTo: null, rate: 0.35, quickDeduction: 9850000.0 },
];

export const ANNUAL_PIT_BRACKETS: PitBracket[] = [
  { upTo: 60000000.0, rate: 0.05, quickDeduction: 0 },
  { upTo: 120000000.0, rate: 0.1, quickDeduction: 3000000.0 },
  { upTo: 216000000.0, rate: 0.15, quickDeduction: 9000000.0 },
  { upTo: 384000000.0, rate: 0.2, quickDeduction: 19800000.0 },
  { upTo: 624000000.0, rate: 0.25, quickDeduction: 39000000.0 },
  { upTo: 960000000.0, rate: 0.3, quickDeduction: 70200000.0 },
  { upTo: null, rate: 0.35, quickDeduction: 118200000.0 },
];

export type Db = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;
export type QueryParameter = string | number | boolean | null | string[];

export interface ReportPeriod {
  id: string;
  code: string;
  name: string;
  status: string;
  start_date: string;
  end_date: string;
}

export interface PositionSummary {
  id: string;
  code: string;
  title: string;
  employeeCount: number;
}

export interface JournalLineSummary {
  id: string;
  accountCode: string;
  accountName: string;
  accountType: string;
  departmentName: string;
  debitAmount: string;
  creditAmount: string;
  description: string;
  lineOrder: number;
}

export interface PayrollSlipItemRow {
  slip_id: string;
  component_name: string;
  type: string;
  amount: string;
}

export interface ReportCatalogItem {
  id?: string;
  code: string;
  category:
    | 'EMPLOYEE'
    | 'ORGANIZATION'
    | 'ATTENDANCE'
    | 'LEAVE'
    | 'PAYROLL'
    | 'ACCOUNTING'
    | 'COMPLIANCE'
    | 'OTHER';
  name: string;
  description: string;
  minRole: 'ADMIN' | 'HR' | 'MANAGER' | 'EMPLOYEE';
  displayOrder: number;
  supportedFilters: string[];
}

export const DEFAULT_REPORT_CATALOG: ReportCatalogItem[] = [
  {
    code: 'RPT-EMP-01',
    category: 'EMPLOYEE',
    name: 'Báo cáo nhân sự & biến động nhân sự',
    description:
      'Tổng hợp danh sách nhân viên, trạng thái hoạt động, cơ cấu phòng ban, chức vụ, loại hợp đồng và thâm niên làm việc.',
    minRole: 'MANAGER',
    displayOrder: 1,
    supportedFilters: [
      'departmentId',
      'positionId',
      'status',
      'contractType',
      'search',
      'hireDateFrom',
      'hireDateTo',
    ],
  },
  {
    code: 'RPT-ORG-01',
    category: 'ORGANIZATION',
    name: 'Báo cáo cơ cấu tổ chức & phòng ban',
    description:
      'Thống kê sơ đồ phân cấp phòng ban, chức vụ, số lượng nhân sự định biên và độ bao phủ quản lý.',
    minRole: 'MANAGER',
    displayOrder: 2,
    supportedFilters: ['departmentId', 'isActive'],
  },
  {
    code: 'RPT-ATT-01',
    category: 'ATTENDANCE',
    name: 'Báo cáo tổng hợp chấm công & ca làm việc',
    description:
      'Thống kê chi tiết ca làm việc, số ngày công, đi muộn, về sớm, tăng ca và tỷ lệ hiện diện.',
    minRole: 'EMPLOYEE',
    displayOrder: 3,
    supportedFilters: ['startDate', 'endDate', 'departmentId', 'employeeId', 'status', 'search'],
  },
  {
    code: 'RPT-LEAVE-01',
    category: 'LEAVE',
    name: 'Báo cáo tình hình nghỉ phép & số dư phép',
    description:
      'Theo dõi hạn mức phép, số ngày đã sử dụng, số dư còn lại và chi tiết các đơn xin nghỉ phép.',
    minRole: 'EMPLOYEE',
    displayOrder: 4,
    supportedFilters: [
      'startDate',
      'endDate',
      'departmentId',
      'leaveTypeId',
      'employeeId',
      'status',
      'search',
    ],
  },
  {
    code: 'RPT-PAY-01',
    category: 'PAYROLL',
    name: 'Bảng lương tổng hợp & chi tiết theo kỳ',
    description:
      'Tổng hợp quỹ lương Gross, lương cơ bản, phụ cấp, thưởng, khấu trừ và thực lĩnh (Net) theo từng kỳ lương.',
    minRole: 'MANAGER',
    displayOrder: 5,
    supportedFilters: ['periodId', 'departmentId', 'search'],
  },
  {
    code: 'RPT-PAY-02',
    category: 'PAYROLL',
    name: 'Báo cáo cơ cấu phụ cấp, thưởng & khấu trừ',
    description:
      'Phân tích chi tiết từng cấu phần phụ cấp (chịu thuế/miễn thuế), thưởng và các khoản khấu trừ bảo hiểm, thuế, tạm ứng.',
    minRole: 'HR',
    displayOrder: 6,
    supportedFilters: ['periodId', 'componentType', 'departmentId'],
  },
  {
    code: 'RPT-PAY-03',
    category: 'PAYROLL',
    name: 'Báo cáo biến động quỹ lương giữa các kỳ (MoM)',
    description:
      'So sánh biến động quỹ lương Gross, Net, số lượng nhân sự và tỷ lệ tăng giảm giữa hai kỳ lương liên tiếp.',
    minRole: 'HR',
    displayOrder: 7,
    supportedFilters: ['periodId', 'comparePeriodId'],
  },
  {
    code: 'RPT-ACC-01',
    category: 'ACCOUNTING',
    name: 'Báo cáo phân bổ chi phí lương theo phòng ban & đơn vị',
    description:
      'Phân bổ chi phí lương Gross, bảo hiểm bắt buộc người sử dụng LĐ (21.5%) và kinh phí công đoàn (2%) sang tài khoản chi phí VAS (6422, 6421).',
    minRole: 'HR',
    displayOrder: 8,
    supportedFilters: ['periodId', 'departmentId'],
  },
  {
    code: 'RPT-ACC-02',
    category: 'ACCOUNTING',
    name: 'Báo cáo công nợ lương & đối chiếu thanh toán',
    description:
      'Đối chiếu công nợ lương phải trả người lao động (TK 3341), số tiền đã chi trả thực tế qua ngân hàng và số dư còn phải trả.',
    minRole: 'HR',
    displayOrder: 9,
    supportedFilters: ['periodId', 'status'],
  },
  {
    code: 'RPT-ACC-03',
    category: 'ACCOUNTING',
    name: 'Báo cáo sổ nhật ký bút toán kế toán lương',
    description:
      'Kiểm toán sổ nhật ký chung các bút toán kế toán lương, kiểm tra cân đối tổng Nợ = tổng Có và lưu vết đảo bút toán.',
    minRole: 'HR',
    displayOrder: 10,
    supportedFilters: ['periodId', 'status', 'accountId'],
  },
  {
    code: 'RPT-TAX-01',
    category: 'COMPLIANCE',
    name: 'Báo cáo tổng hợp thuế TNCN & Kê khai định kỳ (Mẫu 05/KK-TNCN)',
    description:
      'Tổng hợp thu nhập chịu thuế, giảm trừ gia cảnh (NQ 954/2020), thuế TNCN lũy tiến từng phần theo Thông tư 111/2013/TT-BTC và đối chiếu bảng lương.',
    minRole: 'HR',
    displayOrder: 11,
    supportedFilters: ['periodId', 'departmentId', 'search'],
  },
  {
    code: 'RPT-TAX-02',
    category: 'COMPLIANCE',
    name: 'Báo cáo quyết toán thuế TNCN năm (Mẫu 05/QTT-TNCN)',
    description:
      'Tổng hợp quyết toán thuế TNCN năm, cá nhân cư trú có HĐLĐ từ 3 tháng trở lên, ủy quyền quyết toán và xác định số thuế nộp thừa/thiếu.',
    minRole: 'HR',
    displayOrder: 12,
    supportedFilters: ['year', 'departmentId', 'search'],
  },
  {
    code: 'RPT-INS-01',
    category: 'COMPLIANCE',
    name: 'Báo cáo trích nộp BHXH, BHYT, BHTN & Kinh phí công đoàn',
    description:
      'Tổng hợp trích nộp BHXH (8%/17.5%), BHYT (1.5%/3%), BHTN (1%/1%), KPCĐ (2%) theo NĐ 73/2024, NĐ 74/2024 và đối chiếu bảng lương.',
    minRole: 'HR',
    displayOrder: 13,
    supportedFilters: ['periodId', 'departmentId', 'search'],
  },
  {
    code: 'RPT-INS-02',
    category: 'COMPLIANCE',
    name: 'Báo cáo tình hình biến động lao động tham gia bảo hiểm (Mẫu D02-LT)',
    description:
      'Danh sách tăng, giảm, điều chỉnh mức đóng BHXH, BHYT, BHTN theo Quyết định 595/QĐ-BHXH và Quyết định 490/QĐ-BHXH.',
    minRole: 'HR',
    displayOrder: 14,
    supportedFilters: ['month', 'year', 'departmentId', 'search'],
  },
  {
    code: 'RPT-LAB-01',
    category: 'COMPLIANCE',
    name: 'Báo cáo tình hình sử dụng lao động định kỳ (Mẫu 01/PLI)',
    description:
      'Báo cáo tình hình thay đổi lao động định kỳ 6 tháng và hàng năm theo Nghị định 145/2020/NĐ-CP gửi Sở LĐ-TB&XH.',
    minRole: 'HR',
    displayOrder: 15,
    supportedFilters: ['year', 'half', 'departmentId', 'search'],
  },
];

export const ROLE_RANKS: Record<string, number> = {
  ADMIN: 4,
  HR: 3,
  MANAGER: 2,
  EMPLOYEE: 1,
};

export function canAccessReport(userRole: string, minRole: string): boolean {
  const userRank = ROLE_RANKS[userRole] ?? 0;
  const minRank = ROLE_RANKS[minRole] ?? 99;
  return userRank >= minRank;
}

export function toCents(amount: number | string | bigint): bigint {
  if (typeof amount === 'bigint') return amount;
  const num = typeof amount === 'number' ? amount : parseFloat(String(amount || '0'));
  return BigInt(Math.round(num * 100));
}

export function toDecimal(cents: bigint): string {
  const sign = cents < 0n ? '-' : '';
  const abs = cents < 0n ? -cents : cents;
  const whole = abs / 100n;
  const fraction = abs % 100n;
  return `${sign}${whole.toString()}.${fraction.toString().padStart(2, '0')}`;
}

// Build scope SQL clause for employees table (alias e)
export async function buildEmployeeScopeClause(
  db: Db,
  identity: Identity,
  startParamIndex: number,
): Promise<{
  clause: string;
  params: QueryParameter[];
  nextIndex: number;
  departmentIds?: string[];
}> {
  if (['ADMIN', 'HR'].includes(identity.role)) {
    return { clause: '1=1', params: [], nextIndex: startParamIndex };
  }

  if (identity.role === 'EMPLOYEE') {
    return {
      clause: `e.user_id = $${startParamIndex}`,
      params: [identity.userId],
      nextIndex: startParamIndex + 1,
    };
  }

  // MANAGER role: query managementScope
  const scope = await managementScope(db, identity);
  if (!scope) {
    return {
      clause: `e.user_id = $${startParamIndex}`,
      params: [identity.userId],
      nextIndex: startParamIndex + 1,
    };
  }

  const deptParamIdx = startParamIndex;
  const userParamIdx = startParamIndex + 1;
  const selfParamIdx = startParamIndex + 2;

  return {
    clause: `(e.department_id = ANY($${deptParamIdx}::uuid[]) OR e.user_id = ANY($${userParamIdx}::uuid[]) OR e.manager_user_id = $${selfParamIdx} OR e.user_id = $${selfParamIdx})`,
    params: [scope.departments, scope.users, identity.userId],
    nextIndex: startParamIndex + 3,
    departmentIds: scope.departments,
  };
}

// Helper to sanitize CSV cells
export function escapeCsvCell(val: unknown): string {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
