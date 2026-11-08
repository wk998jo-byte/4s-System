from fastapi.testclient import TestClient

from app.main import create_app
from tests.conftest import auth_header


def test_login_returns_role_and_capabilities() -> None:
    client = TestClient(create_app())
    body = client.post(
        "/api/v1/auth/login", json={"username": "operator", "password": "operator"}
    ).json()
    assert body["user"]["role"] == "operator"
    assert body["user"]["capabilities"]["approve_reject"] is False
    assert body["user"]["capabilities"]["register"] is True
    admin = client.post(
        "/api/v1/auth/login", json={"username": "admin", "password": "admin"}
    ).json()
    assert admin["user"]["capabilities"]["approve_reject"] is True


def test_operator_cannot_use_admin_routes() -> None:
    client = TestClient(create_app())
    headers = auth_header(client, "operator")
    denied = [
        client.post("/api/v1/lists/project/items", headers=headers, json={"label": "X"}),
        client.patch(
            "/api/v1/lists/project/items/not-a-real-id",
            headers=headers,
            json={"label": "Y"},
        ),
        client.put(
            "/api/v1/hw",
            headers=headers,
            json={"project_counts": {}, "department_counts": {}},
        ),
        client.get("/api/v1/operator-performance", headers=headers),
        client.get("/api/v1/admin/users", headers=headers),
    ]
    for response in denied:
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "ACCESS_DENIED"


def test_operator_can_register_admin_can_approve() -> None:
    from datetime import date, time

    client = TestClient(create_app())
    operator = auth_header(client, "operator")
    lists = {
        name: client.get(f"/api/v1/lists/{name}", headers=operator).json()["items"][0]["id"]
        for name in ("project", "alert_type", "ai_camera_category", "risk_level", "detection_method")
    }
    created = client.post(
        "/api/v1/ai-camera-observations",
        headers=operator,
        json={
            "project_id": lists["project"],
            "location": "KM 63",
            "occurred_on": date.today().isoformat(),
            "occurred_time": time(10, 0).strftime("%H:%M:%S"),
            "alert_summary": "Helmet",
            "alert_type_id": lists["alert_type"],
            "category_id": lists["ai_camera_category"],
            "risk_level_id": lists["risk_level"],
            "detection_method_id": lists["detection_method"],
            "reported_by": "Rose",
        },
    )
    assert created.status_code == 201
    case_id = created.json()["id"]
    closed = client.post(
        f"/api/v1/ai-camera-observations/{case_id}/close-out",
        headers=operator,
        json={
            "hseo_name_badge": "Ali / 1",
            "close_out_action": "Corrected",
            "close_out_picture": "a.jpg",
        },
    )
    assert closed.status_code == 200
    assert closed.json()["status"] == "under_process"
    blocked = client.post(f"/api/v1/cases/{case_id}/approve", headers=operator)
    assert blocked.status_code == 403
    admin = auth_header(client, "admin")
    approved = client.post(f"/api/v1/cases/{case_id}/approve", headers=admin)
    assert approved.status_code == 200
    assert approved.json()["status"] == "closed"
    assert approved.json()["fields"]["closed_by"] == "Admin"


def test_admin_can_add_project_used_by_operator() -> None:
    client = TestClient(create_app())
    admin = auth_header(client, "admin")
    created = client.post(
        "/api/v1/lists/project/items",
        headers=admin,
        json={"label": "Fadhili"},
    )
    assert created.status_code == 201
    operator = auth_header(client, "operator")
    labels = {
        item["label"]
        for item in client.get("/api/v1/lists/project", headers=operator).json()["items"]
    }
    assert "Jafurah" in labels
    assert "Fadhili" in labels
    overview = client.get("/api/v1/dashboard/overview", headers=operator).json()
    assert "Fadhili" in overview["projects"]


def test_lists_require_sign_in() -> None:
    client = TestClient(create_app())
    response = client.get("/api/v1/lists/project")
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHENTICATED"


def test_dept_hse_is_view_and_sign_only() -> None:
    from datetime import date, time

    client = TestClient(create_app())
    login = client.post(
        "/api/v1/auth/login", json={"username": "hse", "password": "hse"}
    ).json()
    caps = login["user"]["capabilities"]
    assert login["user"]["role"] == "dept_hse"
    assert caps["sign_reports"] is True
    assert caps["sign_monthly_reports"] is False
    assert caps["register"] is False
    assert caps["close_out"] is False
    assert caps["confirm_driver"] is False
    assert caps["close_sos"] is False
    assert caps["approve_reject"] is False
    assert caps["delete_record"] is False
    assert caps["edit_original"] is False
    assert caps["record_weather"] is False

    hse = auth_header(client, "hse")
    assert client.get("/api/v1/dashboard/overview", headers=hse).status_code == 200

    lists = {
        name: client.get(f"/api/v1/lists/{name}", headers=hse).json()["items"][0]["id"]
        for name in ("project", "alert_type", "ai_camera_category", "risk_level", "detection_method")
    }
    created = client.post(
        "/api/v1/ai-camera-observations",
        headers=hse,
        json={
            "project_id": lists["project"],
            "location": "KM 63",
            "occurred_on": date.today().isoformat(),
            "occurred_time": time(10, 0).strftime("%H:%M:%S"),
            "alert_summary": "Helmet",
            "alert_type_id": lists["alert_type"],
            "category_id": lists["ai_camera_category"],
            "risk_level_id": lists["risk_level"],
            "detection_method_id": lists["detection_method"],
            "reported_by": "HSE",
        },
    )
    assert created.status_code == 403

    operator = auth_header(client, "operator")
    row = client.post(
        "/api/v1/ai-camera-observations",
        headers=operator,
        json={
            "project_id": lists["project"],
            "location": "KM 63",
            "occurred_on": date.today().isoformat(),
            "occurred_time": time(10, 0).strftime("%H:%M:%S"),
            "alert_summary": "Helmet",
            "alert_type_id": lists["alert_type"],
            "category_id": lists["ai_camera_category"],
            "risk_level_id": lists["risk_level"],
            "detection_method_id": lists["detection_method"],
            "reported_by": "Rose",
        },
    )
    assert row.status_code == 201
    case_id = row.json()["id"]
    assert (
        client.post(
            f"/api/v1/ai-camera-observations/{case_id}/close-out",
            headers=hse,
            json={
                "hseo_name_badge": "Ali / 1",
                "close_out_action": "Corrected",
                "close_out_picture": "a.jpg",
            },
        ).status_code
        == 403
    )
    assert client.post(f"/api/v1/cases/{case_id}/approve", headers=hse).status_code == 403
    assert (
        client.post(
            f"/api/v1/cases/{case_id}/delete",
            headers=hse,
            json={"confirm": True},
        ).status_code
        == 403
    )
