from pathlib import Path

from fastapi import APIRouter, Depends, Response

from app.core.config import Settings, get_settings
from app.schemas.health import HealthResponse, ReadinessResponse
from app.services.media_store import get_media_store
from app.services.platform_store import platform_store
from app.services.uploads import ensure_upload_dir

router = APIRouter(tags=["Health"])

LIMITATION = (
    "Sign in required for operational APIs. Persistence via SQLAlchemy "
    "(SQLite or DATABASE_URL). Attachments require authenticated media access."
)


@router.get("/health", response_model=HealthResponse)
def health(
    settings: Settings = Depends(get_settings),
) -> HealthResponse:
    return HealthResponse(
        status="ok",
        service=settings.app_name,
        version=settings.app_version,
        storage=platform_store.storage_label(),
        authenticated=False,
        prototype=not settings.is_production,
        message=LIMITATION,
    )


@router.get("/ready", response_model=ReadinessResponse)
def ready(
    response: Response,
    settings: Settings = Depends(get_settings),
) -> ReadinessResponse:
    """Readiness: database ping + upload directory writable."""
    db_status = "ok"
    detail = None
    try:
        platform_store.ping_database()
    except Exception as exc:  # noqa: BLE001 — surface readiness failure
        db_status = "error"
        detail = type(exc).__name__
        response.status_code = 503

    uploads_ok = False
    media_name = "local"
    try:
        ensure_upload_dir()
        store = get_media_store()
        media_name = store.backend_name
        store.probe_writable()
        uploads_ok = True
    except Exception as exc:  # noqa: BLE001
        detail = (detail + "; " if detail else "") + f"uploads:{type(exc).__name__}"
        response.status_code = 503

    dist = Path(settings.frontend_dist).expanduser() if settings.frontend_dist else None
    frontend_ok = bool(dist and dist.is_dir() and (dist / "index.html").is_file())

    status = "ok" if db_status == "ok" and uploads_ok else "not_ready"
    return ReadinessResponse(
        status=status,
        database=db_status,
        storage=platform_store.storage_label(),
        uploads_writable=uploads_ok,
        frontend_dist=frontend_ok,
        media_backend=media_name,
        detail=detail,
    )
