export interface AnalyticsRange {
  startDate: string;
  endDate: string;
  compareStartDate?: string;
  compareEndDate?: string;
  departmentId?: string;
  branchId?: string;
  grain: 'month' | 'quarter' | 'year';
}

export interface CostPeriod {
  records: number;
  employees: number;
  gross: string | null;
  net: string | null;
  base: string | null;
  allowances: string | null;
  bonuses: string | null;
  overtime: string | null;
  overtimeHours: string | null;
  averageSalary: string | null;
  updatedAt: string | null;
  insurance: {
    records: number;
    employer: string | null;
    employee: string | null;
    updatedAt: string | null;
    excludedCurrencyRecords?: number;
  };
  payments: { records: number; amount: string | null; updatedAt: string | null };
  departments: Array<{ id: string | null; label: string | null; gross: string; employees: number }>;
  trends: Array<{ label: string; value: string }>;
  periods: Array<{ id: string; name: string; status: string; startDate: string; endDate: string }>;
}

export interface ExecutiveAnalytics {
  generatedAt: string;
  snapshotDate: string;
  range: AnalyticsRange;
  departments: Array<{ id: string; name: string; parentId: string | null }>;
  workforce: { records: number; headcount: number; hires: number; updatedAt: string | null };
  structure: Array<{
    kind: 'department' | 'position';
    id: string | null;
    label: string | null;
    value: number;
  }>;
  attendance: {
    schedules: number;
    attendanceRate: number | null;
    absenteeismRate: number | null;
    leaveRate: number | null;
    overtimeRate: number | null;
  };
  lifecycle: {
    growth: number | null;
    turnover: number | null;
    retention: number | null;
    departures: number | null;
  };
  capabilities: {
    financial: boolean;
    audit: boolean;
    historicalEmployment: boolean;
    recruitment: boolean;
    budget: boolean;
  };
  cost: null | {
    current: CostPeriod;
    previous: CostPeriod;
    grossChangePercent: number | null;
    costPerEmployee: string | null;
    journal: {
      records: number;
      recognized: string | null;
      liabilityMovement: string | null;
      updatedAt?: string | null;
    };
    anomalies: Array<{ code: string; severity: string; status: string; count: number }>;
    budget: null;
  };
}

export interface ExecutiveAudit {
  items: Array<{
    id: string;
    action: string;
    actor: string | null;
    target: string | null;
    source: string;
    at: string;
  }>;
  total: number;
  page: number;
  limit: number;
}
