from pydantic import BaseModel


class HealthResponse(BaseModel):
    status: str
    service: str
    version: str
    storage: str
    authenticated: bool
    prototype: bool = True
    message: str
