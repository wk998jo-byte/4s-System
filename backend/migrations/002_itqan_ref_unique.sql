-- Optional: enforce ITQAN reference uniqueness at the database level.
-- PRECONDITION: inventory and resolve historical duplicates first.
-- Application-level uniqueness already rejects new duplicates (Phase 3B).
-- Do NOT apply automatically to operational databases.

BEGIN;

-- Expression unique index on JSON field (PostgreSQL).
-- Soft-deleted rows are excluded so historical cleanup can soft-delete.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cases_itqan_ref_active
ON cases ((fields->>'itqan_ref'))
WHERE record_type = 'itqan'
  AND is_deleted = FALSE
  AND COALESCE(fields->>'itqan_ref', '') <> '';

COMMIT;
