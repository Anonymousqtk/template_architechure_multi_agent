export const officeDaysSql = `SELECT overlay(overlay(md5(e.id::text||':'||to_char(d.work_date,'YYYY-MM-DD')||':office') placing '3' from 13 for 1) placing '8' from 17 for 1)::uuid AS id,
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

export const attendanceLedgerSql = `WITH all_schedule AS (SELECT * FROM work_schedule WHERE organization_id=$1 AND employee_id=$2
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
      FROM records ORDER BY work_date,starts_at,id`;
