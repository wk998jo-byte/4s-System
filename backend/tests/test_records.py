from uuid import uuid4

from fastapi.testclient import TestClient

from tests.conftest import auth_header


def test_list_records_requires_auth(client: TestClient) -> None:
    assert client.get("/api/v1/records").status_code == 401


def test_list_records_empty(client: TestClient) -> None:
    headers = auth_header(client, "operator")
    response = client.get("/api/v1/records", headers=headers)
    assert response.status_code == 200
    body = response.json()
    assert body["items"] == []
    assert body["total"] == 0
    assert body["prototype"] is True
    assert body["storage"] == "in_memory"


def test_create_record(client: TestClient) -> None:
    headers = auth_header(client, "operator")
    response = client.post(
        "/api/v1/records",
        headers=headers,
        json={
            "title": "Laydown camera observation",
            "module_type": "ai_camera",
            "status": "open",
            "notes": "Prototype test payload",
        },
    )
    assert response.status_code == 201
    body = response.json()
    assert body["title"] == "Laydown camera observation"
    assert body["module_type"] == "ai_camera"
    assert body["status"] == "open"
    assert body["prototype"] is True
    assert "id" in body
    assert "created_at" in body

    listed = client.get("/api/v1/records", headers=headers)
    assert listed.status_code == 200
    assert listed.json()["total"] == 1
    assert listed.json()["items"][0]["id"] == body["id"]


def test_create_record_validation_error(client: TestClient) -> None:
    headers = auth_header(client, "admin")
    response = client.post(
        "/api/v1/records",
        headers=headers,
        json={"module_type": "dashcam"},
    )
    assert response.status_code == 400
    body = response.json()
    assert body["error"]["code"] == "VALIDATION_ERROR"
    fields = {item["field"] for item in body["error"]["details"]}
    assert "title" in fields


def test_create_record_invalid_module(client: TestClient) -> None:
    headers = auth_header(client, "admin")
    response = client.post(
        "/api/v1/records",
        headers=headers,
        json={"title": "Bad module", "module_type": "analytics"},
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_get_record_not_found(client: TestClient) -> None:
    headers = auth_header(client, "operator")
    missing = uuid4()
    response = client.get(f"/api/v1/records/{missing}", headers=headers)
    assert response.status_code == 404
    body = response.json()
    assert body["error"]["code"] == "NOT_FOUND"


def test_get_record_by_id(client: TestClient) -> None:
    headers = auth_header(client, "operator")
    created = client.post(
        "/api/v1/records",
        headers=headers,
        json={"title": "SOS drill", "module_type": "sos"},
    )
    record_id = created.json()["id"]
    response = client.get(f"/api/v1/records/{record_id}", headers=headers)
    assert response.status_code == 200
    assert response.json()["title"] == "SOS drill"


def test_dashboard_summary_tracks_creates(client: TestClient) -> None:
    headers = auth_header(client, "admin")
    assert client.get("/api/v1/dashboard/summary").status_code == 401
    empty = client.get("/api/v1/dashboard/summary", headers=headers)
    assert empty.status_code == 200
    assert empty.json()["kpis"]["total_records"] == 0
    assert empty.json()["authentication"] == "required"

    client.post(
        "/api/v1/records",
        headers=headers,
        json={"title": "Speed check", "module_type": "speed", "status": "open"},
    )
    summary = client.get("/api/v1/dashboard/summary", headers=headers).json()
    assert summary["kpis"]["total_records"] == 1
    assert summary["kpis"]["open"] == 1
    assert summary["by_module"]["speed"] == 1
