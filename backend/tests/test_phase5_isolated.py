"""Phase 5 isolated acceptance tests (synthetic DBs/uploads only)."""

from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("DATABASE_URL", "sqlite+pysqlite:///:memory:")

from app.core.config import get_settings
from app.db.base import Base
from app.db.engine import sqlite_file_url
from app.db import models  # noqa: F401
from app.main import create_app
from app.schemas.scc import ItqanCreate
from app.services.platform_store import PlatformStore
from app.services.uploads import ensure_upload_dir
from tests.conftest import auth_header


OPS_DB = Path(__file__).resolve().parents[1] / "data" / "scc_platform.db"


def _patch_store(monkeypatch: pytest.MonkeyPatch, store: PlatformStore) -> None:
    import importlib

    for name in (
        "app.api.deps",
        "app.api.v1.auth",
        "app.api.v1.health",
        "app.api.v1.media",
        "app.api.v1.records",
        "app.api.v1.scc",
        "app.api.v1.uploads",
        "app.services.platform_store",
    ):
        mod = importlib.import_module(name)
        if hasattr(mod, "platform_store"):
            monkeypatch.setattr(mod, "platform_store", store)


def _itqan_payload(store: PlatformStore, ref: str, reported_by: str = "Op") -> ItqanCreate:
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


def test_ops_db_path_guardrail() -> None:
    assert OPS_DB.name == "scc_platform.db"
    assert "scc_platform.db" not in os.environ.get("DATABASE_URL", "")


def test_postgresql_runtime_unavailable_is_explicit() -> None:
    import importlib.util

    script = Path(__file__).resolve().parents[1] / "scripts" / "verify_pg_schema.py"
    spec = importlib.util.spec_from_file_location("verify_pg_schema_p5", script)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    old = os.environ.pop("DATABASE_URL", None)
    try:
        spec.loader.exec_module(mod)
        assert mod.main() == 2
    finally:
        os.environ["DATABASE_URL"] = old or "sqlite+pysqlite:///:memory:"


def test_migration_sql_covers_all_models() -> None:
    root = Path(__file__).resolve().parents[1] / "migrations"
    baseline = (root / "001_postgresql_baseline.sql").read_text(encoding="utf-8")
    for table in Base.metadata.tables:
        assert f"CREATE TABLE IF NOT EXISTS {table}" in baseline
    assert "uq_cases_itqan_ref_active" in (
        root / "002_itqan_ref_unique.sql"
    ).read_text(encoding="utf-8")


def test_itqan_app_level_uniqueness_sequential(tmp_path) -> None:
    store = PlatformStore(database_url=sqlite_file_url(tmp_path / "itqan_seq.db"))
    payload = _itqan_payload(store, "ITQAN-P5-001")
    store.create_itqan(payload)
    with pytest.raises(ValueError, match="already in use"):
        store.create_itqan(payload)


def test_itqan_app_level_uniqueness_concurrent_threads(tmp_path) -> None:
    store = PlatformStore(database_url=sqlite_file_url(tmp_path / "itqan_conc.db"))

    def once(i: int) -> str:
        try:
            store.create_itqan(_itqan_payload(store, "ITQAN-P5-CONC", reported_by=f"Op{i}"))
            return "ok"
        except ValueError:
            return "dup"

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(once, range(8)))
    assert results.count("ok") == 1
    assert results.count("dup") == 7


def test_sos_direct_close_without_admin(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = PlatformStore(database_url=sqlite_file_url(tmp_path / "sos.db"))
    _patch_store(monkeypatch, store)
    get_settings.cache_clear()
    with TestClient(create_app()) as client:
        op = auth_header(client, "operator")
        ad = auth_header(client, "admin")
        projects = client.get("/api/v1/lists/project", headers=op).json()["items"]
        sources = client.get("/api/v1/lists/sos_source", headers=op).json()["items"]
        now = datetime.now(timezone.utc)
        created = client.post(
            "/api/v1/sos-alerts",
            headers=op,
            json={
                "project_id": projects[0]["id"],
                "worker_name_badge": "1 - Worker",
                "sos_created_at": (now - timedelta(minutes=2)).isoformat(),
                "seen_at": now.isoformat(),
                "location": "Pad",
                "source_id": sources[0]["id"],
            },
        )
        assert created.status_code == 201, created.text
        sos_id = created.json()["id"]
        approve = client.post(f"/api/v1/cases/{sos_id}/approve", headers=ad)
        assert approve.status_code >= 400
        closed = client.post(
            f"/api/v1/sos-alerts/{sos_id}/close",
            headers=op,
            json={
                "alarm": "False Alarm",
                "picture_shared_by": "Sup",
                "closed_at": datetime.now(timezone.utc).isoformat(),
                "close_out_report": "OK",
            },
        )
        assert closed.status_code == 200, closed.text
        assert closed.json()["status"] == "closed"
    get_settings.cache_clear()


def test_durable_local_upload_dir_survives_restart(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    upload_root = tmp_path / "durable_uploads"
    monkeypatch.setenv("UPLOAD_DIR", str(upload_root))
    get_settings.cache_clear()
    store = PlatformStore(database_url=sqlite_file_url(tmp_path / "media1.db"))
    _patch_store(monkeypatch, store)
    ensure_upload_dir()
    stored = ""
    with TestClient(create_app()) as client:
        login = client.post(
            "/api/v1/auth/login", json={"username": "admin", "password": "admin"}
        )
        assert login.status_code == 200
        token = login.json()["access_token"]
        media = login.json().get("media_token")
        headers = {"Authorization": f"Bearer {token}"}
        files = {"file": ("p5.png", b"\x89PNG\r\n\x1a\n" + b"0" * 64, "image/png")}
        up = client.post("/api/v1/uploads", headers=headers, files=files)
        assert up.status_code in (200, 201), up.text
        body = up.json()
        stored = body.get("stored_name") or Path(str(body.get("url") or "")).name
        assert stored
        path = upload_root / stored
        assert path.is_file()
        assert client.get(f"/uploads/{stored}").status_code == 401
        if media:
            assert client.get(f"/uploads/{stored}?media_token={media}").status_code == 200
        assert client.get(f"/uploads/{stored}", headers=headers).status_code == 200

    # Restart simulation: new process-equivalent store/app, same durable dir
    store2 = PlatformStore(database_url=sqlite_file_url(tmp_path / "media2.db"))
    _patch_store(monkeypatch, store2)
    ensure_upload_dir()
    assert (upload_root / stored).is_file()
    with TestClient(create_app()) as client2:
        login2 = client2.post(
            "/api/v1/auth/login", json={"username": "admin", "password": "admin"}
        )
        assert login2.status_code == 200
        h2 = {"Authorization": f"Bearer {login2.json()['access_token']}"}
        # Orphan file on new DB: ACL may deny non-owners; admin may be allowed.
        assert client2.get(f"/uploads/{stored}", headers=h2).status_code in (200, 403)
    get_settings.cache_clear()


def test_backup_restore_drill_script() -> None:
    import importlib.util

    script = Path(__file__).resolve().parents[1] / "scripts" / "phase5_backup_restore_drill.py"
    spec = importlib.util.spec_from_file_location("phase5_backup", script)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    assert mod.main() == 0


def test_etl_script_requires_postgres() -> None:
    import importlib.util

    script = Path(__file__).resolve().parents[1] / "scripts" / "etl_sqlite_to_pg.py"
    spec = importlib.util.spec_from_file_location("etl_p5", script)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    os.environ.pop("SOURCE_SQLITE_URL", None)
    os.environ["DATABASE_URL"] = "sqlite+pysqlite:///:memory:"
    try:
        spec.loader.exec_module(mod)
        assert mod.main() == 2
    finally:
        os.environ["DATABASE_URL"] = "sqlite+pysqlite:///:memory:"
