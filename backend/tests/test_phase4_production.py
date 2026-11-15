"""Phase 4: production readiness (isolated SQLite only — no ops/Postgres writes)."""

from __future__ import annotations

import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("DATABASE_URL", "sqlite+pysqlite:///:memory:")

from app.core.config import Settings, get_settings
from app.db.base import Base
from app.db.engine import make_engine, sqlite_file_url
from app.db import models  # noqa: F401
from app.main import create_app
from app.services.platform_store import PlatformStore
from app.services.rate_limit import SlidingWindowLimiter
from app.services.uploads import UPLOAD_DIR, ensure_upload_dir


def _patch_store(monkeypatch: pytest.MonkeyPatch, store: PlatformStore) -> None:
    import importlib

    for mod_name in (
        "app.api.deps",
        "app.api.v1.auth",
        "app.api.v1.dashboard",
        "app.api.v1.health",
        "app.api.v1.media",
        "app.api.v1.records",
        "app.api.v1.scc",
        "app.api.v1.uploads",
        "app.services.platform_store",
    ):
        mod = importlib.import_module(mod_name)
        if hasattr(mod, "platform_store"):
            monkeypatch.setattr(mod, "platform_store", store)


@pytest.fixture()
def isolated_client(tmp_path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    store = PlatformStore(database_url=sqlite_file_url(tmp_path / "phase4.db"))
    _patch_store(monkeypatch, store)
    get_settings.cache_clear()
    with TestClient(create_app()) as client:
        yield client
    get_settings.cache_clear()


def test_metadata_tables_match_models() -> None:
    expected = {
        "list_items",
        "cases",
        "contacts",
        "users",
        "sessions",
        "app_state",
        "audit_events",
        "weather_hourly_readings",
        "asset_classifications",
        "weather_weekly_logs",
    }
    assert set(Base.metadata.tables.keys()) == expected


def test_sqlite_create_all_isolated(tmp_path) -> None:
    url = sqlite_file_url(tmp_path / "schema.db")
    engine = make_engine(url)
    Base.metadata.create_all(engine)
    from sqlalchemy import inspect

    assert set(inspect(engine).get_table_names()) == set(Base.metadata.tables.keys())


def test_migration_sql_files_present() -> None:
    root = Path(__file__).resolve().parents[1] / "migrations"
    assert (root / "001_postgresql_baseline.sql").is_file()
    assert (root / "002_itqan_ref_unique.sql").is_file()
    assert (root / "003_foreign_keys.sql").is_file()
    baseline = (root / "001_postgresql_baseline.sql").read_text(encoding="utf-8")
    for table in Base.metadata.tables.keys():
        assert f"CREATE TABLE IF NOT EXISTS {table}" in baseline


def test_ready_endpoint(isolated_client: TestClient) -> None:
    res = isolated_client.get("/api/v1/ready")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["database"] == "ok"
    assert body["uploads_writable"] is True


def test_security_headers(isolated_client: TestClient) -> None:
    res = isolated_client.get("/api/v1/health")
    assert res.headers.get("X-Content-Type-Options") == "nosniff"
    assert res.headers.get("X-Frame-Options") == "DENY"
    assert res.headers.get("Referrer-Policy") == "same-origin"


def test_production_disables_demo_seeds_and_legacy_token() -> None:
    s = Settings(app_env="production", cors_origins="https://example.replit.app")
    assert s.demo_cases_enabled is False
    assert s.demo_users_enabled is False
    assert s.legacy_upload_access_token_allowed is False
    assert s.is_production is True


def test_production_cors_rejects_wildcard() -> None:
    with pytest.raises(ValueError, match="CORS_ORIGINS"):
        _ = Settings(app_env="production", cors_origins="*").cors_origin_list


def test_legacy_access_token_rejected_when_disabled(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = PlatformStore(database_url=sqlite_file_url(tmp_path / "legacy.db"))
    _patch_store(monkeypatch, store)
    monkeypatch.setattr(
        "app.api.v1.media.get_settings",
        lambda: Settings(
            app_env="production",
            cors_origins="https://example.replit.app",
            allow_legacy_upload_access_token=False,
        ),
    )
    with TestClient(create_app()) as client:
        login = client.post(
            "/api/v1/auth/login", json={"username": "admin", "password": "admin"}
        )
        assert login.status_code == 200
        token = login.json()["access_token"]
        media = login.json().get("media_token")
        ensure_upload_dir()
        name = "phase4_legacy.bin"
        (UPLOAD_DIR / name).write_bytes(b"x")
        assert client.get(f"/uploads/{name}?access_token={token}").status_code == 401
        if media:
            assert client.get(f"/uploads/{name}?media_token={media}").status_code == 200
        bearer = client.get(
            f"/uploads/{name}", headers={"Authorization": f"Bearer {token}"}
        )
        assert bearer.status_code == 200
        # Fresh media token via API session (SPA boot / expired media_token recovery).
        refreshed = client.post(
            "/api/v1/auth/media-token",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert refreshed.status_code == 200
        new_media = refreshed.json()["media_token"]
        assert new_media
        assert new_media != media
        assert (
            client.get(f"/uploads/{name}?media_token={new_media}").status_code == 200
        )


def test_auth_rate_limiter_trips() -> None:
    limiter = SlidingWindowLimiter(3, 60.0)
    for _ in range(3):
        limiter.check("phase4-key")
    with pytest.raises(Exception) as exc:
        limiter.check("phase4-key")
    assert getattr(exc.value, "status_code", None) == 429


def test_spa_static_serving(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<html>spa</html>", encoding="utf-8")
    (dist / "assets" / "app.js").write_text("console.log(1)", encoding="utf-8")
    monkeypatch.setenv("FRONTEND_DIST", str(dist))
    get_settings.cache_clear()
    with TestClient(create_app()) as client:
        assert client.get("/").status_code == 200
        assert "spa" in client.get("/").text
        assert client.get("/assets/app.js").status_code == 200
        assert "spa" in client.get("/dashboard").text
        assert client.get("/api/v1/health").status_code == 200
    get_settings.cache_clear()


def test_verify_pg_schema_requires_postgres_url(monkeypatch: pytest.MonkeyPatch) -> None:
    import importlib.util

    script = Path(__file__).resolve().parents[1] / "scripts" / "verify_pg_schema.py"
    spec = importlib.util.spec_from_file_location("verify_pg_schema", script)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    spec.loader.exec_module(mod)
    assert mod.main() == 2
