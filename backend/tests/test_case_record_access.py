"""P0: case detail read/edit must enforce auth + saved-project access."""

from __future__ import annotations

from datetime import date, time

import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.db.models import UserRow
from app.main import create_app
from app.schemas.scc import ConfirmDriver, DashcamCreate
from app.services.auth import hash_password
from app.services.platform_store import PlatformStore
from app.db.engine import sqlite_file_url
from tests.test_phase4_production import _patch_store
from tests.test_project_isolation import database_snapshot


PASSWORD = "CaseAccessFix2026!"


def _project_id(store: PlatformStore, label: str) -> str:
    for item in store.catalog.get("project"):
        if item["label"] == label:
            return item["id"]
    raise AssertionError(f"Missing project label {label!r}")


@pytest.fixture()
def access_client(tmp_path, monkeypatch):
    monkeypatch.setenv("SEED_DEMO_CASES", "false")
    monkeypatch.setenv("SEED_DEMO_USERS", "false")
    monkeypatch.setenv("SEED_DEMO_FIXTURES", "false")
    monkeypatch.setenv("BOOTSTRAP_ADMIN_USERNAME", "")
    monkeypatch.setenv("BOOTSTRAP_ADMIN_PASSWORD", "")
    monkeypatch.setenv("FRONTEND_DIST", "")
    monkeypatch.setattr("app.services.rate_limit._auth_limiter", None)
    get_settings.cache_clear()
    store = PlatformStore(database_url=sqlite_file_url(tmp_path / "case_access.db"))
    digest = hash_password(PASSWORD)
    with store._sessions() as session:
        session.add(
            UserRow(
                id="op-yanbu",
                username="op-yanbu",
                display_name="Yanbu Operator",
                badge_number="YB1",
                role="operator",
                projects=["Yanbu"],
                password_hash=digest,
                is_active=True,
            )
        )
        session.add(
            UserRow(
                id="op-star",
                username="op-star",
                display_name="All Projects Operator",
                badge_number="ST1",
                role="operator",
                projects=["*"],
                password_hash=digest,
                is_active=True,
            )
        )
        session.add(
            UserRow(
                id="admin-access",
                username="admin-access",
                display_name="Admin Access",
                badge_number="AA1",
                role="admin",
                projects=None,
                password_hash=digest,
                is_active=True,
            )
        )
        session.commit()
    _patch_store(monkeypatch, store)
    client = TestClient(create_app())
    yield client, store
    store._engine.dispose()
    get_settings.cache_clear()


def _login(client: TestClient, username: str) -> dict[str, str]:
    response = client.post(
        "/api/v1/auth/login", json={"username": username, "password": PASSWORD}
    )
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def _create_dashcam(store: PlatformStore, project_label: str) -> dict:
    return store.create_dashcam(
        DashcamCreate(
            assign_to="project",
            project_id=_project_id(store, project_label),
            vehicle_type_id=store.catalog.get("vehicle_type")[0]["id"],
            model_id=store.catalog.get("model")[0]["id"],
            asset_number="007-01-100",
            driver_name="Access Driver",
            driver_badge_number="9001",
            occurred_on=date.today(),
            occurred_time=time(9, 0),
            violation_type_id=store.catalog.get("dashcam_observation_type")[0]["id"],
            risk_level_id=store.catalog.get("risk_level")[0]["id"],
            alert_summary="Seat belt not fastened",
            reported_by="Yanbu Operator",
        )
    )


def test_unauthenticated_case_detail_is_rejected(access_client):
    client, store = access_client
    created = _create_dashcam(store, "Yanbu")
    response = client.get(f"/api/v1/cases/{created['id']}")
    assert response.status_code == 401


def test_yanbu_operator_can_read_and_edit_own_open_record(access_client):
    client, store = access_client
    created = _create_dashcam(store, "Yanbu")
    headers = _login(client, "op-yanbu")

    read = client.get(f"/api/v1/cases/{created['id']}", headers=headers)
    assert read.status_code == 200, read.text
    assert read.json()["project"] == "Yanbu"

    edited = client.patch(
        f"/api/v1/cases/{created['id']}",
        headers=headers,
        json={"fields": {"driver_name": "Updated Driver"}, "project": "Yanbu"},
    )
    assert edited.status_code == 200, edited.text
    assert edited.json()["fields"]["driver_name"] == "Updated Driver"
    assert edited.json()["project"] == "Yanbu"


def test_yanbu_operator_cannot_read_or_edit_jafurah_by_id(access_client):
    client, store = access_client
    foreign = _create_dashcam(store, "Jafurah")
    headers = _login(client, "op-yanbu")
    before = database_snapshot(store)

    denied_get = client.get(f"/api/v1/cases/{foreign['id']}", headers=headers)
    assert denied_get.status_code == 403
    assert "not authorized" in denied_get.json()["error"]["message"].lower()

    denied_patch = client.patch(
        f"/api/v1/cases/{foreign['id']}",
        headers=headers,
        json={"fields": {"driver_name": "Should Not Save"}},
    )
    assert denied_patch.status_code == 403
    assert database_snapshot(store) == before
    assert store.get_case(foreign["id"])["fields"]["driver_name"] == "Access Driver"


def test_admin_and_star_operator_can_access_jafurah(access_client):
    client, store = access_client
    foreign = _create_dashcam(store, "Jafurah")

    for username in ("admin-access", "op-star"):
        headers = _login(client, username)
        read = client.get(f"/api/v1/cases/{foreign['id']}", headers=headers)
        assert read.status_code == 200, read.text
        assert read.json()["project"] == "Jafurah"


def test_operator_forbidden_project_and_workflow_field_changes(access_client):
    client, store = access_client
    created = _create_dashcam(store, "Yanbu")
    headers = _login(client, "op-yanbu")
    before = database_snapshot(store)

    move_project = client.patch(
        f"/api/v1/cases/{created['id']}",
        headers=headers,
        json={"project": "Jafurah", "fields": {"driver_name": "Nope"}},
    )
    assert move_project.status_code == 403
    assert "project" in move_project.json()["error"]["message"].lower()
    assert database_snapshot(store) == before

    protected = client.patch(
        f"/api/v1/cases/{created['id']}",
        headers=headers,
        json={
            "fields": {
                "reported_by": "Hijacked",
                "itqan_proof": "/uploads/evil.png",
                "status": "closed",
            }
        },
    )
    assert protected.status_code == 403
    assert "protected" in protected.json()["error"]["message"].lower()
    assert database_snapshot(store) == before
    row = store.get_case(created["id"])
    assert row["fields"]["reported_by"] == "Yanbu Operator"
    assert row["status"] == "open"


def test_operator_cannot_edit_closed_record(access_client):
    client, store = access_client
    created = _create_dashcam(store, "Yanbu")
    store.confirm_driver(
        created["id"],
        "dashcam",
        ConfirmDriver(itqan_proof="/uploads/x.png", uploaded_by="Yanbu Operator"),
        actor="Yanbu Operator",
    )
    closed = store.approve_case(created["id"], actor="Admin Access")
    assert closed["status"] == "closed"

    headers = _login(client, "op-yanbu")
    before = database_snapshot(store)
    blocked = client.patch(
        f"/api/v1/cases/{created['id']}",
        headers=headers,
        json={"fields": {"driver_name": "Should Fail"}},
    )
    assert blocked.status_code == 400
    assert "Open" in blocked.json()["error"]["message"]
    assert database_snapshot(store) == before
