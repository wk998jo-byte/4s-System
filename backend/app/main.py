from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.v1 import api_router
from app.core.config import get_settings
from app.core.errors import register_exception_handlers
from app.services.uploads import UPLOAD_DIR, ensure_upload_dir

PROTOTYPE_DESCRIPTION = """
SCC Platform API — **local prototype**.

Sign in with local Admin or Operator accounts. Operational records persist
in SQLite (`backend/data/scc_platform.db`) unless `DATABASE_URL` is set.
SSO is not implemented. It is not for production.

`POST /api/v1/records` creates a **generic test record**. It does not
implement AI Camera, DashCam, Speed, or SOS operational workflows.
"""


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        description=PROTOTYPE_DESCRIPTION,
        docs_url="/docs",
        redoc_url="/redoc",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "Accept", "Authorization"],
    )
    register_exception_handlers(app)
    app.include_router(api_router)
    ensure_upload_dir()
    app.mount(
        "/uploads",
        StaticFiles(directory=str(UPLOAD_DIR)),
        name="uploads",
    )
    return app


app = create_app()
