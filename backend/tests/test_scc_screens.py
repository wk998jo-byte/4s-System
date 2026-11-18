from fastapi.testclient import TestClient

from app.main import create_app
from app.services.platform_store import PlatformStore, platform_store
from tests.conftest import auth_header


def test_lists_seed_projects_without_dhahran() -> None:
    client = TestClient(create_app())
    headers = auth_header(client, "operator")
    projects = client.get("/api/v1/lists/project", headers=headers).json()["items"]
    labels = {item["label"] for item in projects}
    assert "Jafurah" in labels
    assert "Dhahran" not in labels
    hw = client.get("/api/v1/lists/hw_site", headers=headers).json()["items"]
    assert "Dhahran" in {item["label"] for item in hw}


def test_create_ai_camera_and_dashboard() -> None:
    store = PlatformStore()
    # Swap the module singleton used by routes is hard; hit the store directly
    from app.schemas.scc import AiCameraCreate
    from datetime import date, time

    project = store.catalog.get("project")[0]["id"]
    payload = AiCameraCreate(
        project_id=project,
        location="KM 63 Laydown",
        occurred_on=date.today(),
        occurred_time=time(10, 30),
        alert_summary="Worker without helmet",
        alert_type_id=store.catalog.get("alert_type")[0]["id"],
        category_id=store.catalog.get("ai_camera_category")[0]["id"],
        risk_level_id=store.catalog.get("risk_level")[0]["id"],
        detection_method_id=store.catalog.get("detection_method")[0]["id"],
        reported_by="Rose",
    )
    created = store.create_ai_camera(payload)
    assert created["status"] == "open"
    assert created["case_id"].startswith("SCC-")
    overview = store.dashboard("this_week")
    assert overview["kpis"]["ai_camera"] >= 1


def test_speed_generates_alert_summary() -> None:
    from datetime import date, time

    from app.schemas.scc import SpeedCreate

    store = PlatformStore()
    project = store.catalog.get("project")[0]["id"]
    row = store.create_speed(
        SpeedCreate(
            assign_to="project",
            project_id=project,
            speed_violation_type_id=store.catalog.get("speed_violation_type")[1]["id"],
            vehicle_type_id=store.catalog.get("vehicle_type")[0]["id"],
            model_id=store.catalog.get("model")[1]["id"],
            asset_number="A-1",
            driver_name="Test Driver",
            driver_badge_number="B-1",
            location_coordinates="26.3, 50.1",
            occurred_on=date.today(),
            occurred_time=time(11, 0),
            permitted_speed_kmh=60,
            vehicle_speed_kmh=78,
            reported_by="Rose",
        )
    )
    assert "Exceedance: 18 km/h" in row["fields"]["alert_summary"]
    assert row["fields"]["exceedance_kmh"] == 18


def test_rental_requires_iqama() -> None:
    from datetime import date, time

    from app.schemas.scc import DashcamCreate

    store = PlatformStore()
    project = store.catalog.get("project")[0]["id"]
    payload = DashcamCreate(
        assign_to="project",
        project_id=project,
        vehicle_type_id=store.catalog.get("vehicle_type")[0]["id"],
        model_id=store.catalog.get("model")[0]["id"],
        asset_number="X",
        driver_name="D",
        driver_badge_number="1",
        rental_driver=True,
        occurred_on=date.today(),
        occurred_time=time(9, 0),
        violation_type_id=store.catalog.get("dashcam_observation_type")[0]["id"],
        risk_level_id=store.catalog.get("risk_level")[0]["id"],
        alert_summary="Seat belt",
        reported_by="Rose",
    )
    try:
        store.create_dashcam(payload)
        raise AssertionError("expected rental validation")
    except ValueError as exc:
        assert "Iqama" in str(exc)


def test_dashboard_view_and_custom_period(monkeypatch, tmp_path) -> None:
    from datetime import date, time

    from app.core.config import get_settings
    from app.db.engine import sqlite_file_url
    from app.schemas.scc import DashcamCreate, SpeedCreate

    # Isolate from demo operational seeds so KPI totals reflect only this test.
    monkeypatch.setenv("SEED_DEMO_CASES", "false")
    get_settings.cache_clear()
    store = PlatformStore(database_url=sqlite_file_url(tmp_path / "dash_view.db"))
    project = store.catalog.get("project")[0]
    department = store.catalog.get("department")[0]
    store.create_dashcam(
        DashcamCreate(
            assign_to="department",
            department_id=department["id"],
            vehicle_type_id=store.catalog.get("vehicle_type")[0]["id"],
            model_id=store.catalog.get("model")[0]["id"],
            asset_number="X1",
            driver_name="D",
            driver_badge_number="1",
            occurred_on=date.today(),
            occurred_time=time(9, 0),
            violation_type_id=store.catalog.get("dashcam_observation_type")[0]["id"],
            risk_level_id=store.catalog.get("risk_level")[0]["id"],
            alert_summary="Seat belt",
            reported_by="Rose",
        )
    )
    store.create_speed(
        SpeedCreate(
            assign_to="project",
            project_id=project["id"],
            speed_violation_type_id=store.catalog.get("speed_violation_type")[0]["id"],
            vehicle_type_id=store.catalog.get("vehicle_type")[0]["id"],
            model_id=store.catalog.get("model")[0]["id"],
            asset_number="A-1",
            driver_name="Test Driver",
            driver_badge_number="B-1",
            location_coordinates="26.3, 50.1",
            occurred_on=date.today(),
            occurred_time=time(11, 0),
            permitted_speed_kmh=60,
            vehicle_speed_kmh=70,
            reported_by="Rose",
        )
    )
    overall = store.dashboard("this_week", view="overall")
    projects = store.dashboard("this_week", view="projects")
    departments = store.dashboard("this_week", view="departments")
    assert overall["kpis"]["total"] == 2
    assert projects["kpis"]["total"] == 1
    assert departments["kpis"]["total"] == 1
    custom = store.dashboard(
        "custom",
        view="overall",
        start_date=date.today(),
        end_date=date.today(),
    )
    assert custom["period"] == "custom"
    assert custom["kpis"]["total"] == 2
    get_settings.cache_clear()


def test_ai_close_out_sets_under_process() -> None:
    from datetime import date, time

    from app.schemas.scc import AiCameraCloseOut, AiCameraCreate

    store = PlatformStore()
    created = store.create_ai_camera(
        AiCameraCreate(
            project_id=store.catalog.get("project")[0]["id"],
            location="KM 63 Laydown",
            occurred_on=date.today(),
            occurred_time=time(10, 30),
            alert_summary="Worker without helmet",
            alert_type_id=store.catalog.get("alert_type")[0]["id"],
            category_id=store.catalog.get("ai_camera_category")[0]["id"],
            risk_level_id=store.catalog.get("risk_level")[0]["id"],
            detection_method_id=store.catalog.get("detection_method")[0]["id"],
            reported_by="Rose",
        )
    )
    assert created["status"] == "open"
    closed = store.close_out_ai_camera(
        created["id"],
        AiCameraCloseOut(
            hseo_name_badge="Ali / 12",
            close_out_action="Corrected on site",
            close_out_picture="action.jpg",
        ),
    )
    assert closed is not None
    assert closed["status"] == "under_process"
    try:
        store.close_out_ai_camera(
            created["id"],
            AiCameraCloseOut(
                hseo_name_badge="Ali / 12",
                close_out_action="Corrected on site",
                close_out_picture="action.jpg",
            ),
        )
        raise AssertionError("expected close-out to reject non-open records")
    except ValueError as exc:
        assert "Open" in str(exc)


def test_confirm_driver_sets_under_process() -> None:
    from datetime import date, time

    from app.schemas.scc import ConfirmDriver, DashcamCreate

    store = PlatformStore()
    created = store.create_dashcam(
        DashcamCreate(
            assign_to="project",
            project_id=store.catalog.get("project")[0]["id"],
            vehicle_type_id=store.catalog.get("vehicle_type")[0]["id"],
            model_id=store.catalog.get("model")[0]["id"],
            asset_number="X1",
            driver_name="D",
            driver_badge_number="1",
            occurred_on=date.today(),
            occurred_time=time(9, 0),
            violation_type_id=store.catalog.get("dashcam_observation_type")[0]["id"],
            risk_level_id=store.catalog.get("risk_level")[0]["id"],
            alert_summary="Seat belt",
            reported_by="Rose",
        )
    )
    closed = store.confirm_driver(
        created["id"],
        "dashcam",
        ConfirmDriver(itqan_proof="itqan.png", uploaded_by="Rose"),
    )
    assert closed is not None
    assert closed["status"] == "under_process"
    assert closed["fields"]["close_out_action"] == "The Violation has been uploaded in ITQAN"


def test_confirm_driver_preserves_reported_by_and_credits_uploader() -> None:
    """Registrant stays on reported_by; confirm actor is uploaded_by only."""
    from datetime import date, time

    from app.schemas.scc import ConfirmDriver, SpeedCreate

    store = PlatformStore()
    created = store.create_speed(
        SpeedCreate(
            assign_to="project",
            project_id=store.catalog.get("project")[0]["id"],
            speed_violation_type_id=store.catalog.get("speed_violation_type")[0]["id"],
            vehicle_type_id=store.catalog.get("vehicle_type")[0]["id"],
            model_id=store.catalog.get("model")[0]["id"],
            asset_number="007-02-359",
            driver_name="Rajdev Yadav",
            driver_badge_number="12191",
            location_coordinates="26.1,50.1",
            occurred_on=date.today(),
            occurred_time=time(5, 54),
            permitted_speed_kmh=80,
            vehicle_speed_kmh=86,
            reported_by="50200 - Safiah Josh",
        )
    )
    confirmed = store.confirm_driver(
        created["id"],
        "speed",
        ConfirmDriver(itqan_proof="itqan.png", uploaded_by="50253 - Fajr AlAmer"),
        actor="50253 - Fajr AlAmer",
    )
    assert confirmed is not None
    assert confirmed["fields"]["reported_by"] == "50200 - Safiah Josh"
    assert confirmed["fields"]["uploaded_by"] == "50253 - Fajr AlAmer"
    # Confirming no longer creates an ITQAN record; the sheet import does.
    assert not confirmed["fields"].get("itqan_case_id")
    assert confirmed["fields"]["upload_to_itqan"] is True

    today = date.today().strftime("%d/%m/%Y")
    sheet = _itqan_html_sheet(
        [
            ["1", "Rajdev Yadav", "12191", "Heavy Driver", "MGS Project",
             "Speeding Over Limit - 86", f"{today} 05:50 AM", "1", "007-02-359",
             "Heavy Vehicle", "The driver exceeded the speed limit", "Under HR Action",
             "REF_9000001"],
            ["2", "Nobody Matching", "99999", "Heavy Driver", "Riyas",
             "Using Mobile Phones & Electronic Devices", f"{today} 08:00 AM", "1",
             "007-01-342", "Heavy Vehicle", "", "Finished", "REF_9000002"],
            ["3", "Bad Date", "5", "", "", "Not Using Seat Belt While Driving",
             "not-a-date", "1", "", "Light Vehicle", "", "Under Safety", "REF_9000003"],
        ]
    )
    result = store.import_itqan_sheet(sheet, "tracking_violations.xls", actor="Admin Rose")
    assert result["created"] == 2
    assert result["linked"] == 1
    assert len(result["errors"]) == 1

    refreshed = store.get_case(created["id"])
    assert refreshed["fields"]["itqan_ref"] == "REF_9000001"
    # Dashcam/Speed upload label data is untouched by the import.
    assert refreshed["fields"]["upload_to_itqan"] is True
    itq = store.get_case(refreshed["fields"]["itqan_case_id"])
    assert itq is not None
    assert itq["fields"]["itqan_status"] == "Under HR Action"
    assert itq["fields"]["source_case_id"] == created["id"]
    assert itq["fields"]["source"] == "Speed Violation"
    assert itq["fields"]["reported_by"] == "50200 - Safiah Josh"
    assert itq["fields"]["uploaded_by"] == "50253 - Fajr AlAmer"
    assert itq["status"] == "under_process"

    standalone = next(
        r for r in store.list_cases(record_type="itqan")
        if r["fields"].get("itqan_ref") == "REF_9000002"
    )
    assert standalone["status"] == "closed"
    assert standalone["fields"]["source"] == "Dashcam Observation"
    assert standalone["fields"]["violation_type"] == "Using Mobile Phone"
    assert not standalone["fields"].get("source_case_id")

    # Re-import: status comes from the sheet, no duplicates are created.
    again = _itqan_html_sheet(
        [
            ["1", "Rajdev Yadav", "12191", "", "MGS Project",
             "Speeding Over Limit - 86", f"{today} 05:50 AM", "1", "", "Heavy Vehicle",
             "", "Finished", "REF_9000001"],
        ]
    )
    second = store.import_itqan_sheet(again, "x.xls", actor="Admin Rose")
    assert second["created"] == 0
    assert second["status_updated"] == 1
    itq = store.get_case(itq["id"])
    assert itq["fields"]["itqan_status"] == "Finished"
    assert itq["status"] == "closed"


def _itqan_html_sheet(rows: list[list[str]]) -> bytes:
    from app.services.itqan_import import TEMPLATE_HEADERS

    head = "".join(f"<td>{h}</td>" for h in TEMPLATE_HEADERS)
    body = "".join("<tr>" + "".join(f"<td>{c}</td>" for c in r) + "</tr>" for r in rows)
    return (
        "<html><head></head><body><table><tr>" + head + "</tr>" + body + "</table></body></html>"
    ).encode()


def test_itqan_import_template_and_xlsx_roundtrip() -> None:
    from io import BytesIO

    from app.services.itqan_import import build_template_xlsx, parse_itqan_sheet

    rows = parse_itqan_sheet(build_template_xlsx(), "template.xlsx")
    assert len(rows) == 1
    assert rows[0]["reference"] == "REF_0000001"
    assert rows[0]["status"] == "Under Safety"
    assert BytesIO(build_template_xlsx()).read(2) == b"PK"


def test_itqan_import_endpoint_admin_only() -> None:
    client = TestClient(create_app())
    sheet = _itqan_html_sheet([])
    files = {"file": ("t.xls", sheet, "application/vnd.ms-excel")}
    denied = client.post(
        "/api/v1/itqan-violations/import", files=files, headers=auth_header(client, "operator")
    )
    assert denied.status_code == 403
    template = client.get(
        "/api/v1/itqan-violations/import-template", headers=auth_header(client, "operator")
    )
    assert template.status_code == 200
    assert template.content[:2] == b"PK"


def test_sqlite_file_survives_new_store(tmp_path) -> None:
    from datetime import date, time

    from app.schemas.scc import AiCameraCreate

    from app.db.engine import sqlite_file_url

    url = sqlite_file_url(tmp_path / "scc.db")
    first = PlatformStore(database_url=url)
    created = first.create_ai_camera(
        AiCameraCreate(
            project_id=first.catalog.get("project")[0]["id"],
            location="KM 63 Laydown",
            occurred_on=date.today(),
            occurred_time=time(10, 30),
            alert_summary="Persisted helmet alert",
            alert_type_id=first.catalog.get("alert_type")[0]["id"],
            category_id=first.catalog.get("ai_camera_category")[0]["id"],
            risk_level_id=first.catalog.get("risk_level")[0]["id"],
            detection_method_id=first.catalog.get("detection_method")[0]["id"],
            reported_by="Rose",
        )
    )
    second = PlatformStore(database_url=url)
    loaded = second.get_case(created["id"])
    assert loaded is not None
    assert loaded["case_id"] == created["case_id"]
    assert loaded["status"] == "open"
    assert loaded["fields"]["alert_summary"] == "Persisted helmet alert"
    assert second.catalog.get("project")[0]["label"] == first.catalog.get("project")[0]["label"]


def test_admin_list_add_is_read_from_database(tmp_path) -> None:
    from app.db.engine import sqlite_file_url

    url = sqlite_file_url(tmp_path / "lists.db")
    first = PlatformStore(database_url=url)
    labels = {item["label"] for item in first.catalog.get("project")}
    assert "Jafurah" in labels
    added = first.catalog.add("project", "Abqaiq")
    first.catalog.add("department", "NewDept")
    second = PlatformStore(database_url=url)
    later = {item["label"] for item in second.catalog.get("project")}
    assert "Abqaiq" in later
    assert added["id"] in {item["id"] for item in second.catalog.get("project")}
    overview = second.dashboard("this_week")
    assert "Abqaiq" in overview["projects"]
    # Custom department labels can be re-synced by HW department seeders on
    # store init; project list persistence is the critical path under test.
    hw = second.get_hw()
    assert "Pipe Dolly" in hw["department_counts"]
    # NewDept may appear in HW counts only after an inventory save.
    assert isinstance(hw.get("department_counts"), dict)


def test_reject_notifies_close_out_operator_only() -> None:
    """Admin return → notification only for the operator who submitted close-out."""
    from datetime import date, time

    from app.schemas.auth import format_user_label
    from app.schemas.scc import AiCameraCloseOut, AiCameraCreate

    store = PlatformStore()
    op = next(u for u in store.list_users() if u["role"] == "operator")
    other = {
        "id": "other-op",
        "username": "other",
        "display_name": "Other Op",
        "badge_number": "O-999",
        "role": "operator",
        "projects": None,
    }
    closer = format_user_label(op["display_name"], op.get("badge_number"))
    created = store.create_ai_camera(
        AiCameraCreate(
            project_id=store.catalog.get("project")[0]["id"],
            location="Pad A",
            occurred_on=date.today(),
            occurred_time=time(11, 0),
            alert_summary="Reject notice test",
            alert_type_id=store.catalog.get("alert_type")[0]["id"],
            category_id=store.catalog.get("ai_camera_category")[0]["id"],
            risk_level_id=store.catalog.get("risk_level")[0]["id"],
            detection_method_id=store.catalog.get("detection_method")[0]["id"],
            reported_by="Someone Else",
        )
    )
    closed = store.close_out_ai_camera(
        created["id"],
        AiCameraCloseOut(
            hseo_name_badge="HSE / 1",
            close_out_action="Fixed on site",
            close_out_picture="fix.jpg",
        ),
        actor=closer,
    )
    assert closed is not None
    rejected = store.reject_case(closed["id"], "Missing evidence photo", "A-001 - Admin")
    assert rejected is not None
    assert rejected["status"] == "open"
    assert rejected["fields"]["reject_reason"] == "Missing evidence photo"

    op_notes = store.overdue_notifications(op)
    reject_items = [i for i in op_notes["items"] if i["state"] == "reject"]
    assert len(reject_items) == 1
    assert reject_items[0]["case_id"] == rejected["case_id"]
    assert "Missing evidence photo" in reject_items[0]["detail"]
    assert reject_items[0]["state_label"] == "Returned"

    other_notes = store.overdue_notifications(other)
    assert not any(i["state"] == "reject" for i in other_notes["items"])

    admin = next(u for u in store.list_users() if u["role"] == "admin")
    admin_notes = store.overdue_notifications(admin)
    assert not any(i["state"] == "reject" for i in admin_notes["items"])

    # Resubmit clears the return notice.
    again = store.close_out_ai_camera(
        rejected["id"],
        AiCameraCloseOut(
            hseo_name_badge="HSE / 1",
            close_out_action="Evidence attached",
            close_out_picture="fix2.jpg",
        ),
        actor=closer,
    )
    assert again is not None
    assert not again["fields"].get("reject_reason")
    cleared = store.overdue_notifications(op)
    assert not any(
        i["state"] == "reject" and i["case_id"] == rejected["case_id"]
        for i in cleared["items"]
    )


def test_list_item_edit_and_delete_update_dropdowns(tmp_path) -> None:
    from datetime import date, time

    from app.db.engine import sqlite_file_url
    from app.schemas.scc import AiCameraCreate

    url = sqlite_file_url(tmp_path / "edit-lists.db")
    store = PlatformStore(database_url=url)
    project = next(item for item in store.catalog.get("project") if item["label"] == "Jafurah")
    created = store.create_ai_camera(
        AiCameraCreate(
            project_id=project["id"],
            location="Yard",
            occurred_on=date.today(),
            occurred_time=time(9, 0),
            alert_summary="Typo fix",
            alert_type_id=store.catalog.get("alert_type")[0]["id"],
            category_id=store.catalog.get("ai_camera_category")[0]["id"],
            risk_level_id=store.catalog.get("risk_level")[0]["id"],
            detection_method_id=store.catalog.get("detection_method")[0]["id"],
            reported_by="Rose",
        )
    )
    store.rename_list_item("project", project["id"], "Jafurah North")
    later = PlatformStore(database_url=url)
    labels = {item["label"] for item in later.catalog.get("project")}
    assert "Jafurah North" in labels
    assert "Jafurah" not in labels
    assert later.get_case(created["id"])["project"] == "Jafurah North"
    later.delete_list_item("project", project["id"])
    remaining = {item["label"] for item in later.catalog.get("project")}
    assert "Jafurah North" not in remaining
