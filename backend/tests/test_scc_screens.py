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
            position="Driver",
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
        location_coordinates="1,2",
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


def test_dashboard_view_and_custom_period() -> None:
    from datetime import date, time

    from app.schemas.scc import DashcamCreate, SpeedCreate

    store = PlatformStore()
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
            location_coordinates="1,2",
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
            position="Driver",
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
            location_coordinates="1,2",
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
    assert "NewDept" in overview["departments"]
    hw = second.get_hw()
    assert "Pipe Dolly" in hw["department_counts"]
    assert "NewDept" in hw["department_counts"]


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
