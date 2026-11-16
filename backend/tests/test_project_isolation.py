"""Hardware/report authorization matrix; all records are disposable fixtures."""

import json
from copy import deepcopy

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.config import get_settings
from app.db.base import Base
from app.db.models import AppStateRow, UserRow
from app.main import create_app
from app.schemas.scc import HwRegisterCreate
from app.services.auth import hash_password
from app.services.project_access import project_scope
from tests.test_data_accuracy import add_case, store  # noqa: F401 (shared isolated fixture)
from tests.test_phase4_production import _patch_store


def database_snapshot(store):
    """Compare every table, including signatures, inventory, users and audit."""
    with store._sessions() as session:
        return {
            table.name: sorted(
                json.dumps(dict(row._mapping), sort_keys=True, default=str)
                for row in session.execute(select(table))
            )
            for table in Base.metadata.sorted_tables
        }


@pytest.fixture()
def gate(store, monkeypatch):
    monkeypatch.setenv("FRONTEND_DIST", "")
    # Each synthetic database also needs its own in-process login limiter.
    # Keep throttling enabled; don't carry one fixture's logins into the next.
    monkeypatch.setattr("app.services.rate_limit._auth_limiter", None)
    get_settings.cache_clear()
    identities = {
        "pm_a": ("receiver", ["Yanbu"]),
        "pm_b": ("receiver", ["Jafurah"]),
        "operator": ("operator", ["Yanbu"]),
        "hse_a": ("dept_hse", ["Yanbu"]),
        "hse_b": ("dept_hse", ["Jafurah"]),
        "admin": ("admin", None),
        # Admin remains global even if an old project list is stored.
        "admin_two": ("admin", ["Yanbu"]),
        "missing": ("receiver", None),
        "empty": ("receiver", []),
        "blank": ("receiver", ["", "  "]),
        # Explicit All-projects sentinel (Admin UI All option).
        "all_star": ("operator", ["*"]),
    }
    password = "DisposableScopeTest2026!"
    digest = hash_password(password)
    with store._sessions() as session:
        for name, (role, projects) in identities.items():
            session.add(UserRow(
                id=f"scope-{name}", username=f"scope-{name}",
                display_name=f"Test {name}", role=role, projects=projects,
                password_hash=digest, is_active=True,
            ))
        session.commit()
    objects = {}
    for project in ("Yanbu", "Jafurah"):
        objects[f"device_{project}"] = store.add_hw_register_item(HwRegisterCreate(
            device="Smart Helmet", serial=f"TEST-{project}", project=project, status="In Stock",
        ))["item"]
        objects[f"transfer_{project}"] = store.create_hw_transfer({
            "from": "Warehouse", "to": project, "type": "Smart Helmet", "kind": "delivery",
            "qty": 1, "serials": [f"TEST-{project}"],
        }, actor="Test admin")["item"]
        add_case(store, project=project)
    objects["shift"] = store.create_hw_transfer({
        "from": "Yanbu", "to": "Jafurah", "type": "Smart Helmet", "kind": "shift",
        "qty": 1, "serials": ["TEST-SHIFT"],
    }, actor="Test admin")["item"]
    objects["reverse_shift"] = store.create_hw_transfer({
        "from": "Jafurah", "to": "Yanbu", "type": "Smart Helmet", "kind": "shift",
        "qty": 1, "serials": ["TEST-REVERSE"],
    }, actor="Test admin")["item"]
    # The fixture clock is Nov 15: use an earlier month for signable monthly packets.
    from datetime import date
    add_case(store, project="Yanbu", day=date(2026, 10, 25))
    add_case(store, project="Jafurah", day=date(2026, 10, 26))
    packets = store.reports()["packets"]
    for project in ("Yanbu", "Jafurah"):
        for kind in ("weekly", "monthly"):
            objects[f"{kind}_{project}"] = next(
                p for p in packets if p["kind"] == kind and p["scope"] == project
                and p["a"].startswith("2026-10")
            )
    store.save_platform_settings({
        "reportDistribution": {"Jafurah": {"name": "FOREIGN-DISTRIBUTION", "email": "test@example.invalid"}}
    })
    _patch_store(monkeypatch, store)
    with TestClient(create_app()) as client:
        headers = {}
        for name in identities:
            login = client.post("/api/v1/auth/login", json={
                "username": f"scope-{name}", "password": password,
            })
            assert login.status_code == 200
            headers[name] = {"Authorization": f"Bearer {login.json()['access_token']}"}
        yield client, store, headers, objects


@pytest.mark.parametrize("identity,project,foreign", [
    ("pm_a", "Yanbu", "Jafurah"), ("pm_b", "Jafurah", "Yanbu"),
    ("operator", "Yanbu", "Jafurah"),
])
def test_lists_only_expose_assigned_project(gate, identity, project, foreign):
    client, store, headers, objects = gate
    before = database_snapshot(store)
    hw = client.get("/api/v1/hw", headers=headers[identity]).json()
    assert set(hw["project_counts"]) == {project}
    assert hw["all_projects"] == 1
    assert hw["department_counts"] == {}
    register = client.get("/api/v1/hw/register", headers=headers[identity]).json()
    assert {r["project"] for r in register["items"]} == {project}
    assert register["total"] == 1
    transfers = client.get("/api/v1/hw/transfers", headers=headers[identity]).json()
    ids = {r["id"] for r in transfers["items"]}
    assert objects[f"transfer_{project}"]["id"] in ids
    assert objects[f"transfer_{foreign}"]["id"] not in ids
    assert objects["shift"]["id"] in ids  # involved endpoints may view
    reports = client.get("/api/v1/reports", headers=headers[identity]).json()
    assert {r["project"] for r in reports["details"]} == {project}
    assert {r["project"] for r in reports["by_project"]} == {project}
    assert all(p["kind"] == "daily" or p["scope"] == project for p in reports["packets"])
    assert all(p["scope"] == "Authorized projects" for p in reports["packets"] if p["kind"] == "daily")
    assert foreign not in json.dumps(reports)
    assert "FOREIGN-DISTRIBUTION" not in json.dumps(reports)
    assert database_snapshot(store) == before


@pytest.mark.parametrize("path", ["/hw", "/hw/register", "/hw/transfers", "/reports"])
def test_forged_project_filters_do_not_widen_scope(gate, path):
    client, _, headers, objects = gate
    response = client.get("/api/v1" + path, headers=headers["pm_a"], params={
        "project": "Jafurah", "projects": "Jafurah", "scope": "All projects", "role": "admin",
    })
    assert response.status_code == 200
    payload = response.json()
    if path == "/hw":
        assert "Jafurah" not in payload["project_counts"]
    elif path == "/hw/register":
        assert all(r["project"] == "Yanbu" for r in payload["items"])
    elif path == "/hw/transfers":
        assert objects["transfer_Jafurah"]["id"] not in {r["id"] for r in payload["items"]}
    else:
        assert all(r["project"] == "Yanbu" for r in payload["details"])
        assert all(p["kind"] == "daily" or p["scope"] == "Yanbu" for p in payload["packets"])


@pytest.mark.parametrize("identity,method,template,expected", [
    ("pm_a", "post", "/hw/transfers/{transfer_Jafurah}/receive", 403),
    ("pm_a", "post", "/hw/transfers/{shift}/receive", 403),
    ("pm_b", "post", "/hw/transfers/{reverse_shift}/receive", 403),
    ("pm_a", "post", "/reports/{monthly_Jafurah}/sign", 403),
    ("hse_a", "post", "/reports/{weekly_Jafurah}/sign", 403),
    ("hse_a", "post", "/reports/{monthly_Jafurah}/sign", 403),
    ("operator", "post", "/reports/{weekly_Yanbu}/sign", 403),
    ("pm_a", "post", "/reports/{weekly_Yanbu}/sign", 403),
    ("operator", "post", "/hw/transfers/{transfer_Yanbu}/receive", 403),
    ("admin", "post", "/hw/transfers/{transfer_Yanbu}/receive", 403),
    ("pm_a", "patch", "/hw/register/{device_Jafurah}/status", 403),
    ("operator", "patch", "/hw/register/{device_Yanbu}/status", 403),
    ("pm_a", "post", "/hw/transfers", 403),
    ("operator", "post", "/hw/transfers", 403),
    ("pm_a", "post", "/reports/{monthly_Yanbu}/issue", 403),
    ("pm_a", "get", "/hw/register/{device_Jafurah}", 404),
    ("pm_a", "get", "/hw/transfers/{transfer_Jafurah}", 404),
    ("pm_a", "get", "/reports/{monthly_Jafurah}", 404),
])
def test_denied_direct_id_requests_never_modify_any_table(gate, identity, method, template, expected):
    client, store, headers, objects = gate
    path = template.format(**{k: v["id"] for k, v in objects.items()})
    before = database_snapshot(store)
    # Payload scope is intentionally forged. Authorization must use saved data.
    kwargs = {} if method == "get" else {"json": {
        "signature_image": "test-signature.png", "project": "Yanbu", "to": "Yanbu",
        "scope": "Yanbu", "status": "Lost",
    }}
    response = getattr(client, method)("/api/v1" + path, headers=headers[identity], **kwargs)
    assert response.status_code == expected
    assert database_snapshot(store) == before


@pytest.mark.parametrize("identity", ["missing", "empty", "blank"])
def test_missing_empty_or_blank_assignments_are_denied_and_never_write(gate, identity):
    """null / [] / blanks are not a global grant — fail closed."""
    client, store, headers, objects = gate
    before = database_snapshot(store)
    for path in ("/hw", "/hw/register", "/hw/transfers", "/reports"):
        assert client.get("/api/v1" + path, headers=headers[identity]).status_code == 403
    for path in (
        f"/hw/transfers/{objects['transfer_Yanbu']['id']}/receive",
        f"/reports/{objects['monthly_Yanbu']['id']}/sign",
    ):
        assert client.post(
            "/api/v1" + path,
            headers=headers[identity],
            json={"signature_image": "test.png"},
        ).status_code == 403
    # Direct-ID mutation must also stay denied.
    assert (
        client.post(
            f"/api/v1/hw/transfers/{objects['transfer_Yanbu']['id']}/receive",
            headers=headers[identity],
        ).status_code
        == 403
    )
    assert database_snapshot(store) == before


def test_explicit_all_projects_sentinel_retains_global_read(gate):
    """Admin UI All-projects is stored as ['*'] and must keep HW/reports access."""
    client, _, headers, objects = gate
    for path in ("/hw", "/hw/register", "/hw/transfers", "/reports", "/dashboard/overview"):
        assert client.get("/api/v1" + path, headers=headers["all_star"]).status_code == 200
    hw = client.get("/api/v1/hw", headers=headers["all_star"]).json()
    assert set(hw["project_counts"]) >= {"Yanbu", "Jafurah"}
    register = client.get("/api/v1/hw/register", headers=headers["all_star"]).json()
    assert {r["project"] for r in register["items"]} >= {"Yanbu", "Jafurah"}
    # Yanbu-only PM cannot receive a Jafurah delivery by direct ID.
    assert (
        client.post(
            f"/api/v1/hw/transfers/{objects['transfer_Jafurah']['id']}/receive",
            headers=headers["pm_a"],
        ).status_code
        == 403
    )


@pytest.mark.parametrize("bearer", [None, "Bearer invalid-fixture-token"])
def test_anonymous_and_invalid_sessions_are_rejected_without_writes(gate, bearer):
    client, store, _, objects = gate
    headers = {"Authorization": bearer} if bearer else {}
    before = database_snapshot(store)
    for path in ("/hw", "/hw/register", "/hw/transfers", "/reports"):
        assert client.get("/api/v1" + path, headers=headers).status_code == 401
    for path in ("/hw/transfers", "/hw/register",
                 f"/hw/transfers/{objects['transfer_Yanbu']['id']}/receive",
                 f"/reports/{objects['monthly_Yanbu']['id']}/sign"):
        assert client.post("/api/v1" + path, headers=headers, json={}).status_code == 401
    assert client.patch("/api/v1/hw/register/unknown/status", headers=headers, json={}).status_code == 401
    assert database_snapshot(store) == before


def test_authorized_receipt_and_dual_signature_workflow(gate):
    client, store, headers, objects = gate
    before = database_snapshot(store)
    inventory_before = deepcopy(store._hw_state())
    personnel_before = deepcopy(store.get_key_personnel())
    # Source involvement permits listing, but only the destination PM receives.
    shift = objects["shift"]["id"]
    assert client.post(f"/api/v1/hw/transfers/{shift}/receive", headers=headers["pm_b"]).status_code == 200
    response = client.post(
        f"/api/v1/hw/transfers/{objects['transfer_Yanbu']['id']}/receive",
        headers=headers["pm_a"],
    )
    assert response.status_code == 200
    assert response.json()["status"] == "received"
    weekly = objects["weekly_Yanbu"]["id"]
    assert client.post(f"/api/v1/reports/{weekly}/sign", headers=headers["hse_a"],
                       json={"signature_image": "test-hse.png"}).json()["status"] == "Signed"
    monthly = objects["monthly_Yanbu"]["id"]
    first = client.post(f"/api/v1/reports/{monthly}/sign", headers=headers["hse_a"],
                        json={"signature_image": "test-hse.png"})
    assert first.status_code == 200
    assert first.json()["status"] == "Awaiting PM signature"
    final = client.post(f"/api/v1/reports/{monthly}/sign", headers=headers["pm_a"],
                        json={"signature_image": "test-pm.png"})
    assert final.status_code == 200
    assert final.json()["status"] == "Signed"
    assert store.find_saved_report_packet(monthly)["pm_signed"]
    after = database_snapshot(store)
    for table in ("users", "contacts", "list_items", "asset_classifications", "cases"):
        assert after[table] == before[table]
    assert store._hw_state() == inventory_before
    assert store.get_key_personnel() == personnel_before


@pytest.mark.parametrize("identity", ["admin", "admin_two"])
def test_admin_retains_existing_global_permissions_without_new_sign_or_receive_rights(gate, identity):
    client, _, headers, objects = gate
    register = client.get("/api/v1/hw/register", headers=headers[identity]).json()
    assert {r["project"] for r in register["items"]} == {"Yanbu", "Jafurah"}
    response = client.patch(f"/api/v1/hw/register/{objects['device_Jafurah']['id']}/status",
                            headers=headers[identity], json={"status": "Lost"})
    assert response.status_code == 200
    saved = client.post("/api/v1/hw/transfers", headers=headers[identity], json={
        "from": "Warehouse", "to": "Jafurah", "type": "Smart Helmet", "kind": "delivery",
        "qty": 1, "serials": ["TEST-ADMIN-NEW"],
    })
    assert saved.status_code == 201
    reports = client.get("/api/v1/reports", headers=headers[identity]).json()
    assert {r["project"] for r in reports["details"]} == {"Yanbu", "Jafurah"}
    assert all(p["scope"] == "All projects" for p in reports["packets"] if p["kind"] == "daily")
    before = database_snapshot(gate[1])
    assert client.post(f"/api/v1/reports/{objects['monthly_Jafurah']['id']}/sign",
                       headers=headers[identity], json={"signature_image": "test.png"}).status_code == 403
    assert client.post(f"/api/v1/hw/transfers/{saved.json()['item']['id']}/receive",
                       headers=headers[identity]).status_code == 403
    assert database_snapshot(gate[1]) == before


def test_register_creation_scope_and_response_do_not_leak_foreign_inventory(gate):
    client, store, headers, _ = gate
    before = database_snapshot(store)
    payload = {"device": "Smart Watch", "serial": "TEST-OP-NEW", "project": "Jafurah", "status": "In Stock"}
    assert client.post("/api/v1/hw/register", headers=headers["operator"], json=payload).status_code == 403
    assert database_snapshot(store) == before
    payload["project"] = "Yanbu"
    response = client.post("/api/v1/hw/register", headers=headers["operator"], json=payload)
    assert response.status_code == 200
    saved = response.json()
    assert {r["project"] for r in saved["items"]} == {"Yanbu"}
    assert set(saved["hw"]["project_counts"]) == {"Yanbu"}
    assert saved["hw"]["all_projects"] == 2


def test_daily_projection_does_not_rewrite_shared_packets_or_expose_other_days(gate):
    client, store, headers, _ = gate
    raw_before = deepcopy(store._report_packets_snapshot())
    response = client.get("/api/v1/reports", headers=headers["pm_a"]).json()
    daily = [p for p in response["packets"] if p["kind"] == "daily"]
    assert daily
    assert all(p["scope"] == "Authorized projects" for p in daily)
    assert "2026-10-26" not in {p["a"] for p in daily}  # Jafurah-only day
    assert "2026-10-25" in {p["a"] for p in daily}  # Yanbu day
    assert {r["project"] for r in response["details"]} == {"Yanbu"}
    assert store._report_packets_snapshot() == raw_before


def test_denied_sign_lookup_does_not_compile_or_notify(gate, monkeypatch):
    client, store, headers, objects = gate
    def forbidden_compile():
        raise AssertionError("Unauthorized request ran the report compiler")
    monkeypatch.setattr(store, "_report_packets", forbidden_compile)
    before = database_snapshot(store)
    for report_id, expected in ((objects["monthly_Jafurah"]["id"], 403), ("MISSING-ID", 404)):
        response = client.post(f"/api/v1/reports/{report_id}/sign", headers=headers["pm_a"],
                               json={"signature_image": "test.png"})
        assert response.status_code == expected
    assert database_snapshot(store) == before


def test_missing_transfer_destination_never_falls_back_to_source(gate):
    client, store, headers, _ = gate
    with store._sessions() as session:
        row = session.get(AppStateRow, "hw_transfers")
        state = deepcopy(row.value)
        state["items"].append({
            "id": "TEST-MISSING-DESTINATION", "from": "Yanbu", "status": "transit",
        })
        row.value = state
        session.commit()
    before = database_snapshot(store)
    response = client.post("/api/v1/hw/transfers/TEST-MISSING-DESTINATION/receive",
                           headers=headers["pm_a"], json={"to": "Yanbu"})
    assert response.status_code == 403
    assert database_snapshot(store) == before


def test_report_notifications_follow_assignments(gate):
    _, store, _, _ = gate
    for role, method in (("receiver", store._pm_report_ready_notifications),
                         ("dept_hse", store._hse_report_ready_notifications)):
        notifications = method({"role": role, "projects": ["Yanbu"]})
        assert notifications
        assert all(n["project"] == "Yanbu" for n in notifications)
        # Missing assignment is not a global grant.
        assert method({"role": role, "projects": None}) == []
        all_access = method({"role": role, "projects": ["*"]})
        assert {n["project"] for n in all_access} >= {"Yanbu", "Jafurah"}


@pytest.mark.parametrize(
    "projects,expected",
    [
        (None, frozenset()),
        ([], frozenset()),
        (["*"], None),
        (["Yanbu"], frozenset({"Yanbu"})),
        (["", "  "], frozenset()),
        ("Yanbu", frozenset()),  # non-list → fail closed
        ([None, 1], frozenset()),
    ],
)
def test_project_scope_distinguishes_explicit_all_from_missing(projects, expected):
    assert project_scope({"role": "receiver", "projects": projects}) == expected
    assert project_scope({"role": "admin", "projects": projects}) is None


def test_legacy_null_migration_encodes_all_without_granting_post_flag_missing(store):
    """One-time migration turns legacy null into ['*']; later null stays denied."""
    from app.db.models import AppStateRow, UserRow
    from app.services.auth import hash_password
    from app.services.project_access import ALL_PROJECTS_SENTINEL

    digest = hash_password("DisposableScopeTest2026!")
    with store._lock, store._sessions() as session:
        flag = session.get(AppStateRow, "projects_all_sentinel_v1")
        if flag is not None:
            session.delete(flag)
        session.add(
            UserRow(
                id="legacy-null-op",
                username="legacy-null-op",
                display_name="Legacy Null",
                role="operator",
                projects=None,
                password_hash=digest,
                is_active=True,
            )
        )
        session.commit()

    store._migrate_legacy_null_all_projects_v1()
    with store._sessions() as session:
        legacy = session.get(UserRow, "legacy-null-op")
        assert legacy is not None
        assert legacy.projects == [ALL_PROJECTS_SENTINEL]
        assert session.get(AppStateRow, "projects_all_sentinel_v1") is not None

    # New missing user after migration flag: stays null and is denied.
    with store._lock, store._sessions() as session:
        session.add(
            UserRow(
                id="post-mig-missing",
                username="post-mig-missing",
                display_name="Post Mig",
                role="operator",
                projects=None,
                password_hash=digest,
                is_active=True,
            )
        )
        session.commit()
    store._migrate_legacy_null_all_projects_v1()  # no-op once flagged
    with store._sessions() as session:
        post = session.get(UserRow, "post-mig-missing")
        assert post is not None
        assert post.projects is None
    missing = {
        "id": "post-mig-missing",
        "role": "operator",
        "projects": None,
    }
    assert project_scope(missing) == frozenset()
    assert store.get_hw(user=missing)["project_counts"] == {}
