from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware

from app.api.v1 import api_router
from app.api.v1.media import router as media_router
from app.core.config import get_settings
from app.core.errors import register_exception_handlers
from app.services.uploads import ensure_upload_dir

PROTOTYPE_DESCRIPTION = """
SCC Platform API.

Operational records persist via SQLAlchemy (SQLite locally, PostgreSQL when
`DATABASE_URL` is set). Attachments use authenticated `GET /uploads/{name}`
with short-lived `media_token` (legacy `access_token` query disabled in
production by default).
"""


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "same-origin")
        response.headers.setdefault(
            "Permissions-Policy", "camera=(), microphone=(), geolocation=()"
        )
        # HTTPS termination is expected at the platform edge (Replit/proxy).
        if get_settings().is_production:
            response.headers.setdefault(
                "Strict-Transport-Security",
                "max-age=31536000; includeSubDomains",
            )
        return response


def create_app() -> FastAPI:
    settings = get_settings()
    # Fail fast in production if persistence is misconfigured (no SQLite fallback).
    if settings.is_production:
        from app.db.engine import resolve_database_url

        resolve_database_url()
    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        description=PROTOTYPE_DESCRIPTION,
        docs_url=None if settings.is_production else "/docs",
        redoc_url=None if settings.is_production else "/redoc",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "Accept", "Authorization"],
    )
    app.add_middleware(SecurityHeadersMiddleware)
    register_exception_handlers(app)
    app.include_router(api_router)
    # Authenticated attachment download (replaces public StaticFiles mount).
    app.include_router(media_router)
    ensure_upload_dir()

    dist = Path(settings.frontend_dist).expanduser() if settings.frontend_dist else None
    if dist and dist.is_dir() and (dist / "index.html").is_file():
        assets = dist / "assets"
        if assets.is_dir():
            app.mount("/assets", StaticFiles(directory=str(assets)), name="fe_assets")

        @app.get("/")
        def spa_index():
            return FileResponse(dist / "index.html")

        @app.get("/{full_path:path}")
        def spa_fallback(full_path: str):
            # Never shadow API or authenticated uploads.
            if full_path.startswith("api/") or full_path.startswith("uploads/"):
                return JSONResponse({"detail": "Not Found"}, status_code=404)
            candidate = dist / full_path
            if candidate.is_file():
                return FileResponse(candidate)
            return FileResponse(dist / "index.html")

    return app


app = create_app()
