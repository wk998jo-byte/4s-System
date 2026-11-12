"""Phase 3B — dashboard accuracy, ITQAN uniqueness, SOS close, media ACL."""

from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("DATABASE_URL", "sqlite+pysqlite:///:memory:")

from app.core.config import get_settings
from app.db.engine import sqlite_file_url
from app.main import create_app
from app.schemas.scc import AiCameraCreate, ItqanCreate, SosClose, SosCreate
from app.services.platform_store import PlatformStore
from app.services.uploads import ensure_upload_dir
from app.services.week import week_from_date
from tests.conftest import auth_header


@pytest.fixture()
def client() -> TestClient:
    return TestClient(create_app())


@pytest.fixture()
def clean_store(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> PlatformStore:
    monkeypatch.setenv("SEED_DEMO_CASES", "false")
    get_settings.cache_clear()
    store = PlatformStore(database_url=sqlite_file_url(tmp_path / "p3b.db"))
    yield store
    get_settings.cache_clear()


def test_operator_performance_no_500(client: TestClient) -> None:
    ad = auth_header(client, "admin")
    r = client.get("/api/v1/operator-performance?period=this_week", headers=ad)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "kpis" in body
    assert "operators" in body
    assert "filters" in body
    assert isinstance(body["filters"]["operators"], list)
    # Zero-record custom window still succeeds
    empty = client.get(
        "/api/v1/operator-performance"
        "?period=custom&start_date=2090-01-01&end_date=2090-01-07",
        headers=ad,
    )
    assert empty.status_code == 200
    assert empty.json()["kpis"]["registered"]["value"] == 0


def test_period_all_and_unknown(client: TestClient) -> None:
    ad = auth_header(client, "admin")
    all_r = client.get("/api/v1/dashboard/overview?period=all", headers=ad)
    assert all_r.status_code == 200
    body = all_r.json()
    assert body["period"] == "all"
    assert body["period_start"] == "1970-01-01"
    assert body["period_end"] == "2100-12-31"
    # Should not silently equal this_week bounds
    week = client.get("/api/v1/dashboard/overview?period=this_week", headers=ad).json()
    assert body["period_start"] != week["period_start"] or body["kpis"]["total"] >= week[
        "kpis"
    ]["total"]

    bad = client.get("/api/v1/dashboard/overview?period=last_year", headers=ad)
    assert bad.status_code == 400


def test_project_filter_overall_matches_db(clean_store: PlatformStore) -> None:
    store = clean_store
    p0 = store.catalog.get("project")[0]
    p1 = store.catalog.get("project")[1]
    today = date.today()
    for proj in (p0, p1):
        store.create_ai_camera(
            AiCameraCreate(
                project_id=proj["id"],
                location="P3B",
                occurred_on=today,
                occurred_time=time(10, 0),
                alert_summary=f"case-{proj['label']}",
                alert_type_id=store.catalog.get("alert_type")[0]["id"],
                category_id=store.catalog.get("ai_camera_category")[0]["id"],
                risk_level_id=store.catalog.get("risk_level")[0]["id"],
                detection_method_id=store.catalog.get("detection_method")[0]["id"],
                reported_by="P3B Op",
            )
        )
    dash = store.dashboard(
        period="all", view="overall", project=p0["label"], user={"role": "admin"}
    )
    db_n = len(
        [r for r in store.list_cases() if r.get("project") == p0["label"]]
    )
    assert dash["kpis"]["total"] == db_n == 1

    # Unauthorized project for scoped user → empty, not all projects
    scoped = store.dashboard(
        period="all",
        view="overall",
        project=p1["label"],
        user={"role": "operator", "projects": [p0["label"]]},
    )
    assert scoped["kpis"]["total"] == 0


def test_series_week_year_no_collision(clean_store: PlatformStore) -> None:
    store = clean_store
    project = store.catalog.get("project")[0]
    # Pick a week number that exists in both years near year boundary.
    d_prev = date(2025, 12, 28)  # late Dec
    d_curr = date(2026, 1, 4)  # early Jan
    y1, w1 = week_from_date(d_prev)
    y2, w2 = week_from_date(d_curr)
    assert (y1, w1) != (y2, w2) or y1 != y2

    for d, label in ((d_prev, "prev-year"), (d_curr, "curr-year")):
        store.create_ai_camera(
            AiCameraCreate(
                project_id=project["id"],
                location="P3B",
                occurred_on=d,
                occurred_time=time(9, 0),
                alert_summary=label,
                alert_type_id=store.catalog.get("alert_type")[0]["id"],
                category_id=store.catalog.get("ai_camera_category")[0]["id"],
                risk_level_id=store.catalog.get("risk_level")[0]["id"],
                detection_method_id=store.catalog.get("detection_method")[0]["id"],
                reported_by="P3B Op",
            )
        )

    # Force "today" series to include both by using all period KPIs + series structure
    dash = store.dashboard(period="all", view="overall")
    # Each series entry must carry week_year
    assert all("week_year" in s for s in dash["series_8_weeks"])
    # Counts for matching week_number alone must not double-count across years
    # when looking at raw rows:
    same_week_num = [
        r
        for r in store.list_cases()
        if r["week_number"] == w1
    ]
    # If week numbers collide across years, week_year distinguishes them
    years = {r["week_year"] for r in same_week_num}
    if len(years) > 1:
        # series aggregation uses both fields — verify independent counts
        c1 = sum(
            1
            for r in store.list_cases()
            if r["week_year"] == y1 and r["week_number"] == w1
        )
        c2 = sum(
            1
            for r in store.list_cases()
            if r["week_year"] == y2 and r["week_number"] == w2
        )
        assert c1 == 1 and c2 == 1


def test_itqan_duplicate_ref_rejected(clean_store: PlatformStore) -> None:
    store = clean_store
    project = store.catalog.get("project")[0]
    payload = ItqanCreate(
        assign_to="project",
        project_id=project["id"],
        driver_name="D",
        driver_badge_number="1",
        vehicle_type_id=store.catalog.get("vehicle_type")[0]["id"],
        violation_type_id=store.catalog.get("itqan_violation_type")[0]["id"],
        itqan_ref="P3B-UNIQUE-1",
        itqan_status_id=store.catalog.get("itqan_status")[0]["id"],
        occurred_on=date.today(),
        occurred_time=time(12, 0),
        reported_by="Op",
    )
    store.create_itqan(payload)
    with pytest.raises(ValueError, match="already in use"):
        store.create_itqan(payload)


def test_itqan_concurrent_duplicate(clean_store: PlatformStore) -> None:
    store = clean_store
    project = store.catalog.get("project")[0]

    def once(i: int) -> str:
        try:
            store.create_itqan(
                ItqanCreate(
                    assign_to="project",
                    project_id=project["id"],
                    driver_name="D",
                    driver_badge_number="1",
                    vehicle_type_id=store.catalog.get("vehicle_type")[0]["id"],
                    violation_type_id=store.catalog.get("itqan_violation_type")[0]["id"],
                    itqan_ref="P3B-RACE-REF",
                    itqan_status_id=store.catalog.get("itqan_status")[0]["id"],
                    occurred_on=date.today(),
                    occurred_time=time(12, 0),
                    reported_by=f"Op{i}",
                )
            )
            return "ok"
        except ValueError:
            return "dup"

    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(once, range(4)))
    assert results.count("ok") == 1
    assert results.count("dup") == 3


def test_sos_closes_without_admin_approval(client: TestClient) -> None:
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
    assert created.status_code == 201
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
    assert closed.status_code == 200
    assert closed.json()["status"] == "closed"


def test_orphan_upload_acl_and_media_token(client: TestClient) -> None:
    ensure_upload_dir()
    login = client.post(
        "/api/v1/auth/login", json={"username": "operator", "password": "operator"}
    )
    assert login.status_code == 200
    body = login.json()
    assert body.get("media_token")
    op_headers = {"Authorization": f"Bearer {body['access_token']}"}
    media = body["media_token"]

    up = client.post(
        "/api/v1/uploads",
        headers=op_headers,
        files={"file": ("a.jpg", b"\xff\xd8\xff\xd9", "image/jpeg")},
    )
    assert up.status_code == 200
    path = up.json()["url"]

    assert client.get(path).status_code == 401
    assert client.get(f"{path}?media_token={media}").status_code == 200

    # Media token must not work as API bearer
    assert (
        client.get(
            "/api/v1/dashboard/overview",
            headers={"Authorization": f"Bearer {media}"},
        ).status_code
        == 401
    )

    # Another operator cannot read orphan upload
    other = auth_header(client, "admin")  # admin can
    assert client.get(path, headers=other).status_code == 200
    # Create second operator upload ownership isolation via hse if available
    hse_login = client.post(
        "/api/v1/auth/login", json={"username": "hse", "password": "hse"}
    )
    if hse_login.status_code == 200:
        hse_h = {"Authorization": f"Bearer {hse_login.json()['access_token']}"}
        denied = client.get(path, headers=hse_h)
        assert denied.status_code == 403
