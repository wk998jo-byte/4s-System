"""Production seed isolation: no synthetic HW / KP / transfer fixtures on boot.

Uses disposable SQLite only — never ops or Replit production databases.
"""

from __future__ import annotations

import importlib
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.db.engine import sqlite_file_url
from app.db.models import UserRow
from app.main import create_app
from app.services.auth import hash_password
from app.services.platform_store import PlatformStore


def _patch_store(monkeypatch: pytest.MonkeyPatch, store: PlatformStore) -> None:
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


def _kp_names(packs: dict) -> set[str]:
    names: set[str] = set()
    for pack in packs.values():
        if not isinstance(pack, dict):
            continue
        for group in pack.get("groups") or []:
            if not isinstance(group, dict):
                continue
            for row in group.get("rows") or []:
                if isinstance(row, dict) and row.get("name"):
                    names.add(str(row["name"]))
    return names


DEMO_KP_MARKERS = {
    "Jason Michael",
    "Zaid Nawwaf AlEitan",
    "Enjamamul Haque",
    "Sirajul Islam",
}


@pytest.fixture()
def production_store(tmp_path, monkeypatch: pytest.MonkeyPatch) -> PlatformStore:
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("CORS_ORIGINS", "https://example.replit.app")
    monkeypatch.setenv("SEED_DEMO_CASES", "false")
    monkeypatch.setenv("SEED_DEMO_USERS", "false")
    monkeypatch.setenv("SEED_DEMO_FIXTURES", "false")
    monkeypatch.delenv("DATABASE_URL", raising=False)
    get_settings.cache_clear()
    store = PlatformStore(database_url=sqlite_file_url(tmp_path / "prod_seed.db"))
    yield store
    get_settings.cache_clear()


@pytest.fixture()
def development_store(tmp_path, monkeypatch: pytest.MonkeyPatch) -> PlatformStore:
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.delenv("SEED_DEMO_FIXTURES", raising=False)
    monkeypatch.delenv("SEED_DEMO_CASES", raising=False)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    get_settings.cache_clear()
    store = PlatformStore(database_url=sqlite_file_url(tmp_path / "dev_seed.db"))
    yield store
    get_settings.cache_clear()


def test_production_boot_has_empty_hw_and_no_demo_kp(
    production_store: PlatformStore,
) -> None:
    hw = production_store.get_hw()
    assert int(hw.get("all_projects") or 0) == 0
    dept = hw.get("department_counts") or {}
    assert sum(sum(int(n or 0) for n in c.values()) for c in dept.values()) == 0

    packs = production_store.get_key_personnel()
    assert set(packs.keys()) >= {"Jafurah", "MGS", "Yanbu", "Ras Tanura", "Dhahran"}
    assert DEMO_KP_MARKERS.isdisjoint(_kp_names(packs))

    transfers = production_store.get_hw_transfers()
    assert transfers.get("items") == []
    assert transfers.get("register") == []


def test_production_restart_does_not_repopulate_cleared_hw(
    production_store: PlatformStore, tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    url = sqlite_file_url(tmp_path / "prod_seed.db")
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("CORS_ORIGINS", "https://example.replit.app")
    monkeypatch.setenv("SEED_DEMO_FIXTURES", "false")
    get_settings.cache_clear()
    again = PlatformStore(database_url=url)
    assert int(again.get_hw().get("all_projects") or 0) == 0
    assert again.get_hw_transfers().get("items") == []
    get_settings.cache_clear()


def test_development_still_seeds_hw_and_named_kp(
    development_store: PlatformStore,
) -> None:
    hw = development_store.get_hw()
    assert int(hw.get("all_projects") or 0) > 100
    packs = development_store.get_key_personnel()
    assert "Jason Michael" in _kp_names(packs)
    transfers = development_store.get_hw_transfers()
    assert any(i.get("id") == "TRF-0007" for i in (transfers.get("items") or []))


def test_production_preserves_existing_hw_counts(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("APP_ENV", "development")
    get_settings.cache_clear()
    url = sqlite_file_url(tmp_path / "preserve.db")
    first = PlatformStore(database_url=url)
    before = int(first.get_hw().get("all_projects") or 0)
    assert before > 0

    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("CORS_ORIGINS", "https://example.replit.app")
    monkeypatch.setenv("SEED_DEMO_FIXTURES", "false")
    get_settings.cache_clear()
    second = PlatformStore(database_url=url)
    assert int(second.get_hw().get("all_projects") or 0) == before
    get_settings.cache_clear()


def test_production_catalogs_and_empty_modules(production_store: PlatformStore) -> None:
    """Empty operational modules stay usable (store-level; no prod DB URL required)."""
    depts = production_store.catalog.get("department")
    assert len(depts) >= 1
    projects = production_store.catalog.get("project")
    assert len(projects) >= 1
    assert production_store.asset_meta()["count"] >= 0

    hw = production_store.get_hw()
    assert int(hw.get("all_projects") or 0) == 0
    assert production_store.get_hw_transfers()["items"] == []
    assert production_store.get_key_personnel()
    assert isinstance(production_store.list_weather_weekly_logs(), list)
    reports = production_store.reports(user={"role": "admin", "username": "admin"})
    assert isinstance(reports, dict)
    overview = production_store.dashboard(view="overall")
    assert isinstance(overview, dict)


def test_sos_direct_close_still_works_without_admin(
    development_store: PlatformStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Regression: Operator closes SOS without Admin approve."""
    _patch_store(monkeypatch, development_store)
    with TestClient(create_app()) as client:
        op = {
            "Authorization": (
                "Bearer "
                + client.post(
                    "/api/v1/auth/login",
                    json={"username": "operator", "password": "operator"},
                ).json()["access_token"]
            )
        }
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


def test_demo_fixtures_settings_defaults() -> None:
    get_settings.cache_clear()
    prod = get_settings.__wrapped__ if False else None  # placate linters
    del prod
    from app.core.config import Settings

    assert Settings(app_env="production").demo_fixtures_enabled is False
    assert Settings(app_env="development").demo_fixtures_enabled is True
    assert (
        Settings(app_env="production", seed_demo_fixtures=True).demo_fixtures_enabled
        is True
    )
    get_settings.cache_clear()
