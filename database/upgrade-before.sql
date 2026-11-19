-- Disposable-cluster fixture only: test actual AUTH-001 -> AUTH-002 upgrade.
INSERT INTO organizations(id,name) VALUES('10000000-0000-0000-0000-000000000001','Upgrade fixture');
INSERT INTO users(id,email,full_name,password_hash,email_verified_at) VALUES('10000000-0000-0000-0000-000000000002','upgrade@example.test','Preserved user','fixture-hash',now());
INSERT INTO memberships(id,user_id,organization_id,role) VALUES('10000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','ADMIN');
