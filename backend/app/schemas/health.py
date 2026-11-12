from pydantic import BaseModel


class HealthResponse(BaseModel):
    status: str
    service: str
    version: str
    storage: str
    authenticated: bool
    prototype: bool = True
    message: str


class ReadinessResponse(BaseModel):
    status: str
    database: str
    storage: str
    uploads_writable: bool
    frontend_dist: bool
    media_backend: str = "local"
    detail: str | None = None
