BEGIN;
INSERT INTO organizations(id,name) VALUES ('00000000-0000-0000-0000-000000000001','Migration test');
INSERT INTO users(id,email,full_name,password_hash,email_verified_at)
VALUES ('00000000-0000-0000-0000-000000000002','test@example.test','Test','hash',now());
INSERT INTO memberships(id,user_id,organization_id,role)
VALUES ('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','ADMIN');
INSERT INTO organizations(id,name) VALUES ('00000000-0000-0000-0000-000000000010','Second org');
INSERT INTO users(id,email,full_name,password_hash,email_verified_at)
VALUES
  ('00000000-0000-0000-0000-000000000011','manager@example.test','Manager','hash',now()),
  ('00000000-0000-0000-0000-000000000012','otherorg@example.test','Other Org','hash',now()),
  ('00000000-0000-0000-0000-000000000013','employee@example.test','Employee','hash',now());
INSERT INTO memberships(id,user_id,organization_id,role)
VALUES
  ('00000000-0000-0000-0000-000000000014','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000001','MANAGER'),
  ('00000000-0000-0000-0000-000000000015','00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000010','MANAGER');
DO $$
BEGIN
  BEGIN
    INSERT INTO users(id,email,full_name,password_hash) VALUES ('00000000-0000-0000-0000-000000000004','UPPER@example.test','Test','hash');
    RAISE EXCEPTION 'email normalization constraint absent';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO memberships(id,user_id,organization_id,role)
    VALUES ('00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','EMPLOYEE');
    RAISE EXCEPTION 'membership uniqueness absent';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  BEGIN
    INSERT INTO invitations(id,organization_id,email,role,token_hash,created_by_user_id,expires_at)
    VALUES ('00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000001','test@example.test','ADMIN',repeat('a',64),'00000000-0000-0000-0000-000000000002',now()+interval '48 hours');
    RAISE EXCEPTION 'invitation ADMIN assignment constraint absent';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO auth_rate_limits(key_hash,window_start,attempts) VALUES(repeat('b',64),now(),0);
    RAISE EXCEPTION 'rate limit positive constraint absent';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO user_sessions(id,user_id,organization_id,session_hash,expires_at)
    VALUES ('00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000099',repeat('c',64),now()+interval '1 hour');
    RAISE EXCEPTION 'session organization foreign key absent';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  BEGIN
    INSERT INTO memberships(id,user_id,organization_id,role)
    VALUES ('00000000-0000-0000-0000-000000000016','00000000-0000-0000-0000-000000000013','00000000-0000-0000-0000-000000000001','SUPERADMIN');
    RAISE EXCEPTION 'membership invalid role constraint absent';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO memberships(id,user_id,organization_id,role,manager_user_id)
    VALUES ('00000000-0000-0000-0000-000000000017','00000000-0000-0000-0000-000000000013','00000000-0000-0000-0000-000000000001','EMPLOYEE','00000000-0000-0000-0000-000000000013');
    RAISE EXCEPTION 'self-manager constraint absent';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO memberships(id,user_id,organization_id,role,manager_user_id)
    VALUES ('00000000-0000-0000-0000-000000000018','00000000-0000-0000-0000-000000000013','00000000-0000-0000-0000-000000000001','EMPLOYEE','00000000-0000-0000-0000-000000000012');
    RAISE EXCEPTION 'cross-organization manager foreign key absent';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  INSERT INTO memberships(id,user_id,organization_id,role,manager_user_id)
  VALUES ('00000000-0000-0000-0000-000000000019','00000000-0000-0000-0000-000000000013','00000000-0000-0000-0000-000000000001','EMPLOYEE','00000000-0000-0000-0000-000000000011');
  -- ORG-001 verification
  INSERT INTO departments(id,organization_id,code,name)
  VALUES ('00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000001','ENG','Engineering');
  -- Duplicate department code in same org must fail
  BEGIN
    INSERT INTO departments(id,organization_id,code,name)
    VALUES ('00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000001','ENG','Engineering Duplicate');
    RAISE EXCEPTION 'department duplicate code check absent';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  -- Same department code in another org must succeed
  INSERT INTO departments(id,organization_id,code,name)
  VALUES ('00000000-0000-0000-0000-000000000022','00000000-0000-0000-0000-000000000010','ENG','Engineering Other Org');
  -- Department self-parent must fail
  BEGIN
    INSERT INTO departments(id,organization_id,parent_id,code,name)
    VALUES ('00000000-0000-0000-0000-000000000023','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000023','SELF','Self Parent');
    RAISE EXCEPTION 'department self-parent check absent';
  EXCEPTION WHEN check_violation THEN NULL; END;
  -- Department cross-organization manager must fail
  BEGIN
    INSERT INTO departments(id,organization_id,code,name,manager_user_id)
    VALUES ('00000000-0000-0000-0000-000000000024','00000000-0000-0000-0000-000000000001','FAIL_MGR','Fail Mgr','00000000-0000-0000-0000-000000000012');
    RAISE EXCEPTION 'cross-organization department manager foreign key absent';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  -- Position duplicate code in same org must fail
  INSERT INTO positions(id,organization_id,code,title)
  VALUES ('00000000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000000001','DEV','Developer');
  BEGIN
    INSERT INTO positions(id,organization_id,code,title)
    VALUES ('00000000-0000-0000-0000-000000000031','00000000-0000-0000-0000-000000000001','DEV','Developer Duplicate');
    RAISE EXCEPTION 'position duplicate code check absent';
  EXCEPTION WHEN unique_violation THEN NULL; END;
END $$;
ROLLBACK;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM organizations) THEN RAISE EXCEPTION 'test fixture rollback failed'; END IF;
END $$;
