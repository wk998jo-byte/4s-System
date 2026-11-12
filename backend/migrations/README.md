# SCC Platform database migrations

These migrations are **version-controlled** and **not auto-applied** to operational
databases. Phase 4 forbids silent migration against production/ops data.

## Layout

| File | Purpose |
|------|---------|
| `001_postgresql_baseline.sql` | Create all tables for a fresh PostgreSQL database |
| `002_itqan_ref_unique.sql` | Optional unique index for ITQAN refs (after duplicate audit) |
| `003_foreign_keys.sql` | Optional FK constraints (sessions→users) |

## How to apply (authorized environments only)

```bash
# Fresh PostgreSQL (example — do NOT run against operational DBs without approval)
psql "$DATABASE_URL" -f migrations/001_postgresql_baseline.sql
```

Or use SQLAlchemy metadata against an **isolated** empty database:

```bash
DATABASE_URL=postgresql+psycopg://... python -m scripts.verify_pg_schema
```

## SQLite note

Local SQLite continues to use `Base.metadata.create_all` plus the existing
`_migrate_sqlite` pragma helpers for additive columns. Those helpers run only
when the configured engine dialect is SQLite.

## Historical ITQAN duplicates

Do **not** apply `002_itqan_ref_unique.sql` until duplicates are inventoried and
resolved manually. Application-level uniqueness (Phase 3B) already rejects new
duplicates.
