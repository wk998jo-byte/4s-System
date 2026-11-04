import os

os.environ["DATABASE_URL"] = "sqlite+pysqlite:///:memory:"

import pytest
from fastapi.testclient import TestClient

from app.api.deps import get_record_store
from app.main import create_app
from app.services.record_store import InMemoryRecordStore


@pytest.fixture()
def record_store() -> InMemoryRecordStore:
    return InMemoryRecordStore()


@pytest.fixture()
def client(record_store: InMemoryRecordStore) -> TestClient:
    app = create_app()
    app.dependency_overrides[get_record_store] = lambda: record_store
    return TestClient(app)


def auth_header(client: TestClient, username: str = "admin", password: str | None = None) -> dict[str, str]:
    response = client.post(
        "/api/v1/auth/login",
        json={"username": username, "password": password or username},
    )
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}
