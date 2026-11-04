from fastapi import APIRouter, Depends

from app.core.config import Settings, get_settings
from app.schemas.health import HealthResponse
from app.services.platform_store import platform_store

router = APIRouter(tags=["Health"])

LIMITATION = (
    "Prototype only. Sign in as Admin or Operator. Records persist in SQLite "
    "(or DATABASE_URL). Not for production."
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
        prototype=True,
        message=LIMITATION,
    )
