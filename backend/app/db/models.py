from datetime import date, datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Float,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ListItemRow(Base):
    __tablename__ = "list_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    list_type: Mapped[str] = mapped_column(String(64), index=True)
    label: Mapped[str] = mapped_column(String(200))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class CaseRow(Base):
    __tablename__ = "cases"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    case_id: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    record_type: Mapped[str] = mapped_column(String(32), index=True)
    status: Mapped[str] = mapped_column(String(32), index=True)
    project: Mapped[str | None] = mapped_column(String(120), nullable=True)
    department: Mapped[str | None] = mapped_column(String(120), nullable=True)
    title: Mapped[str] = mapped_column(String(200))
    occurred_on: Mapped[date] = mapped_column(Date)
    week_year: Mapped[int] = mapped_column(Integer)
    week_number: Mapped[int] = mapped_column(Integer)
    risk_level: Mapped[str | None] = mapped_column(String(80), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)
    fields: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)


class ContactRow(Base):
    __tablename__ = "contacts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(String(36), index=True)
    project: Mapped[str] = mapped_column(String(120))
    category: Mapped[str] = mapped_column(String(64))
    name: Mapped[str] = mapped_column(String(120))
    job_title: Mapped[str | None] = mapped_column(String(120), nullable=True)
    role: Mapped[str | None] = mapped_column(String(120), nullable=True)
    contact_number: Mapped[str | None] = mapped_column(String(80), nullable=True)
    email: Mapped[str | None] = mapped_column(String(200), nullable=True)


class UserRow(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    username: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(120))
    badge_number: Mapped[str | None] = mapped_column(String(80), nullable=True)
    role: Mapped[str] = mapped_column(String(20), index=True)
    password_hash: Mapped[str] = mapped_column(String(200))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    projects: Mapped[list[str] | None] = mapped_column(JSON, nullable=True, default=None)


class SessionRow(Base):
    __tablename__ = "sessions"

    token: Mapped[str] = mapped_column(String(80), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(36), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class AppStateRow(Base):
    __tablename__ = "app_state"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[Any] = mapped_column(JSON)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)


class AuditEventRow(Base):
    __tablename__ = "audit_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    actor_user_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    actor_name: Mapped[str] = mapped_column(String(120))
    action: Mapped[str] = mapped_column(String(64), index=True)
    category: Mapped[str] = mapped_column(String(32), index=True)
    summary: Mapped[str] = mapped_column(String(400))
    details: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    case_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)


class WeatherHourlyReadingRow(Base):
    """One hourly weather reading for a station/day (7:00–14:00)."""

    __tablename__ = "weather_hourly_readings"
    __table_args__ = (
        UniqueConstraint(
            "station_id",
            "observed_on",
            "hour",
            name="uq_weather_hourly_station_day_hour",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    station_id: Mapped[str] = mapped_column(String(32), index=True)
    project: Mapped[str] = mapped_column(String(120), index=True)
    location: Mapped[str] = mapped_column(String(160))
    observed_on: Mapped[date] = mapped_column(Date, index=True)
    hour: Mapped[int] = mapped_column(Integer)
    wind_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    temp_c: Mapped[float | None] = mapped_column(Float, nullable=True)
    rh_percent: Mapped[float | None] = mapped_column(Float, nullable=True)
    co2_ppm: Mapped[float | None] = mapped_column(Float, nullable=True)
    pm25: Mapped[float | None] = mapped_column(Float, nullable=True)
    pm10: Mapped[float | None] = mapped_column(Float, nullable=True)
    heat_index: Mapped[float | None] = mapped_column(Float, nullable=True)
    category_level: Mapped[int | None] = mapped_column(Integer, nullable=True)
    category_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="ok")
    logged_by: Mapped[str | None] = mapped_column(String(120), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class AssetClassificationRow(Base):
    """BQ asset register: number → category + type (from BQ_Asset_Classification)."""

    __tablename__ = "asset_classifications"

    asset_number: Mapped[str] = mapped_column(String(80), primary_key=True)
    asset_category: Mapped[str] = mapped_column(String(120), index=True)
    asset_type: Mapped[str] = mapped_column(String(120), index=True)


class WeatherWeeklyLogRow(Base):
    """Submitted weekly weather log (one per project per Sunday–Saturday week)."""

    __tablename__ = "weather_weekly_logs"
    __table_args__ = (
        UniqueConstraint(
            "project",
            "week_start",
            name="uq_weather_weekly_project_week",
        ),
    )

    id: Mapped[str] = mapped_column(String(48), primary_key=True)
    project: Mapped[str] = mapped_column(String(120), index=True)
    week_year: Mapped[int] = mapped_column(Integer)
    week_number: Mapped[int] = mapped_column(Integer, index=True)
    week_start: Mapped[date] = mapped_column(Date, index=True)
    week_end: Mapped[date] = mapped_column(Date)
    location: Mapped[str] = mapped_column(String(160))
    station_count: Mapped[int] = mapped_column(Integer, default=1)
    hours_logged: Mapped[int] = mapped_column(Integer, default=0)
    hours_expected: Mapped[int] = mapped_column(Integer, default=0)
    max_temp: Mapped[float] = mapped_column(Float, default=0)
    max_humidity: Mapped[float] = mapped_column(Float, default=0)
    max_heat_index: Mapped[float] = mapped_column(Float, default=0)
    highest_category: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    submitted_by: Mapped[str] = mapped_column(String(120))
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    days_by_station: Mapped[list[Any]] = mapped_column(JSON, default=list)
