BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE departments
  ADD COLUMN attendance_mode text NOT NULL DEFAULT 'SHIFT' CHECK (attendance_mode IN ('SHIFT','OFFICE')),
  ADD COLUMN office_time_zone text NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  ADD COLUMN office_start time NOT NULL DEFAULT '08:00',
  ADD COLUMN office_end time NOT NULL DEFAULT '17:00',
  ADD COLUMN office_days integer[] NOT NULL DEFAULT ARRAY[1,2,3,4,5],
  ADD COLUMN office_since date NOT NULL DEFAULT CURRENT_DATE,
  ADD CONSTRAINT department_office_hours CHECK (office_end > office_start),
  ADD CONSTRAINT department_office_days CHECK (cardinality(office_days) BETWEEN 1 AND 7 AND office_days <@ ARRAY[0,1,2,3,4,5,6] AND array_position(office_days,NULL) IS NULL);
ALTER TABLE work_schedule ADD COLUMN attendance_kind text NOT NULL DEFAULT 'SHIFT'
  CHECK (attendance_kind IN ('SHIFT','OFFICE','OFF'));
UPDATE work_schedule SET attendance_kind='OFF' WHERE shift_id IS NULL;
ALTER TABLE work_schedule ADD CONSTRAINT work_schedule_kind
  CHECK ((attendance_kind='SHIFT') = (shift_id IS NOT NULL));
CREATE UNIQUE INDEX work_schedule_office_day ON work_schedule(organization_id,employee_id,work_date) WHERE attendance_kind='OFFICE';
COMMIT;
