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

  -- EMP-001 & EMP-002 verification
  INSERT INTO employees(id,organization_id,employee_code,full_name,hire_date,department_id,position_id,manager_user_id)
  VALUES ('00000000-0000-0000-0000-000000000040','00000000-0000-0000-0000-000000000001','EMP-001','Employee One',CURRENT_DATE,'00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000000011');
  -- Duplicate employee code in same org must fail
  BEGIN
    INSERT INTO employees(id,organization_id,employee_code,full_name,hire_date)
    VALUES ('00000000-0000-0000-0000-000000000041','00000000-0000-0000-0000-000000000001','EMP-001','Employee Dup',CURRENT_DATE);
    RAISE EXCEPTION 'employee duplicate code check absent';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  -- Same employee code in another org must succeed
  INSERT INTO employees(id,organization_id,employee_code,full_name,hire_date)
  VALUES ('00000000-0000-0000-0000-000000000042','00000000-0000-0000-0000-000000000010','EMP-001','Employee Other Org',CURRENT_DATE);
  -- Birth date after hire date must fail
  BEGIN
    INSERT INTO employees(id,organization_id,employee_code,full_name,hire_date,birth_date)
    VALUES ('00000000-0000-0000-0000-000000000043','00000000-0000-0000-0000-000000000001','EMP-003','Employee Invalid Birth','2020-01-01','2021-01-01');
    RAISE EXCEPTION 'employee birth date check absent';
  EXCEPTION WHEN check_violation THEN NULL; END;
  -- Cross-tenant department reference must fail
  BEGIN
    INSERT INTO employees(id,organization_id,employee_code,full_name,hire_date,department_id)
    VALUES ('00000000-0000-0000-0000-000000000044','00000000-0000-0000-0000-000000000001','EMP-004','Cross Dept',CURRENT_DATE,'00000000-0000-0000-0000-000000000022');
    RAISE EXCEPTION 'cross-tenant department fk absent';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  -- Contract creation and activation
  INSERT INTO employee_contracts(id,organization_id,employee_id,contract_number,contract_type,start_date,signed_on,status)
  VALUES ('00000000-0000-0000-0000-000000000050','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000040','HD-001','INDEFINITE',CURRENT_DATE,CURRENT_DATE,'DRAFT');
  UPDATE employee_contracts SET status='ACTIVE' WHERE id='00000000-0000-0000-0000-000000000050';
  -- Second active contract for same employee must fail
  BEGIN
    INSERT INTO employee_contracts(id,organization_id,employee_id,contract_number,contract_type,start_date,signed_on,status)
    VALUES ('00000000-0000-0000-0000-000000000051','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000040','HD-002','INDEFINITE',CURRENT_DATE,CURRENT_DATE,'DRAFT');
    UPDATE employee_contracts SET status='ACTIVE' WHERE id='00000000-0000-0000-0000-000000000051';
    RAISE EXCEPTION 'single active contract constraint absent';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  -- Immutable work history deletion must fail
  BEGIN
    DELETE FROM employee_work_history WHERE employee_id='00000000-0000-0000-0000-000000000040';
    RAISE EXCEPTION 'work history immutability trigger absent';
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- PAY-001: Salary component creation and constraints
  INSERT INTO salary_components(id,organization_id,code,name,type,default_amount)
  VALUES ('00000000-0000-0000-0000-000000000060','00000000-0000-0000-0000-000000000001','BASE','Lương cơ bản','BASE_SALARY',10000000.00);
  -- Duplicate component code in same tenant must fail
  BEGIN
    INSERT INTO salary_components(id,organization_id,code,name,type,default_amount)
    VALUES ('00000000-0000-0000-0000-000000000061','00000000-0000-0000-0000-000000000001','base','Lương trùng','BASE_SALARY',5000000.00);
    RAISE EXCEPTION 'duplicate component code constraint absent';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  -- Negative amount check
  BEGIN
    INSERT INTO salary_components(id,organization_id,code,name,type,default_amount)
    VALUES ('00000000-0000-0000-0000-000000000062','00000000-0000-0000-0000-000000000001','NEG','Âm','ALLOWANCE',-100.00);
    RAISE EXCEPTION 'negative component amount check absent';
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- Employee salary profile with effective dates
  INSERT INTO employee_salary_profiles(id,organization_id,employee_id,salary_mode,base_salary,effective_from)
  VALUES ('00000000-0000-0000-0000-000000000070','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000040','GROSS',15000000.00,'2026-01-01');
  -- Invalid effective_to < effective_from
  BEGIN
    INSERT INTO employee_salary_profiles(id,organization_id,employee_id,salary_mode,base_salary,effective_from,effective_to)
    VALUES ('00000000-0000-0000-0000-000000000071','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000040','GROSS',15000000.00,'2026-01-01','2025-01-01');
    RAISE EXCEPTION 'salary profile effective date check absent';
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- Payroll period lifecycle & slip immutability
  INSERT INTO payroll_periods(id,organization_id,code,name,start_date,end_date,standard_working_days,status)
  VALUES ('00000000-0000-0000-0000-000000000080','00000000-0000-0000-0000-000000000001','KY-2026-01','Kỳ lương Tháng 1/2026','2026-01-01','2026-01-31',22.00,'DRAFT');
  -- Slip creation
  INSERT INTO payroll_slips(id,organization_id,period_id,employee_id,base_salary,prorated_base_salary,gross_pay,net_pay)
  VALUES ('00000000-0000-0000-0000-000000000090','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000080','00000000-0000-0000-0000-000000000040',15000000.00,15000000.00,15000000.00,15000000.00);
  -- Duplicate slip in same period must fail
  BEGIN
    INSERT INTO payroll_slips(id,organization_id,period_id,employee_id,base_salary,prorated_base_salary,gross_pay,net_pay)
    VALUES ('00000000-0000-0000-0000-000000000091','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000080','00000000-0000-0000-0000-000000000040',15000000.00,15000000.00,15000000.00,15000000.00);
    RAISE EXCEPTION 'duplicate slip in period constraint absent';
  EXCEPTION WHEN unique_violation THEN NULL; END;

  -- Close period
  UPDATE payroll_periods SET status='CLOSED' WHERE id='00000000-0000-0000-0000-000000000080';
  -- Modifying slip in closed period must fail
  BEGIN
    UPDATE payroll_slips SET net_pay=16000000.00 WHERE id='00000000-0000-0000-0000-000000000090';
    RAISE EXCEPTION 'closed period slip immutability absent';
  EXCEPTION WHEN raise_exception THEN NULL; END;

  -- EMP-003: Document constraints and immutable work history
  BEGIN
    INSERT INTO employee_documents(id,organization_id,employee_id,file_name,file_path,file_size,mime_type)
    VALUES ('00000000-0000-0000-0000-000000000095','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000040','danger.exe','uploads/danger.exe',1000,'application/x-msdownload');
    RAISE EXCEPTION 'invalid document MIME constraint absent';
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- Valid document insertion
  INSERT INTO employee_documents(id,organization_id,employee_id,file_name,file_path,file_size,mime_type,document_type)
  VALUES ('00000000-0000-0000-0000-000000000096','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000040','cv.pdf','uploads/cv.pdf',2048,'application/pdf','RESUME');

  -- Work history cannot be deleted
  BEGIN
    DELETE FROM employee_work_history WHERE employee_id='00000000-0000-0000-0000-000000000040';
    RAISE EXCEPTION 'immutable work history guard absent';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
ROLLBACK;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM organizations) THEN RAISE EXCEPTION 'test fixture rollback failed'; END IF;
END $$;
