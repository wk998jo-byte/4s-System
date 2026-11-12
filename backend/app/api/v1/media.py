"""Authenticated attachment download (replaces public StaticFiles /uploads)."""

from __future__ import annotations

import re
from pathlib import Path

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from fastapi.responses import Response

from app.core.config import get_settings
from app.schemas.auth import UserOut
from app.services.media_store import get_media_store
from app.services.platform_store import platform_store
from app.services.uploads import ensure_upload_dir

# Mounted at application root (not under /api/v1) so stored `/uploads/...`
# paths in case fields keep working after auth is enforced.
router = APIRouter(tags=["Uploads"])

_SAFE_NAME = re.compile(r"^[A-Za-z0-9._\-]+$")


def _resolve_token(
    authorization: str | None,
    media_token: str | None,
    access_token: str | None,
) -> str | None:
    # Prefer dedicated short-lived media_token over full session access_token.
    if media_token and media_token.strip():
        return media_token.strip()
    if access_token and access_token.strip():
        if not get_settings().legacy_upload_access_token_allowed:
            raise HTTPException(
                status_code=401,
                detail=(
                    "Legacy access_token query is disabled. "
                    "Use media_token from login or Authorization Bearer."
                ),
            )
        return access_token.strip()
    if not authorization:
        return None
    scheme, _, value = authorization.partition(" ")
    if scheme.lower() != "bearer" or not value:
        return None
    return value.strip()


def require_upload_user(
    authorization: str | None = Header(default=None),
    media_token: str | None = Query(
        default=None,
        description="Short-lived attachment token from login (preferred for <img>).",
    ),
    access_token: str | None = Query(
        default=None,
        description="Legacy: API session token. Disabled in production by default.",
    ),
) -> UserOut:
    """Auth for media: Authorization, media_token, or legacy access_token query."""
    token = _resolve_token(authorization, media_token, access_token)
    if not token:
        raise HTTPException(
            status_code=401, detail="Sign in as Admin or Operator to continue."
        )
    user = platform_store.user_from_token(token, allow_media=True)
    if not user:
        raise HTTPException(status_code=401, detail="Session expired. Sign in again.")
    return UserOut(**user)


def _media_type_for(name: str) -> str:
    lower = name.lower()
    if lower.endswith((".jpg", ".jpeg")):
        return "image/jpeg"
    if lower.endswith(".png"):
        return "image/png"
    if lower.endswith(".gif"):
        return "image/gif"
    if lower.endswith(".webp"):
        return "image/webp"
    if lower.endswith(".bmp"):
        return "image/bmp"
    return "application/octet-stream"


@router.get("/uploads/{stored_name}")
def get_upload(
    stored_name: str,
    user: UserOut = Depends(require_upload_user),
):
    """Serve an uploaded image after auth + path checks.

    Stored case fields keep `/uploads/<name>` paths. Anonymous access is denied.
    Bytes come from local disk or Replit App Storage (MEDIA_BACKEND).
    """
    name = Path(stored_name).name
    if name != stored_name or not _SAFE_NAME.match(name) or ".." in stored_name:
        raise HTTPException(status_code=400, detail="Invalid attachment name.")
    if not platform_store.user_can_access_upload(user.model_dump(), name):
        raise HTTPException(status_code=403, detail="You cannot access this attachment.")
    # Refresh local root when UPLOAD_DIR overrides change; object backend no-ops path.
    ensure_upload_dir()
    data = get_media_store().get_bytes(name)
    if data is None:
        raise HTTPException(status_code=404, detail="Attachment not found.")
    return Response(
        content=data,
        media_type=_media_type_for(name),
        headers={
            "Content-Disposition": f'inline; filename="{name}"',
            "Cache-Control": "private, no-store",
        },
    )
