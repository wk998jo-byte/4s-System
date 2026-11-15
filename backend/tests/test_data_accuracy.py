"""Data integrity regressions. Every write uses a disposable SQLite database."""

from datetime import date, datetime, time

import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.db.engine import sqlite_file_url
from app.db.models import AppStateRow, ContactRow, UserRow, WeatherHourlyReadingRow
from app.main import create_app
from app.schemas.scc import AiCameraCreate, HwRegisterCreate
from app.services.auth import hash_password
from app.services.platform_store import AST, PlatformStore
from tests.test_phase4_production import _patch_store


@pytest.fixture()
def store(tmp_path, monkeypatch):
    for key in ("SEED_DEMO_CASES", "SEED_DEMO_USERS", "SEED_DEMO_FIXTURES"):
        monkeypatch.setenv(key, "false")
    monkeypatch.setenv("BOOTSTRAP_ADMIN_USERNAME", "")
    monkeypatch.setenv("BOOTSTRAP_ADMIN_PASSWORD", "")
    get_settings.cache_clear()
    result = PlatformStore(database_url=sqlite_file_url(tmp_path / "accuracy.db"))
    monkeypatch.setattr(result, "_report_local_now", lambda: datetime(2026, 11, 15, 12, tzinfo=AST))
    # No email/outbox effects from report compilation in tests.
    monkeypatch.setattr(result, "_dispatch_compile_notifications", lambda packets: packets)
    yield result
    result._engine.dispose()
    get_settings.cache_clear()


def add_case(store, project="Jafurah", day=date(2026, 11, 10)):
    return store.create_ai_camera(AiCameraCreate(
        project_id=next(p["id"] for p in store.catalog.get("project") if p["label"] == project),
        location="Isolated test", occurred_on=day, occurred_time=time(10),
        alert_summary="Isolated accuracy test",
        alert_type_id=store.catalog.get("alert_type")[0]["id"],
        category_id=store.catalog.get("ai_camera_category")[0]["id"],
        risk_level_id=store.catalog.get("risk_level")[0]["id"],
        detection_method_id=store.catalog.get("detection_method")[0]["id"],
        reported_by="Isolated test operator",
    ))


def test_empty_inventory_transfers_reports_and_dashboard(store):
    hw = store.get_hw()
    assert hw["all_projects"] == 0
    assert sum(sum(v.values()) for v in hw["project_counts"].values()) == 0
    assert sum(sum(v.values()) for v in hw["department_counts"].values()) == 0
    assert hw["project_counts"]  # retain selectable projects and device categories
    assert store.get_hw_register() == {"items": [], "total": 0}
    assert store.get_hw_transfers() == {"items": [], "register": []}
    for _ in range(2):
        reports = store.reports(user={"role": "admin"})
        assert reports["packets"] == []
        assert reports["report_counts"] == {
            "stored_packets": 0,
            "generated": {"daily": 0, "weekly": 0, "monthly": 0},
        }
    with store._sessions() as session:
        assert session.get(AppStateRow, "report_packets") is None
        assert session.get(AppStateRow, "hw_transfers") is None
    for view in ("overall", "projects", "departments"):
        overview = store.dashboard(period="all", view=view)
        assert overview["kpis"]["total"] == 0
        assert all(v == 0 for v in overview["by_status"].values())


def test_legacy_empty_calendar_packets_are_retained_not_completed(store):
    old = [
        *store._rebuild_daily_packets([]),
        *store._rebuild_weekly_packets([], ["Jafurah", "Yanbu", "MGS", "Ras Tanura"]),
        *store._rebuild_monthly_packets([], ["Jafurah", "Yanbu", "MGS", "Ras Tanura"]),
    ]
    assert len(old) == 78
    store._save_report_packets(old)
    reports = store.reports()
    assert len(reports["packets"]) == 78
    assert {p["id"] for p in reports["packets"]} == {p["id"] for p in old}
    assert {p["status"] for p in reports["packets"]} == {"No source data"}
    assert reports["report_counts"]["generated"] == {"daily": 0, "weekly": 0, "monthly": 0}
    assert store._report_ready_notifications() == []
    with pytest.raises(ValueError, match="not been generated"):
        store.sign_report(old[30]["id"], actor="Test HSE", signature="test.png", role="dept_hse")
    with store._sessions() as session:
        assert len(session.get(AppStateRow, "report_packets").value) == 78


def test_real_data_compiles_only_matching_periods_and_persists_counts(store):
    add_case(store)
    reports = store.reports()
    packets = reports["packets"]
    assert len(packets) == 3  # one active day, week and month; no empty calendar filler
    assert {p["kind"] for p in packets} == {"daily", "weekly", "monthly"}
    assert next(p for p in packets if p["kind"] == "daily")["status"] == "Generated"
    assert next(p for p in packets if p["kind"] == "weekly")["status"] == "Awaiting HSE signature"
    assert next(p for p in packets if p["kind"] == "monthly")["status"] == "Compiling"
    assert reports["report_counts"]["generated"] == {"daily": 1, "weekly": 1, "monthly": 0}
    with store._sessions() as session:
        assert session.get(AppStateRow, "report_packets").value == packets
    assert store.reports()["packets"] == packets


def test_empty_calendar_periods_never_send_compile_notifications(store, monkeypatch):
    deliveries = []
    monkeypatch.setattr("app.services.report_mail.send_report_ready_notice",
                        lambda **kwargs: deliveries.append(kwargs))
    monkeypatch.setattr(store, "_dispatch_compile_notifications",
                        PlatformStore._dispatch_compile_notifications.__get__(store))
    store._save_report_packets([
        *store._rebuild_weekly_packets([], ["Jafurah"]),
        *store._rebuild_monthly_packets([], ["Jafurah"]),
    ])
    store.reports()
    assert deliveries == []


def test_daily_cutoff_and_monthly_signatures_remain_functional(store, monkeypatch):
    add_case(store, day=date(2026, 11, 15))
    current = next(p for p in store.reports()["packets"] if p["kind"] == "daily")
    assert current["status"] == "Compiling"
    monkeypatch.setattr(store, "_report_local_now", lambda: datetime(2026, 11, 15, 23, 59, tzinfo=AST))
    current = next(p for p in store.reports()["packets"] if p["kind"] == "daily")
    assert current["status"] == "Generated"
    add_case(store, day=date(2026, 10, 25))
    monthly = next(p for p in store.reports()["packets"] if p["kind"] == "monthly" and p["a"] == "2026-10-01")
    first = store.sign_report(monthly["id"], actor="Test HSE", signature="hse.png", role="dept_hse")
    assert first["status"] == "Awaiting PM signature"
    signed = store.sign_report(monthly["id"], actor="Test PM", signature="pm.png", role="receiver")
    assert signed["status"] == "Signed"
    assert store.get_report_packet(signed["id"]) == signed


def test_weekly_signature_and_scoped_reports_remain_functional(store):
    add_case(store)
    add_case(store, project="Yanbu")
    packets = store.reports(user={"projects": ["Yanbu"]})["packets"]
    assert all(p["kind"] == "daily" or p["scope"] == "Yanbu" for p in packets)
    weekly = next(p for p in packets if p["kind"] == "weekly")
    with pytest.raises(ValueError, match="Only Dept HSE"):
        store.sign_report(weekly["id"], actor="Test PM", signature="pm.png", role="receiver")
    signed = store.sign_report(weekly["id"], actor="Test HSE", signature="hse.png", role="dept_hse")
    assert signed["status"] == "Signed"


def test_weekly_compiling_is_not_signable(store):
    add_case(store, day=date(2026, 11, 15))
    weekly = next(p for p in store.reports()["packets"] if p["kind"] == "weekly")
    assert weekly["status"] == "Compiling"
    with pytest.raises(ValueError, match="not been generated"):
        store.sign_report(weekly["id"], actor="Test HSE", signature="hse.png", role="dept_hse")


def test_signed_and_issued_history_survives_empty_source_and_old_windows(store):
    stamp = {"by": "Test HSE", "signature": "signature.png", "at": "2020-01-01T00:00:00Z"}
    old = [
        {"id": "WR-ARCHIVE", "kind": "weekly", "scope": "Jafurah", "a": "2020-01-01",
         "b": "2020-01-07", "status": "Signed", "signed": stamp, "label": "Archive"},
        {"id": "MR-ARCHIVE", "kind": "monthly", "scope": "Jafurah", "a": "2020-01-01",
         "b": "2020-01-31", "status": "Issued", "signed": stamp, "pm_signed": stamp,
         "issued": {"by": "Test admin", "at": "2020-02-01"}, "label": "Archive"},
    ]
    store._save_report_packets(old)
    assert store.reports()["packets"] == old
    assert store._report_packets_snapshot() == old


def test_weather_only_reports_use_real_readings_not_station_definitions(store):
    def weather_row(row_id, day, **kwargs):
        return WeatherHourlyReadingRow(
            id=row_id, station_id="WS-JF-01", project="Jafurah", location="Isolated test",
            observed_on=day, hour=7, updated_at=datetime(2026, 11, 15, tzinfo=AST), **kwargs,
        )
    with store._sessions() as session:
        session.add(weather_row("stub", date(2026, 11, 9), status="missing"))
        session.commit()
    assert store.reports()["packets"] == []
    with store._sessions() as session:
        session.add(weather_row("actual", date(2026, 11, 10), status="ok", temp_c=0))
        session.commit()
    packets = store.reports()["packets"]
    assert len(packets) == 3
    assert next(p for p in packets if p["kind"] == "daily")["a"] == "2026-11-10"


def test_register_and_inventory_round_trip(store):
    created = store.add_hw_register_item(HwRegisterCreate(
        device="Smart Watch", serial="TEST-SW-1", status="Assigned", project="Yanbu",
    ))
    assert created["hw"]["all_projects"] == 1
    assert store.get_hw()["project_counts"]["Yanbu"]["Smart Watch"] == 1
    assert store.get_hw_register()["items"][0]["status"] == "Assigned"
    store.update_hw_register_status(created["item"]["id"], "Lost")
    assert store.get_hw_register()["items"][0]["status"] == "Lost"
    assert store.get_hw()["all_projects"] == 1
    with pytest.raises(ValueError):
        store.update_hw_register_status(created["item"]["id"], "Invented")

def test_weekly_weather_aggregation_does_not_invent_daily_readings(store):
    sources = {("Jafurah", "2026-11-08", "weekly_weather"), ("Jafurah", "2026-11-14", "weekly_weather")}
    assert not store._packet_has_source({
        "kind": "daily", "scope": "All projects", "a": "2026-11-08", "b": "2026-11-08",
    }, sources)
    assert store._packet_has_source({
        "kind": "weekly", "scope": "Jafurah", "a": "2026-11-08", "b": "2026-11-14",
    }, sources)
    assert store._packet_has_source({
        "kind": "monthly", "scope": "Jafurah", "a": "2026-11-01", "b": "2026-11-30",
    }, sources)


def test_transfer_is_saved_not_synthesized_and_receipt_survives_reload(store):
    created = store.create_hw_transfer({
        "from": "Warehouse", "to": "Jafurah", "type": "Smart Helmet",
        "kind": "delivery", "qty": 1, "serials": ["TEST-SH-1"], "receiver": "Test receiver",
    }, actor="Test sender")
    assert len(store.get_hw_transfers()["items"]) == 1
    assert store.get_hw_transfers()["items"][0] == created["item"]
    received = store.receive_hw_transfer(created["item"]["id"], actor="Test receiver")
    assert received["status"] == "received"
    assert store.get_hw_transfers()["items"][0]["status"] == "received"
    with pytest.raises(KeyError):
        store.receive_hw_transfer("NONEXISTENT", actor="Test receiver")
    with pytest.raises(ValueError):
        store.create_hw_transfer({"qty": 2, "serials": ["one"]}, actor="Test")


def test_reporting_does_not_change_protected_company_data(store):
    with store._sessions() as session:
        session.add(UserRow(
            id="fixture-admin", username="fixture-admin", display_name="Test admin", role="admin",
            password_hash="isolated-test-hash", projects=["Jafurah"], is_active=True,
        ))
        session.add(ContactRow(
            id="fixture-contact", project_id="fixture-project", project="Jafurah",
            category="key_project_personnel", name="Test contact",
            contact_number="test-contact", email="fixture@example.invalid",
        ))
        session.add(AppStateRow(key="protected_test_marker", value=True))
        kp = session.get(AppStateRow, "key_personnel")
        kp.value = {"Test project": {"groups": [{"name": "Test group", "rows": [{"name": "Test person"}]}]}}
        session.commit()

    def snapshot():
        with store._sessions() as session:
            return {
                "personnel": session.get(AppStateRow, "key_personnel").value,
                "contacts": [(r.id, r.name, r.contact_number, r.email) for r in session.query(ContactRow).all()],
                "users": [(r.id, r.role, r.password_hash, r.projects) for r in session.query(UserRow).all()],
                "projects": store.catalog.get("project"), "departments": store.catalog.get("department"),
                "classifications": store.asset_meta(),
            }
    before = snapshot()
    store.reports()
    store.get_hw()
    store.get_hw_transfers()
    assert snapshot() == before


def test_authenticated_api_empty_states_and_saved_transfer_permissions(store, monkeypatch):
    with store._sessions() as session:
        for role in ("admin", "operator", "receiver"):
            session.add(UserRow(
                id=f"api-test-{role}", username=f"api-test-{role}", display_name=f"Test {role}",
                role=role, password_hash=hash_password("IsolatedTestOnly2026!"), is_active=True,
            ))
        session.commit()
    _patch_store(monkeypatch, store)
    with TestClient(create_app()) as client:
        def headers(role):
            login = client.post("/api/v1/auth/login", json={
                "username": f"api-test-{role}", "password": "IsolatedTestOnly2026!",
            })
            assert login.status_code == 200, login.text
            return {"Authorization": f"Bearer {login.json()['access_token']}"}
        admin, operator, receiver = headers("admin"), headers("operator"), headers("receiver")
        assert client.get("/api/v1/hw", headers=admin).json()["all_projects"] == 0
        assert client.get("/api/v1/hw/register", headers=admin).json()["items"] == []
        assert client.get("/api/v1/hw/transfers", headers=admin).json()["items"] == []
        reports = client.get("/api/v1/reports", headers=admin)
        assert reports.status_code == 200
        assert reports.json()["packets"] == []
        assert client.get("/api/v1/dashboard/overview?period=all", headers=admin).json()["kpis"]["total"] == 0
        payload = {"from": "Warehouse", "to": "Jafurah", "type": "Smart Helmet",
                   "kind": "delivery", "qty": 1, "serials": ["API-TEST-1"]}
        assert client.post("/api/v1/hw/transfers", json=payload, headers=operator).status_code == 403
        saved = client.post("/api/v1/hw/transfers", json=payload, headers=admin)
        assert saved.status_code == 201, saved.text
        assert client.get("/api/v1/hw/transfers", headers=admin).json()["items"] == saved.json()["items"]
        assert client.post("/api/v1/hw/transfers/MISSING/receive", headers=admin).status_code == 403
        missing = client.post("/api/v1/hw/transfers/MISSING/receive", headers=receiver)
        assert missing.status_code == 404
        received = client.post(f"/api/v1/hw/transfers/{saved.json()['item']['id']}/receive", headers=receiver)
        assert received.status_code == 200
        register = store.add_hw_register_item(HwRegisterCreate(
            device="Smart Helmet", serial="API-TEST-1", status="In Stock", project="Jafurah",
        ))
        path = f"/api/v1/hw/register/{register['item']['id']}/status"
        assert client.patch(path, json={"status": "Lost"}, headers=operator).status_code == 403
        changed = client.patch(path, json={"status": "Lost"}, headers=admin)
        assert changed.status_code == 200
        assert client.get("/api/v1/hw/register", headers=admin).json()["items"][0]["status"] == "Lost"
