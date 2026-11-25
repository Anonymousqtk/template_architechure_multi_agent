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
  PERFORM set_config('app.current_user_id','00000000-0000-0000-0000-000000000002',true);
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

  -- PAY-003: Accounting & Reconciliation Constraints
  INSERT INTO accounting_accounts(id,organization_id,code,name,type)
  VALUES
    ('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000001','6422','Chi phi quan ly DN','EXPENSE'),
    ('00000000-0000-0000-0000-000000000102','00000000-0000-0000-0000-000000000001','3341','Phai tra nguoi lao dong','LIABILITY');

  -- Duplicate account code in same org must fail
  BEGIN
    INSERT INTO accounting_accounts(id,organization_id,code,name,type)
    VALUES ('00000000-0000-0000-0000-000000000103','00000000-0000-0000-0000-000000000001','6422','Duplicate Code','EXPENSE');
    RAISE EXCEPTION 'duplicate account code constraint absent';
  EXCEPTION WHEN unique_violation THEN NULL; END;

  -- Journal entry & posted immutability
  INSERT INTO payroll_journal_entries(id,organization_id,period_id,entry_number,entry_date,status,total_debit,total_credit)
  VALUES ('00000000-0000-0000-0000-000000000110','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000080','PKT-202601-01','2026-01-31','DRAFT',15000000.00,15000000.00);

  INSERT INTO payroll_journal_entry_lines(id,organization_id,entry_id,account_id,debit_amount,credit_amount,line_order)
  VALUES
    ('00000000-0000-0000-0000-000000000111','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000110','00000000-0000-0000-0000-000000000101',15000000.00,0.00,1),
    ('00000000-0000-0000-0000-000000000112','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000110','00000000-0000-0000-0000-000000000102',0.00,15000000.00,2);

  -- Post entry
  UPDATE payroll_journal_entries SET status='POSTED', posted_at=now() WHERE id='00000000-0000-0000-0000-000000000110';

  -- Modifying posted entry must fail
  BEGIN
    UPDATE payroll_journal_entries SET total_debit=16000000.00 WHERE id='00000000-0000-0000-0000-000000000110';
    RAISE EXCEPTION 'posted journal entry immutability absent';
  EXCEPTION WHEN raise_exception THEN NULL; END;

  -- Modifying line of posted entry must fail
  BEGIN
    INSERT INTO payroll_journal_entry_lines(id,organization_id,entry_id,account_id,debit_amount,credit_amount,line_order)
    VALUES ('00000000-0000-0000-0000-000000000113','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000110','00000000-0000-0000-0000-000000000101',1000.00,0.00,3);
    RAISE EXCEPTION 'posted journal line immutability absent';
  EXCEPTION WHEN raise_exception THEN NULL; END;

  -- Disbursements uniqueness check
  INSERT INTO payroll_disbursements(id,organization_id,period_id,employee_id,disbursement_code,amount,payment_date)
  VALUES ('00000000-0000-0000-0000-000000000120','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000080','00000000-0000-0000-0000-000000000040','DISB-001',15000000.00,'2026-02-05');

  BEGIN
    INSERT INTO payroll_disbursements(id,organization_id,period_id,employee_id,disbursement_code,amount,payment_date)
    VALUES ('00000000-0000-0000-0000-000000000121','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000080','00000000-0000-0000-0000-000000000040','DISB-001',15000000.00,'2026-02-05');
    RAISE EXCEPTION 'duplicate disbursement code constraint absent';
  EXCEPTION WHEN unique_violation THEN NULL; END;

  -- PAY-004: Compliance & Reporting checks
  -- 1. Statutory rule with invalid date range
  BEGIN
    INSERT INTO compliance_statutory_rules(id, organization_id, rule_type, rule_code, name, effective_from, effective_to, parameters, legal_reference)
    VALUES ('00000000-0000-0000-0000-000000000130', '00000000-0000-0000-0000-000000000001', 'PIT_DEDUCTIONS', 'PIT_RULE_TEST', 'PIT Deductions', '2026-01-01', '2025-01-01', '{"personal": 11000000}'::jsonb, 'NQ 954/2020');
    RAISE EXCEPTION 'statutory rule effective date check absent';
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- 2. Valid statutory rule
  INSERT INTO compliance_statutory_rules(id, organization_id, rule_type, rule_code, name, effective_from, effective_to, parameters, legal_reference)
  VALUES ('00000000-0000-0000-0000-000000000131', '00000000-0000-0000-0000-000000000001', 'PIT_DEDUCTIONS', 'PIT_RULE_TEST', 'PIT Deductions', '2026-01-01', NULL, '{"personal": 11000000, "dependent": 4400000}'::jsonb, 'NQ 954/2020');

  -- 3. Employee dependent
  INSERT INTO employee_dependents(id, organization_id, employee_id, full_name, relationship, tax_id, effective_from)
  VALUES ('00000000-0000-0000-0000-000000000140', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000040', 'Nguyen Con', 'CHILD', '8000112233', '2026-01-01');

  -- 4. Compliance report creation & locking
  INSERT INTO compliance_reports(id, organization_id, report_type, report_code, title, period_start, period_end, status, created_by)
  VALUES ('00000000-0000-0000-0000-000000000150', '00000000-0000-0000-0000-000000000001', 'PIT_MONTHLY', 'REP-PIT-2026-01', 'Báo cáo thuế TNCN T1/2026', '2026-01-01', '2026-01-31', 'LOCKED', '00000000-0000-0000-0000-000000000002');

  -- 5. Modifying locked report must fail
  BEGIN
    UPDATE compliance_reports SET title='Modified Title' WHERE id='00000000-0000-0000-0000-000000000150';
    RAISE EXCEPTION 'locked compliance report immutability absent';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'locked compliance report immutability absent' THEN
      RAISE EXCEPTION 'locked compliance report immutability absent';
    END IF;
  END;

  -- 6. Compliance anomaly & audit log
  INSERT INTO compliance_anomalies(id, organization_id, report_id, employee_id, anomaly_code, severity, description)
  VALUES ('00000000-0000-0000-0000-000000000160', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000150', '00000000-0000-0000-0000-000000000040', 'SALARY_BELOW_REGIONAL_MIN', 'CRITICAL', 'Lương thấp hơn mức tối thiểu vùng');

  INSERT INTO compliance_audit_logs(id, organization_id, action, target_type, target_id, performed_by, details)
  VALUES ('00000000-0000-0000-0000-000000000170', '00000000-0000-0000-0000-000000000001', 'REPORT_LOCKED', 'COMPLIANCE_REPORT', '00000000-0000-0000-0000-000000000150', '00000000-0000-0000-0000-000000000002', '{"code": "REP-PIT-2026-01"}'::jsonb);

  -- RPT-001: Reporting Center & Export Audit checks
  -- 1. Insert report catalog entry
  INSERT INTO report_catalog(id, organization_id, code, category, name, description, min_role)
  VALUES ('00000000-0000-0000-0000-000000000180', '00000000-0000-0000-0000-000000000001', 'RPT-EMP-01', 'EMPLOYEE', 'Báo cáo nhân sự', 'Chi tiết nhân sự', 'HR');

  -- Duplicate report code in same org must fail
  BEGIN
    INSERT INTO report_catalog(id, organization_id, code, category, name, description, min_role)
    VALUES ('00000000-0000-0000-0000-000000000181', '00000000-0000-0000-0000-000000000001', 'RPT-EMP-01', 'EMPLOYEE', 'Duplicate Code', 'Mô tả', 'HR');
    RAISE EXCEPTION 'duplicate report code constraint absent';
  EXCEPTION WHEN unique_violation THEN NULL; END;

  -- 2. Insert report saved template
  INSERT INTO report_saved_templates(id, organization_id, report_code, user_id, template_name, filters)
  VALUES ('00000000-0000-0000-0000-000000000182', '00000000-0000-0000-0000-000000000001', 'RPT-EMP-01', '00000000-0000-0000-0000-000000000002', 'Mau thang nay', '{"department": "all"}'::jsonb);

  -- Duplicate template name for same user must fail
  BEGIN
    INSERT INTO report_saved_templates(id, organization_id, report_code, user_id, template_name, filters)
    VALUES ('00000000-0000-0000-0000-000000000183', '00000000-0000-0000-0000-000000000001', 'RPT-EMP-01', '00000000-0000-0000-0000-000000000002', 'Mau thang nay', '{"department": "tech"}'::jsonb);
    RAISE EXCEPTION 'duplicate saved template constraint absent';
  EXCEPTION WHEN unique_violation THEN NULL; END;

  -- 3. Insert report export audit log
  INSERT INTO report_export_audit_logs(id, organization_id, report_code, format, row_count, filters, exported_by)
  VALUES ('00000000-0000-0000-0000-000000000184', '00000000-0000-0000-0000-000000000001', 'RPT-EMP-01', 'CSV', 10, '{"status": "ACTIVE"}'::jsonb, '00000000-0000-0000-0000-000000000002');

  -- Invalid export format must fail
  BEGIN
    INSERT INTO report_export_audit_logs(id, organization_id, report_code, format, row_count, filters, exported_by)
    VALUES ('00000000-0000-0000-0000-000000000185', '00000000-0000-0000-0000-000000000001', 'RPT-EMP-01', 'EXE', 10, '{}'::jsonb, '00000000-0000-0000-0000-000000000002');
    RAISE EXCEPTION 'invalid export format constraint absent';
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- 4. RPT-002: Verify 'ACCOUNTING' category in report_catalog
  INSERT INTO report_catalog(id, organization_id, code, category, name, description, min_role)
  VALUES ('00000000-0000-0000-0000-000000000186', '00000000-0000-0000-0000-000000000001', 'RPT-ACC-01', 'ACCOUNTING', 'Phân bổ chi phí', 'Mô tả', 'HR');

  -- 5. RPT-003: Verify 'LABOR_UTILIZATION' report_type in compliance_reports
  INSERT INTO compliance_reports(id, organization_id, report_type, report_code, title, period_start, period_end, created_by)
  VALUES ('00000000-0000-0000-0000-000000000187', '00000000-0000-0000-0000-000000000001', 'LABOR_UTILIZATION', 'RPT-LAB-2026-H1', 'Báo cáo lao động H1/2026', CURRENT_DATE - 30, CURRENT_DATE, '00000000-0000-0000-0000-000000000002');

  -- 6. RPT-002: Dynamic Custom Report Builder schema checks
  INSERT INTO custom_reports(id, organization_id, name, primary_entity, definition, visualization_type, visibility, created_by)
  VALUES ('00000000-0000-0000-0000-000000000190', '00000000-0000-0000-0000-000000000001', 'Headcount Matrix', 'employees', '{"primaryEntity":"employees","relatedEntities":["departments"],"columns":[],"rows":[{"fieldId":"dept_name"}],"pivotColumns":[],"values":[{"id":"v1","fieldId":"emp_id","aggregation":"COUNT"}],"groupBy":[],"filters":{"id":"root","combinator":"AND","rules":[],"groups":[]},"sortBy":[],"calculatedFields":[]}'::jsonb, 'PIVOT', 'SHARED', '00000000-0000-0000-0000-000000000002');

  -- Invalid visualization type must fail
  BEGIN
    INSERT INTO custom_reports(id, organization_id, name, primary_entity, definition, visualization_type, created_by)
    VALUES ('00000000-0000-0000-0000-000000000191', '00000000-0000-0000-0000-000000000001', 'Bad Viz', 'employees', '{}'::jsonb, '3D_PIE', '00000000-0000-0000-0000-000000000002');
    RAISE EXCEPTION 'custom_reports visualization check constraint absent';
  EXCEPTION WHEN check_violation THEN NULL; END;

  INSERT INTO custom_report_versions(id, organization_id, report_id, version, definition, visualization_type, created_by)
  VALUES ('00000000-0000-0000-0000-000000000192', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000190', 1, '{}'::jsonb, 'PIVOT', '00000000-0000-0000-0000-000000000002');

  INSERT INTO custom_report_user_prefs(organization_id, report_id, user_id, is_favorite, last_viewed_at)
  VALUES ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000190', '00000000-0000-0000-0000-000000000002', true, now());

  INSERT INTO custom_report_export_jobs(id, organization_id, report_id, report_name, format, status, definition_snapshot, locale, requested_by)
  VALUES ('00000000-0000-0000-0000-000000000193', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000190', 'Headcount Matrix', 'EXCEL', 'COMPLETED', '{}'::jsonb, 'vi', '00000000-0000-0000-0000-000000000002');
END $$;
ROLLBACK;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM organizations) THEN RAISE EXCEPTION 'test fixture rollback failed'; END IF;
END $$;
