import type { Express } from 'express';
import type { Pool, PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { authorizeMutation } from './authorization.js';
import { managementScope } from './management-scope.js';
import { escapeLike, type OrgStructureDeps } from './organization-structure.js';
import { fail, type Authed, type Identity } from './types.js';

const uuid = z.uuid();
const day = z.iso.date();
const instant = z.iso.datetime({ offset: true });
const clockTime = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const reason = z.string().trim().min(1).max(500);
const offsetMinutes = z.number().int().min(0).max(720);
const balanceMinutes = z.number().int().min(0).max(2_000_000_000);
const roles = ['ADMIN', 'HR', 'MANAGER', 'EMPLOYEE'] as const;
const admins = ['ADMIN', 'HR'] as const;
const reviewers = ['ADMIN', 'HR', 'MANAGER'] as const;
const shiftInput = z.object({
  name: z.string().trim().min(1).max(120), timeZone: z.string().trim().min(1).max(80),
  startTime: clockTime, endTime: clockTime, active: z.boolean(),
  earlyCheckIn: offsetMinutes, lateGrace: offsetMinutes.nullable(),
  earlyGrace: offsetMinutes.nullable(), overtimeAfter: offsetMinutes.nullable(),
}).strict();
const leaveTypeInput = z.object({
  name: z.string().trim().min(1).max(120), tracksBalance: z.boolean(), active: z.boolean(),
}).strict();
const scheduleInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('SHIFT'), workDate: day, shiftId: uuid,
    startsAt: instant.optional(), endsAt: instant.optional() }).strict(),
  z.object({ kind: z.literal('OFF'), workDate: day, timeZone: z.string().trim().min(1).max(80) }).strict(),
]);
const reviewInput = z.object({ action: z.enum(['APPROVE', 'REJECT']), reason }).strict();
type Employee = {
  id: string; attendance_mode: 'SHIFT' | 'OFFICE'; user_id: string | null; full_name: string; employee_code: string;
  employment_status: string; department_id: string | null; manager_user_id: string | null; role: string | null;
};
type Schedule = {
  id: string; employee_id: string; shift_id: string | null; attendance_kind: string; starts_at: Date; ends_at: Date;
  early_check_in: number; checked_in_at: Date | null; checked_out_at: Date | null; adjusted: boolean;
};
type Db = Pool | PoolClient;
const employeeColumns = "e.id,e.user_id,e.full_name,e.employee_code,e.employment_status,e.department_id,e.manager_user_id,m.role,COALESCE((SELECT d.attendance_mode FROM departments d WHERE d.id=e.department_id AND d.organization_id=e.organization_id),'SHIFT') AS attendance_mode";
const employeeJoin = "employees e LEFT JOIN memberships m ON m.organization_id=e.organization_id AND m.user_id=e.user_id";
const shiftColumns = 'id,name,time_zone AS "timeZone",to_char(start_time,\'HH24:MI\') AS "startTime",to_char(end_time,\'HH24:MI\') AS "endTime",active,early_check_in AS "earlyCheckIn",late_grace AS "lateGrace",early_grace AS "earlyGrace",overtime_after AS "overtimeAfter"';
const typeColumns = 'id,name,tracks_balance AS "tracksBalance",active';
const usedBalance = "COALESCE((SELECT sum(r.charge_minutes) FROM leave_requests r WHERE r.organization_id=b.organization_id AND r.employee_id=b.employee_id AND r.leave_type_id=b.leave_type_id AND r.status='APPROVED'),0)";

const departmentColumns = `id,name,attendance_mode AS mode,office_time_zone AS "timeZone",
  to_char(office_start,'HH24:MI') AS "startTime",to_char(office_end,'HH24:MI') AS "endTime",office_days AS weekdays`;
// Project office days without writes on GET. A real snapshot is inserted on the first punch.
const officeDaysSql = `SELECT overlay(overlay(md5(e.id::text||':'||to_char(d.work_date,'YYYY-MM-DD')||':office') placing '3' from 13 for 1) placing '8' from 17 for 1)::uuid AS id,
  e.organization_id,e.id AS employee_id,NULL::uuid AS shift_id,'Giờ hành chính'::text AS label,
  d.work_date::date AS work_date,p.office_time_zone AS time_zone,
  (d.work_date::date+p.office_start) AT TIME ZONE p.office_time_zone AS starts_at,
  (d.work_date::date+p.office_end) AT TIME ZONE p.office_time_zone AS ends_at,
  120 AS early_check_in,0 AS late_grace,0 AS early_grace,NULL::integer AS overtime_after,'OFFICE'::text AS attendance_kind
  FROM employees e JOIN departments p ON p.id=e.department_id AND p.organization_id=e.organization_id
  CROSS JOIN LATERAL generate_series($3::date::timestamp,$4::date::timestamp,interval '1 day') d(work_date)
  WHERE e.organization_id=$1 AND e.id=$2 AND p.attendance_mode='OFFICE' AND p.is_active AND e.employment_status='ACTIVE'
    AND d.work_date::date>=greatest(e.hire_date,p.office_since) AND extract(dow FROM d.work_date)::int=ANY(p.office_days)
    AND (((d.work_date::date+p.office_start) AT TIME ZONE p.office_time_zone) AT TIME ZONE p.office_time_zone)::time=p.office_start
    AND (((d.work_date::date+p.office_end) AT TIME ZONE p.office_time_zone) AT TIME ZONE p.office_time_zone)::time=p.office_end
    AND NOT EXISTS(SELECT 1 FROM work_schedule s WHERE s.organization_id=e.organization_id AND s.employee_id=e.id
      AND (s.work_date=d.work_date::date OR (s.starts_at<((d.work_date::date+p.office_end) AT TIME ZONE p.office_time_zone)
      AND s.ends_at>((d.work_date::date+p.office_start) AT TIME ZONE p.office_time_zone))))`;

async function employeeScope(db: Db, identity: Identity) {
  const params: unknown[] = [identity.orgId, identity.userId];
  const self = 'e.user_id=$2';
  if (identity.role === 'ADMIN') return { sql: 'e.organization_id=$1 AND ($2::uuid IS NOT NULL)', params };
  if (identity.role === 'HR') return { sql: "e.organization_id=$1 AND (" + self + " OR e.user_id IS NULL OR m.role='EMPLOYEE')", params };
  if (identity.role !== 'MANAGER') return { sql: 'e.organization_id=$1 AND ' + self, params };
  const scope = (await managementScope(db, identity))!;
  params.push(scope.departments, scope.users);
  return { sql: "e.organization_id=$1 AND (" + self + " OR ((e.user_id IS NULL OR m.role IN ('EMPLOYEE','MANAGER')) AND (e.department_id=ANY($3::uuid[]) OR e.user_id=ANY($4::uuid[]) OR e.manager_user_id=$2)))", params };
}

async function getEmployee(db: Db, identity: Identity, id: string) {
  const scope = await employeeScope(db, identity);
  const result = await db.query<Employee>(
    'SELECT ' + employeeColumns + ' FROM ' + employeeJoin + ' WHERE ' + scope.sql + ' AND e.id=$' + (scope.params.length + 1),
    [...scope.params, id],
  );
  return result.rows[0] ?? fail(404, 'ATT_EMPLOYEE_NOT_FOUND');
}

function own(identity: Identity, employee: Employee) {
  if (employee.user_id !== identity.userId) fail(403, 'FORBIDDEN');
}

function reviewable(identity: Identity, employee: Employee, applicant: string) {
  if (employee.user_id === identity.userId || applicant === identity.userId) fail(403, 'ATT_SELF_REVIEW');
}

async function now(db: Db): Promise<Date> {
  return (await db.query('SELECT clock_timestamp() AS now')).rows[0].now;
}

function validateRange(start: string, end: string) {
  if (Date.parse(end) <= Date.parse(start)) fail(400, 'ATT_INVALID_RANGE');
}

async function assertZone(db: Db, zone: string) {
  if (!(await db.query('SELECT 1 FROM pg_timezone_names WHERE name=$1', [zone])).rowCount) fail(400, 'ATT_INVALID_ZONE');
}

async function resolveWindow(db: Db, date: string, zone: string, start: string, end: string, options?: { startsAt?: string; endsAt?: string }) {
  // Try offsets observed on either side of the date and verify each candidate against its local clock.
  const result = await db.query<{ starts_at: Date | null; ends_at: Date | null }>(`
    WITH wall AS (
      SELECT $1::date+$3::time AS a, ($1::date+CASE WHEN $4::time<=$3::time THEN 1 ELSE 0 END)+$4::time AS b
    ), walls AS (SELECT 'a' AS key,a AS t,$5::timestamptz AS explicit FROM wall UNION ALL SELECT 'b',b,$6::timestamptz FROM wall),
    candidates AS (
      SELECT DISTINCT key,w.t,w.explicit,
        CASE WHEN w.explicit IS NOT NULL THEN w.explicit ELSE (w.t AT TIME ZONE 'UTC') -
          ((sample AT TIME ZONE $2)-(sample AT TIME ZONE 'UTC')) END AS candidate
      FROM walls w CROSS JOIN LATERAL (SELECT (w.t AT TIME ZONE $2)+delta AS sample
        FROM unnest(ARRAY[interval '-1 day',interval '0',interval '1 day']) delta) s
    ), valid AS (SELECT key,min(candidate) AS value FROM candidates WHERE candidate AT TIME ZONE $2=t GROUP BY key HAVING count(*)=1)
    SELECT (SELECT value FROM valid WHERE key='a') AS starts_at,(SELECT value FROM valid WHERE key='b') AS ends_at`,
    [date, zone, start, end, options?.startsAt ?? null, options?.endsAt ?? null]);
  const { starts_at, ends_at } = result.rows[0];
  if (!starts_at || !ends_at || ends_at <= starts_at) return fail(400, 'ATT_AMBIGUOUS_SCHEDULE');
  return { startsAt: starts_at, endsAt: ends_at };
}

async function getSchedule(db: Db, org: string, id: string): Promise<Schedule> {
  const result = await db.query<Schedule>(`SELECT s.*,p.checked_in_at,p.checked_out_at,
    EXISTS(SELECT 1 FROM attendance_adjustments a WHERE a.organization_id=s.organization_id AND a.schedule_id=s.id AND a.status='APPROVED') AS adjusted
    FROM work_schedule s LEFT JOIN attendance_punches p ON p.schedule_id=s.id AND p.organization_id=s.organization_id
    WHERE s.organization_id=$1 AND s.id=$2`, [org, id]);
  return result.rows[0] ?? fail(404, 'ATT_SCHEDULE_NOT_FOUND');
}

async function assertNoLeave(db: Db, organization: string, employee: string, start: Date, end?: Date) {
  const overlap = await db.query(`SELECT 1 FROM leave_requests WHERE organization_id=$1 AND employee_id=$2 AND status='APPROVED'
    AND ends_at>$3 AND (CASE WHEN $4::timestamptz IS NULL THEN starts_at<=$3 ELSE starts_at<$4 END) LIMIT 1`,
    [organization, employee, start, end ?? null]);
  if (overlap.rowCount) fail(409, 'ATT_LEAVE_CONFLICT');
}

async function assertNoWork(db: Db, organization: string, employee: string, start: string | Date, end: string | Date, ignore?: string) {
  const effective = await db.query(`SELECT 1 FROM work_schedule s LEFT JOIN attendance_punches p ON p.schedule_id=s.id
    LEFT JOIN LATERAL (SELECT proposed_in,proposed_out FROM attendance_adjustments a
      WHERE a.schedule_id=s.id AND a.status='APPROVED' ORDER BY reviewed_at DESC,id DESC LIMIT 1) a ON true
    WHERE s.organization_id=$1 AND s.employee_id=$2 AND s.id IS DISTINCT FROM $5::uuid
      AND (COALESCE(a.proposed_in,p.checked_in_at)<$4 AND COALESCE(a.proposed_out,p.checked_out_at,clock_timestamp())>$3)
    LIMIT 1`, [organization, employee, start, end, ignore ?? null]);
  if (effective.rowCount) fail(409, 'ATT_WORK_CONFLICT');
}

export function registerAttendanceRoutes(app: Express, { pool, transaction, audit, requireIdentity }: OrgStructureDeps) {
  const prefix = '/api/organizations/:organizationId/attendance';
  function actor(req: Authed) {
    const identity = requireIdentity(req);
    if (uuid.parse(req.params.organizationId) !== identity.orgId) fail(403, 'FORBIDDEN');
    return identity;
  }
  function mutate<T>(identity: Identity, allowed: typeof roles | typeof admins | typeof reviewers, handler: (db: PoolClient, current: Identity) => Promise<T>) {
    return transaction(async db => {
      // The existing authorization lock serializes attendance, balance and assignment mutations per organization.
      const role = await authorizeMutation(db, identity, [identity.userId], allowed, { requireRecent: allowed !== roles });
      return handler(db, { ...identity, role });
    });
  }

  app.get(prefix + '/employees', async (req: Authed, res) => {
    const identity = actor(req);
    const query = z.object({ q: z.string().trim().max(100).default(''), page: z.coerce.number().int().min(1).max(100000).default(1) }).strict().parse(req.query);
    const scope = await employeeScope(pool, identity);
    const q = scope.params.length + 1;
    const result = await pool.query<Employee & { self: boolean }>(`SELECT ` + employeeColumns + `,COALESCE(e.user_id=$2,false) AS self
      FROM ` + employeeJoin + ' WHERE ' + scope.sql +
      ` AND (e.full_name ILIKE $` + q + ` ESCAPE '\\' OR e.employee_code ILIKE $` + q + ` ESCAPE '\\') ORDER BY self DESC,e.employee_code,e.id LIMIT 51 OFFSET $` + (q + 1),
    [...scope.params, '%' + escapeLike(query.q) + '%', (query.page - 1) * 50]);
    res.json({ items: result.rows.slice(0, 50).map(e => ({
      id: e.id, name: e.full_name, code: e.employee_code, self: e.self, status: e.employment_status, attendanceMode: e.attendance_mode,
    })), hasMore: result.rows.length > 50 });
  });

  app.get(prefix + '/catalog', async (req: Authed, res) => {
    const identity = actor(req);
    const admin = admins.some(role => role === identity.role);
    const [shifts, leaveTypes, departments] = await Promise.all([
      admin ? pool.query('SELECT ' + shiftColumns + ' FROM work_shifts WHERE organization_id=$1 ORDER BY name,id', [identity.orgId]) : { rows: [] },
      pool.query('SELECT ' + typeColumns + ' FROM leave_types WHERE organization_id=$1 AND ($2 OR active) ORDER BY name,id', [identity.orgId, admin]),
      admin ? pool.query('SELECT ' + departmentColumns + ' FROM departments WHERE organization_id=$1 AND is_active ORDER BY name,id', [identity.orgId]) : { rows: [] },
    ]);
    res.json({ shifts: shifts.rows, leaveTypes: leaveTypes.rows, departments: departments.rows });
  });

  app.put(prefix + '/departments/:id/policy', async (req: Authed, res) => {
    const identity = actor(req), id = uuid.parse(req.params.id);
    const input = z.object({ mode: z.enum(['SHIFT','OFFICE']), timeZone: z.string().trim().min(1).max(80),
      startTime: clockTime, endTime: clockTime, weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7)
    }).strict().parse(req.body);
    if (input.endTime <= input.startTime || new Set(input.weekdays).size !== input.weekdays.length) fail(400, 'ATT_INVALID_RANGE');
    await mutate(identity, admins, async db => {
      await assertZone(db, input.timeZone);
      // Freeze elapsed office days before a policy change so historical absences/hours do not drift.
      const affected = await db.query(`SELECT e.id,p.office_since::text AS since,
        (clock_timestamp() AT TIME ZONE p.office_time_zone)::date::text AS today
        FROM departments p JOIN employees e ON e.department_id=p.id AND e.organization_id=p.organization_id
        WHERE p.organization_id=$1 AND p.id=$2 AND p.attendance_mode='OFFICE'`, [identity.orgId,id]);
      for (const employee of affected.rows) {
        await db.query('INSERT INTO work_schedule ' + officeDaysSql,
          [identity.orgId,employee.id,employee.since,employee.today]);
      }
      const updated = await db.query(`UPDATE departments SET office_since=CASE WHEN attendance_mode='SHIFT' AND $3='OFFICE'
          THEN (clock_timestamp() AT TIME ZONE $4)::date ELSE office_since END,attendance_mode=$3,office_time_zone=$4,office_start=$5,
        office_end=$6,office_days=$7,updated_at=now() WHERE organization_id=$1 AND id=$2 AND is_active`,
      [identity.orgId,id,input.mode,input.timeZone,input.startTime,input.endTime,input.weekdays]);
      if (!updated.rowCount) fail(404, 'ATT_DEPARTMENT_NOT_FOUND');
      await audit(db, 'ATT_DEPARTMENT_POLICY_SAVED', identity.userId, identity.orgId, undefined, { departmentId: id, mode: input.mode });
    });
    res.status(204).end();
  });

  app.put(prefix + '/shifts/:id', async (req: Authed, res) => {
    const identity = actor(req), param = z.union([z.literal('new'), uuid]).parse(req.params.id);
    const data = shiftInput.parse(req.body);
    if (data.startTime === data.endTime) fail(400, 'ATT_INVALID_RANGE');
    const id = param === 'new' ? randomUUID() : param;
    await mutate(identity, admins, async db => {
      await assertZone(db, data.timeZone);
      const values = [identity.orgId, id, data.name, data.timeZone, data.startTime, data.endTime, data.active,
        data.earlyCheckIn, data.lateGrace, data.earlyGrace, data.overtimeAfter];
      if ((await db.query('SELECT 1 FROM work_shifts WHERE organization_id=$1 AND lower(btrim(name))=lower(btrim($2)) AND id<>$3',
        [identity.orgId, data.name, id])).rowCount) fail(409, 'ATT_DUPLICATE_NAME');
      const result = param === 'new' ? await db.query(`INSERT INTO work_shifts
        (organization_id,id,name,time_zone,start_time,end_time,active,early_check_in,late_grace,early_grace,overtime_after)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, values) :
        await db.query(`UPDATE work_shifts SET name=$3,time_zone=$4,start_time=$5,end_time=$6,active=$7,
          early_check_in=$8,late_grace=$9,early_grace=$10,overtime_after=$11 WHERE organization_id=$1 AND id=$2`, values);
      if (!result.rowCount) fail(404, 'ATT_SHIFT_NOT_FOUND');
      await audit(db, 'ATT_SHIFT_SAVED', identity.userId, identity.orgId, undefined, { shiftId: id });
    });
    res.status(param === 'new' ? 201 : 200).json({ id });
  });

  app.put(prefix + '/leave-types/:id', async (req: Authed, res) => {
    const identity = actor(req), param = z.union([z.literal('new'), uuid]).parse(req.params.id);
    const data = leaveTypeInput.parse(req.body), id = param === 'new' ? randomUUID() : param;
    await mutate(identity, admins, async db => {
      if ((await db.query('SELECT 1 FROM leave_types WHERE organization_id=$1 AND lower(btrim(name))=lower(btrim($2)) AND id<>$3',
        [identity.orgId, data.name, id])).rowCount) fail(409, 'ATT_DUPLICATE_NAME');
      const result = param === 'new' ?
        await db.query('INSERT INTO leave_types(organization_id,id,name,tracks_balance,active) VALUES($1,$2,$3,$4,$5)',
          [identity.orgId, id, data.name, data.tracksBalance, data.active]) :
        await db.query('UPDATE leave_types SET name=$3,active=$5 WHERE organization_id=$1 AND id=$2 AND tracks_balance=$4',
          [identity.orgId, id, data.name, data.tracksBalance, data.active]);
      if (!result.rowCount) fail(409, 'ATT_LEAVE_TYPE_UNAVAILABLE');
      await audit(db, 'ATT_LEAVE_TYPE_SAVED', identity.userId, identity.orgId, undefined, { leaveTypeId: id });
    });
    res.status(param === 'new' ? 201 : 200).json({ id });
  });

  app.put(prefix + '/employees/:employeeId/schedule/:id', async (req: Authed, res) => {
    const identity = actor(req), employeeId = uuid.parse(req.params.employeeId);
    const param = z.union([z.literal('new'), uuid]).parse(req.params.id);
    const id = param === 'new' ? randomUUID() : param;
    const data = scheduleInput.parse(req.body);
    await mutate(identity, admins, async (db, current) => {
      const employee = await getEmployee(db, current, employeeId);
      if (employee.employment_status === 'TERMINATED') fail(409, 'ATT_EMPLOYEE_INACTIVE');
      if (data.kind === 'SHIFT' && employee.department_id && (await db.query(
        "SELECT 1 FROM departments WHERE id=$1 AND organization_id=$2 AND attendance_mode='OFFICE'",
        [employee.department_id, current.orgId])).rowCount) fail(409, 'ATT_OFFICE_NO_SHIFT');
      if (param !== 'new') {
        const original = await getSchedule(db, current.orgId, id);
        if (original.employee_id !== employee.id) fail(404, 'ATT_SCHEDULE_NOT_FOUND');
        if (original.starts_at <= await now(db) || original.checked_in_at) fail(409, 'ATT_SCHEDULE_STARTED');
      }
      const shift = data.kind === 'SHIFT' ?
        (await db.query('SELECT ' + shiftColumns + ' FROM work_shifts WHERE organization_id=$1 AND id=$2 AND active', [identity.orgId, data.shiftId])).rows[0] : null;
      if (data.kind === 'SHIFT' && !shift) fail(404, 'ATT_SHIFT_NOT_FOUND');
      const zone = data.kind === 'OFF' ? data.timeZone : shift.timeZone as string;
      if (data.kind === 'OFF') await assertZone(db, zone);
      const window = await resolveWindow(db, data.workDate, zone, shift?.startTime ?? '00:00', shift?.endTime ?? '00:00',
        data.kind === 'SHIFT' ? data : undefined);
      if (window.startsAt <= await now(db)) fail(409, 'ATT_SCHEDULE_STARTED');
      if ((await db.query(`SELECT 1 FROM work_schedule WHERE organization_id=$1 AND employee_id=$2 AND id<>$3 AND
        starts_at<$5 AND ends_at>$4 LIMIT 1`,
      [identity.orgId, employee.id, id, window.startsAt, window.endsAt])).rowCount) fail(409, 'ATT_SCHEDULE_CONFLICT');
      await db.query(`INSERT INTO work_schedule
        (organization_id,employee_id,id,shift_id,label,work_date,time_zone,starts_at,ends_at,early_check_in,late_grace,early_grace,overtime_after,attendance_kind)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        ON CONFLICT(id) DO UPDATE SET attendance_kind=EXCLUDED.attendance_kind,shift_id=EXCLUDED.shift_id,label=EXCLUDED.label,work_date=EXCLUDED.work_date,
          time_zone=EXCLUDED.time_zone,starts_at=EXCLUDED.starts_at,ends_at=EXCLUDED.ends_at,early_check_in=EXCLUDED.early_check_in,
          late_grace=EXCLUDED.late_grace,early_grace=EXCLUDED.early_grace,overtime_after=EXCLUDED.overtime_after
        WHERE work_schedule.organization_id=EXCLUDED.organization_id AND work_schedule.employee_id=EXCLUDED.employee_id`,
      [identity.orgId, employee.id, id, shift?.id ?? null, shift?.name ?? 'OFF', data.workDate, zone, window.startsAt, window.endsAt,
        shift?.earlyCheckIn ?? 0, shift?.lateGrace ?? null, shift?.earlyGrace ?? null, shift?.overtimeAfter ?? null, data.kind]);
      await audit(db, 'ATT_SCHEDULE_SAVED', identity.userId, identity.orgId, employee.user_id ?? undefined, { scheduleId: id, employeeId });
    });
    res.status(param === 'new' ? 201 : 200).json({ id });
  });

  app.delete(prefix + '/employees/:employeeId/schedule/:id', async (req: Authed, res) => {
    const identity = actor(req), employeeId = uuid.parse(req.params.employeeId), id = uuid.parse(req.params.id);
    await mutate(identity, admins, async (db, current) => {
      const employee = await getEmployee(db, current, employeeId);
      const row = await getSchedule(db, identity.orgId, id);
      if (row.employee_id !== employee.id) fail(404, 'ATT_SCHEDULE_NOT_FOUND');
      if (row.starts_at <= await now(db) || row.checked_in_at) fail(409, 'ATT_SCHEDULE_STARTED');
      await db.query('DELETE FROM work_schedule WHERE organization_id=$1 AND employee_id=$2 AND id=$3', [identity.orgId, employee.id, id]);
      await audit(db, 'ATT_SCHEDULE_REMOVED', identity.userId, identity.orgId, employee.user_id ?? undefined, { scheduleId: id, employeeId });
    });
    res.status(204).end();
  });

  async function punch(db: PoolClient, current: Identity, id: string, action: 'IN' | 'OUT') {
      const row = await getSchedule(db, current.orgId, id);
      const employee = await getEmployee(db, current, row.employee_id);
      own(current, employee);
      if (row.attendance_kind === 'OFF' || row.adjusted || (action === 'IN' && employee.employment_status !== 'ACTIVE')) fail(409, 'ATT_PUNCH_UNAVAILABLE');
      const clock = await now(db);
      if (action === 'IN') {
        if (row.checked_in_at) fail(409, 'ATT_DUPLICATE_PUNCH');
        if (clock.getTime() < row.starts_at.getTime() - row.early_check_in * 60000 || clock >= row.ends_at) fail(409, 'ATT_PUNCH_WINDOW');
        const open = await db.query(`SELECT 1 FROM attendance_punches p JOIN work_schedule s ON s.id=p.schedule_id
          WHERE s.organization_id=$1 AND s.employee_id=$2 AND p.checked_out_at IS NULL AND NOT EXISTS
            (SELECT 1 FROM attendance_adjustments a WHERE a.schedule_id=s.id AND a.status='APPROVED') LIMIT 1`, [current.orgId, employee.id]);
        if (open.rowCount) fail(409, 'ATT_OPEN_PUNCH');
        await assertNoLeave(db, current.orgId, employee.id, clock);
        await db.query('INSERT INTO attendance_punches(organization_id,schedule_id,checked_in_at) VALUES($1,$2,$3)', [current.orgId, id, clock]);
      } else {
        if (!row.checked_in_at || row.checked_out_at) return fail(409, 'ATT_DUPLICATE_PUNCH');
        await db.query('UPDATE attendance_punches SET checked_out_at=$3 WHERE organization_id=$1 AND schedule_id=$2 AND checked_out_at IS NULL',
          [current.orgId, id, clock]);
      }
      await audit(db, action === 'IN' ? 'ATT_CHECK_IN' : 'ATT_CHECK_OUT', current.userId, current.orgId, current.userId, { scheduleId: id });
      return clock;
  }
  app.post(prefix + '/punches/:id', async (req: Authed, res) => {
    const identity = actor(req), id = uuid.parse(req.params.id);
    const { action } = z.object({ action: z.enum(['IN','OUT']) }).strict().parse(req.body);
    const date = await mutate(identity, roles, (db, current) => punch(db, current, id, action));
    res.json({ at: date });
  });
  app.post(prefix + '/employees/:employeeId/office-punch', async (req: Authed, res) => {
    const identity = actor(req), employeeId = uuid.parse(req.params.employeeId);
    const input = z.object({ action: z.literal('IN'), workDate: day }).strict().parse(req.body);
    const date = await mutate(identity, roles, async (db, current) => {
      const employee = await getEmployee(db, current, employeeId);
      own(current, employee);
      const projected = (await db.query(officeDaysSql, [current.orgId, employee.id, input.workDate, input.workDate])).rows[0];
      if (!projected) fail(409, 'ATT_PUNCH_UNAVAILABLE');
      const today = (await db.query("SELECT (clock_timestamp() AT TIME ZONE $1)::date::text AS day", [projected.time_zone])).rows[0].day;
      if (today !== input.workDate) fail(409, 'ATT_PUNCH_WINDOW');
      await db.query(`INSERT INTO work_schedule
        (id,organization_id,employee_id,shift_id,label,work_date,time_zone,starts_at,ends_at,early_check_in,late_grace,early_grace,overtime_after,attendance_kind)
        VALUES($1,$2,$3,NULL,$4,$5,$6,$7,$8,$9,0,0,NULL,'OFFICE')`,
      [projected.id,current.orgId,employee.id,projected.label,input.workDate,projected.time_zone,projected.starts_at,projected.ends_at,projected.early_check_in]);
      return punch(db, current, projected.id, 'IN');
    });
    res.json({ at: date });
  });

  app.get(prefix + '/employees/:employeeId/ledger', async (req: Authed, res) => {
    const identity = actor(req), employee = await getEmployee(pool, identity, uuid.parse(req.params.employeeId));
    const range = z.object({ from: day, to: day, timeZone: z.string().trim().min(1).max(80).default('UTC') }).strict().parse(req.query);
    if (Date.parse(range.to) < Date.parse(range.from) || Date.parse(range.to) - Date.parse(range.from) > 92 * 86400000) {
      fail(400, 'ATT_INVALID_RANGE');
    }
    await assertZone(pool, range.timeZone);
    const params = [identity.orgId, employee.id, range.from, range.to];
    const [schedule, leave, balances, corrections] = await Promise.all([
      pool.query(`WITH all_schedule AS (SELECT * FROM work_schedule WHERE organization_id=$1 AND employee_id=$2
        UNION ALL ${officeDaysSql}), records AS (
        SELECT s.*,p.checked_in_at AS raw_in,p.checked_out_at AS raw_out,
          COALESCE(a.proposed_in,p.checked_in_at) AS effective_in,COALESCE(a.proposed_out,p.checked_out_at) AS effective_out,
          a.id IS NOT NULL AS adjusted,
          COALESCE((SELECT range_agg(tstzrange(l.starts_at,l.ends_at,'[)')) @> tstzrange(s.starts_at,s.ends_at,'[)')
            FROM leave_requests l WHERE l.organization_id=s.organization_id AND l.employee_id=s.employee_id
              AND l.status='APPROVED' AND l.starts_at<s.ends_at AND l.ends_at>s.starts_at),false) AS covered
        FROM all_schedule s LEFT JOIN attendance_punches p ON p.schedule_id=s.id
        LEFT JOIN LATERAL (SELECT id,proposed_in,proposed_out FROM attendance_adjustments a
          WHERE a.schedule_id=s.id AND a.status='APPROVED' ORDER BY reviewed_at DESC,id DESC LIMIT 1) a ON true
        WHERE s.organization_id=$1 AND s.employee_id=$2 AND s.work_date BETWEEN $3 AND $4
      )
      SELECT id,label,attendance_kind AS "attendanceKind",NOT EXISTS(SELECT 1 FROM work_schedule persisted WHERE persisted.id=records.id) AS virtual,work_date::text AS "workDate",time_zone AS "timeZone",shift_id AS "shiftId",starts_at AS "startsAt",ends_at AS "endsAt",
        raw_in AS "rawIn",raw_out AS "rawOut",effective_in AS "checkedInAt",effective_out AS "checkedOutAt",adjusted,
        CASE WHEN attendance_kind='OFF' THEN 'OFF' WHEN covered THEN 'LEAVE' WHEN effective_out IS NOT NULL THEN 'COMPLETE'
          WHEN now()>=ends_at THEN 'MISSING' WHEN effective_in IS NOT NULL THEN 'IN_PROGRESS' ELSE 'SCHEDULED' END AS status,
        CASE WHEN attendance_kind<>'OFF' AND NOT covered AND effective_in IS NOT NULL AND late_grace IS NOT NULL
          THEN effective_in>starts_at+late_grace*interval '1 minute' END AS late,
        CASE WHEN attendance_kind<>'OFF' AND NOT covered AND effective_out IS NOT NULL AND early_grace IS NOT NULL
          THEN effective_out<ends_at-early_grace*interval '1 minute' END AS "leftEarly",
        CASE WHEN effective_out IS NOT NULL AND overtime_after IS NOT NULL
          THEN greatest(0,trunc(extract(epoch FROM (effective_out-greatest(ends_at+overtime_after*interval '1 minute',effective_in)))/60))::int END AS "overtimeMinutes",
        CASE WHEN effective_out IS NOT NULL THEN trunc(extract(epoch FROM (effective_out-effective_in))/60)::int END AS "recordedMinutes",
        EXISTS(SELECT 1 FROM leave_requests l WHERE l.organization_id=records.organization_id AND l.employee_id=records.employee_id
          AND l.status='APPROVED' AND l.starts_at<COALESCE(effective_out,now()) AND l.ends_at>effective_in) AS "leaveConflict",
        (attendance_kind<>'OFF' AND NOT adjusted AND NOT covered AND effective_in IS NULL AND now()>=starts_at-early_check_in*interval '1 minute' AND now()<ends_at
          AND (attendance_kind<>'OFFICE' OR work_date=(now() AT TIME ZONE time_zone)::date)) AS "canCheckIn",
        (attendance_kind<>'OFF' AND NOT adjusted AND raw_in IS NOT NULL AND raw_out IS NULL) AS "canCheckOut"
      FROM records ORDER BY work_date,starts_at,id`, params),
      pool.query(`SELECT r.id,t.name,r.starts_at AS "startsAt",r.ends_at AS "endsAt",r.status,r.reason,
        r.charge_minutes AS "chargeMinutes",r.created_by AS "createdBy",r.created_at AS "createdAt",r.reviewed_at AS "reviewedAt",
        r.reviewed_by AS "reviewedBy",r.review_reason AS "reviewReason",r.cancelled_by AS "cancelledBy",r.cancel_reason AS "cancelReason",
        r.cancelled_at AS "cancelledAt",t.tracks_balance AS "tracksBalance"
        FROM leave_requests r JOIN leave_types t ON t.id=r.leave_type_id AND t.organization_id=r.organization_id
        WHERE r.organization_id=$1 AND r.employee_id=$2 AND r.starts_at<(($4::date+1)::timestamp AT TIME ZONE $5)
          AND r.ends_at>($3::date::timestamp AT TIME ZONE $5) ORDER BY r.starts_at DESC,r.id`, [...params, range.timeZone]),
      pool.query(`SELECT b.leave_type_id AS "leaveTypeId",t.name,b.allowance_minutes AS "allowanceMinutes",
        (b.allowance_minutes-` + usedBalance + `)::int AS "availableMinutes" FROM leave_balances b
        JOIN leave_types t ON t.id=b.leave_type_id AND t.organization_id=b.organization_id
        WHERE b.organization_id=$1 AND b.employee_id=$2 ORDER BY t.name,b.leave_type_id`, params.slice(0, 2)),
      pool.query(`SELECT a.id,a.schedule_id AS "scheduleId",s.work_date::text AS "workDate",a.status,a.reason,
        a.proposed_in AS "proposedIn",a.proposed_out AS "proposedOut",a.created_by AS "createdBy",a.created_at AS "createdAt",
        a.reviewed_by AS "reviewedBy",a.reviewed_at AS "reviewedAt",a.review_reason AS "reviewReason"
        FROM attendance_adjustments a JOIN work_schedule s ON s.id=a.schedule_id AND s.organization_id=a.organization_id
        WHERE s.organization_id=$1 AND s.employee_id=$2 AND s.work_date BETWEEN $3 AND $4 ORDER BY a.created_at DESC,a.id`, params),
    ]);
    res.json({ schedule: schedule.rows, leave: leave.rows, balances: balances.rows, corrections: corrections.rows });
  });

  app.post(prefix + '/corrections/:scheduleId', async (req: Authed, res) => {
    const identity = actor(req), scheduleId = uuid.parse(req.params.scheduleId), id = randomUUID();
    const input = z.object({ checkedInAt: instant, checkedOutAt: instant, reason, employeeId: uuid.optional(), workDate: day.optional() }).strict().parse(req.body);
    validateRange(input.checkedInAt, input.checkedOutAt);
    await mutate(identity, roles, async (db, current) => {
      if (input.employeeId || input.workDate) {
        if (!input.employeeId || !input.workDate) fail(400, 'ATT_INVALID_RANGE');
        const employee = await getEmployee(db, current, uuid.parse(input.employeeId));
        if (employee.user_id !== current.userId) await authorizeMutation(db, current, [current.userId], admins);
        const projected = (await db.query(officeDaysSql, [current.orgId, employee.id, input.workDate, input.workDate])).rows[0];
        if (!projected || projected.id !== scheduleId) fail(404, 'ATT_SCHEDULE_NOT_FOUND');
        await db.query(`INSERT INTO work_schedule
          (id,organization_id,employee_id,shift_id,label,work_date,time_zone,starts_at,ends_at,early_check_in,late_grace,early_grace,overtime_after,attendance_kind)
          VALUES($1,$2,$3,NULL,$4,$5,$6,$7,$8,$9,0,0,NULL,'OFFICE')`,
        [projected.id,current.orgId,employee.id,projected.label,input.workDate,projected.time_zone,projected.starts_at,projected.ends_at,projected.early_check_in]);
      }
      const row = await getSchedule(db, current.orgId, scheduleId);
      const employee = await getEmployee(db, current, row.employee_id);
      if (employee.user_id !== current.userId) await authorizeMutation(db, current, [current.userId], admins);
      const clock = await now(db);
      if (row.attendance_kind === 'OFF' || row.ends_at > clock || Date.parse(input.checkedOutAt) > clock.getTime() ||
          Date.parse(input.checkedOutAt) <= row.starts_at.getTime() || Date.parse(input.checkedInAt) >= row.ends_at.getTime()) {
        fail(400, 'ATT_INVALID_RANGE');
      }
      const result = await db.query(`INSERT INTO attendance_adjustments
        (id,organization_id,schedule_id,created_by,proposed_in,proposed_out,reason,observed_in,observed_out)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
      [id, current.orgId, scheduleId, current.userId, input.checkedInAt, input.checkedOutAt, input.reason, row.checked_in_at, row.checked_out_at]);
      if (!result.rowCount) fail(409, 'ATT_PENDING_CORRECTION');
      await audit(db, 'ATT_CORRECTION_SUBMITTED', current.userId, current.orgId, employee.user_id ?? undefined, { correctionId: id, scheduleId });
    });
    res.status(201).json({ id });
  });

  app.post(prefix + '/corrections/:id/review', async (req: Authed, res) => {
    const identity = actor(req), id = uuid.parse(req.params.id), input = reviewInput.parse(req.body);
    await mutate(identity, reviewers, async (db, current) => {
      const item = (await db.query('SELECT * FROM attendance_adjustments WHERE organization_id=$1 AND id=$2', [current.orgId, id])).rows[0];
      if (!item) fail(404, 'ATT_REQUEST_NOT_FOUND');
      const row = await getSchedule(db, current.orgId, item.schedule_id);
      const employee = await getEmployee(db, current, row.employee_id);
      reviewable(current, employee, item.created_by);
      if (item.status !== 'PENDING') fail(409, 'ATT_ALREADY_REVIEWED');
      if (input.action === 'APPROVE') {
        if (item.observed_in?.getTime() !== row.checked_in_at?.getTime() || item.observed_out?.getTime() !== row.checked_out_at?.getTime()) {
          fail(409, 'ATT_STALE_CORRECTION');
        }
        await assertNoLeave(db, current.orgId, employee.id, item.proposed_in, item.proposed_out);
        await assertNoWork(db, current.orgId, employee.id, item.proposed_in, item.proposed_out, row.id);
      }
      await db.query(`UPDATE attendance_adjustments SET status=$3,reviewed_by=$4,review_reason=$5,reviewed_at=clock_timestamp()
        WHERE organization_id=$1 AND id=$2`, [current.orgId, id, input.action === 'APPROVE' ? 'APPROVED' : 'REJECTED', current.userId, input.reason]);
      await audit(db, 'ATT_CORRECTION_REVIEWED', current.userId, current.orgId, employee.user_id ?? undefined, { correctionId: id, action: input.action });
    });
    res.status(204).end();
  });

  app.put(prefix + '/employees/:employeeId/balances/:leaveTypeId', async (req: Authed, res) => {
    const identity = actor(req), employeeId = uuid.parse(req.params.employeeId), typeId = uuid.parse(req.params.leaveTypeId);
    const input = z.object({ allowanceMinutes: balanceMinutes, reason }).strict().parse(req.body);
    await mutate(identity, admins, async (db, current) => {
      const employee = await getEmployee(db, current, employeeId);
      if (employee.user_id === current.userId) fail(403, 'ATT_SELF_REVIEW');
      if (!(await db.query('SELECT 1 FROM leave_types WHERE organization_id=$1 AND id=$2 AND tracks_balance', [current.orgId, typeId])).rowCount) {
        fail(404, 'ATT_LEAVE_TYPE_UNAVAILABLE');
      }
      const previous = (await db.query('SELECT allowance_minutes FROM leave_balances WHERE organization_id=$1 AND employee_id=$2 AND leave_type_id=$3',
        [current.orgId, employee.id, typeId])).rows[0]?.allowance_minutes ?? null;
      const used = (await db.query(`SELECT COALESCE(sum(charge_minutes),0) AS minutes FROM leave_requests
        WHERE organization_id=$1 AND employee_id=$2 AND leave_type_id=$3 AND status='APPROVED'`, [current.orgId, employee.id, typeId])).rows[0].minutes;
      if (Number(used) > input.allowanceMinutes) fail(409, 'ATT_INSUFFICIENT_BALANCE');
      await db.query(`INSERT INTO leave_balances(organization_id,employee_id,leave_type_id,allowance_minutes)
        VALUES($1,$2,$3,$4) ON CONFLICT(employee_id,leave_type_id) DO UPDATE SET allowance_minutes=EXCLUDED.allowance_minutes`,
      [current.orgId, employee.id, typeId, input.allowanceMinutes]);
      await audit(db, 'ATT_BALANCE_SAVED', current.userId, current.orgId, employee.user_id ?? undefined,
        { employeeId, leaveTypeId: typeId, previous, allowanceMinutes: input.allowanceMinutes, reason: input.reason });
    });
    res.status(204).end();
  });

  app.post(prefix + '/employees/:employeeId/leave', async (req: Authed, res) => {
    const identity = actor(req), employeeId = uuid.parse(req.params.employeeId), id = randomUUID();
    const input = z.object({ leaveTypeId: uuid, startsAt: instant, endsAt: instant, reason }).strict().parse(req.body);
    validateRange(input.startsAt, input.endsAt);
    await mutate(identity, roles, async (db, current) => {
      const employee = await getEmployee(db, current, employeeId);
      if (employee.user_id !== current.userId) await authorizeMutation(db, current, [current.userId], admins);
      if (employee.employment_status === 'TERMINATED') fail(409, 'ATT_EMPLOYEE_INACTIVE');
      if (!(await db.query('SELECT 1 FROM leave_types WHERE organization_id=$1 AND id=$2 AND active', [current.orgId, input.leaveTypeId])).rowCount) {
        fail(404, 'ATT_LEAVE_TYPE_UNAVAILABLE');
      }
      if ((await db.query(`SELECT 1 FROM leave_requests WHERE organization_id=$1 AND employee_id=$2 AND status IN ('PENDING','APPROVED')
        AND starts_at<$4 AND ends_at>$3 LIMIT 1`, [current.orgId, employee.id, input.startsAt, input.endsAt])).rowCount) {
        fail(409, 'ATT_LEAVE_CONFLICT');
      }
      await assertNoWork(db, current.orgId, employee.id, input.startsAt, input.endsAt);
      await db.query(`INSERT INTO leave_requests(id,organization_id,employee_id,leave_type_id,created_by,starts_at,ends_at,reason)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [id, current.orgId, employee.id, input.leaveTypeId, current.userId, input.startsAt, input.endsAt, input.reason]);
      await audit(db, 'ATT_LEAVE_SUBMITTED', current.userId, current.orgId, employee.user_id ?? undefined, { leaveId: id, employeeId });
    });
    res.status(201).json({ id });
  });

  app.post(prefix + '/leave/:id/review', async (req: Authed, res) => {
    const identity = actor(req), id = uuid.parse(req.params.id);
    const input = reviewInput.extend({ chargeMinutes: balanceMinutes.optional() }).parse(req.body);
    await mutate(identity, reviewers, async (db, current) => {
      const item = (await db.query(`SELECT r.*,t.tracks_balance FROM leave_requests r JOIN leave_types t
        ON t.id=r.leave_type_id AND t.organization_id=r.organization_id WHERE r.organization_id=$1 AND r.id=$2`, [current.orgId, id])).rows[0];
      if (!item) fail(404, 'ATT_REQUEST_NOT_FOUND');
      const employee = await getEmployee(db, current, item.employee_id);
      reviewable(current, employee, item.created_by);
      if (item.status !== 'PENDING') fail(409, 'ATT_ALREADY_REVIEWED');
      let charge: number | null = null;
      if (input.action === 'APPROVE') {
        await assertNoWork(db, current.orgId, employee.id, item.starts_at, item.ends_at);
        charge = item.tracks_balance ? input.chargeMinutes ?? fail(400, 'ATT_CHARGE_REQUIRED') : 0;
        if ((!item.tracks_balance && input.chargeMinutes) || charge > (item.ends_at.getTime() - item.starts_at.getTime()) / 60000) {
          fail(400, 'ATT_INVALID_CHARGE');
        }
        if (item.tracks_balance) {
          const balance = (await db.query(`SELECT (allowance_minutes-` + usedBalance + `) AS available FROM leave_balances b
            WHERE organization_id=$1 AND employee_id=$2 AND leave_type_id=$3`, [current.orgId, employee.id, item.leave_type_id])).rows[0];
          if (!balance || Number(balance.available) < charge) fail(409, 'ATT_INSUFFICIENT_BALANCE');
        }
      }
      await db.query(`UPDATE leave_requests SET status=$3,charge_minutes=$4,reviewed_by=$5,review_reason=$6,reviewed_at=clock_timestamp()
        WHERE organization_id=$1 AND id=$2`,
      [current.orgId, id, input.action === 'APPROVE' ? 'APPROVED' : 'REJECTED', charge, current.userId, input.reason]);
      await audit(db, 'ATT_LEAVE_REVIEWED', current.userId, current.orgId, employee.user_id ?? undefined, { leaveId: id, action: input.action, chargeMinutes: charge });
    });
    res.status(204).end();
  });

  app.post(prefix + '/leave/:id/cancel', async (req: Authed, res) => {
    const identity = actor(req), id = uuid.parse(req.params.id);
    const input = z.object({ reason }).strict().parse(req.body);
    await mutate(identity, roles, async (db, current) => {
      const item = (await db.query('SELECT * FROM leave_requests WHERE organization_id=$1 AND id=$2', [current.orgId, id])).rows[0];
      if (!item) fail(404, 'ATT_REQUEST_NOT_FOUND');
      const employee = await getEmployee(db, current, item.employee_id);
      if (item.status !== 'PENDING' && item.status !== 'APPROVED') fail(409, 'ATT_ALREADY_REVIEWED');
      if (item.status === 'APPROVED') {
        // The approved cancellation releases an allocated balance and requires the same fresh proof as approval.
        await authorizeMutation(db, current, [current.userId], reviewers);
        reviewable(current, employee, item.created_by);
      } else if (employee.user_id !== current.userId && item.created_by !== current.userId) {
        await authorizeMutation(db, current, [current.userId], reviewers);
      }
      await db.query(`UPDATE leave_requests SET status='CANCELLED',cancelled_by=$3,cancelled_at=clock_timestamp(),cancel_reason=$4
        WHERE organization_id=$1 AND id=$2`, [current.orgId, id, current.userId, input.reason]);
      await audit(db, 'ATT_LEAVE_CANCELLED', current.userId, current.orgId, employee.user_id ?? undefined, { leaveId: id });
    });
    res.status(204).end();
  });
}
