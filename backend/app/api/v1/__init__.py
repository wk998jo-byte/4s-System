from fastapi import APIRouter

from app.api.v1 import auth, dashboard, health, records, scc, uploads

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(health.router)
api_router.include_router(auth.router)
api_router.include_router(dashboard.router)
api_router.include_router(records.router)
api_router.include_router(scc.router)
api_router.include_router(uploads.router)
