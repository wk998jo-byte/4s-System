"""Local file storage for observation / close-out pictures (prototype)."""

from __future__ import annotations

import re
import struct
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException, UploadFile

UPLOAD_DIR = Path(__file__).resolve().parents[2] / "data" / "uploads"
ALLOWED_EXT = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"}
MAX_BYTES = 12 * 1024 * 1024  # 12 MB


def ensure_upload_dir() -> Path:
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    return UPLOAD_DIR


def ensure_demo_image(stem: str, *, hue: int = 210) -> str:
    """Write a small landscape placeholder BMP and return its `/uploads/...` URL."""
    ensure_upload_dir()
    name = re.sub(r"[^\w.\-]+", "_", stem).strip("._") or "demo"
    stored = f"{name}.bmp"
    dest = UPLOAD_DIR / stored
    if not dest.exists():
        # 58×38 BMP matches .ai-thumb aspect; colors vary by hue bucket.
        w, h = 58, 38
        r = 40 + (hue * 3) % 120
        g = 55 + (hue * 5) % 90
        b = 70 + (hue * 7) % 110
        pad = (4 - (w * 3) % 4) % 4
        # BMP rows are bottom-up; build sky→ground gradient.
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
        dest.write_bytes(header + dib + pixels)
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
    ensure_upload_dir()
    stored = f"{uuid4().hex}{ext}"
    dest = UPLOAD_DIR / stored
    size = 0
    try:
        with dest.open("wb") as out:
            while True:
                chunk = await file.read(1024 * 64)
                if not chunk:
                    break
                size += len(chunk)
                if size > MAX_BYTES:
                    out.close()
                    dest.unlink(missing_ok=True)
                    raise HTTPException(
                        status_code=400,
                        detail="Image is too large (max 12 MB).",
                    )
                out.write(chunk)
    finally:
        await file.close()
    if size == 0:
        dest.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail="Empty file.")
    return {
        "url": f"/uploads/{stored}",
        "filename": original,
        "stored_name": stored,
        "content_type": content_type,
        "size": size,
    }
