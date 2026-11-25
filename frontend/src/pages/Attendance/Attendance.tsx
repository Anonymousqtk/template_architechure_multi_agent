import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { errorText, request, type Profile } from '../../services/api';
import { DashIcon } from '../../components/layout/DashboardShell';
import { getLocale, useTranslation } from '../../i18n';
import { attendanceMessages, attendanceStatuses } from './attendanceMessages';
import { SearchableSelect } from '../../components/common/SearchableSelect';
import '../../assets/styles/attendance.css';

type Employee = {
  attendanceMode?: 'SHIFT' | 'OFFICE';
  id: string;
  name: string;
  code: string;
  self: boolean;
  status: string;
};
type Shift = {
  id: string;
  name: string;
  timeZone: string;
  startTime: string;
  endTime: string;
  active: boolean;
  earlyCheckIn: number;
  lateGrace: number | null;
  earlyGrace: number | null;
  overtimeAfter: number | null;
};
type LeaveType = { id: string; name: string; active: boolean; tracksBalance: boolean };
type Schedule = {
  attendanceKind?: 'SHIFT' | 'OFFICE' | 'OFF';
  virtual?: boolean;
  id: string;
  label: string;
  shiftId: string | null;
  workDate: string;
  timeZone: string;
  startsAt: string;
  endsAt: string;
  rawIn: string | null;
  rawOut: string | null;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  status: string;
  adjusted: boolean;
  late: boolean | null;
  leftEarly: boolean | null;
  overtimeMinutes: number | null;
  recordedMinutes: number | null;
  canCheckIn: boolean;
  canCheckOut: boolean;
  leaveConflict: boolean;
};
type Review = {
  id: string;
  status: string;
  reason: string;
  createdBy: string;
  createdAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  reviewReason: string | null;
};
type Leave = Review & {
  name: string;
  startsAt: string;
  endsAt: string;
  tracksBalance: boolean;
  chargeMinutes: number | null;
  cancelReason: string | null;
  cancelledAt: string | null;
};
type Correction = Review & { workDate: string; proposedIn: string; proposedOut: string };
type Balance = {
  leaveTypeId: string;
  name: string;
  allowanceMinutes: number;
  availableMinutes: number;
};
type Ledger = {
  schedule: Schedule[];
  leave: Leave[];
  corrections: Correction[];
  balances: Balance[];
};
type DepartmentPolicy = {
  id: string;
  name: string;
  mode: 'SHIFT' | 'OFFICE';
  timeZone: string;
  startTime: string;
  endTime: string;
  weekdays: number[];
};
type Catalog = { shifts: Shift[]; leaveTypes: LeaveType[]; departments?: DepartmentPolicy[] };
type Save = (path: string, body: unknown, method?: 'POST' | 'PUT' | 'DELETE') => Promise<unknown>;

const dateLocale = () => (getLocale() === 'vi' ? 'vi-VN' : 'en-US');
const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const formatDate = (value: string | null, zone = browserZone) =>
  value
    ? new Date(value).toLocaleString(dateLocale(), {
        timeZone: zone,
        dateStyle: 'short',
        timeStyle: 'short',
      })
    : '—';
const formatTime = (value: string | null, zone: string) =>
  value
    ? new Intl.DateTimeFormat(dateLocale(), {
        timeZone: zone,
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(value))
    : '—';
const formatDay = (value: string) =>
  new Intl.DateTimeFormat(dateLocale(), {
    timeZone: 'UTC',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(value + 'T00:00:00Z'));
const duration = (minutes: number) =>
  `${Math.floor(minutes / 60)} giờ${minutes % 60 ? ' ' + (minutes % 60) + ' phút' : ''}`;
function shiftMoment(value: string | null, row: Schedule) {
  if (!value) return '—';
  const valueDay = new Intl.DateTimeFormat('sv-SE', {
    timeZone: row.timeZone,
    dateStyle: 'short',
  }).format(new Date(value));
  return valueDay === row.workDate
    ? formatTime(value, row.timeZone)
    : formatDate(value, row.timeZone);
}

function Status({ status }: { status: string }) {
  const { locale } = useTranslation();
  return (
    <span className="att-status" data-status={status}>
      {attendanceStatuses[status]?.[locale] ?? status}
    </span>
  );
}
const str = (data: FormData, key: string) => String(data.get(key) ?? '');
const numberOrNull = (data: FormData, key: string) =>
  str(data, key) === '' ? null : Number(str(data, key));

function localDate(value: Date) {
  return new Intl.DateTimeFormat('sv-SE', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
}

function localInstant(value: string) {
  const date = new Date(value);
  const display = localDate(date) + 'T' + date.toTimeString().slice(0, 5);
  if (display !== value.slice(0, 16))
    throw new Error('Giờ này không tồn tại trong múi giờ của thiết bị.');
  return date.toISOString();
}

function useLoad<T>(path: string | null, revision: number) {
  const [result, setResult] = useState<{ path: string; data: T } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(Boolean(path));
  useEffect(() => {
    let current = true;
    setError('');
    setLoading(Boolean(path));
    if (path)
      request<T>(path)
        .then((data) => {
          if (current) setResult({ path, data });
        })
        .catch((cause) => {
          if (current) setError(errorText(cause));
        })
        .finally(() => {
          if (current) setLoading(false);
        });
    return () => {
      current = false;
    };
  }, [path, revision]);
  return { data: result?.path === path ? result.data : null, error, loading };
}

function ActionForm({
  title,
  submitLabel,
  children,
  save,
  dismiss,
  reset = true,
}: {
  title: string;
  submitLabel: string;
  children: ReactNode;
  save: (data: FormData) => Promise<unknown>;
  dismiss?: () => void;
  reset?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const focusOnOpen = Boolean(dismiss);
  useEffect(() => {
    if (!focusOnOpen) return;
    const trigger = document.activeElement;
    heading.current?.focus();
    return () => {
      if (trigger instanceof HTMLElement && trigger.isConnected)
        trigger.focus({ preventScroll: true });
    };
  }, [focusOnOpen]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    setBusy(true);
    setError('');
    try {
      await save(new FormData(form));
      if (reset) form.reset();
      dismiss?.();
    } catch (cause) {
      setError(
        cause instanceof Error && !('status' in cause) && cause.message.startsWith('Giờ này')
          ? cause.message
          : errorText(cause),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="att-form" onSubmit={submit} aria-busy={busy}>
      <h3 ref={heading} tabIndex={focusOnOpen ? -1 : undefined}>
        {title}
      </h3>
      <fieldset disabled={busy}>
        {children}
        {error && (
          <p role="alert" className="notice error">
            {error}
          </p>
        )}
        <div className="org-action-cell">
          <button className="primary" type="submit">
            {busy ? 'Đang lưu…' : submitLabel}
          </button>
          {dismiss && (
            <button className="secondary" type="button" onClick={dismiss}>
              Đóng
            </button>
          )}
        </div>
      </fieldset>
    </form>
  );
}

function Reason({ label = 'Lý do' }: { label?: string }) {
  return (
    <label className="field">
      {label}
      <textarea name="reason" maxLength={500} required />
    </label>
  );
}

function TimeRange() {
  return (
    <>
      <div className="att-form-pair">
        <label className="field">
          Bắt đầu
          <input name="start" type="datetime-local" required />
        </label>
        <label className="field">
          Kết thúc
          <input name="end" type="datetime-local" required />
        </label>
      </div>
      <p className="att-help">Múi giờ nhập liệu · {browserZone}</p>
    </>
  );
}

function DepartmentPolicies({
  departments,
  save,
}: {
  departments: DepartmentPolicy[];
  save: Save;
}) {
  const [selected, setSelected] = useState('');
  const department = departments.find((item) => item.id === selected) ?? departments[0];
  const [mode, setMode] = useState<'SHIFT' | 'OFFICE' | null>(null);
  if (!department) return <p>Hãy tạo phòng ban trước khi thiết lập chế độ chấm công.</p>;
  return (
    <section aria-label="Chấm công theo phòng ban">
      <label className="field">
        Phòng ban
        <SearchableSelect
          value={department.id}
          options={departments.map((item) => ({
            value: item.id,
            label: `${item.name} · ${item.mode === 'OFFICE' ? 'Giờ hành chính' : 'Theo ca'}`,
            keywords: item.name,
          }))}
          onChange={(val) => {
            setSelected(val);
            setMode(departments.find((d) => d.id === val)!.mode);
          }}
        />
      </label>
      <ActionForm
        key={
          department.id +
          department.mode +
          department.startTime +
          department.endTime +
          department.weekdays.join(',')
        }
        title="Chế độ chấm công phòng ban"
        submitLabel="Lưu chế độ chấm công"
        reset={false}
        save={(data) =>
          save(
            '/departments/' + department.id + '/policy',
            {
              mode: str(data, 'mode'),
              timeZone: str(data, 'zone') || department.timeZone,
              startTime: str(data, 'start') || department.startTime,
              endTime: str(data, 'end') || department.endTime,
              weekdays:
                str(data, 'mode') === 'OFFICE'
                  ? data.getAll('weekdays').map(Number)
                  : department.weekdays,
            },
            'PUT',
          )
        }
      >
        <label className="field">
          Hình thức chấm công
          <select
            name="mode"
            defaultValue={department.mode}
            onChange={(event) => setMode(event.target.value as 'SHIFT' | 'OFFICE')}
          >
            <option value="SHIFT">Theo ca — phân ca cho từng nhân viên</option>
            <option value="OFFICE">Giờ hành chính — vào buổi sáng, ra cuối ngày</option>
          </select>
        </label>
        {(mode ?? department.mode) === 'OFFICE' && (
          <>
            <p>
              Nhân viên tự chấm công vào–ra theo ngày làm việc, không cần phân ca. Lịch đã gán riêng
              được ưu tiên.
            </p>
            <div className="att-form-pair">
              <label className="field">
                Giờ bắt đầu
                <input name="start" type="time" defaultValue={department.startTime} required />
              </label>
              <label className="field">
                Giờ kết thúc
                <input name="end" type="time" defaultValue={department.endTime} required />
              </label>
            </div>
            <label className="field">
              Múi giờ
              <input name="zone" defaultValue={department.timeZone} required maxLength={80} />
            </label>
            <fieldset>
              <legend>Ngày làm việc trong tuần</legend>
              {['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'].map(
                (label, index) => (
                  <label key={index}>
                    <input
                      type="checkbox"
                      name="weekdays"
                      value={index}
                      defaultChecked={department.weekdays.includes(index)}
                    />
                    {label}{' '}
                  </label>
                ),
              )}
            </fieldset>
            <p className="att-help">
              Thời gian ghi nhận là khoảng từ vào đến ra; chưa tự trừ nghỉ trưa. Dấu giờ đã ghi nhận
              được giữ nguyên khi đổi chế độ.
            </p>
          </>
        )}
      </ActionForm>
    </section>
  );
}

function CatalogPanel({
  catalog,
  save,
  section,
}: {
  catalog: Catalog;
  save: Save;
  section?: 'shifts' | 'leave-types';
}) {
  const [tab, setTab] = useState<'shifts' | 'leave-types'>(section ?? 'shifts');
  const [id, setId] = useState('new');
  const shift = catalog.shifts.find((item) => item.id === id);
  const type = catalog.leaveTypes.find((item) => item.id === id);
  return (
    <section className="att-catalog" aria-label="Danh mục ca và loại phép">
      <div className="att-catalog-picker">
        {!section && (
          <div className="att-switch" role="group" aria-label="Chọn danh mục">
            <button
              className="secondary"
              type="button"
              aria-pressed={tab === 'shifts'}
              onClick={() => {
                setTab('shifts');
                setId('new');
              }}
            >
              Ca làm việc
            </button>
            <button
              className="secondary"
              type="button"
              aria-pressed={tab === 'leave-types'}
              onClick={() => {
                setTab('leave-types');
                setId('new');
              }}
            >
              Loại phép
            </button>
          </div>
        )}
        <label className="field">
          {tab === 'shifts' ? 'Chọn ca' : 'Chọn loại phép'}
          <SearchableSelect
            value={id}
            onChange={setId}
            options={[
              { value: 'new', label: 'Tạo mới' },
              ...(tab === 'shifts' ? catalog.shifts : catalog.leaveTypes).map((item) => ({
                value: item.id,
                label: `${item.name}${item.active ? '' : ' (Ngừng sử dụng)'}`,
                keywords: item.name,
              })),
            ]}
          />
        </label>
      </div>
      <ActionForm
        key={tab + id}
        title={tab === 'shifts' ? 'Thiết lập ca làm việc' : 'Thiết lập loại phép'}
        submitLabel="Lưu danh mục"
        reset={false}
        save={(data) => {
          const common = { name: str(data, 'name'), active: data.has('active') };
          return save(
            '/' + tab + '/' + id,
            tab === 'shifts'
              ? {
                  ...common,
                  timeZone: str(data, 'zone'),
                  startTime: str(data, 'start'),
                  endTime: str(data, 'end'),
                  earlyCheckIn: Number(str(data, 'earlyCheckIn')),
                  lateGrace: numberOrNull(data, 'lateGrace'),
                  earlyGrace: numberOrNull(data, 'earlyGrace'),
                  overtimeAfter: numberOrNull(data, 'overtimeAfter'),
                }
              : { ...common, tracksBalance: type?.tracksBalance ?? data.has('tracksBalance') },
            'PUT',
          );
        }}
      >
        <label className="field">
          Tên
          <input name="name" defaultValue={(shift ?? type)?.name} required maxLength={120} />
        </label>
        <label>
          <input name="active" type="checkbox" defaultChecked={(shift ?? type)?.active ?? true} />{' '}
          Đang sử dụng
        </label>
        {tab === 'shifts' ? (
          <>
            <label className="field">
              Múi giờ IANA
              <input
                name="zone"
                defaultValue={shift?.timeZone ?? browserZone}
                required
                maxLength={80}
              />
            </label>
            <div className="att-form-pair">
              <label className="field">
                Giờ bắt đầu
                <input name="start" type="time" defaultValue={shift?.startTime} required />
              </label>
              <label className="field">
                Giờ kết thúc
                <input name="end" type="time" defaultValue={shift?.endTime} required />
              </label>
            </div>
            <p className="att-help">
              Giờ kết thúc sớm hơn giờ bắt đầu được tính sang ngày hôm sau.
            </p>
            <div className="att-form-pair">
              {(
                [
                  ['earlyCheckIn', 'Cho phép vào trước ca (phút)', shift?.earlyCheckIn, true],
                  ['lateGrace', 'Ngưỡng đi muộn (phút)', shift?.lateGrace, false],
                  ['earlyGrace', 'Ngưỡng về sớm (phút)', shift?.earlyGrace, false],
                  [
                    'overtimeAfter',
                    'Bắt đầu ghi nhận giờ thêm sau ca (phút)',
                    shift?.overtimeAfter,
                    false,
                  ],
                ] as const
              ).map(([key, label, value, required]) => (
                <label className="field" key={key}>
                  {label}
                  <input
                    name={key}
                    type="number"
                    min={0}
                    max={720}
                    step={1}
                    defaultValue={value ?? ''}
                    required={required}
                  />
                </label>
              ))}
            </div>
            <p className="att-help">Để trống ngưỡng chưa được phê duyệt.</p>
          </>
        ) : (
          <p>
            <label>
              <input
                name="tracksBalance"
                type="checkbox"
                defaultChecked={type?.tracksBalance}
                disabled={Boolean(type)}
              />{' '}
              Theo dõi số dư theo phút
            </label>
            <br />
            Cách theo dõi số dư được cố định khi tạo loại phép.
          </p>
        )}
      </ActionForm>
    </section>
  );
}

function ScheduleForm({
  employee,
  shifts,
  row,
  save,
  close,
}: {
  employee: Employee;
  shifts: Shift[];
  row: Schedule | null;
  save: Save;
  close: () => void;
}) {
  const [kind, setKind] = useState(
    employee.attendanceMode === 'OFFICE' || (row && !row.shiftId) ? 'OFF' : 'SHIFT',
  );
  const [shiftId, setShiftId] = useState(row?.shiftId ?? '');
  return (
    <ActionForm
      title={row ? 'Sửa lịch làm việc' : 'Phân ca hoặc ngày nghỉ'}
      submitLabel="Lưu lịch"
      dismiss={close}
      save={(data) => {
        const workDate = str(data, 'date');
        return save(
          '/employees/' + employee.id + '/schedule/' + (row?.id ?? 'new'),
          kind === 'OFF'
            ? { kind, workDate, timeZone: str(data, 'zone') }
            : {
                kind,
                workDate,
                shiftId: str(data, 'shift'),
                ...(str(data, 'explicitStart') && { startsAt: str(data, 'explicitStart') }),
                ...(str(data, 'explicitEnd') && { endsAt: str(data, 'explicitEnd') }),
              },
          'PUT',
        );
      }}
    >
      <label className="field">
        Ngày làm việc
        <input name="date" type="date" defaultValue={row?.workDate} required />
      </label>
      <label className="field">
        Loại lịch
        <select value={kind} onChange={(event) => setKind(event.target.value)}>
          {employee.attendanceMode !== 'OFFICE' && <option value="SHIFT">Ca làm việc</option>}
          <option value="OFF">Ngày nghỉ</option>
        </select>
      </label>
      {kind === 'SHIFT' ? (
        <>
          <label className="field">
            Ca làm việc
            <SearchableSelect
              name="shift"
              required
              value={shiftId}
              onChange={setShiftId}
              options={[
                { value: '', label: 'Chọn ca đang sử dụng' },
                ...shifts
                  .filter((s) => s.active)
                  .map((s) => ({
                    value: s.id,
                    label: `${s.name} · ${s.startTime}–${s.endTime} · ${s.timeZone}`,
                    keywords: `${s.name} ${s.timeZone}`,
                  })),
              ]}
            />
          </label>
          <details>
            <summary>Chọn độ lệch giờ khi đồng hồ đổi giờ mùa hè</summary>
            <p>
              Chỉ điền khi giờ địa phương xuất hiện hai lần. Dùng thời điểm ISO có độ lệch, ví dụ
              2026-11-01T01:30:00-04:00.
            </p>
            <label className="field">
              Bắt đầu có độ lệch
              <input name="explicitStart" maxLength={40} />
            </label>
            <label className="field">
              Kết thúc có độ lệch
              <input name="explicitEnd" maxLength={40} />
            </label>
          </details>
        </>
      ) : (
        <label className="field">
          Múi giờ ngày nghỉ
          <input name="zone" defaultValue={row?.timeZone ?? browserZone} maxLength={80} required />
        </label>
      )}
    </ActionForm>
  );
}

function Punch({ row, employee, save }: { row: Schedule; employee: Employee; save: Save }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const action = row.canCheckOut ? 'OUT' : row.canCheckIn ? 'IN' : null;
  if (!action) return null;
  async function punch() {
    setBusy(true);
    setError('');
    try {
      await save(
        row.virtual ? '/employees/' + employee.id + '/office-punch' : '/punches/' + row.id,
        row.virtual ? { action, workDate: row.workDate } : { action },
      );
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button type="button" className="primary" disabled={busy} onClick={() => void punch()}>
        {busy ? 'Đang ghi giờ…' : action === 'IN' ? 'Check-in' : 'Check-out'}
      </button>
      {error && <p role="alert">{error}</p>}
    </>
  );
}

function SchedulePanel({
  employee,
  catalog,
  ledger,
  canManage,
  save,
}: {
  employee: Employee;
  catalog: Catalog;
  ledger: Ledger;
  canManage: boolean;
  save: Save;
}) {
  const [editor, setEditor] = useState<Schedule | 'new' | null>(null);
  const [correction, setCorrection] = useState<Schedule | null>(null);
  const [removing, setRemoving] = useState('');
  const [error, setError] = useState('');
  async function remove(row: Schedule) {
    if (!window.confirm('Xóa lịch ngày ' + row.workDate + '?')) return;
    setRemoving(row.id);
    setError('');
    try {
      await save('/employees/' + employee.id + '/schedule/' + row.id, {}, 'DELETE');
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setRemoving('');
    }
  }
  return (
    <section className="att-section" aria-labelledby="att-schedule-heading">
      <div className="att-section-heading">
        <div>
          <h2 id="att-schedule-heading">Bảng công</h2>
          <p>{ledger.schedule.length} mục trong kỳ</p>
        </div>
        {canManage && employee.status !== 'TERMINATED' && (
          <button type="button" className="primary" onClick={() => setEditor('new')}>
            {employee.attendanceMode === 'OFFICE' ? '+ Đánh dấu ngày nghỉ' : '+ Phân ca'}
          </button>
        )}
      </div>
      {editor && (
        <ScheduleForm
          key={editor === 'new' ? 'new' : editor.id}
          employee={employee}
          shifts={catalog.shifts}
          row={editor === 'new' ? null : editor}
          save={save}
          close={() => setEditor(null)}
        />
      )}
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {correction && (
        <ActionForm
          key={correction.id}
          title={'Đề nghị điều chỉnh công ngày ' + correction.workDate}
          submitLabel="Gửi đề nghị"
          dismiss={() => setCorrection(null)}
          save={(data) =>
            save('/corrections/' + correction.id, {
              checkedInAt: localInstant(str(data, 'start')),
              checkedOutAt: localInstant(str(data, 'end')),
              reason: str(data, 'reason'),
              ...(correction.virtual && { employeeId: employee.id, workDate: correction.workDate }),
            })
          }
        >
          <TimeRange />
          <Reason />
        </ActionForm>
      )}
      <div className="table-wrap att-table">
        <table role="table" aria-labelledby="att-schedule-heading">
          <thead role="rowgroup">
            <tr role="row">
              <th role="columnheader" scope="col">
                Ngày / ca
              </th>
              <th role="columnheader" scope="col">
                Giờ thực tế
              </th>
              <th role="columnheader" scope="col">
                Trạng thái
              </th>
              <th role="columnheader" scope="col">
                Thao tác
              </th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            {ledger.schedule.map((row) => (
              <tr key={row.id} role="row">
                <td role="cell" className="att-leading-cell">
                  <strong>{formatDay(row.workDate)}</strong>
                  <span>
                    {row.attendanceKind === 'OFFICE' || row.shiftId ? row.label : 'Ngày nghỉ'}
                  </span>
                  {(row.attendanceKind === 'OFFICE' || row.shiftId) && (
                    <small>
                      {shiftMoment(row.startsAt, row)} – {shiftMoment(row.endsAt, row)} ·{' '}
                      {row.timeZone}
                    </small>
                  )}
                </td>
                <td role="cell" data-label="Giờ thực tế">
                  <span className="att-times">
                    {shiftMoment(row.checkedInAt, row)} → {shiftMoment(row.checkedOutAt, row)}
                  </span>
                  {row.adjusted && (
                    <details>
                      <summary>Đã điều chỉnh</summary>
                      Giờ gốc: {formatDate(row.rawIn, row.timeZone)} →{' '}
                      {formatDate(row.rawOut, row.timeZone)}
                    </details>
                  )}
                </td>
                <td role="cell" data-label="Trạng thái">
                  <Status
                    status={
                      row.attendanceKind === 'OFFICE' && row.status === 'SCHEDULED'
                        ? 'OFFICE_SCHEDULED'
                        : row.status
                    }
                  />
                  <div className="att-flags">
                    {row.late && <div>Đi muộn</div>}
                    {row.leftEarly && <div>Về sớm</div>}
                    {row.recordedMinutes !== null && (
                      <div>{duration(row.recordedMinutes)} ghi nhận</div>
                    )}
                    {row.overtimeMinutes !== null && row.overtimeMinutes > 0 && (
                      <div>Thêm giờ · {duration(row.overtimeMinutes)}</div>
                    )}
                    {row.leaveConflict && <div>Giờ ghi nhận trùng với phép đã duyệt</div>}
                  </div>
                </td>
                <td role="cell" className="att-table-actions">
                  <div className="org-action-cell">
                    {employee.self && <Punch row={row} employee={employee} save={save} />}
                    {canManage &&
                      !row.virtual &&
                      row.attendanceKind !== 'OFFICE' &&
                      employee.status !== 'TERMINATED' &&
                      Date.parse(row.startsAt) > Date.now() &&
                      !row.rawIn && (
                        <>
                          <button
                            className="secondary"
                            type="button"
                            onClick={() => setEditor(row)}
                          >
                            Sửa lịch
                          </button>
                          <button
                            className="secondary"
                            type="button"
                            disabled={Boolean(removing)}
                            onClick={() => void remove(row)}
                          >
                            Xóa lịch
                          </button>
                        </>
                      )}
                    {(employee.self || canManage) &&
                      (row.shiftId || row.attendanceKind === 'OFFICE') &&
                      Date.parse(row.endsAt) <= Date.now() && (
                        <button
                          className="secondary"
                          type="button"
                          onClick={() => setCorrection(row)}
                        >
                          Đề nghị điều chỉnh
                        </button>
                      )}
                  </div>
                </td>
              </tr>
            ))}
            {!ledger.schedule.length && (
              <tr role="row">
                <td role="cell" colSpan={4} className="att-empty">
                  Chưa có lịch làm việc trong kỳ này.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RequestsPanel({
  employee,
  ledger,
  catalog,
  profile,
  canManage,
  save,
}: {
  employee: Employee;
  ledger: Ledger;
  catalog: Catalog;
  profile: Profile;
  canManage: boolean;
  save: Save;
}) {
  const [action, setAction] = useState<{
    kind: 'leave' | 'corrections';
    id: string;
    transition: 'APPROVE' | 'REJECT' | 'CANCEL';
    charge: boolean;
  } | null>(null);
  const [form, setForm] = useState<'leave' | 'balance' | null>(null);
  const [leaveTypeId, setLeaveTypeId] = useState('');
  const [balanceTypeId, setBalanceTypeId] = useState('');
  const canReview =
    !employee.self && ['ADMIN', 'HR', 'MANAGER'].includes(profile.organization.role);
  function actions(item: Review, kind: 'leave' | 'corrections', charge = false) {
    const mayReview = canReview && item.createdBy !== profile.user.id;
    return (
      <div className="org-action-cell">
        {item.status === 'PENDING' && mayReview && (
          <>
            <button
              className="secondary"
              type="button"
              onClick={() => setAction({ kind, id: item.id, transition: 'APPROVE', charge })}
            >
              Duyệt
            </button>
            <button
              className="secondary"
              type="button"
              onClick={() => setAction({ kind, id: item.id, transition: 'REJECT', charge: false })}
            >
              Từ chối
            </button>
          </>
        )}
        {kind === 'leave' &&
          ((item.status === 'PENDING' &&
            (employee.self || canReview || item.createdBy === profile.user.id)) ||
            (item.status === 'APPROVED' && mayReview)) && (
            <button
              className="secondary"
              type="button"
              onClick={() => setAction({ kind, id: item.id, transition: 'CANCEL', charge: false })}
            >
              Hủy đơn
            </button>
          )}
      </div>
    );
  }
  function history(item: Review) {
    return (
      <>
        <Status status={item.status} />
        <details>
          <summary>Lịch sử</summary>
          <p>
            Gửi lúc {formatDate(item.createdAt)} · {item.reason}
          </p>
          {item.reviewedAt && (
            <p>
              Xử lý lúc {formatDate(item.reviewedAt)} · {item.reviewReason}
            </p>
          )}
          {'cancelledAt' in item && Boolean((item as Leave).cancelledAt) && (
            <p>
              Hủy lúc {formatDate((item as Leave).cancelledAt)} · {(item as Leave).cancelReason}
            </p>
          )}
        </details>
      </>
    );
  }
  return (
    <section className="att-section" aria-labelledby="att-requests-heading">
      <div className="att-section-heading">
        <div>
          <h2 id="att-requests-heading">Nghỉ phép</h2>
          <p>
            {ledger.leave.filter((item) => item.status === 'PENDING').length} đơn chờ duyệt trong kỳ
          </p>
        </div>
        <div className="org-action-cell">
          {(employee.self || canManage) && employee.status !== 'TERMINATED' && (
            <button className="primary" type="button" onClick={() => setForm('leave')}>
              + Gửi đơn nghỉ phép
            </button>
          )}
          {canManage && !employee.self && (
            <button className="secondary" type="button" onClick={() => setForm('balance')}>
              Cập nhật số dư phép
            </button>
          )}
        </div>
      </div>
      {form === 'leave' && (
        <ActionForm
          title="Đơn nghỉ phép"
          submitLabel="Gửi duyệt"
          dismiss={() => setForm(null)}
          save={(data) =>
            save('/employees/' + employee.id + '/leave', {
              leaveTypeId: str(data, 'type'),
              startsAt: localInstant(str(data, 'start')),
              endsAt: localInstant(str(data, 'end')),
              reason: str(data, 'reason'),
            })
          }
        >
          <label className="field">
            Loại phép
            <SearchableSelect
              name="type"
              required
              value={leaveTypeId}
              onChange={setLeaveTypeId}
              options={[
                { value: '', label: 'Chọn loại phép' },
                ...catalog.leaveTypes
                  .filter((type) => type.active)
                  .map((type) => ({ value: type.id, label: type.name })),
              ]}
            />
          </label>
          <TimeRange />
          <Reason label="Lý do nghỉ phép" />
        </ActionForm>
      )}
      {form === 'balance' && (
        <ActionForm
          title="Cập nhật hạn mức phép"
          submitLabel="Lưu hạn mức"
          dismiss={() => setForm(null)}
          save={(data) =>
            save(
              '/employees/' + employee.id + '/balances/' + str(data, 'type'),
              { allowanceMinutes: Number(str(data, 'minutes')), reason: str(data, 'reason') },
              'PUT',
            )
          }
        >
          <label className="field">
            Loại phép
            <SearchableSelect
              name="type"
              required
              value={balanceTypeId}
              onChange={setBalanceTypeId}
              options={[
                { value: '', label: 'Chọn loại có số dư' },
                ...catalog.leaveTypes
                  .filter((type) => type.tracksBalance)
                  .map((type) => ({ value: type.id, label: type.name })),
              ]}
            />
          </label>
          <label className="field">
            Tổng hạn mức đã cấp (phút)
            <input name="minutes" type="number" min={0} max={2000000000} step={1} required />
          </label>
          <Reason />
        </ActionForm>
      )}
      {action && (
        <ActionForm
          key={action.id + action.transition}
          title={
            action.transition === 'APPROVE'
              ? 'Duyệt đơn'
              : action.transition === 'REJECT'
                ? 'Từ chối đơn'
                : 'Hủy đơn'
          }
          submitLabel="Xác nhận"
          dismiss={() => setAction(null)}
          save={(data) => {
            const suffix = action.transition === 'CANCEL' ? '/cancel' : '/review';
            const payload = {
              reason: str(data, 'reason'),
              ...(action.transition !== 'CANCEL' && { action: action.transition }),
              ...(action.charge && { chargeMinutes: Number(str(data, 'minutes')) }),
            };
            return save('/' + action.kind + '/' + action.id + suffix, payload);
          }}
        >
          {action.charge && (
            <label className="field">
              Số phút trừ theo chính sách đã duyệt
              <input name="minutes" type="number" min={0} max={2000000000} step={1} required />
            </label>
          )}
          <Reason />
        </ActionForm>
      )}
      <section className="att-balance" aria-labelledby="att-balance-title">
        <h3 id="att-balance-title">Số dư phép</h3>
        {ledger.balances.length ? (
          <ul>
            {ledger.balances.map((balance) => (
              <li key={balance.leaveTypeId}>
                <span>{balance.name}</span>
                <strong>{balance.availableMinutes.toLocaleString('vi-VN')} phút</strong>
                <small>
                  Trong tổng {balance.allowanceMinutes.toLocaleString('vi-VN')} phút đã cấp
                </small>
              </li>
            ))}
          </ul>
        ) : (
          <p>Chưa có hạn mức phép.</p>
        )}
      </section>
      <div className="table-wrap att-table">
        <table role="table">
          <caption>Đơn nghỉ phép</caption>
          <thead role="rowgroup">
            <tr role="row">
              <th role="columnheader" scope="col">
                Loại phép
              </th>
              <th role="columnheader" scope="col">
                Thời gian
              </th>
              <th role="columnheader" scope="col">
                Trạng thái
              </th>
              <th role="columnheader" scope="col">
                Thao tác
              </th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            {ledger.leave.map((item) => (
              <tr key={item.id} role="row">
                <td role="cell" className="att-leading-cell">
                  <strong>{item.name}</strong>
                </td>
                <td role="cell" data-label="Thời gian">
                  {formatDate(item.startsAt)} → {formatDate(item.endsAt)}
                  {item.chargeMinutes !== null && <div>{item.chargeMinutes} phút đã duyệt</div>}
                </td>
                <td role="cell" data-label="Trạng thái">
                  {history(item)}
                </td>
                <td role="cell" className="att-table-actions">
                  {actions(item, 'leave', item.tracksBalance)}
                </td>
              </tr>
            ))}
            {!ledger.leave.length && (
              <tr role="row">
                <td role="cell" colSpan={4} className="att-empty">
                  Chưa có đơn nghỉ trong kỳ này.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="table-wrap att-table">
        <table role="table">
          <caption>Điều chỉnh công</caption>
          <thead role="rowgroup">
            <tr role="row">
              <th role="columnheader" scope="col">
                Ngày công
              </th>
              <th role="columnheader" scope="col">
                Giờ đề nghị
              </th>
              <th role="columnheader" scope="col">
                Trạng thái
              </th>
              <th role="columnheader" scope="col">
                Thao tác
              </th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            {ledger.corrections.map((item) => (
              <tr key={item.id} role="row">
                <td role="cell" className="att-leading-cell">
                  <strong>{formatDay(item.workDate)}</strong>
                </td>
                <td role="cell" data-label="Giờ đề nghị">
                  {formatDate(item.proposedIn)} → {formatDate(item.proposedOut)}
                </td>
                <td role="cell" data-label="Trạng thái">
                  {history(item)}
                </td>
                <td role="cell" className="att-table-actions">
                  {actions(item, 'corrections')}
                </td>
              </tr>
            ))}
            {!ledger.corrections.length && (
              <tr role="row">
                <td role="cell" colSpan={4} className="att-empty">
                  Chưa có đề nghị điều chỉnh trong kỳ này.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function Attendance({
  profile,
  view,
}: {
  profile: Profile;
  view?: 'shifts' | 'leave-types' | 'policy';
}) {
  const { locale } = useTranslation();
  const tr = attendanceMessages[locale];
  const endpoint = '/api/organizations/' + profile.organization.id + '/attendance';
  const canManage = ['ADMIN', 'HR'].includes(profile.organization.role);
  const [tab, setTab] = useState<'schedule' | 'requests' | 'catalog' | 'departments'>(
    view === 'policy' ? 'departments' : view ? 'catalog' : 'schedule',
  );
  const [revision, setRevision] = useState(0);
  const [message, setMessage] = useState('');
  const [selected, setSelected] = useState('');
  const [search, setSearch] = useState({ q: '', page: 1 });
  const [range, setRange] = useState(() => {
    const current = new Date();
    return {
      from: localDate(new Date(current.getFullYear(), current.getMonth(), current.getDate() - 7)),
      to: localDate(new Date(current.getFullYear(), current.getMonth(), current.getDate() + 14)),
    };
  });
  const people = useLoad<{ items: Employee[]; hasMore: boolean }>(
    view
      ? null
      : endpoint + '/employees?' + new URLSearchParams({ q: search.q, page: String(search.page) }),
    revision,
  );
  const employee = people.data?.items.find((item) => item.id === selected) ?? people.data?.items[0];
  const catalog = useLoad<Catalog>(view && !canManage ? null : endpoint + '/catalog', revision);
  const ledger = useLoad<Ledger>(
    employee
      ? endpoint +
          '/employees/' +
          employee.id +
          '/ledger?' +
          new URLSearchParams({ ...range, timeZone: browserZone })
      : null,
    revision,
  );

  const save: Save = async (path, body, method) => {
    setMessage('');
    const result = await request(endpoint + path, body, method);
    setMessage('Đã lưu thay đổi.');
    setRevision((value) => value + 1);
    return result;
  };

  if (view && !canManage)
    return (
      <p role="alert" className="notice error">
        {tr.noPermission}
      </p>
    );
  const title =
    view === 'shifts'
      ? tr.shifts
      : view === 'leave-types'
        ? tr.leaveTypes
        : view === 'policy'
          ? tr.policy
          : tr.attendance;
  return (
    <div className="att-page">
      <header className="att-header">
        <span className="att-header-icon">
          <DashIcon
            name={view === 'policy' ? 'settings' : view === 'leave-types' ? 'leave' : 'clock'}
          />
        </span>
        <div>
          <h1>{title}</h1>
          <p>{profile.organization.name}</p>
        </div>
      </header>
      {!view && (
        <nav className="att-tabs" aria-label={tr.navigation}>
          <button
            type="button"
            aria-pressed={tab === 'schedule'}
            onClick={() => setTab('schedule')}
          >
            {tr.schedule}
          </button>
          <button
            type="button"
            aria-pressed={tab === 'requests'}
            onClick={() => setTab('requests')}
          >
            {tr.requests}
          </button>
        </nav>
      )}
      {message && (
        <p role="status" className="notice success">
          {message}
        </p>
      )}
      {view && catalog.loading && <p role="status">{tr.loadingCatalog}</p>}
      {(catalog.error || (tab !== 'catalog' && (people.error || ledger.error))) && (
        <p role="alert" className="notice error">
          {catalog.error || people.error || ledger.error}
        </p>
      )}
      {tab === 'departments' ? (
        catalog.data && (
          <DepartmentPolicies departments={catalog.data.departments ?? []} save={save} />
        )
      ) : tab === 'catalog' ? (
        catalog.data && (
          <CatalogPanel
            catalog={catalog.data}
            save={save}
            section={view === 'shifts' || view === 'leave-types' ? view : undefined}
          />
        )
      ) : (
        <>
          <section className="att-context" aria-label={tr.context}>
            {profile.organization.role !== 'EMPLOYEE' && (
              <div className="att-person-controls">
                {employee && (
                  <label className="field">
                    {tr.employee}
                    <SearchableSelect
                      value={employee.id}
                      onChange={setSelected}
                      options={
                        people.data?.items.map((item) => ({
                          value: item.id,
                          label: `${item.name} (${item.code})${item.self ? ' · Bạn' : ''}`,
                          keywords: `${item.name} ${item.code}`,
                        })) ?? []
                      }
                    />
                  </label>
                )}
                <details>
                  <summary>{tr.searchEmployee}</summary>
                  <form
                    className="att-search"
                    onSubmit={(event) => {
                      event.preventDefault();
                      setSelected('');
                      setSearch({ q: str(new FormData(event.currentTarget), 'q').trim(), page: 1 });
                    }}
                  >
                    <input
                      type="search"
                      name="q"
                      aria-label={tr.searchEmployee}
                      placeholder={tr.searchPlaceholder}
                      maxLength={100}
                    />
                    <button className="secondary" type="submit">
                      {tr.search}
                    </button>
                  </form>
                </details>
                {(search.page > 1 || people.data?.hasMore) && (
                  <div className="att-person-pages">
                    <button
                      className="secondary"
                      type="button"
                      aria-label="Trang nhân viên trước"
                      disabled={search.page === 1 || people.loading}
                      onClick={() => setSearch({ ...search, page: search.page - 1 })}
                    >
                      Trước
                    </button>
                    <span>Trang {search.page}</span>
                    <button
                      className="secondary"
                      type="button"
                      aria-label="Trang nhân viên sau"
                      disabled={!people.data?.hasMore || people.loading}
                      onClick={() => setSearch({ ...search, page: search.page + 1 })}
                    >
                      Sau
                    </button>
                  </div>
                )}
              </div>
            )}
            {employee && (
              <form
                className="att-period"
                onSubmit={(event) => {
                  event.preventDefault();
                  const data = new FormData(event.currentTarget);
                  setRange({ from: str(data, 'from'), to: str(data, 'to') });
                  setRevision((value) => value + 1);
                }}
              >
                <label className="field">
                  Từ ngày
                  <input name="from" type="date" defaultValue={range.from} required />
                </label>
                <label className="field">
                  Đến ngày
                  <input name="to" type="date" defaultValue={range.to} required />
                </label>
                <button className="secondary" type="submit">
                  Xem dữ liệu
                </button>
              </form>
            )}
          </section>
          {!people.loading && !people.error && !employee && (
            <div className="att-zero">
              <h2>Chưa tìm thấy nhân viên</h2>
              <p>
                {search.q
                  ? 'Thử tìm bằng mã hoặc tên khác.'
                  : 'Chưa có hồ sơ nhân viên trong phạm vi của bạn.'}
              </p>
              {canManage && !search.q && <a href="/admin/employees">Mở danh sách nhân viên</a>}
            </div>
          )}
          {tab === 'schedule' && ledger.data && (
            <dl className="att-metrics">
              <div>
                <dt>Ca đã phân</dt>
                <dd>{ledger.data.schedule.filter((row) => row.shiftId).length}</dd>
              </div>
              <div>
                <dt>Thời gian ghi nhận</dt>
                <dd>
                  {duration(
                    ledger.data.schedule.reduce(
                      (total, row) => total + (row.recordedMinutes ?? 0),
                      0,
                    ),
                  )}
                </dd>
              </div>
              <div>
                <dt>Cần bổ sung dấu giờ</dt>
                <dd>{ledger.data.schedule.filter((row) => row.status === 'MISSING').length}</dd>
              </div>
            </dl>
          )}
          {employee &&
            ledger.data &&
            catalog.data &&
            (tab === 'schedule' ? (
              <SchedulePanel
                key={employee.id}
                employee={employee}
                ledger={ledger.data}
                catalog={catalog.data}
                canManage={canManage}
                save={save}
              />
            ) : (
              <RequestsPanel
                key={employee.id}
                employee={employee}
                ledger={ledger.data}
                catalog={catalog.data}
                profile={profile}
                canManage={canManage}
                save={save}
              />
            ))}
        </>
      )}
      {(catalog.loading || (tab !== 'catalog' && (people.loading || ledger.loading))) && (
        <p role="status">Đang tải dữ liệu…</p>
      )}
    </div>
  );
}
