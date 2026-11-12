-- Optional foreign keys for PostgreSQL (models currently omit FK declarations).
-- Apply after baseline and after confirming orphan session/user rows are clean.

BEGIN;

ALTER TABLE sessions
  DROP CONSTRAINT IF EXISTS fk_sessions_user_id;

ALTER TABLE sessions
  ADD CONSTRAINT fk_sessions_user_id
  FOREIGN KEY (user_id) REFERENCES users (id)
  ON DELETE CASCADE;

COMMIT;
