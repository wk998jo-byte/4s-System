"""Apply migrations 001–003 to an EMPTY staging PostgreSQL database only.

Safety:
- Refuses SQLite / operational scc_platform.db paths
- Refuses non-empty databases (existing public tables)
- Does not invent credentials; requires DATABASE_URL in the environment
- Never touches local operational SQLite

Usage (authorized staging only):
  set DATABASE_URL=postgresql+psycopg://USER:PASS@HOST:5432/scc_staging
  python -m scripts.phase6b_apply_staging_migrations
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from urllib.parse import unquote, urlparse

import psycopg
from sqlalchemy import create_engine, text

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "migrations"
ITQAN_INDEX = "uq_cases_itqan_ref_active"


def _require_postgres_url(raw: str) -> str:
    url = (raw or "").strip()
    if not url:
        raise SystemExit("DATABASE_URL is required.")
    lower = url.lower()
    if "sqlite" in lower or "scc_platform.db" in lower:
        raise SystemExit("Refusing SQLite / operational database URL.")
    if not lower.startswith("postgresql"):
        raise SystemExit("DATABASE_URL must be PostgreSQL (postgresql+psycopg://...).")
    if lower.startswith("postgresql://") and "+psycopg" not in lower:
        url = "postgresql+psycopg://" + url.split("://", 1)[1]
    return url


def _psycopg_conninfo(sa_url: str) -> str:
    """Convert SQLAlchemy URL to a psycopg conninfo string."""
    # Strip driver suffix for urlparse
    normalized = sa_url.replace("postgresql+psycopg://", "postgresql://", 1)
    parsed = urlparse(normalized)
    user = unquote(parsed.username or "")
    password = unquote(parsed.password or "")
    host = parsed.hostname or "127.0.0.1"
    port = parsed.port or 5432
    dbname = (parsed.path or "/").lstrip("/") or "postgres"
    return (
        f"host={host} port={port} dbname={dbname} "
        f"user={user} password={password}"
    )


def _assert_empty(engine) -> None:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT table_name
                FROM information_schema.tables
                WHERE table_schema = 'public'
                  AND table_type = 'BASE TABLE'
                ORDER BY table_name
                """
            )
        ).fetchall()
    names = [r[0] for r in rows]
    if names:
        raise SystemExit(
            "Database is not empty — aborting. Existing public tables: "
            + ", ".join(names[:30])
            + ("…" if len(names) > 30 else "")
        )


def _apply_sql_file(conninfo: str, path: Path) -> None:
    sql = path.read_text(encoding="utf-8")
    with psycopg.connect(conninfo) as conn:
        conn.execute(sql)
        conn.commit()


def _verify_itqan_unique(engine) -> bool:
    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT 1
                FROM pg_indexes
                WHERE schemaname = 'public'
                  AND indexname = :name
                LIMIT 1
                """
            ),
            {"name": ITQAN_INDEX},
        ).fetchone()
    return row is not None


def main() -> int:
    url = _require_postgres_url(os.environ.get("DATABASE_URL", ""))
    engine = create_engine(url, pool_pre_ping=True)
    conninfo = _psycopg_conninfo(url)
    print("[phase6b] connected (identity redacted)")
    _assert_empty(engine)
    for name in (
        "001_postgresql_baseline.sql",
        "002_itqan_ref_unique.sql",
        "003_foreign_keys.sql",
    ):
        path = MIGRATIONS / name
        if not path.is_file():
            raise SystemExit(f"Missing migration: {path}")
        print(f"[phase6b] applying {name}…")
        _apply_sql_file(conninfo, path)
    ok_itqan = _verify_itqan_unique(engine)
    print(
        f"[phase6b] ITQAN unique index {ITQAN_INDEX}: "
        f"{'PRESENT' if ok_itqan else 'MISSING'}"
    )
    if not ok_itqan:
        return 2
    print("[phase6b] PASS — staging schema ready (empty DB + 001–003)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
