-- AUTH-003 additive migration. Never apply to production without review.
BEGIN;
ALTER TABLE user_sessions ADD COLUMN last_seen_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE user_sessions ADD COLUMN reauthenticated_at timestamptz;
ALTER TABLE user_sessions ADD COLUMN mfa_verified_at timestamptz;
ALTER TABLE user_sessions ADD COLUMN device_label text NOT NULL DEFAULT 'Browser';
ALTER TABLE user_sessions ADD CONSTRAINT session_device_length CHECK(length(device_label)<=40);
CREATE TABLE user_mfa (
 user_id uuid PRIMARY KEY REFERENCES users(id),
 encrypted_secret text,
 pending_secret text,
 pending_expires_at timestamptz,
 enabled_at timestamptz,
 last_counter bigint NOT NULL DEFAULT -1,
 recovery_hashes jsonb NOT NULL DEFAULT '[]'::jsonb,
 CHECK(jsonb_typeof(recovery_hashes)='array'),
 CHECK(enabled_at IS NULL OR encrypted_secret IS NOT NULL)
);
COMMIT;
