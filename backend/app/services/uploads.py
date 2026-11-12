"""Image upload helpers backed by MediaStore (local disk or Replit App Storage)."""

from __future__ import annotations

import re
import struct
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException, UploadFile

from app.services.media_store import (
    LocalMediaStore,
    get_media_store,
    reset_media_store_cache,
)

ALLOWED_EXT = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"}
MAX_BYTES = 12 * 1024 * 1024  # 12 MB

# Back-compat for tests that import UPLOAD_DIR; refreshed by ensure_upload_dir().
UPLOAD_DIR = Path(__file__).resolve().parents[2] / "data" / "uploads"


def ensure_upload_dir() -> Path:
    """Ensure media backend is ready. Returns local root when backend is local."""
    global UPLOAD_DIR
    # Rebuild when UPLOAD_DIR env / settings change (Phase 5 durable-path tests).
    store = get_media_store()
    if isinstance(store, LocalMediaStore):
        from app.services.media_store import _configured_local_root

        desired = _configured_local_root().expanduser().resolve()
        if store.root != desired:
            reset_media_store_cache()
            store = get_media_store()
    store.ensure_ready()
    if isinstance(store, LocalMediaStore):
        UPLOAD_DIR = store.root
        return UPLOAD_DIR
    # Object backend: keep default local dir for any transitional tooling.
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    return UPLOAD_DIR


def ensure_demo_image(stem: str, *, hue: int = 210) -> str:
    """Write a small landscape placeholder BMP and return its `/uploads/...` URL."""
    name = re.sub(r"[^\w.\-]+", "_", stem).strip("._") or "demo"
    stored = f"{name}.bmp"
    store = get_media_store()
    store.ensure_ready()
    if not store.exists(stored):
        # 58×38 BMP matches .ai-thumb aspect; colors vary by hue bucket.
        w, h = 58, 38
        r = 40 + (hue * 3) % 120
        g = 55 + (hue * 5) % 90
        b = 70 + (hue * 7) % 110
        pad = (4 - (w * 3) % 4) % 4
        rows: list[bytes] = []
        for i in range(h):
            t = i / max(h - 1, 1)
            rr = int(r + (180 - r) * (1 - t))
            gg = int(g + (150 - g) * (1 - t))
            bb = int(b + (220 - b) * (1 - t))
            rows.append(bytes((bb % 256, gg % 256, rr % 256)) * w + (b"\x00" * pad))
        pixels = b"".join(reversed(rows))
        file_size = 14 + 40 + len(pixels)
        header = struct.pack("<2sIHHI", b"BM", file_size, 0, 0, 54)
        dib = struct.pack(
            "<IIIHHIIIIII",
            40,
            w,
            h,
            1,
            24,
            0,
            len(pixels),
            2835,
            2835,
            0,
            0,
        )
        store.put_bytes(stored, header + dib + pixels)
    return f"/uploads/{stored}"


def _safe_ext(filename: str | None) -> str:
    name = (filename or "").strip()
    ext = Path(name).suffix.lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(
            status_code=400,
            detail="Unsupported image type. Use JPG, PNG, GIF, WEBP or BMP.",
        )
    return ext


def _safe_original_name(filename: str | None) -> str:
    raw = Path(filename or "image").name
    cleaned = re.sub(r"[^\w.\- ()\[\]]+", "_", raw).strip("._") or "image"
    return cleaned[:180]


async def save_upload(file: UploadFile) -> dict[str, str | int]:
    content_type = file.content_type or ""
    if not content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image.")
    ext = _safe_ext(file.filename)
    original = _safe_original_name(file.filename)
    store = get_media_store()
    store.ensure_ready()
    stored = f"{uuid4().hex}{ext}"
    chunks: list[bytes] = []
    size = 0
    try:
        while True:
            chunk = await file.read(1024 * 64)
            if not chunk:
                break
            size += len(chunk)
            if size > MAX_BYTES:
                raise HTTPException(
                    status_code=400,
                    detail="Image is too large (max 12 MB).",
                )
            chunks.append(chunk)
    finally:
        await file.close()
    if size == 0:
        raise HTTPException(status_code=400, detail="Empty file.")
    data = b"".join(chunks)
    try:
        store.put_bytes(stored, data)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=503,
            detail=f"Media storage unavailable ({type(exc).__name__}).",
        ) from exc
    return {
        "url": f"/uploads/{stored}",
        "filename": original,
        "stored_name": stored,
        "content_type": content_type,
        "size": size,
    }
