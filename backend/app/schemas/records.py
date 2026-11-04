from datetime import datetime
from enum import Enum
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class PrototypeModule(str, Enum):
    """Placeholder module tags. These are not the operational SCC record types."""

    ai_camera = "ai_camera"
    dashcam = "dashcam"
    speed = "speed"
    sos = "sos"
    other = "other"


class PrototypeStatus(str, Enum):
    open = "open"
    under_process = "under_process"
    closed = "closed"


class PrototypeRecordCreate(BaseModel):
    """Request body for a generic prototype record.

    This is a test payload only. It does not replace AI Camera, DashCam,
    Speed, or SOS operational schemas.
    """

    title: str = Field(..., min_length=1, max_length=200)
    module_type: PrototypeModule
    status: PrototypeStatus = PrototypeStatus.open
    notes: str | None = Field(default=None, max_length=2000)

    @field_validator("title")
    @classmethod
    def title_not_blank(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Title is required.")
        return stripped


class PrototypeRecord(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    title: str
    module_type: PrototypeModule
    status: PrototypeStatus
    notes: str | None = None
    created_at: datetime
    prototype: bool = True


class PrototypeRecordList(BaseModel):
    items: list[PrototypeRecord]
    page: int
    page_size: int
    total: int
    storage: str = "in_memory"
    prototype: bool = True
