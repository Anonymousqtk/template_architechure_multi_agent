-- EMP-001 / EMP-002: additive, transactional. No account creation or RBAC changes.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE TABLE employees (
 id uuid PRIMARY KEY,
 organization_id uuid NOT NULL REFERENCES organizations(id),
 user_id uuid,
 employee_code text NOT NULL,
 full_name text NOT NULL,
 hire_date date NOT NULL,
 employment_status text NOT NULL DEFAULT 'ACTIVE' CHECK(employment_status IN ('ACTIVE','ON_LEAVE','TERMINATED')),
 birth_date date CHECK(birth_date IS NULL OR birth_date<=hire_date),
 phone text, personal_email text, address text,
 department_id uuid, position_id uuid, manager_user_id uuid,
 version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,organization_id), UNIQUE(user_id,organization_id),
 FOREIGN KEY(user_id,organization_id) REFERENCES memberships(user_id,organization_id),
 FOREIGN KEY(department_id,organization_id) REFERENCES departments(id,organization_id),
 FOREIGN KEY(position_id,organization_id) REFERENCES positions(id,organization_id),
 FOREIGN KEY(manager_user_id,organization_id) REFERENCES memberships(user_id,organization_id)
);
CREATE UNIQUE INDEX employees_org_code ON employees(organization_id,upper(btrim(employee_code)));
CREATE INDEX employees_org_department ON employees(organization_id,department_id);
CREATE INDEX employees_org_manager ON employees(organization_id,manager_user_id);

CREATE TABLE employee_contracts (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, employee_id uuid NOT NULL,
 contract_number text NOT NULL,
 contract_type text NOT NULL CHECK(contract_type IN ('PROBATION','FIXED_TERM','INDEFINITE')),
 start_date date NOT NULL, end_date date,
 signed_on date, termination_date date,
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','ACTIVE','TERMINATED','EXPIRED','CANCELLED')),
 notes text, version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(employee_id,organization_id) REFERENCES employees(id,organization_id),
 CHECK(end_date IS NULL OR end_date>=start_date),
 CHECK((contract_type='INDEFINITE' AND end_date IS NULL) OR (contract_type<>'INDEFINITE' AND end_date IS NOT NULL)),
 CHECK((status='TERMINATED' AND termination_date IS NOT NULL AND termination_date>=start_date AND (end_date IS NULL OR termination_date<=end_date)) OR (status<>'TERMINATED' AND termination_date IS NULL))
);
CREATE UNIQUE INDEX employee_contract_numbers ON employee_contracts(organization_id,upper(btrim(contract_number)));
CREATE UNIQUE INDEX employee_one_active_contract ON employee_contracts(organization_id,employee_id) WHERE status='ACTIVE';
CREATE INDEX employee_contract_timeline ON employee_contracts(organization_id,employee_id,start_date DESC,id);

CREATE TABLE employee_work_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, employee_id uuid NOT NULL,
 effective_on date NOT NULL, reason text NOT NULL,
 department_id uuid, position_id uuid, manager_user_id uuid,
 department_name text, position_title text, manager_name text,
 actor_user_id uuid, recorded_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(employee_id,organization_id) REFERENCES employees(id,organization_id),
 FOREIGN KEY(department_id,organization_id) REFERENCES departments(id,organization_id),
 FOREIGN KEY(position_id,organization_id) REFERENCES positions(id,organization_id),
 FOREIGN KEY(manager_user_id,organization_id) REFERENCES memberships(user_id,organization_id),
 FOREIGN KEY(actor_user_id,organization_id) REFERENCES memberships(user_id,organization_id)
);
CREATE INDEX employee_history_timeline ON employee_work_history(organization_id,employee_id,effective_on DESC,recorded_at DESC,id);

CREATE FUNCTION guard_employee_assignment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM id FROM organizations WHERE id=NEW.organization_id FOR UPDATE;
 IF NEW.user_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM memberships m WHERE m.organization_id=NEW.organization_id AND m.user_id=NEW.user_id
   AND ROW(m.department_id,m.position_id,m.manager_user_id) IS NOT DISTINCT FROM ROW(NEW.department_id,NEW.position_id,NEW.manager_user_id)) THEN
   RAISE EXCEPTION 'Linked employee must match membership assignment' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT 1 FROM positions p WHERE p.id=NEW.position_id AND p.organization_id=NEW.organization_id AND p.department_id IS NOT NULL AND p.department_id IS DISTINCT FROM NEW.department_id) THEN
   RAISE EXCEPTION 'Position department mismatch' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER employee_assignment_guard BEFORE INSERT OR UPDATE ON employees FOR EACH ROW EXECUTE FUNCTION guard_employee_assignment();

CREATE FUNCTION employee_assignment_history() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE effective date;
BEGIN
 IF TG_OP='UPDATE' AND ROW(OLD.department_id,OLD.position_id,OLD.manager_user_id) IS NOT DISTINCT FROM ROW(NEW.department_id,NEW.position_id,NEW.manager_user_id) THEN RETURN NEW; END IF;
 effective:=COALESCE(NULLIF(current_setting('app.employee_effective_on',true), '')::date,CASE WHEN TG_OP='INSERT' THEN NEW.hire_date ELSE CURRENT_DATE END);
 IF effective<NEW.hire_date OR EXISTS(SELECT 1 FROM employee_work_history WHERE employee_id=NEW.id AND organization_id=NEW.organization_id AND effective_on>effective) THEN
   RAISE EXCEPTION 'History must be chronological' USING ERRCODE='23514';
 END IF;
 INSERT INTO employee_work_history(organization_id,employee_id,effective_on,reason,department_id,position_id,manager_user_id,department_name,position_title,manager_name,actor_user_id)
 VALUES(NEW.organization_id,NEW.id,effective,COALESCE(NULLIF(current_setting('app.employee_reason',true),''),CASE WHEN TG_OP='INSERT' THEN 'PROFILE_CREATED' ELSE 'ASSIGNMENT_CHANGED' END),NEW.department_id,NEW.position_id,NEW.manager_user_id,
   (SELECT name FROM departments WHERE id=NEW.department_id AND organization_id=NEW.organization_id),
   (SELECT title FROM positions WHERE id=NEW.position_id AND organization_id=NEW.organization_id),
   (SELECT full_name FROM users WHERE id=NEW.manager_user_id),NULLIF(current_setting('app.employee_actor',true),'')::uuid);
 RETURN NEW;
END $$;
CREATE TRIGGER employee_history_record AFTER INSERT OR UPDATE OF department_id,position_id,manager_user_id ON employees FOR EACH ROW EXECUTE FUNCTION employee_assignment_history();

-- Existing account-assignment endpoints also maintain employee records/history.
CREATE FUNCTION sync_employee_membership() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE employees SET department_id=NEW.department_id,position_id=NEW.position_id,manager_user_id=NEW.manager_user_id,version=version+1,updated_at=now()
 WHERE organization_id=NEW.organization_id AND user_id=NEW.user_id
   AND ROW(department_id,position_id,manager_user_id) IS DISTINCT FROM ROW(NEW.department_id,NEW.position_id,NEW.manager_user_id);
 RETURN NEW;
END $$;
CREATE TRIGGER membership_employee_sync AFTER UPDATE OF department_id,position_id,manager_user_id ON memberships FOR EACH ROW EXECUTE FUNCTION sync_employee_membership();

CREATE FUNCTION clear_employee_manager() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.role<>'MANAGER' OR NOT NEW.is_active THEN
   UPDATE employees SET manager_user_id=NULL,version=version+1,updated_at=now() WHERE organization_id=NEW.organization_id AND manager_user_id=NEW.user_id AND user_id IS NULL;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER employee_manager_revoke AFTER UPDATE OF role,is_active ON memberships FOR EACH ROW EXECUTE FUNCTION clear_employee_manager();
CREATE FUNCTION guard_employee_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Work history is append-only' USING ERRCODE='23514'; END $$;
CREATE TRIGGER employee_history_immutable BEFORE UPDATE OR DELETE ON employee_work_history FOR EACH ROW EXECUTE FUNCTION guard_employee_history_mutation();

CREATE FUNCTION guard_employee_contract() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM id FROM organizations WHERE id=NEW.organization_id FOR UPDATE;
 IF TG_OP='INSERT' AND NEW.status<>'DRAFT' THEN RAISE EXCEPTION 'New contracts must be drafts' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
   IF NEW.employee_id<>OLD.employee_id OR NEW.organization_id<>OLD.organization_id THEN RAISE EXCEPTION 'Contract ownership is immutable' USING ERRCODE='23514'; END IF;
   IF OLD.status<>'DRAFT' AND ROW(NEW.contract_number,NEW.contract_type,NEW.start_date,NEW.end_date,NEW.signed_on,NEW.notes) IS DISTINCT FROM ROW(OLD.contract_number,OLD.contract_type,OLD.start_date,OLD.end_date,OLD.signed_on,OLD.notes) THEN
     RAISE EXCEPTION 'Signed contract details are immutable' USING ERRCODE='23514';
   END IF;
   IF NOT ((OLD.status='DRAFT' AND NEW.status IN ('DRAFT','ACTIVE','CANCELLED','TERMINATED','EXPIRED')) OR (OLD.status='ACTIVE' AND NEW.status IN ('TERMINATED','EXPIRED'))) THEN
     RAISE EXCEPTION 'Invalid contract transition' USING ERRCODE='23514';
   END IF;
 END IF;
 IF NEW.status IN ('ACTIVE','TERMINATED','EXPIRED') AND (NEW.signed_on IS NULL OR NEW.signed_on>CURRENT_DATE) THEN RAISE EXCEPTION 'Valid signature date required' USING ERRCODE='23514'; END IF;
 IF NEW.status='ACTIVE' AND (NEW.start_date>CURRENT_DATE OR (NEW.end_date IS NOT NULL AND NEW.end_date<CURRENT_DATE)) THEN RAISE EXCEPTION 'Contract is outside its validity dates' USING ERRCODE='23514'; END IF;
 IF NEW.status='EXPIRED' AND (NEW.end_date IS NULL OR NEW.end_date>=CURRENT_DATE) THEN RAISE EXCEPTION 'Contract has not expired' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER employee_contract_guard BEFORE INSERT OR UPDATE ON employee_contracts FOR EACH ROW EXECUTE FUNCTION guard_employee_contract();
COMMIT;
