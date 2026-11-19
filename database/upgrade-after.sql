DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id JOIN organizations o ON o.id=m.organization_id WHERE m.id='10000000-0000-0000-0000-000000000003' AND m.role='ADMIN' AND m.is_active AND m.manager_user_id IS NULL AND u.email='upgrade@example.test' AND u.password_hash='fixture-hash' AND u.full_name='Preserved user' AND u.is_active AND o.name='Upgrade fixture') THEN RAISE EXCEPTION 'RBAC migration changed existing account'; END IF;
END $$;
DELETE FROM memberships WHERE id='10000000-0000-0000-0000-000000000003';
DELETE FROM users WHERE id='10000000-0000-0000-0000-000000000002';
DELETE FROM organizations WHERE id='10000000-0000-0000-0000-000000000001';
