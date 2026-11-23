"""Operators may edit Open records only; Under Process / Closed are blocked."""

from datetime import date, time

import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.db.engine import sqlite_file_url
from app.db.models import UserRow
from app.main import create_app
from app.schemas.scc import DashcamCreate
from app.services.auth import hash_password
from app.services.platform_store import PlatformStore
from tests.test_phase4_production import _patch_store


PASSWORD = "OpenEditTest2026!"


@pytest.fixture()
def edit_client(tmp_path, monkeypatch):
    monkeypatch.setenv("SEED_DEMO_CASES", "false")
    monkeypatch.setenv("SEED_DEMO_USERS", "false")
    monkeypatch.setenv("SEED_DEMO_FIXTURES", "false")
    monkeypatch.setenv("BOOTSTRAP_ADMIN_USERNAME", "")
    monkeypatch.setenv("BOOTSTRAP_ADMIN_PASSWORD", "")
    monkeypatch.setenv("FRONTEND_DIST", "")
    monkeypatch.setattr("app.services.rate_limit._auth_limiter", None)
    get_settings.cache_clear()
    store = PlatformStore(database_url=sqlite_file_url(tmp_path / "open_edit.db"))
    digest = hash_password(PASSWORD)
    with store._sessions() as session:
        session.add(
            UserRow(
                id="op-edit",
                username="op-edit",
                display_name="Operator Edit",
                badge_number="OE1",
                role="operator",
                projects=["Yanbu"],
                password_hash=digest,
                is_active=True,
            )
        )
        session.add(
            UserRow(
                id="admin-edit",
                username="admin-edit",
                display_name="Admin Edit",
                badge_number="AE1",
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


def _create_open_dashcam(store: PlatformStore) -> dict:
    return store.create_dashcam(
        DashcamCreate(
            assign_to="project",
            project_id=store.catalog.get("project")[0]["id"],
            vehicle_type_id=store.catalog.get("vehicle_type")[0]["id"],
            model_id=store.catalog.get("model")[0]["id"],
            asset_number="007-01-100",
            driver_name="Edit Driver",
            driver_badge_number="9001",
            occurred_on=date.today(),
            occurred_time=time(9, 0),
            violation_type_id=store.catalog.get("dashcam_observation_type")[0]["id"],
            risk_level_id=store.catalog.get("risk_level")[0]["id"],
            alert_summary="Seat belt not fastened",
            reported_by="Operator Edit",
        )
    )


def test_operator_can_edit_open_record(edit_client):
    client, store = edit_client
    created = _create_open_dashcam(store)
    headers = _login(client, "op-edit")
    response = client.patch(
        f"/api/v1/cases/{created['id']}",
        headers=headers,
        json={"fields": {"driver_name": "Updated Driver", "alert_summary": "Updated summary"}},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["fields"]["driver_name"] == "Updated Driver"
    assert body["fields"]["alert_summary"] == "Updated summary"


def test_operator_cannot_edit_under_process_or_closed(edit_client):
    client, store = edit_client
    created = _create_open_dashcam(store)
    from app.schemas.scc import ConfirmDriver

    confirmed = store.confirm_driver(
        created["id"],
        "dashcam",
        ConfirmDriver(itqan_proof="/uploads/x.png", uploaded_by="Operator Edit"),
        actor="Operator Edit",
    )
    assert confirmed["status"] == "under_process"
    headers = _login(client, "op-edit")
    blocked = client.patch(
        f"/api/v1/cases/{created['id']}",
        headers=headers,
        json={"fields": {"driver_name": "Should Fail"}},
    )
    assert blocked.status_code == 400
    assert "Open" in blocked.json()["error"]["message"]

    closed = store.approve_case(created["id"], actor="Admin Edit")
    assert closed["status"] == "closed"
    blocked_closed = client.patch(
        f"/api/v1/cases/{created['id']}",
        headers=headers,
        json={"fields": {"driver_name": "Should Fail"}},
    )
    assert blocked_closed.status_code == 400


def test_admin_can_still_edit_under_process(edit_client):
    client, store = edit_client
    created = _create_open_dashcam(store)
    from app.schemas.scc import ConfirmDriver

    store.confirm_driver(
        created["id"],
        "dashcam",
        ConfirmDriver(itqan_proof="/uploads/x.png", uploaded_by="Operator Edit"),
        actor="Operator Edit",
    )
    headers = _login(client, "admin-edit")
    response = client.patch(
        f"/api/v1/cases/{created['id']}",
        headers=headers,
        json={"fields": {"driver_name": "Admin Fix"}},
    )
    assert response.status_code == 200, response.text
    assert response.json()["fields"]["driver_name"] == "Admin Fix"
