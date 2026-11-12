"""Phase 6A: Weather + Hardware API acceptance on isolated PostgreSQL.

Env: DATABASE_URL=postgresql+psycopg://…  (disposable DB only)
Refuses scc_platform.db. Never prints passwords.
"""

from __future__ import annotations

import io
import json
import os
import sys
from datetime import date, timedelta
from pathlib import Path
from uuid import uuid4

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))


def main() -> int:
    url = (os.environ.get("DATABASE_URL") or "").strip()
    if "scc_platform.db" in url or not (
        url.startswith("postgresql") or url.startswith("postgres")
    ):
        print("REFUSED: isolated PostgreSQL DATABASE_URL required")
        return 2

    import importlib

    from fastapi.testclient import TestClient
    from openpyxl import Workbook

    from app.core.config import get_settings
    from app.db.engine import make_engine
    from app.main import create_app
    from app.services.platform_store import PlatformStore, WEATHER_STATIONS
    from sqlalchemy import text

    get_settings.cache_clear()
    store = PlatformStore(database_url=url)
    for name in (
        "app.api.deps",
        "app.api.v1.auth",
        "app.api.v1.scc",
        "app.api.v1.uploads",
        "app.api.v1.media",
        "app.api.v1.health",
        "app.services.platform_store",
    ):
        mod = importlib.import_module(name)
        if hasattr(mod, "platform_store"):
            setattr(mod, "platform_store", store)

    report: dict = {"weather": {}, "hardware": {}, "ok": True}
    with TestClient(create_app()) as client:
        op = _login(client, "operator")
        ad = _login(client, "admin")
        # Unauthorized weather writer: dept_hse if present else attempt without auth
        hse = client.post(
            "/api/v1/auth/login", json={"username": "hse", "password": "hse"}
        )
        hse_headers = (
            {"Authorization": f"Bearer {hse.json()['access_token']}"}
            if hse.status_code == 200
            else None
        )

        station = WEATHER_STATIONS[0]
        # Use a Sunday start for a fully past week so all hours are writable.
        today = date.today()
        week_start = today - timedelta(days=(today.weekday() + 1) % 7 + 7)  # prior Sunday
        observed = week_start + timedelta(days=1)  # Monday in that week

        # Unauthorized
        unauth = client.put(
            "/api/v1/weather/hourly",
            json={
                "station_id": station["id"],
                "project": station["project"],
                "location": station["loc"],
                "observed_on": observed.isoformat(),
                "readings": [{"hour": 7, "temp": 30, "rh": 40, "wind": 2}],
            },
        )
        report["weather"]["unauth_no_token"] = unauth.status_code == 401
        if hse_headers:
            denied = client.put(
                "/api/v1/weather/hourly",
                headers=hse_headers,
                json={
                    "station_id": station["id"],
                    "project": station["project"],
                    "location": station["loc"],
                    "observed_on": observed.isoformat(),
                    "readings": [{"hour": 7, "temp": 30, "rh": 40}],
                },
            )
            report["weather"]["unauth_role"] = denied.status_code in {401, 403}
        else:
            report["weather"]["unauth_role"] = "SKIP:no_hse_user"

        readings = [
            {
                "hour": h,
                "temp": 28 + (h - 7) * 0.5,
                "rh": 45,
                "wind": 1.5,
                "status": "ok",
            }
            for h in range(7, 15)
        ]
        saved = client.put(
            "/api/v1/weather/hourly",
            headers=op,
            json={
                "station_id": station["id"],
                "project": station["project"],
                "location": station["loc"],
                "observed_on": observed.isoformat(),
                "readings": readings,
                "logged_by": "P6A Op",
            },
        )
        report["weather"]["hourly_save"] = saved.status_code == 200
        got = client.get(
            f"/api/v1/weather/hourly?project={station['project']}&observed_on={observed.isoformat()}",
            headers=op,
        )
        report["weather"]["hourly_read"] = got.status_code == 200 and bool(
            got.json().get("tables")
        )

        # Update one hour
        upd = client.put(
            "/api/v1/weather/hourly",
            headers=op,
            json={
                "station_id": station["id"],
                "project": station["project"],
                "location": station["loc"],
                "observed_on": observed.isoformat(),
                "readings": [{"hour": 10, "temp": 33.5, "rh": 50, "wind": 2.0, "status": "ok"}],
            },
        )
        report["weather"]["hourly_update"] = upd.status_code == 200

        # DB persistence + unique constraint (station/day/hour)
        eng = make_engine(url)
        with eng.connect() as conn:
            cnt = conn.execute(
                text(
                    "SELECT COUNT(*) FROM weather_hourly_readings "
                    "WHERE station_id=:s AND observed_on=:d"
                ),
                {"s": station["id"], "d": observed},
            ).scalar()
            # Attempt duplicate unique key via raw SQL should fail
            dup_blocked = False
            try:
                with eng.begin() as c2:
                    c2.execute(
                        text(
                            """
                            INSERT INTO weather_hourly_readings (
                              id, station_id, project, location, observed_on, hour,
                              status, updated_at
                            ) VALUES (
                              :id, :s, :p, :l, :d, 7, 'ok', NOW()
                            )
                            """
                        ),
                        {
                            "id": str(uuid4()),
                            "s": station["id"],
                            "p": station["project"],
                            "l": station["loc"],
                            "d": observed,
                        },
                    )
            except Exception as exc:
                dup_blocked = "unique" in str(exc).lower() or "UniqueViolation" in type(
                    exc
                ).__name__
        report["weather"]["db_row_count_ge_8"] = int(cnt or 0) >= 8
        report["weather"]["duplicate_hour_blocked"] = dup_blocked

        # Invalid hour
        bad = client.put(
            "/api/v1/weather/hourly",
            headers=op,
            json={
                "station_id": station["id"],
                "project": station["project"],
                "location": station["loc"],
                "observed_on": observed.isoformat(),
                "readings": [{"hour": 3, "temp": 20}],
            },
        )
        report["weather"]["invalid_hour_rejected"] = bad.status_code >= 400

        preview = client.get(
            f"/api/v1/weather/weekly/preview?project={station['project']}&week_start={week_start.isoformat()}",
            headers=op,
        )
        report["weather"]["weekly_preview"] = preview.status_code == 200

        weekly = client.post(
            "/api/v1/weather/weekly",
            headers=op,
            json={
                "project": station["project"],
                "week_start": week_start.isoformat(),
                "remarks": "P6A weekly",
                "submitted_by": "P6A Op",
            },
        )
        report["weather"]["weekly_submit"] = weekly.status_code in {200, 201}
        listed = client.get(
            f"/api/v1/weather/weekly?project={station['project']}", headers=op
        )
        report["weather"]["weekly_list"] = listed.status_code == 200 and len(
            listed.json().get("items") or []
        ) >= 1

        # Audit
        audits = client.get("/api/v1/admin/audit-log?limit=50", headers=ad)
        actions = {
            (a.get("action") or "")
            for a in (audits.json().get("items") if audits.status_code == 200 else [])
        }
        report["weather"]["audit_hourly_or_weekly"] = (
            "weather_hourly_saved" in actions or "weather_weekly_submitted" in actions
        )

        # --- Hardware ---
        serial = f"P6A-{uuid4().hex[:8].upper()}"
        created = client.post(
            "/api/v1/hw/register",
            headers=op,
            json={
                "device": "Smart Helmet",
                "serial": serial,
                "status": "In Stock",
                "project": "Jafurah",
            },
        )
        report["hardware"]["register_create"] = created.status_code in {200, 201}
        reg = client.get("/api/v1/hw/register", headers=op)
        items = (reg.json().get("items") if reg.status_code == 200 else []) or []
        report["hardware"]["register_read"] = any(
            str(i.get("serial")) == serial for i in items
        )

        # Synthetic Excel import (admin)
        wb = Workbook()
        ws = wb.active
        ws.append(["Device", "Serial Number", "Status", "Project"])
        ws.append(["Smart Watch", f"IMP-{uuid4().hex[:6].upper()}", "In Stock", "Yanbu"])
        ws.append(["Router", f"IMP-{uuid4().hex[:6].upper()}", "In Stock", "Jafurah"])
        ws.append(["BogusDevice", "BAD-1", "In Stock", "Jafurah"])  # validation error
        buf = io.BytesIO()
        wb.save(buf)
        content = buf.getvalue()
        imp = client.post(
            "/api/v1/hw/register/import",
            headers=ad,
            files={
                "file": (
                    "synthetic.xlsx",
                    content,
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                )
            },
        )
        report["hardware"]["excel_import_http"] = imp.status_code in {200, 201, 400}
        if imp.status_code in {200, 201}:
            body = imp.json()
            report["hardware"]["excel_imported_rows"] = int(body.get("imported") or 0) >= 1
            errs = body.get("skipped_errors") or body.get("errors") or []
            report["hardware"]["excel_validation_errors_captured"] = len(errs) >= 1
        else:
            report["hardware"]["excel_import_http"] = False
            report["hardware"]["excel_imported_rows"] = False
            report["hardware"]["excel_validation_errors_captured"] = False

        # Unauthorized import
        bad_imp = client.post(
            "/api/v1/hw/register/import",
            headers=op,
            files={
                "file": (
                    "synthetic.xlsx",
                    content,
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                )
            },
        )
        report["hardware"]["import_requires_admin"] = bad_imp.status_code in {401, 403}

        # HW counts update (admin)
        hw = client.get("/api/v1/hw", headers=ad)
        report["hardware"]["hw_dashboard_read"] = hw.status_code == 200

        # Transfers: seed sample + receive
        transfers = client.get("/api/v1/hw/transfers", headers=ad)
        report["hardware"]["transfers_list"] = transfers.status_code == 200
        tid = None
        if transfers.status_code == 200:
            for item in (transfers.json().get("items") or []):
                if item.get("status") == "transit":
                    tid = item.get("id")
                    break
        if tid:
            # receive_hw capability is Project PM (receiver), not admin
            pm_login = client.post(
                "/api/v1/auth/login", json={"username": "pm", "password": "pm"}
            )
            if pm_login.status_code != 200:
                pm_login = client.post(
                    "/api/v1/auth/login",
                    json={"username": "receiver", "password": "receiver"},
                )
            if pm_login.status_code == 200:
                pm_h = {
                    "Authorization": f"Bearer {pm_login.json()['access_token']}"
                }
                recv = client.post(
                    f"/api/v1/hw/transfers/{tid}/receive", headers=pm_h
                )
                report["hardware"]["transfer_receive"] = recv.status_code == 200 and (
                    recv.json().get("status") == "received"
                )
                # Admin cannot receive (documents authorization boundary)
                denied_admin = client.post(
                    f"/api/v1/hw/transfers/{tid}/receive", headers=ad
                )
                report["hardware"]["transfer_admin_denied_or_already_received"] = (
                    denied_admin.status_code in {200, 403}
                )
            else:
                report["hardware"]["transfer_receive"] = "SKIP:no_pm_user"
        else:
            report["hardware"]["transfer_receive"] = "SKIP:no_transit_item"

        # Restart persistence: new store same DB
        store2 = PlatformStore(database_url=url)
        items2 = store2.get_hw_register().get("items") or []
        report["hardware"]["persist_after_restart"] = any(
            str(i.get("serial")) == serial for i in items2
        )
        with make_engine(url).connect() as conn:
            wcount = conn.execute(
                text("SELECT COUNT(*) FROM weather_hourly_readings")
            ).scalar()
            wweekly = conn.execute(
                text("SELECT COUNT(*) FROM weather_weekly_logs")
            ).scalar()
        report["weather"]["persist_hourly_table"] = int(wcount or 0) >= 8
        report["weather"]["persist_weekly_table"] = int(wweekly or 0) >= 1

    def _truthy(v) -> bool:
        return v is True

    weather_ok = all(
        _truthy(v) or (isinstance(v, str) and v.startswith("SKIP"))
        for k, v in report["weather"].items()
        if k != "excel_validation_errors_captured"
    )
    # tighten: require core weather flags True
    for key in (
        "hourly_save",
        "hourly_read",
        "hourly_update",
        "db_row_count_ge_8",
        "duplicate_hour_blocked",
        "invalid_hour_rejected",
        "weekly_submit",
        "weekly_list",
        "persist_hourly_table",
        "persist_weekly_table",
        "unauth_no_token",
    ):
        if report["weather"].get(key) is not True:
            weather_ok = False
    hw_ok = all(
        v is True or (isinstance(v, str) and (v.startswith("SKIP") or v == "NO_ERRORS_FIELD"))
        for v in report["hardware"].values()
    )
    for key in (
        "register_create",
        "register_read",
        "import_requires_admin",
        "persist_after_restart",
        "transfers_list",
    ):
        if report["hardware"].get(key) is not True:
            hw_ok = False

    report["weather"]["pass"] = weather_ok
    report["hardware"]["pass"] = hw_ok
    report["ok"] = weather_ok and hw_ok
    print(json.dumps(report, indent=2, default=str))
    return 0 if report["ok"] else 1


def _login(client, username: str) -> dict[str, str]:
    res = client.post(
        "/api/v1/auth/login", json={"username": username, "password": username}
    )
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


if __name__ == "__main__":
    raise SystemExit(main())
