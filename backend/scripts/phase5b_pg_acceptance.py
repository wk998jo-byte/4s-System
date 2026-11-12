"""Phase 5B acceptance against isolated PostgreSQL DATABASE_URL.

Env: DATABASE_URL=postgresql+psycopg://user:***@127.0.0.1:5432/scc_phase5b
Refuses operational sqlite. Never prints passwords.
"""

from __future__ import annotations

import json
import os
import sys
import traceback
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from uuid import uuid4
from urllib.parse import urlparse

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))


def main() -> int:
    url = (os.environ.get("DATABASE_URL") or "").strip()
    if "scc_platform.db" in url:
        print("REFUSED operational sqlite")
        return 3
    if not (url.startswith("postgresql") or url.startswith("postgres")):
        print("REFUSED non-postgres URL")
        return 2

    parsed = urlparse(url.replace("postgresql+psycopg", "postgresql", 1))
    report: dict = {
        "database": parsed.path.lstrip("/"),
        "host": parsed.hostname,
        "port": parsed.port,
        "user": parsed.username,
        "steps": {},
        "ok": True,
    }

    from sqlalchemy import inspect, text

    from app.core.config import get_settings
    from app.db.base import Base
    from app.db import models  # noqa: F401
    from app.db.engine import make_engine
    from app.schemas.scc import (
        AiCameraCreate,
        DashcamCreate,
        ItqanCreate,
        SosClose,
        SosCreate,
        SpeedCreate,
    )
    from app.services.platform_store import PlatformStore

    engine = make_engine(url)
    insp = inspect(engine)
    tables = sorted(insp.get_table_names())
    expected = sorted(Base.metadata.tables.keys())
    missing = [t for t in expected if t not in tables]
    report["steps"]["model_parity"] = {
        "expected": expected,
        "actual": tables,
        "missing": missing,
        "pass": not missing,
    }
    if missing:
        report["ok"] = False

    with engine.connect() as conn:
        idx = conn.execute(
            text(
                "SELECT indexname FROM pg_indexes WHERE schemaname='public' "
                "AND indexname='uq_cases_itqan_ref_active'"
            )
        ).scalar()
        fk = conn.execute(
            text(
                "SELECT conname FROM pg_constraint WHERE conname='fk_sessions_user_id'"
            )
        ).scalar()
        jb = conn.execute(
            text("SELECT CAST(:payload AS jsonb) ->> 'a'"),
            {"payload": '{"a":1}'},
        ).scalar()
        bl = conn.execute(text("SELECT TRUE::boolean")).scalar()
    report["steps"]["constraints_types"] = {
        "itqan_unique_index": bool(idx),
        "sessions_fk": bool(fk),
        "jsonb": jb == "1",
        "boolean": bl is True,
        "pass": bool(idx) and bool(fk) and jb == "1" and bl is True,
    }
    if not report["steps"]["constraints_types"]["pass"]:
        report["ok"] = False

    get_settings.cache_clear()
    store = PlatformStore(database_url=url)
    users = store.list_users()
    report["steps"]["startup"] = {
        "storage": store.storage_label(),
        "users": len(users),
        "cases": len(store.list_cases()),
        "pass": store.storage_label() == "postgresql" and len(users) >= 1,
    }
    if not report["steps"]["startup"]["pass"]:
        report["ok"] = False

    project = store.catalog.get("project")[0]
    details: dict = {}
    module_ok = True

    def mark(name: str, ok: bool, err: str | None = None) -> None:
        nonlocal module_ok
        details[name] = True if ok else f"FAIL:{err}"
        if not ok:
            module_ok = False

    try:
        ai = store.create_ai_camera(
            AiCameraCreate(
                project_id=project["id"],
                location="P5B Laydown",
                occurred_on=date.today(),
                occurred_time=time(10, 30),
                alert_summary="P5B helmet",
                alert_type_id=store.catalog.get("alert_type")[0]["id"],
                category_id=store.catalog.get("ai_camera_category")[0]["id"],
                risk_level_id=store.catalog.get("risk_level")[0]["id"],
                detection_method_id=store.catalog.get("detection_method")[0]["id"],
                reported_by="P5B",
            )
        )
        mark("ai_camera", store.get_case(ai["id"]) is not None)
    except Exception as exc:
        mark("ai_camera", False, f"{type(exc).__name__}:{exc}")

    try:
        dc = store.create_dashcam(
            DashcamCreate(
                assign_to="project",
                project_id=project["id"],
                vehicle_type_id=store.catalog.get("vehicle_type")[0]["id"],
                model_id=store.catalog.get("model")[0]["id"],
                asset_number="P5B-A1",
                driver_name="D",
                driver_badge_number="1",
                occurred_on=date.today(),
                occurred_time=time(9, 0),
                violation_type_id=store.catalog.get("dashcam_observation_type")[0]["id"],
                risk_level_id=store.catalog.get("risk_level")[0]["id"],
                alert_summary="Seat belt",
                reported_by="P5B",
                upload_to_itqan=False,
                itqan_skip_reason="phase5b",
            )
        )
        mark("dashcam", store.get_case(dc["id"]) is not None)
    except Exception as exc:
        mark("dashcam", False, f"{type(exc).__name__}:{exc}")

    try:
        sp = store.create_speed(
            SpeedCreate(
                assign_to="project",
                project_id=project["id"],
                speed_violation_type_id=store.catalog.get("speed_violation_type")[1]["id"],
                vehicle_type_id=store.catalog.get("vehicle_type")[0]["id"],
                model_id=store.catalog.get("model")[1]["id"],
                asset_number="P5B-S1",
                driver_name="D",
                driver_badge_number="2",
                location_coordinates="26.3, 50.1",
                occurred_on=date.today(),
                occurred_time=time(11, 0),
                permitted_speed_kmh=60,
                vehicle_speed_kmh=78,
                reported_by="P5B",
                upload_to_itqan=False,
                itqan_skip_reason="phase5b",
            )
        )
        mark("speed", store.get_case(sp["id"]) is not None)
    except Exception as exc:
        mark("speed", False, f"{type(exc).__name__}:{exc}")

    try:
        now = datetime.now(timezone.utc)
        sos = store.create_sos(
            SosCreate(
                project_id=project["id"],
                worker_name_badge="1 - P5B Worker",
                sos_created_at=now - timedelta(minutes=2),
                seen_at=now,
                location="Pad-P5B",
                source_id=store.catalog.get("sos_source")[0]["id"],
            ),
            actor="Operator P5B",
        )
        closed = store.close_sos(
            sos["id"],
            SosClose(
                alarm="False Alarm",
                picture_shared_by="Sup",
                closed_at=datetime.now(timezone.utc),
                close_out_report="OK",
            ),
            actor="Operator P5B",
        )
        mark("sos_direct_close", bool(closed) and closed.get("status") == "closed")
    except Exception as exc:
        mark("sos_direct_close", False, f"{type(exc).__name__}:{exc}")

    try:
        store.create_itqan(_itqan(store, "P5B-ITQ-OK"))
        try:
            store.create_itqan(_itqan(store, "P5B-ITQ-OK"))
            mark("itqan_seq_dup", False, "duplicate accepted")
        except ValueError:
            mark("itqan_seq_dup", True)
    except Exception as exc:
        mark("itqan_seq_dup", False, f"{type(exc).__name__}:{exc}")

    try:
        mark("weather", store.get_weather() is not None)
        mark("hardware", store.get_hw() is not None)
        dash = store.dashboard(period="all", view="overall")
        mark("dashboard", isinstance(dash, dict) and "kpis" in dash)
        admin = next(u for u in users if u.get("role") == "admin")
        reps = store.reports(
            user={
                "role": "admin",
                "id": admin["id"],
                "projects": None,
                "display_name": admin.get("display_name"),
            }
        )
        mark("reports", reps is not None)
        tok = store.login("admin", "admin")
        mark(
            "auth_session",
            bool(tok.get("access_token"))
            and store.user_from_token(tok["access_token"]) is not None,
        )
    except Exception as exc:
        mark("support_auth", False, f"{type(exc).__name__}:{exc}")

    report["steps"]["modules"] = {"details": details, "pass": module_ok}
    if not module_ok:
        report["ok"] = False

    def once(i: int) -> str:
        try:
            store.create_itqan(_itqan(store, "P5B-RACE", f"Op{i}"))
            return "ok"
        except ValueError:
            return "dup"
        except Exception as exc:
            return type(exc).__name__

    with ThreadPoolExecutor(max_workers=8) as pool:
        race = list(pool.map(once, range(8)))
    report["steps"]["itqan_concurrent_app"] = {
        "results": race,
        "pass": race.count("ok") == 1,
    }
    if race.count("ok") != 1:
        report["ok"] = False

    db_unique = _db_level_unique(url)
    report["steps"]["itqan_db_unique"] = db_unique
    if not db_unique.get("pass"):
        report["ok"] = False

    print(json.dumps(report, indent=2, default=str))
    return 0 if report["ok"] else 1


def _itqan(store, ref: str, reported_by: str = "Op") -> ItqanCreate:
    from app.schemas.scc import ItqanCreate

    project = store.catalog.get("project")[0]
    return ItqanCreate(
        assign_to="project",
        project_id=project["id"],
        driver_name="D",
        driver_badge_number="1",
        vehicle_type_id=store.catalog.get("vehicle_type")[0]["id"],
        violation_type_id=store.catalog.get("itqan_violation_type")[0]["id"],
        itqan_ref=ref,
        itqan_status_id=store.catalog.get("itqan_status")[0]["id"],
        occurred_on=date.today(),
        occurred_time=time(12, 0),
        reported_by=reported_by,
    )


def _db_level_unique(url: str) -> dict:
    from sqlalchemy import text
    from app.db.engine import make_engine

    eng = make_engine(url)
    ref = f"P5B-DB-{uuid4().hex[:8]}"
    sql = text(
        """
        INSERT INTO cases (
          id, case_id, record_type, status, project, department, title,
          occurred_on, week_year, week_number, created_at, is_deleted, fields
        ) VALUES (
          :id, :case_id, 'itqan', 'open', 'P', 'D', 't',
          CURRENT_DATE, 2026, 1, NOW(), FALSE, CAST(:fields AS jsonb)
        )
        """
    )
    with eng.begin() as c1:
        c1.execute(
            sql,
            {
                "id": str(uuid4()),
                "case_id": f"C-{uuid4().hex[:8]}",
                "fields": json.dumps({"itqan_ref": ref}),
            },
        )
    try:
        with eng.begin() as c2:
            c2.execute(
                sql,
                {
                    "id": str(uuid4()),
                    "case_id": f"C-{uuid4().hex[:8]}",
                    "fields": json.dumps({"itqan_ref": ref}),
                },
            )
        return {"pass": False, "second_blocked": False}
    except Exception as exc:
        blocked = "unique" in str(exc).lower() or "UniqueViolation" in type(exc).__name__
        return {
            "pass": blocked,
            "second_blocked": blocked,
            "error_type": type(exc).__name__,
        }


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception:
        traceback.print_exc()
        raise SystemExit(1)
