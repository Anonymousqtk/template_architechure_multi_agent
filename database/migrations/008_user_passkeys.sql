BEGIN;

CREATE TABLE user_passkeys (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES user_mfa(user_id) ON DELETE CASCADE,
  rp_id text NOT NULL,
  public_key bytea NOT NULL,
  counter bigint NOT NULL CHECK (counter >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
CREATE INDEX user_passkeys_user_idx ON user_passkeys(user_id, rp_id);

CREATE TABLE passkey_challenges (
  challenge text PRIMARY KEY,
  browser_hash text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('login', 'register')),
  session_id uuid REFERENCES user_sessions(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  CHECK ((purpose = 'register') = (session_id IS NOT NULL))
);
CREATE INDEX passkey_challenges_expiry_idx ON passkey_challenges(expires_at);

COMMIT;
