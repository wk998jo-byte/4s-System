"""Create SQLAlchemy metadata on an isolated PostgreSQL URL and report status.

Usage (isolated empty DB only):
  DATABASE_URL=postgresql+psycopg://user:pass@host/db python -m scripts.verify_pg_schema

Exits 2 if DATABASE_URL is missing or not PostgreSQL.
Never targets the operational SQLite file.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))


def main() -> int:
    url = (os.environ.get("DATABASE_URL") or "").strip()
    if not url or not (
        url.startswith("postgresql") or url.startswith("postgres")
    ):
        print("NOT VERIFIED: set DATABASE_URL to an isolated PostgreSQL URL")
        return 2
    if "scc_platform.db" in url:
        print("REFUSED: refusing operational sqlite path in DATABASE_URL")
        return 3

    from sqlalchemy import inspect, text

    from app.db.base import Base
    from app.db import models  # noqa: F401
    from app.db.engine import make_engine

    engine = make_engine(url)
    Base.metadata.create_all(engine)
    insp = inspect(engine)
    tables = sorted(insp.get_table_names())
    expected = sorted(Base.metadata.tables.keys())
    missing = [t for t in expected if t not in tables]
    with engine.connect() as conn:
        conn.execute(text("SELECT 1"))
    print("PASS: PostgreSQL schema create_all")
    print("tables=", tables)
    if missing:
        print("FAIL: missing", missing)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
