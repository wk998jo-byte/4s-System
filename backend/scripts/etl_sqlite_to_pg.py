"""Isolated SQLite → PostgreSQL ETL dry-run (synthetic sources only).

Usage (disposable databases only):
  set SOURCE_SQLITE_URL=sqlite+pysqlite:///C:/tmp/phase5_src.db
  set DATABASE_URL=postgresql+psycopg://user:pass@localhost:5432/scc_phase5
  python -m scripts.etl_sqlite_to_pg

Refuses operational scc_platform.db. Exits 2 if PostgreSQL URL missing.
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
from datetime import date, datetime
from pathlib import Path
from typing import Any

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

TABLE_ORDER = [
    "users",
    "list_items",
    "asset_classifications",
    "app_state",
    "cases",
    "contacts",
    "weather_hourly_readings",
    "weather_weekly_logs",
    "audit_events",
    "sessions",
]


def _refuse_ops(url: str) -> None:
    if "scc_platform.db" in (url or ""):
        raise SystemExit("REFUSED: operational scc_platform.db is not allowed")


def _jsonable(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, (bytes, bytearray)):
        return value.hex()
    return value


def _row_fingerprint(row: dict[str, Any]) -> str:
    payload = {k: _jsonable(row[k]) for k in sorted(row)}
    raw = json.dumps(payload, sort_keys=True, default=str, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _coerce_for_pg(value: Any, pg_type: str) -> Any:
    """Normalize SQLite-ish values for PostgreSQL column types."""
    t = (pg_type or "").lower()
    if value is None:
        return None
    if t == "boolean":
        if isinstance(value, bool):
            return value
        if isinstance(value, (int, float)):
            return bool(value)
        if isinstance(value, str):
            return value.strip().lower() in {"1", "true", "t", "yes"}
        return bool(value)
    if t in {"json", "jsonb"}:
        if isinstance(value, (dict, list)):
            return json.dumps(value)
        if isinstance(value, (bytes, bytearray)):
            return value.decode("utf-8")
        if isinstance(value, str):
            # Keep valid JSON text; wrap bare scalars if needed.
            try:
                json.loads(value)
                return value
            except Exception:
                return json.dumps(value)
        return json.dumps(value)
    return value


def main() -> int:
    src = (os.environ.get("SOURCE_SQLITE_URL") or "").strip()
    dst = (os.environ.get("DATABASE_URL") or "").strip()
    if not src.startswith("sqlite"):
        print("NOT VERIFIED: set SOURCE_SQLITE_URL to an isolated sqlite URL")
        return 2
    if not dst or not (dst.startswith("postgresql") or dst.startswith("postgres")):
        print("NOT VERIFIED: set DATABASE_URL to an isolated PostgreSQL URL")
        return 2
    _refuse_ops(src)
    _refuse_ops(dst)

    from sqlalchemy import inspect, text
    from sqlalchemy.orm import Session

    from app.db.base import Base
    from app.db import models  # noqa: F401
    from app.db.engine import make_engine

    src_engine = make_engine(src)
    dst_engine = make_engine(dst)
    Base.metadata.create_all(dst_engine)

    src_insp = inspect(src_engine)
    dst_insp = inspect(dst_engine)
    report: dict[str, Any] = {"tables": {}, "mismatches": [], "ok": True}

    with Session(src_engine) as s_src, Session(dst_engine) as s_dst:
        for table in TABLE_ORDER:
            if table not in src_insp.get_table_names():
                report["mismatches"].append(f"missing source table {table}")
                report["ok"] = False
                continue
            cols = [c["name"] for c in src_insp.get_columns(table)]
            dst_cols = {
                c["name"]: str(c.get("type") or "")
                for c in dst_insp.get_columns(table)
            }
            rows = s_src.execute(text(f'SELECT * FROM "{table}"')).mappings().all()
            # Clear destination table for repeatable dry-run
            if table in dst_insp.get_table_names():
                s_dst.execute(text(f'DELETE FROM "{table}"'))
            inserted = 0
            for row in rows:
                data = {
                    k: _coerce_for_pg(row[k], dst_cols.get(k, ""))
                    for k in cols
                    if k in dst_cols
                }
                # Cast JSON/JSONB explicitly for text payloads
                cast_exprs = []
                for c in data:
                    pg_t = dst_cols.get(c, "").lower()
                    if pg_t in {"json", "jsonb"}:
                        cast_exprs.append(f"CAST(:{c} AS jsonb)")
                    else:
                        cast_exprs.append(f":{c}")
                col_list = ", ".join(f'"{c}"' for c in data)
                placeholders = ", ".join(cast_exprs)
                s_dst.execute(
                    text(f'INSERT INTO "{table}" ({col_list}) VALUES ({placeholders})'),
                    data,
                )
                inserted += 1
            s_dst.commit()
            dst_count = s_dst.execute(text(f'SELECT COUNT(*) FROM "{table}"')).scalar()
            # Compare on coerced logical values (bool 0/1 vs false/true, JSON parse)
            def norm_row(r: dict[str, Any], types: dict[str, str]) -> dict[str, Any]:
                out = {}
                for k, v in r.items():
                    t = types.get(k, "").lower()
                    if v is None:
                        out[k] = None
                        continue
                    if t == "boolean":
                        out[k] = bool(v) if not isinstance(v, str) else v.strip().lower() in {
                            "1",
                            "true",
                            "t",
                        }
                    elif t in {"json", "jsonb"}:
                        if isinstance(v, str):
                            try:
                                out[k] = json.loads(v)
                            except Exception:
                                out[k] = v
                        else:
                            out[k] = v
                    elif "date" in t and "time" not in t:
                        out[k] = str(v)[:10]
                    elif "time" in t or t == "datetime":
                        # Logical timestamp compare: drop tz / normalize fractions.
                        if isinstance(v, datetime):
                            # Compare wall-clock UTC-ish components only.
                            naive = v.replace(tzinfo=None)
                            out[k] = naive.strftime("%Y-%m-%d %H:%M:%S")
                        else:
                            s = str(v).replace("T", " ")
                            s = s.split("+")[0].split("Z")[0].strip()
                            if "." in s:
                                s = s.split(".", 1)[0]
                            out[k] = s[:19]
                    else:
                        out[k] = v
                return out

            src_fps = sorted(
                _row_fingerprint(norm_row(dict(r), dst_cols)) for r in rows
            )
            dst_rows = s_dst.execute(text(f'SELECT * FROM "{table}"')).mappings().all()
            dst_fps = sorted(
                _row_fingerprint(norm_row(dict(r), dst_cols)) for r in dst_rows
            )
            match = src_fps == dst_fps and int(dst_count or 0) == len(rows)
            report["tables"][table] = {
                "source_count": len(rows),
                "dest_count": int(dst_count or 0),
                "inserted": inserted,
                "fingerprint_match": match,
            }
            if not match:
                report["ok"] = False
                report["mismatches"].append(f"{table} reconciliation failed")

    print(json.dumps(report, indent=2))
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
