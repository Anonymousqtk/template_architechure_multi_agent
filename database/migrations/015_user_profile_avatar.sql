BEGIN;
SET LOCAL lock_timeout='5s';

ALTER TABLE users ADD COLUMN avatar_url text;

COMMIT;
