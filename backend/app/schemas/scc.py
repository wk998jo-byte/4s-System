from datetime import date, datetime, time
from typing import Any, Literal

from pydantic import BaseModel, Field


class ListItem(BaseModel):
    id: str
    label: str
    is_active: bool
    sort_order: int


class ListCollection(BaseModel):
    list_type: str
    items: list[ListItem]
    notes: str | None = None


class ListItemCreate(BaseModel):
    label: str = Field(..., min_length=1, max_length=200)


class ListItemUpdate(BaseModel):
    label: str = Field(..., min_length=1, max_length=200)
    is_active: bool = True


class CaseSummary(BaseModel):
    id: str
    case_id: str
    record_type: str
    status: str
    project: str | None
    department: str | None
    title: str
    date: str
    week_number: int
    risk_level: str | None = None
    created_at: datetime
    fields: dict[str, Any] = Field(default_factory=dict)


class CaseDetail(CaseSummary):
    prototype: bool = True


class CaseList(BaseModel):
    items: list[CaseSummary]
    total: int
    prototype: bool = True
    storage: str = "sqlite"


class AiCameraCreate(BaseModel):
    project_id: str
    location: str = Field(..., min_length=1, max_length=200)
    occurred_on: date
    occurred_time: time
    alert_summary: str = Field(..., min_length=1, max_length=4000)
    alert_type_id: str
    category_id: str
    category_other: str | None = Field(default=None, max_length=200)
    risk_level_id: str | None = None
    detection_method_id: str
    reported_by: str = Field(..., min_length=1, max_length=120)
    observation_picture: str | None = Field(default=None, max_length=500)
    camera_id: str | None = Field(default=None, max_length=80)
    updated_in_safelife: bool = False
    safelife_reference: str | None = Field(default=None, max_length=80)
    safelife_skip_reason: str | None = Field(default=None, max_length=200)


class DashcamCreate(BaseModel):
    assign_to: Literal["project", "department"]
    project_id: str | None = None
    department_id: str | None = None
    vehicle_type_id: str
    model_id: str
    asset_number: str = Field(..., min_length=1, max_length=80)
    driver_name: str = Field(..., min_length=1, max_length=120)
    driver_badge_number: str = Field(..., min_length=1, max_length=80)
    rental_driver: bool = False
    iqama_number: str | None = None
    occurred_on: date
    occurred_time: time
    violation_type_id: str
    violation_other: str | None = Field(default=None, max_length=200)
    risk_level_id: str
    alert_summary: str = Field(..., min_length=1, max_length=400)
    reported_by: str = Field(..., min_length=1, max_length=120)
    violation_picture: str | None = Field(default=None, max_length=500)
    upload_to_itqan: bool = True
    itqan_skip_reason: str | None = Field(default=None, max_length=500)


class SpeedCreate(BaseModel):
    assign_to: Literal["project", "department"]
    project_id: str | None = None
    department_id: str | None = None
    speed_violation_type_id: str
    vehicle_type_id: str
    model_id: str
    asset_number: str = Field(..., min_length=1, max_length=80)
    driver_name: str = Field(..., min_length=1, max_length=120)
    driver_badge_number: str = Field(..., min_length=1, max_length=80)
    rental_driver: bool = False
    iqama_number: str | None = None
    location_coordinates: str = Field(..., min_length=1, max_length=80)
    occurred_on: date
    occurred_time: time
    permitted_speed_kmh: float = Field(..., ge=0)
    vehicle_speed_kmh: float = Field(..., ge=0)
    reported_by: str = Field(..., min_length=1, max_length=120)
    fms_evidence: str | None = Field(default=None, max_length=260)
    upload_to_itqan: bool = True
    itqan_skip_reason: str | None = Field(default=None, max_length=500)


class SosCreate(BaseModel):
    project_id: str
    worker_name_badge: str = Field(..., min_length=1, max_length=200)
    sos_created_at: datetime
    seen_at: datetime
    location: str = Field(..., min_length=1, max_length=200)
    source_id: str


class SosClose(BaseModel):
    alarm: str = Field(..., pattern=r"^(False Alarm|True Alarm)$")
    worker_picture: str | None = Field(default=None, max_length=500)
    picture_shared_by: str = Field(..., min_length=1, max_length=200)
    closed_at: datetime
    close_out_report: str = Field(..., min_length=1, max_length=4000)


class AiCameraCloseOut(BaseModel):
    hseo_name_badge: str = Field(..., min_length=1, max_length=200)
    close_out_action: str = Field(..., min_length=1, max_length=4000)
    close_out_picture: str = Field(..., min_length=1, max_length=500)
    safelife_reference: str | None = Field(default=None, max_length=80)


class ConfirmDriver(BaseModel):
    uploaded_by: str = Field(..., min_length=1, max_length=120)
    upload_to_itqan: bool | None = None
    itqan_proof: str | None = Field(default=None, max_length=260)
    itqan_skip_reason: str | None = Field(default=None, max_length=500)


class ItqanCreate(BaseModel):
    assign_to: Literal["project", "department"]
    project_id: str | None = None
    department_id: str | None = None
    driver_name: str = Field(..., min_length=1, max_length=120)
    driver_badge_number: str = Field(..., min_length=1, max_length=80)
    vehicle_type_id: str
    violation_type_id: str
    itqan_ref: str = Field(..., min_length=1, max_length=40)
    itqan_status_id: str
    occurred_on: date
    occurred_time: time
    reported_by: str = Field(..., min_length=1, max_length=120)
    itqan_record_picture: str | None = Field(default=None, max_length=500)


class ItqanStatusUpdate(BaseModel):
    itqan_status_id: str


class ReportSignIn(BaseModel):
    """Dept HSE weekly sign-off — digital signature image URL from /uploads."""

    signature_image: str = Field(..., min_length=1, max_length=500)


class ContactCreate(BaseModel):
    project_id: str
    category: str
    name: str = Field(..., min_length=1, max_length=120)
    job_title: str | None = None
    role: str | None = None
    contact_number: str | None = None
    email: str | None = None


class ContactUpdate(BaseModel):
    category: str
    name: str = Field(..., min_length=1, max_length=120)
    job_title: str | None = None
    role: str | None = None
    contact_number: str | None = None
    email: str | None = None


class WeatherReading(BaseModel):
    time: str
    wind_speed_ms: float | None = None
    temperature_c: float | None = None
    rh_percent: float | None = None
    co2_ppm: float | None = None
    pm25: float | None = None
    pm10: float | None = None
    heat_index: float | None = None
    remarks: str | None = None


class WeatherSheetIn(BaseModel):
    slot: int = Field(..., ge=1, le=4)
    project_id: str | None = None
    location: str | None = None
    observed_on: date | None = None
    readings: list[WeatherReading] = Field(default_factory=list)


class WeatherHourlyCellIn(BaseModel):
    hour: int = Field(..., ge=7, le=14)
    wind: float | None = None
    temp: float | None = None
    rh: float | None = None
    co2: float | None = None
    pm25: float | None = None
    pm10: float | None = None
    heat_index: float | None = None
    remarks: str | None = None
    status: str = "ok"
    logged_by: str | None = Field(default=None, max_length=120)


class WeatherHourlySaveIn(BaseModel):
    station_id: str = Field(..., min_length=1, max_length=32)
    project: str = Field(..., min_length=1, max_length=120)
    location: str = Field(..., min_length=1, max_length=160)
    observed_on: date
    readings: list[WeatherHourlyCellIn] = Field(default_factory=list)
    logged_by: str | None = Field(default=None, max_length=120)


class WeatherWeeklySubmitIn(BaseModel):
    project: str = Field(..., min_length=1, max_length=120)
    week_start: date
    remarks: str | None = Field(default=None, max_length=2000)
    submitted_by: str | None = Field(default=None, max_length=120)


class HwUpdate(BaseModel):
    project_counts: dict[str, dict[str, int]]
    department_counts: dict[str, dict[str, int]]


class HwRegisterCreate(BaseModel):
    device: str = Field(..., min_length=1, max_length=80)
    serial: str = Field(..., min_length=1, max_length=120)
    status: str = Field(..., min_length=1, max_length=80)
    project: str = Field(..., min_length=1, max_length=120)
    system: str | None = Field(default=None, max_length=40)


class CaseAdminUpdate(BaseModel):
    """Admin edit of original record fields (partial)."""

    project: str | None = Field(default=None, max_length=120)
    department: str | None = Field(default=None, max_length=120)
    title: str | None = Field(default=None, min_length=1, max_length=200)
    occurred_on: date | None = None
    risk_level: str | None = Field(default=None, max_length=80)
    fields: dict[str, Any] = Field(default_factory=dict)
