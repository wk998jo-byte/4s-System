"""Local MediaStore + MEDIA_BACKEND wiring (no Replit credentials required)."""

from __future__ import annotations

from io import BytesIO
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.services.media_store import LocalMediaStore, reset_media_store_cache
from app.services.uploads import ensure_upload_dir


@pytest.fixture(autouse=True)
def _clear_settings_and_store(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("MEDIA_BACKEND", "local")
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path / "uploads"))
    get_settings.cache_clear()
    reset_media_store_cache()
    yield
    get_settings.cache_clear()
    reset_media_store_cache()


def test_local_media_store_roundtrip(tmp_path: Path) -> None:
    root = tmp_path / "media"
    store = LocalMediaStore(root)
    store.ensure_ready()
    store.probe_writable()
    store.put_bytes("a.png", b"\x89PNG")
    assert store.exists("a.png")
    assert store.get_bytes("a.png") == b"\x89PNG"
    store.delete("a.png")
    assert store.get_bytes("a.png") is None


def test_ensure_upload_dir_respects_upload_dir(tmp_path: Path) -> None:
    root = ensure_upload_dir()
    assert root == (tmp_path / "uploads").resolve()
    assert root.is_dir()


def test_upload_and_download_via_media_backend(client: TestClient) -> None:
    login = client.post(
        "/api/v1/auth/login",
        json={"username": "admin", "password": "admin"},
    )
    assert login.status_code == 200, login.text
    token = login.json()["access_token"]
    media = login.json().get("media_token") or token
    headers = {"Authorization": f"Bearer {token}"}

    png = b"\x89PNG\r\n\x1a\n" + (b"\x00" * 32)
    files = {"file": ("probe.png", BytesIO(png), "image/png")}
    up = client.post("/api/v1/uploads", headers=headers, files=files)
    assert up.status_code == 200, up.text
    stored = up.json()["stored_name"]
    disk = Path(get_settings().upload_dir) / stored
    assert disk.is_file()

    got = client.get(f"/uploads/{stored}?media_token={media}")
    assert got.status_code == 200
    assert got.content.startswith(b"\x89PNG")
    assert got.headers.get("cache-control", "").startswith("private")

    denied = client.get(f"/uploads/{stored}")
    assert denied.status_code == 401


def test_ready_reports_local_media_backend(client: TestClient) -> None:
    res = client.get("/api/v1/ready")
    assert res.status_code in {200, 503}
    body = res.json()
    assert body.get("media_backend") == "local"
