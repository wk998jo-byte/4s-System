"""Phase 3A — P0 security & data integrity (isolated DB only)."""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

# Force isolated in-memory DB before app imports (conftest also sets this).
os.environ.setdefault("DATABASE_URL", "sqlite+pysqlite:///:memory:")

from app.core.config import get_settings
from app.db.engine import sqlite_file_url
from app.db.models import SessionRow
from app.main import create_app
from app.services.auth import validate_password_strength
from app.services.platform_store import PlatformStore
from app.services.uploads import UPLOAD_DIR, ensure_upload_dir
from tests.conftest import auth_header


@pytest.fixture()
def client() -> TestClient:
    return TestClient(create_app())


def test_production_fresh_db_has_no_demo_cases(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("SEED_DEMO_CASES", "false")
    monkeypatch.setenv("SEED_DEMO_USERS", "false")
    monkeypatch.setenv("BOOTSTRAP_ADMIN_USERNAME", "bootstrap_admin")
    monkeypatch.setenv("BOOTSTRAP_ADMIN_PASSWORD", "Bootstrap1Safe")
    monkeypatch.setenv("CORS_ORIGINS", "https://app.example.com")
    get_settings.cache_clear()
    db = tmp_path / "prod_fresh.db"
    store = PlatformStore(database_url=sqlite_file_url(db))
    cases = store.list_cases()
    assert cases == [], f"expected no demo cases, got {len(cases)}"
    users = store.list_users()
    assert len(users) == 1
    assert users[0]["username"] == "bootstrap_admin"
    assert users[0]["role"] == "admin"
    # Weak defaults must not exist
    assert {u["username"] for u in users}.isdisjoint({"admin", "operator", "hse", "pm"})
    get_settings.cache_clear()


def test_dev_still_seeds_demo_when_enabled(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.delenv("SEED_DEMO_CASES", raising=False)
    monkeypatch.delenv("SEED_DEMO_USERS", raising=False)
    get_settings.cache_clear()
    db = tmp_path / "dev_fresh.db"
    store = PlatformStore(database_url=sqlite_file_url(db))
    assert len(store.list_cases()) > 0
    names = {u["username"] for u in store.list_users()}
    assert "admin" in names and "operator" in names
    get_settings.cache_clear()


def test_legacy_records_require_auth(client: TestClient) -> None:
    anon = client.get("/api/v1/records")
    assert anon.status_code == 401
    anon_post = client.post(
        "/api/v1/records",
        json={"title": "x", "module_type": "other", "status": "open"},
    )
    assert anon_post.status_code == 401

    op = auth_header(client, "operator")
    listed = client.get("/api/v1/records", headers=op)
    assert listed.status_code == 200
    created = client.post(
        "/api/v1/records",
        headers=op,
        json={"title": "op record", "module_type": "other", "status": "open"},
    )
    assert created.status_code == 201

    ad = auth_header(client, "admin")
    assert client.get("/api/v1/records", headers=ad).status_code == 200
    assert client.get("/api/v1/dashboard/summary", headers=ad).status_code == 200
    assert client.get("/api/v1/dashboard/summary").status_code == 401


def test_session_expiry_and_logout(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SESSION_TTL_MINUTES", "30")
    get_settings.cache_clear()
    # Login via API
    login = client.post(
        "/api/v1/auth/login", json={"username": "operator", "password": "operator"}
    )
    assert login.status_code == 200
    token = login.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    assert client.get("/api/v1/dashboard/overview", headers=headers).status_code == 200

    # Force-expire the session row without logging the token value in asserts beyond presence
    from app.services.platform_store import platform_store

    with platform_store._sessions() as session:
        row = session.get(SessionRow, token)
        assert row is not None
        row.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
        session.commit()

    expired = client.get("/api/v1/dashboard/overview", headers=headers)
    assert expired.status_code == 401

    # Fresh login then logout
    login2 = client.post(
        "/api/v1/auth/login", json={"username": "operator", "password": "operator"}
    )
    token2 = login2.json()["access_token"]
    h2 = {"Authorization": f"Bearer {token2}"}
    assert client.get("/api/v1/dashboard/overview", headers=h2).status_code == 200
    client.post("/api/v1/auth/logout", headers=h2)
    assert client.get("/api/v1/dashboard/overview", headers=h2).status_code == 401
    get_settings.cache_clear()


def test_legacy_null_expires_at_rejected(client: TestClient) -> None:
    """Pre-upgrade sessions (NULL expires_at) must re-authenticate."""
    login = client.post(
        "/api/v1/auth/login", json={"username": "admin", "password": "admin"}
    )
    token = login.json()["access_token"]
    from app.services.platform_store import platform_store

    with platform_store._sessions() as session:
        row = session.get(SessionRow, token)
        row.expires_at = None
        session.commit()
    assert (
        client.get(
            "/api/v1/dashboard/overview",
            headers={"Authorization": f"Bearer {token}"},
        ).status_code
        == 401
    )


def test_password_strength_enforced_on_create(client: TestClient) -> None:
    ad = auth_header(client, "admin")
    weak = client.post(
        "/api/v1/admin/users",
        headers=ad,
        json={
            "username": "weakuser",
            "password": "short",
            "display_name": "Weak",
            "badge_number": "W-1",
            "role": "operator",
        },
    )
    assert weak.status_code in (400, 422)
    strong = client.post(
        "/api/v1/admin/users",
        headers=ad,
        json={
            "username": "stronguser",
            "password": "StrongPass1",
            "display_name": "Strong",
            "badge_number": "S-1",
            "role": "operator",
        },
    )
    assert strong.status_code == 201


def test_validate_password_strength_unit() -> None:
    with pytest.raises(ValueError):
        validate_password_strength("short")
    with pytest.raises(ValueError):
        validate_password_strength("nouppercase1xx")
    with pytest.raises(ValueError):
        validate_password_strength("NoNumberHere")
    validate_password_strength("ValidPass1x")


def test_upload_requires_auth_and_blocks_traversal(client: TestClient) -> None:
    ensure_upload_dir()
    # Create a real file via authenticated upload
    op = auth_header(client, "operator")
    up = client.post(
        "/api/v1/uploads",
        headers=op,
        files={"file": ("shot.jpg", b"\xff\xd8\xff\xd9", "image/jpeg")},
    )
    assert up.status_code == 200
    stored = up.json()["stored_name"]
    url_path = up.json()["url"]
    assert url_path.startswith("/uploads/")

    anon = client.get(url_path)
    assert anon.status_code == 401

    ok = client.get(url_path, headers=op)
    assert ok.status_code == 200
    assert ok.content.startswith(b"\xff\xd8")

    # Query token form (img tag)
    token = op["Authorization"].split(" ", 1)[1]
    via_q = client.get(f"{url_path}?access_token={token}")
    assert via_q.status_code == 200

    # Path traversal
    bad = client.get("/uploads/../data/scc_platform.db", headers=op)
    assert bad.status_code in (400, 404)

    # Ensure we did not expose absolute filesystem paths in error bodies
    assert "Desktop" not in bad.text
    assert str(UPLOAD_DIR) not in bad.text
