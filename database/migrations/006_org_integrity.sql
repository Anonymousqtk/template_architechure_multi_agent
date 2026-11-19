-- ORG-002. Forward-only. Invalid existing data fails validation without deletion.
-- Restore an approved backup or ship a reviewed forward repair for rollback.
BEGIN;
SET LOCAL lock_timeout = '5s';

-- organizations are separate tenants; internal units use departments.parent_id.
ALTER TABLE organizations ADD CONSTRAINT organizations_no_tenant_parent CHECK (parent_organization_id IS NULL);
ALTER TABLE departments ADD CONSTRAINT departments_id_org_unique UNIQUE(id, organization_id);
ALTER TABLE positions ADD CONSTRAINT positions_id_org_unique UNIQUE(id, organization_id);
ALTER TABLE departments ADD CONSTRAINT departments_parent_tenant_fk
  FOREIGN KEY(parent_id, organization_id) REFERENCES departments(id, organization_id) ON DELETE RESTRICT;
ALTER TABLE positions ADD CONSTRAINT positions_department_tenant_fk
  FOREIGN KEY(department_id, organization_id) REFERENCES departments(id, organization_id) ON DELETE RESTRICT;
ALTER TABLE memberships ADD CONSTRAINT memberships_department_tenant_fk
  FOREIGN KEY(department_id, organization_id) REFERENCES departments(id, organization_id) ON DELETE RESTRICT;
ALTER TABLE memberships ADD CONSTRAINT memberships_position_tenant_fk
  FOREIGN KEY(position_id, organization_id) REFERENCES positions(id, organization_id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX departments_normalized_code ON departments(organization_id,upper(btrim(code)));
CREATE UNIQUE INDEX positions_normalized_code ON positions(organization_id,upper(btrim(code)));

-- Check legacy cycles before enabling triggers. UNION terminates on corrupt cycles.
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM memberships m JOIN positions p ON p.id=m.position_id AND p.organization_id=m.organization_id
   WHERE p.department_id IS NOT NULL AND m.department_id IS DISTINCT FROM p.department_id) THEN
   RAISE EXCEPTION 'ORG-002 requires position assignment repair before migration';
 END IF;
 IF EXISTS(WITH RECURSIVE paths(start,id,parent,org) AS (
   SELECT id,id,parent_id,organization_id FROM departments
   UNION SELECT p.start,d.id,d.parent_id,p.org FROM paths p JOIN departments d ON d.id=p.parent AND d.organization_id=p.org
 ) SELECT 1 FROM paths WHERE parent=start) THEN
   RAISE EXCEPTION 'ORG-002 requires department cycle repair before migration';
 END IF;
 IF EXISTS(WITH RECURSIVE paths(start,id,parent,org) AS (
   SELECT user_id,user_id,manager_user_id,organization_id FROM memberships
   UNION SELECT p.start,m.user_id,m.manager_user_id,p.org FROM paths p JOIN memberships m ON m.user_id=p.parent AND m.organization_id=p.org
 ) SELECT 1 FROM paths WHERE parent=start) THEN
   RAISE EXCEPTION 'ORG-002 requires reporting cycle repair before migration';
 END IF;
END $$;

CREATE FUNCTION org_guard_cycles() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cycle_found boolean;
BEGIN
 -- Serialize topology changes per tenant, matching authorizeMutation's lock.
 PERFORM id FROM organizations WHERE id=NEW.organization_id FOR UPDATE;
 IF TG_TABLE_NAME='departments' THEN
   WITH RECURSIVE ancestors(id,parent) AS (
     SELECT id,parent_id FROM departments WHERE id=NEW.parent_id AND organization_id=NEW.organization_id
     UNION SELECT d.id,d.parent_id FROM departments d JOIN ancestors a ON d.id=a.parent WHERE d.organization_id=NEW.organization_id
   ) SELECT EXISTS(SELECT 1 FROM ancestors WHERE id=NEW.id) INTO cycle_found;
 ELSE
   WITH RECURSIVE ancestors(id,parent) AS (
     SELECT user_id,manager_user_id FROM memberships WHERE user_id=NEW.manager_user_id AND organization_id=NEW.organization_id
     UNION SELECT m.user_id,m.manager_user_id FROM memberships m JOIN ancestors a ON m.user_id=a.parent WHERE m.organization_id=NEW.organization_id
   ) SELECT EXISTS(SELECT 1 FROM ancestors WHERE id=NEW.user_id) INTO cycle_found;
 END IF;
 IF cycle_found THEN RAISE EXCEPTION 'Circular hierarchy rejected' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER departments_cycle_guard BEFORE INSERT OR UPDATE OF parent_id,organization_id ON departments
 FOR EACH ROW EXECUTE FUNCTION org_guard_cycles();
CREATE TRIGGER memberships_cycle_guard BEFORE INSERT OR UPDATE OF manager_user_id,organization_id ON memberships
 FOR EACH ROW EXECUTE FUNCTION org_guard_cycles();

CREATE FUNCTION org_guard_position_assignment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM id FROM organizations WHERE id=NEW.organization_id FOR UPDATE;
 IF TG_TABLE_NAME='memberships' THEN
   IF EXISTS(SELECT 1 FROM positions p WHERE p.id=NEW.position_id AND p.organization_id=NEW.organization_id
     AND p.department_id IS NOT NULL AND p.department_id IS DISTINCT FROM NEW.department_id) THEN
     RAISE EXCEPTION 'Position department mismatch' USING ERRCODE='23514';
   END IF;
 ELSE
   IF NEW.department_id IS NOT NULL AND EXISTS(SELECT 1 FROM memberships m WHERE m.position_id=NEW.id
     AND m.organization_id=NEW.organization_id AND m.department_id IS DISTINCT FROM NEW.department_id) THEN
     RAISE EXCEPTION 'Position move invalidates assignments' USING ERRCODE='23514';
   END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER memberships_position_guard BEFORE INSERT OR UPDATE OF department_id,position_id,organization_id ON memberships
 FOR EACH ROW EXECUTE FUNCTION org_guard_position_assignment();
CREATE TRIGGER positions_department_guard BEFORE UPDATE OF department_id,organization_id ON positions
 FOR EACH ROW EXECUTE FUNCTION org_guard_position_assignment();
COMMIT;
