"""SCC operational store backed by SQLite (or DATABASE_URL).

Unauthenticated prototype. PostgreSQL is supported if DATABASE_URL is set.
"""

from __future__ import annotations

import re
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from secrets import token_urlsafe
from threading import Lock
from uuid import uuid4
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy.orm.attributes import flag_modified

from app.core.config import get_settings
from app.db.engine import default_sqlite_url, make_engine, make_session_factory
from app.db.models import (
    AppStateRow,
    AssetClassificationRow,
    AuditEventRow,
    CaseRow,
    ContactRow,
    ListItemRow,
    SessionRow,
    UserRow,
    WeatherHourlyReadingRow,
    WeatherWeeklyLogRow,
)
from app.services.auth import (
    ROLES,
    SEED_USERS,
    capabilities,
    hash_password,
    verify_password,
)
from app.services.catalog import CONTACT_CATEGORIES, Catalog
from app.services.uploads import ensure_demo_image
from app.services.week import week_from_date

try:
    AST = ZoneInfo("Asia/Riyadh")
except ZoneInfoNotFoundError:
    AST = timezone(timedelta(hours=3))
ITQAN_CLOSE_OUT = "The Violation has been uploaded in ITQAN"
ITQAN_STATUS_DEFAULT = "Under Safety"
ITQAN_SOURCE_LABELS = {
    "dashcam": "Dashcam Observation",
    "speed": "Speed Violation",
}
DASHCAM_TO_ITQAN_VIOLATION = {
    "mobile phone use": "Using Mobile Phone",
    "using phone": "Using Mobile Phone",
    "seat belt": "Not Using Seat Belt",
    "over passengers": "Negligence / Reckless Driving",
    "tampering": "Tampering with Device",
    "camera covered": "Tampering with Device",
    "smoking": "Negligence / Reckless Driving",
}
LIST_FIELD_KEYS = {
    "alert_type": ["alert_type"],
    "risk_level": ["risk_level"],
    "dashcam_observation_type": ["violation_type"],
    "ai_camera_category": ["category"],
    "speed_violation_type": ["speed_violation_type"],
    "detection_method": ["detection_method"],
    "vehicle_type": ["vehicle_type"],
    "model": ["model"],
    "dashcam_alert_summary": ["alert_summary"],
    "sos_source": ["source"],
    "itqan_violation_type": ["violation_type"],
    "itqan_status": ["itqan_status"],
}
WEATHER_HOURS = [
    "7:00 AM",
    "9:00 AM",
    "10:00 AM",
    "12:00 PM",
    "1:00 PM",
    "2:00 PM",
]
WEATHER_DAY_HOURS = (7, 8, 9, 10, 11, 12, 13, 14)
WEATHER_STATIONS = [
    {"id": "WS-JF-01", "project": "Jafurah", "loc": "Riyas Laydown"},
    {"id": "WS-YB-01", "project": "Yanbu", "loc": "Tank Farm Gate"},
    {"id": "WS-YB-02", "project": "Yanbu", "loc": "Marine Area"},
    {"id": "WS-MG-01", "project": "MGS", "loc": "Pump Station 2"},
    {"id": "WS-RT-01", "project": "Ras Tanura", "loc": "North Pier"},
]


def _heat_category(h: float) -> dict:
    if h >= 54:
        return {
            "level": 4,
            "name": "Extreme Danger",
            "prevention": "Stop outdoor work. Emergency cooling and medical standby.",
        }
    if h >= 41:
        return {
            "level": 3,
            "name": "Danger",
            "prevention": (
                "Work/rest 15/45 min, one cup of water every 15 minutes, "
                "supervisor check every hour."
            ),
        }
    if h >= 32:
        return {
            "level": 2,
            "name": "Extreme Caution",
            "prevention": "Work/rest 30/30 min in shade, one cup of water every 15 minutes.",
        }
    if h >= 27:
        return {
            "level": 1,
            "name": "Caution",
            "prevention": "One cup of water every 20 minutes, shaded rest breaks.",
        }
    return {
        "level": 0,
        "name": "Normal",
        "prevention": "One cup of water every 20 minutes.",
    }


def _calc_heat_index(temp: float, rh: float) -> float:
    return round(
        temp
        + (max(0.0, rh - 40) * 0.08)
        + (max(0.0, temp - 32) * 0.35),
        1,
    )


def _sunday_week_bounds(day: date) -> tuple[date, date]:
    # Python weekday: Mon=0 … Sun=6. Sunday-start week used by Weather V1.
    start = day - timedelta(days=(day.weekday() + 1) % 7)
    end = start + timedelta(days=6)
    return start, end


def _project_code(name: str, index: int = 0) -> str:
    letters = "".join(ch for ch in name.upper() if ch.isalpha())
    code = (letters[:3] or f"P{index + 1}").ljust(3, "X")[:3]
    return code


def _hour_label(hour: int) -> str:
    suffix = "PM" if hour >= 12 else "AM"
    h12 = 12 if hour % 12 == 0 else hour % 12
    return f"{h12}:00 {suffix}"


def _format_short_day(d: date) -> str:
    mon = [
        "Jan",
        "Feb",
        "Mar",
        "Apr",
        "May",
        "Jun",
        "Jul",
        "Aug",
        "Sep",
        "Oct",
        "Nov",
        "Dec",
    ]
    return f"{d.day} {mon[d.month - 1]}"


def _format_day_name(d: date) -> str:
    return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][d.weekday()]


def _format_submitted_at(dt: datetime) -> str:
    local = dt.astimezone(AST) if dt.tzinfo else dt.replace(tzinfo=timezone.utc).astimezone(AST)
    mon = [
        "Jan",
        "Feb",
        "Mar",
        "Apr",
        "May",
        "Jun",
        "Jul",
        "Aug",
        "Sep",
        "Oct",
        "Nov",
        "Dec",
    ]
    return (
        f"{local.day} {mon[local.month - 1]} {local.year}, "
        f"{local.hour:02d}:{local.minute:02d}"
    )


def _speed_summary(kind: str, vehicle: str, permitted: float, recorded: float) -> str:
    exceedance = recorded - permitted
    weight = "light" if "light" in vehicle.lower() else "heavy"
    if kind.upper() == "ROW":
        place = "within the Right of Way (ROW)"
    else:
        place = "on a public road"
    return (
        f"The driver of a {weight} vehicle exceeded the permitted speed limit {place}. "
        f"Permitted speed: {permitted:g} km/h. Recorded speed: {recorded:g} km/h. "
        f"Exceedance: {exceedance:g} km/h."
    )


def _speed_risk_from_exceedance(exceedance: float) -> str:
    if exceedance <= 10:
        return "Low Risk"
    if exceedance <= 20:
        return "Medium Risk"
    return "High Risk"


def _case_dict(row: CaseRow) -> dict:
    created = row.created_at
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    return {
        "id": row.id,
        "case_id": row.case_id,
        "record_type": row.record_type,
        "status": row.status,
        "project": row.project,
        "department": row.department,
        "title": row.title,
        "date": row.occurred_on.isoformat(),
        "week_year": row.week_year,
        "week_number": row.week_number,
        "risk_level": row.risk_level,
        "created_at": created,
        "fields": dict(row.fields or {}),
    }


def _contact_dict(row: ContactRow) -> dict:
    return {
        "id": row.id,
        "project_id": row.project_id,
        "project": row.project,
        "category": row.category,
        "name": row.name,
        "job_title": row.job_title,
        "role": row.role,
        "contact_number": row.contact_number,
        "email": row.email,
    }


class PlatformStore:
    def __init__(self, database_url: str | None = None) -> None:
        self.database_url = database_url or "sqlite+pysqlite:///:memory:"
        self._engine = make_engine(self.database_url)
        self._sessions = make_session_factory(self._engine)
        self.catalog = Catalog(self._sessions)
        self._lock = Lock()
        self._ensure_state()

    def storage_label(self) -> str:
        if self.database_url.startswith("postgresql"):
            return "postgresql"
        if ":memory:" in self.database_url:
            return "sqlite_memory"
        return "sqlite"

    def _ensure_state(self) -> None:
        with self._sessions() as session:
            if session.get(AppStateRow, "case_seq") is None:
                session.add(AppStateRow(key="case_seq", value=1800))
            if session.get(AppStateRow, "weather") is None:
                session.add(AppStateRow(key="weather", value=self._empty_weather()))
            if session.get(AppStateRow, "hw") is None:
                session.add(
                    AppStateRow(
                        key="hw",
                        value={
                            "project": self._empty_hw_project(),
                            "department": self._empty_hw_dept(),
                            "updated_at": None,
                        },
                    )
                )
            session.commit()
        self._migrate_sos_devices_split()
        self._migrate_hw_catalog_v1()
        self._seed_hw_inventory_v1()
        self._seed_asset_classifications()
        self._seed_users()
        self._ensure_sla_deadlines()
        self._seed_sla_demo_cases()
        self._seed_dashcam_demo_cases()
        self._seed_speed_demo_cases()
        self._seed_sos_demo_cases()
        self._seed_itqan_demo_cases()

    def _seed_users(self) -> None:
        with self._lock, self._sessions() as session:
            if session.query(UserRow).count() == 0:
                for item in SEED_USERS:
                    session.add(
                        UserRow(
                            id=str(uuid4()),
                            username=item["username"],
                            display_name=item["display_name"],
                            badge_number=item.get("badge_number"),
                            role=item["role"],
                            password_hash=hash_password(item["password"]),
                            is_active=True,
                            projects=item.get("projects"),
                        )
                    )
                session.commit()
                return
            # Backfill seed badge numbers / missing prototype users.
            for item in SEED_USERS:
                row = (
                    session.query(UserRow)
                    .filter(UserRow.username == item["username"])
                    .one_or_none()
                )
                if row is None:
                    session.add(
                        UserRow(
                            id=str(uuid4()),
                            username=item["username"],
                            display_name=item["display_name"],
                            badge_number=item.get("badge_number"),
                            role=item["role"],
                            password_hash=hash_password(item["password"]),
                            is_active=True,
                            projects=item.get("projects"),
                        )
                    )
                elif not row.badge_number and item.get("badge_number"):
                    row.badge_number = item["badge_number"]
            # Legacy admin UI briefly saved "project_pm"; that is the same role as receiver.
            session.query(UserRow).filter(UserRow.role == "project_pm").update(
                {UserRow.role: "receiver"}
            )
            session.commit()

    def _user_out(self, row: UserRow) -> dict:
        projects = getattr(row, "projects", None)
        if isinstance(projects, list):
            projects = [str(p) for p in projects]
        else:
            projects = None
        return {
            "id": row.id,
            "username": row.username,
            "display_name": row.display_name,
            "badge_number": row.badge_number,
            "role": row.role,
            "capabilities": capabilities(row.role),
            "projects": projects,
        }

    def _normalize_projects(self, value) -> list[str] | None:
        if value is None:
            return None
        cleaned = [str(item).strip() for item in value if str(item).strip()]
        return cleaned or None

    def login(self, username: str, password: str) -> dict | None:
        with self._lock, self._sessions() as session:
            row = (
                session.query(UserRow)
                .filter(UserRow.username == username.strip().lower())
                .one_or_none()
            )
            if not row or not row.is_active or not verify_password(password, row.password_hash):
                return None
            token = token_urlsafe(32)
            session.add(
                SessionRow(
                    token=token,
                    user_id=row.id,
                    created_at=datetime.now(timezone.utc),
                )
            )
            session.commit()
            return {"access_token": token, "token_type": "bearer", "user": self._user_out(row)}

    def logout(self, token: str) -> None:
        with self._lock, self._sessions() as session:
            row = session.get(SessionRow, token)
            if row:
                session.delete(row)
                session.commit()

    def user_from_token(self, token: str) -> dict | None:
        with self._sessions() as session:
            session_row = session.get(SessionRow, token)
            if not session_row:
                return None
            user = session.get(UserRow, session_row.user_id)
            if not user or not user.is_active:
                return None
            return self._user_out(user)

    def list_users(self) -> list[dict]:
        with self._sessions() as session:
            rows = session.query(UserRow).order_by(UserRow.username).all()
            return [self._user_out(row) for row in rows]

    def create_user(self, payload) -> dict:
        role = payload.role.strip().lower()
        if role not in ROLES:
            raise ValueError(
                "Role must be admin, operator, dept_hse, or Project PM (receiver)."
            )
        username = payload.username.strip().lower()
        projects = self._normalize_projects(getattr(payload, "projects", None))
        with self._lock, self._sessions() as session:
            exists = (
                session.query(UserRow).filter(UserRow.username == username).one_or_none()
            )
            if exists:
                raise ValueError("That username is already in use.")
            row = UserRow(
                id=str(uuid4()),
                username=username,
                display_name=payload.display_name.strip(),
                badge_number=payload.badge_number.strip(),
                role=role,
                password_hash=hash_password(payload.password),
                is_active=True,
                projects=projects,
            )
            session.add(row)
            session.commit()
            return self._user_out(row)

    def update_user(
        self, user_id: str, payload, *, actor_id: str | None = None
    ) -> dict:
        role = payload.role.strip().lower()
        if role not in ROLES:
            raise ValueError(
                "Role must be admin, operator, dept_hse, or Project PM (receiver)."
            )
        username = payload.username.strip().lower()
        display_name = payload.display_name.strip()
        badge = payload.badge_number.strip()
        new_password = (payload.password or "").strip()
        projects = self._normalize_projects(getattr(payload, "projects", None))
        with self._lock, self._sessions() as session:
            row = session.get(UserRow, user_id)
            if not row:
                raise KeyError(user_id)
            if row.role == "admin":
                # Other admins are not editable; only the signed-in admin can edit themselves.
                if actor_id != user_id:
                    raise ValueError("Other admin accounts cannot be edited.")
                if role != "admin":
                    raise ValueError("Admin roles cannot be changed.")
                role = "admin"
            clash = (
                session.query(UserRow)
                .filter(UserRow.username == username, UserRow.id != user_id)
                .one_or_none()
            )
            if clash:
                raise ValueError("That username is already in use.")
            if row.role == "admin" and role != "admin":
                admin_count = (
                    session.query(UserRow).filter(UserRow.role == "admin").count()
                )
                if admin_count <= 1:
                    raise ValueError("You cannot demote the last Admin account.")
            old_name = row.display_name
            old_badge = row.badge_number
            row.username = username
            row.display_name = display_name
            row.badge_number = badge
            row.role = role
            row.projects = projects
            if new_password:
                row.password_hash = hash_password(new_password)
            session.commit()
            session.refresh(row)
            updated = self._user_out(row)
        from app.schemas.auth import format_user_label

        old_label = format_user_label(old_name, old_badge)
        new_label = format_user_label(display_name, badge)
        if old_label != new_label:
            self._retarget_user_display_name(old_label, new_label)
        if old_name and old_name != new_label:
            # Older records stored plain display names before badge - Name.
            self._retarget_user_display_name(old_name, new_label)
        return updated

    def delete_user(
        self, user_id: str, confirm: bool, *, actor_id: str | None = None
    ) -> None:
        if not confirm:
            raise ValueError("Delete requires confirmation.")
        with self._lock, self._sessions() as session:
            row = session.get(UserRow, user_id)
            if not row:
                raise KeyError(user_id)
            if actor_id and user_id == actor_id:
                raise ValueError("You cannot delete the account you are signed in with.")
            if row.role == "admin":
                admin_count = (
                    session.query(UserRow).filter(UserRow.role == "admin").count()
                )
                if admin_count <= 1:
                    raise ValueError("You cannot delete the last Admin account.")
            # Hard-delete the login account only. Case field names stay as stored text.
            session.query(SessionRow).filter(SessionRow.user_id == user_id).delete()
            session.delete(row)
            session.commit()

    def _retarget_user_display_name(self, old: str, new: str) -> None:
        if not old or old == new:
            return
        actor_keys = (
            "reported_by",
            "uploaded_by",
            "close_out_submitted_by",
            "closed_by",
            "rejected_by",
            "deleted_by",
        )
        with self._lock, self._sessions() as session:
            rows = session.query(CaseRow).all()
            for row in rows:
                fields = dict(row.fields or {})
                changed = False
                for key in actor_keys:
                    if fields.get(key) == old:
                        fields[key] = new
                        changed = True
                if changed:
                    row.fields = fields
                    flag_modified(row, "fields")
            session.commit()

    def _insert_case(self, record: dict) -> dict:
        with self._lock, self._sessions() as session:
            session.add(
                CaseRow(
                    id=record["id"],
                    case_id=record["case_id"],
                    record_type=record["record_type"],
                    status=record["status"],
                    project=record["project"],
                    department=record["department"],
                    title=record["title"],
                    occurred_on=date.fromisoformat(record["date"]),
                    week_year=record["week_year"],
                    week_number=record["week_number"],
                    risk_level=record["risk_level"],
                    created_at=record["created_at"],
                    is_deleted=False,
                    fields=record["fields"],
                )
            )
            session.commit()
        return record

    def _patch_case(self, case_id: str, record_type: str, mutator) -> dict | None:
        with self._lock, self._sessions() as session:
            row = (
                session.query(CaseRow)
                .filter(CaseRow.id == case_id, CaseRow.record_type == record_type)
                .one_or_none()
            )
            if not row:
                return None
            current = _case_dict(row)
            mutator(current)
            row.status = current["status"]
            row.fields = current["fields"]
            flag_modified(row, "fields")
            session.commit()
            session.refresh(row)
            return _case_dict(row)

    def _empty_weather(self) -> list[dict]:
        sheets = []
        for slot in range(1, 5):
            sheets.append(
                {
                    "slot": slot,
                    "project_id": None,
                    "project": None,
                    "location": None,
                    "observed_on": None,
                    "week_number": None,
                    "readings": [
                        {
                            "time": hour,
                            "wind_speed_ms": None,
                            "temperature_c": None,
                            "rh_percent": None,
                            "co2_ppm": None,
                            "pm25": None,
                            "pm10": None,
                            "heat_index": None,
                            "remarks": None,
                        }
                        for hour in WEATHER_HOURS
                    ],
                }
            )
        return sheets

    def _empty_hw_project(self) -> dict[str, dict[str, int]]:
        sites = [item["label"] for item in self.catalog.get("hw_site")]
        types = [item["label"] for item in self.catalog.get("scc_device_type")]
        return {site: {dtype: 0 for dtype in types} for site in sites}

    def _migrate_sos_devices_split(self) -> None:
        """Replace legacy combined 'SOS Devices' with Smart Helmet + Smart Watch."""
        # V1 wearable deployment split used when only a combined SOS bucket exists.
        deploy = {
            "Jafurah": {"Smart Helmet": 1348, "Smart Watch": 0},
            "Yanbu": {"Smart Helmet": 0, "Smart Watch": 423},
            "MGS": {"Smart Helmet": 0, "Smart Watch": 35},
            "Ras Tanura": {"Smart Helmet": 0, "Smart Watch": 44},
        }
        with self._lock, self._sessions() as session:
            rows = (
                session.query(ListItemRow)
                .filter(ListItemRow.list_type == "scc_device_type")
                .order_by(ListItemRow.sort_order, ListItemRow.label)
                .all()
            )
            by_label = {row.label: row for row in rows}
            sos = by_label.get("SOS Devices")
            if sos is not None:
                # Insert replacements at the SOS sort position, then remove SOS.
                base_order = sos.sort_order
                if "Smart Helmet" not in by_label:
                    session.add(
                        ListItemRow(
                            id=str(uuid4()),
                            list_type="scc_device_type",
                            label="Smart Helmet",
                            is_active=True,
                            sort_order=base_order,
                        )
                    )
                if "Smart Watch" not in by_label:
                    session.add(
                        ListItemRow(
                            id=str(uuid4()),
                            list_type="scc_device_type",
                            label="Smart Watch",
                            is_active=True,
                            sort_order=base_order + 1,
                        )
                    )
                session.delete(sos)
                # Shift later items so ordering stays clean.
                for row in rows:
                    if row.label == "SOS Devices":
                        continue
                    if row.sort_order > base_order:
                        row.sort_order += 1

            hw = session.get(AppStateRow, "hw")
            if hw:
                value = dict(hw.value or {})
                project = dict(value.get("project") or {})
                changed = sos is not None
                for site, counts in list(project.items()):
                    site_counts = dict(counts or {})
                    sos_n = int(site_counts.pop("SOS Devices", 0) or 0)
                    helmet = int(site_counts.get("Smart Helmet", 0) or 0)
                    watch = int(site_counts.get("Smart Watch", 0) or 0)
                    split = deploy.get(site)
                    if split and helmet == 0 and watch == 0:
                        # Empty wearables → apply V1 site deployment profile.
                        helmet = split["Smart Helmet"]
                        watch = split["Smart Watch"]
                        changed = True
                    elif sos_n:
                        if split and split["Smart Watch"] and not split["Smart Helmet"]:
                            watch += sos_n
                        elif split and split["Smart Helmet"] and not split["Smart Watch"]:
                            helmet += sos_n
                        elif split:
                            total = split["Smart Helmet"] + split["Smart Watch"]
                            h_add = round(sos_n * split["Smart Helmet"] / total) if total else sos_n
                            helmet += h_add
                            watch += sos_n - h_add
                        else:
                            helmet += sos_n
                        changed = True
                    if "SOS Devices" in (counts or {}):
                        changed = True
                    site_counts["Smart Helmet"] = helmet
                    site_counts["Smart Watch"] = watch
                    project[site] = site_counts
                if changed:
                    value["project"] = project
                    hw.value = value
                    flag_modified(hw, "value")
            session.commit()

    def _ensure_list_labels(self, list_type: str, labels: list[str]) -> None:
        """Add any missing catalog labels (keeps existing rows)."""
        with self._lock, self._sessions() as session:
            existing = {
                row.label
                for row in session.query(ListItemRow)
                .filter(ListItemRow.list_type == list_type)
                .all()
            }
            sort_order = session.query(ListItemRow).filter(ListItemRow.list_type == list_type).count()
            changed = False
            for label in labels:
                if label in existing:
                    continue
                session.add(
                    ListItemRow(
                        id=str(uuid4()),
                        list_type=list_type,
                        label=label,
                        is_active=True,
                        sort_order=sort_order,
                    )
                )
                sort_order += 1
                changed = True
            if changed:
                session.commit()

    def _list_tombstones(self) -> dict[str, list[str]]:
        with self._sessions() as session:
            row = session.get(AppStateRow, "list_delete_tombstones")
            if not row or not isinstance(row.value, dict):
                return {}
            out: dict[str, list[str]] = {}
            for key, value in row.value.items():
                if isinstance(value, list):
                    out[str(key)] = [
                        str(item).strip()
                        for item in value
                        if str(item).strip()
                    ]
            return out

    def _save_list_tombstones(self, payload: dict[str, list[str]]) -> None:
        with self._lock, self._sessions() as session:
            row = session.get(AppStateRow, "list_delete_tombstones")
            if row:
                row.value = payload
            else:
                session.add(AppStateRow(key="list_delete_tombstones", value=payload))
            session.commit()

    def _remember_list_tombstone(self, list_type: str, label: str) -> None:
        clean = (label or "").strip()
        if not clean:
            return
        tombs = self._list_tombstones()
        current = list(tombs.get(list_type) or [])
        if clean not in current:
            current.append(clean)
            tombs[list_type] = current
            self._save_list_tombstones(tombs)

    def _forget_list_tombstone(self, list_type: str, label: str) -> None:
        clean = (label or "").strip()
        if not clean:
            return
        tombs = self._list_tombstones()
        current = [item for item in (tombs.get(list_type) or []) if item != clean]
        if current == (tombs.get(list_type) or []):
            return
        if current:
            tombs[list_type] = current
        else:
            tombs.pop(list_type, None)
        self._save_list_tombstones(tombs)

    def _sync_list_labels(self, list_type: str, labels: list[str]) -> None:
        """Align catalog with seed labels (order + membership).

        Respects admin disables (does not reactivate) and hard deletes
        (tombstoned labels are not re-created on startup).
        """
        tombstoned = set(self._list_tombstones().get(list_type) or [])
        wanted = [
            label.strip()
            for label in labels
            if label and label.strip() and label.strip() not in tombstoned
        ]
        wanted_set = set(wanted)
        with self._lock, self._sessions() as session:
            rows = (
                session.query(ListItemRow)
                .filter(ListItemRow.list_type == list_type)
                .all()
            )
            by_label = {row.label: row for row in rows}
            changed = False
            for index, label in enumerate(wanted):
                row = by_label.get(label)
                if row is None:
                    session.add(
                        ListItemRow(
                            id=str(uuid4()),
                            list_type=list_type,
                            label=label,
                            is_active=True,
                            sort_order=index,
                        )
                    )
                    changed = True
                    continue
                # Keep admin disables; only refresh sort order for actives.
                if row.is_active and row.sort_order != index:
                    row.sort_order = index
                    changed = True
            for row in rows:
                if row.label not in wanted_set and row.is_active:
                    row.is_active = False
                    changed = True
            if changed:
                session.commit()

    def _migrate_hw_catalog_v1(self) -> None:
        """Normalize legacy HW type labels and ensure V1 sites/types exist."""
        renames = {
            "AI Cameras": "AI Camera",
            "AVL": "GPS",
            "Dashcams": "Dashcam",
            "Weather Stations": "Weather Station",
            "SOS Devices": "Smart Helmet",
        }
        with self._lock, self._sessions() as session:
            for old, new in renames.items():
                row = (
                    session.query(ListItemRow)
                    .filter(
                        ListItemRow.list_type == "scc_device_type",
                        ListItemRow.label == old,
                    )
                    .one_or_none()
                )
                if row is None:
                    continue
                clash = (
                    session.query(ListItemRow)
                    .filter(
                        ListItemRow.list_type == "scc_device_type",
                        ListItemRow.label == new,
                    )
                    .one_or_none()
                )
                if clash:
                    session.delete(row)
                else:
                    row.label = new
            hw = session.get(AppStateRow, "hw")
            if hw:
                value = dict(hw.value or {})
                project = dict(value.get("project") or {})
                for site, counts in list(project.items()):
                    site_counts = dict(counts or {})
                    for old, new in renames.items():
                        if old in site_counts:
                            site_counts[new] = int(site_counts.get(new, 0) or 0) + int(
                                site_counts.pop(old) or 0
                            )
                    project[site] = site_counts
                value["project"] = project
                hw.value = value
                flag_modified(hw, "value")
            session.commit()

        from app.services.catalog import LIST_SEEDS

        self._ensure_list_labels("scc_device_type", LIST_SEEDS["scc_device_type"])
        self._ensure_list_labels("hw_site", LIST_SEEDS["hw_site"])

    def _seed_asset_classifications(self) -> None:
        """Load BQ asset register into DB and sync category/type list seeds."""
        from pathlib import Path

        from app.services.catalog import LIST_SEEDS

        data_path = Path(__file__).resolve().parents[2] / "data" / "BQ_Asset_Classification.xlsx"
        with self._lock, self._sessions() as session:
            existing = session.query(AssetClassificationRow).count()
            if existing == 0 and data_path.exists():
                try:
                    from openpyxl import load_workbook
                except ImportError as exc:
                    raise RuntimeError(
                        "openpyxl is required to import BQ_Asset_Classification.xlsx"
                    ) from exc
                wb = load_workbook(data_path, read_only=True, data_only=True)
                ws = wb.active
                rows_iter = ws.iter_rows(values_only=True)
                header = next(rows_iter, None)
                del header
                batch: list[AssetClassificationRow] = []
                seen: set[str] = set()
                for row in rows_iter:
                    if not row or not row[0]:
                        continue
                    number = str(row[0]).strip()
                    category = str(row[1] or "").strip()
                    asset_type = str(row[2] or "").strip()
                    if not number or number in seen or not category or not asset_type:
                        continue
                    seen.add(number)
                    batch.append(
                        AssetClassificationRow(
                            asset_number=number,
                            asset_category=category,
                            asset_type=asset_type,
                        )
                    )
                if batch:
                    session.add_all(batch)
                    session.commit()

            categories = sorted(
                {
                    row.asset_category
                    for row in session.query(AssetClassificationRow.asset_category).distinct()
                }
            )
            types = sorted(
                {
                    row.asset_type
                    for row in session.query(AssetClassificationRow.asset_type).distinct()
                }
            )
        if categories:
            self._ensure_list_labels("vehicle_type", categories)
        else:
            self._ensure_list_labels("vehicle_type", LIST_SEEDS["vehicle_type"])
        if types:
            self._ensure_list_labels("model", types)
        else:
            self._ensure_list_labels("model", LIST_SEEDS["model"])
        self._sync_list_labels(
            "dashcam_observation_type", LIST_SEEDS["dashcam_observation_type"]
        )
        self._sync_list_labels(
            "dashcam_alert_summary", LIST_SEEDS["dashcam_alert_summary"]
        )
        self._sync_list_labels("ai_camera_category", LIST_SEEDS["ai_camera_category"])
        self._sync_list_labels("driver_position", LIST_SEEDS["driver_position"])
        self._sync_list_labels("department", LIST_SEEDS["department"])

    def list_assets(
        self,
        q: str | None = None,
        category: str | None = None,
        asset_type: str | None = None,
        limit: int = 5000,
    ) -> list[dict]:
        with self._sessions() as session:
            query = session.query(AssetClassificationRow)
            if category:
                query = query.filter(AssetClassificationRow.asset_category == category)
            if asset_type:
                query = query.filter(AssetClassificationRow.asset_type == asset_type)
            if q:
                like = f"%{q.strip()}%"
                query = query.filter(AssetClassificationRow.asset_number.ilike(like))
            rows = (
                query.order_by(AssetClassificationRow.asset_number)
                .limit(max(1, min(limit, 10000)))
                .all()
            )
            return [
                {
                    "asset_number": row.asset_number,
                    "asset_category": row.asset_category,
                    "asset_type": row.asset_type,
                }
                for row in rows
            ]

    def asset_meta(self) -> dict:
        with self._sessions() as session:
            rows = session.query(AssetClassificationRow).all()
        categories: dict[str, set[str]] = {}
        for row in rows:
            categories.setdefault(row.asset_category, set()).add(row.asset_type)
        return {
            "count": len(rows),
            "categories": [
                {"label": cat, "types": sorted(types)}
                for cat, types in sorted(categories.items())
            ],
        }

    def _seed_hw_inventory_v1(self) -> None:
        """Load the V1 SCC Hardware inventory into DB when inventory is still tiny/demo."""
        device_totals = [
            ("AI Camera", 68),
            ("Edge Server", 11),
            ("Router", 20),
            ("NVR", 12),
            ("Smart Helmet", 1348),
            ("Smart Watch", 502),
            ("Weather Station", 5),
            ("GPS", 1979),
            ("Dashcam", 668),
            ("Weight Sensor", 93),
            ("PWAS", 13),
        ]
        project_share = {
            "Jafurah": 0.422,
            "Yanbu": 0.187,
            "Dhahran": 0.09,
            "MGS": 0.075,
            "Salasil": 0.055,
            "Ras Tanura": 0.05,
            "Rig Move": 0.04,
            "Medical Division": 0.035,
            "Aramco Emergency Job": 0.028,
            "Safaniya": 0.018,
        }
        expected = sum(n for _, n in device_totals)
        current = self.get_hw().get("all_projects") or 0
        # Only replace undersized demo inventories; keep real edits once populated.
        if current >= expected * 0.8:
            return
        sites = [item["label"] for item in self.catalog.get("hw_site")]
        if not sites:
            sites = list(project_share.keys())
        matrix: dict[str, dict[str, int]] = {
            site: {dtype: 0 for dtype, _ in device_totals} for site in sites
        }
        for dtype, total in device_totals:
            used = 0
            for i, site in enumerate(sites):
                share = project_share.get(site, 1 / max(len(sites), 1))
                if i == len(sites) - 1:
                    n = max(0, total - used)
                else:
                    n = max(0, round(total * share))
                    used += n
                matrix[site][dtype] = n
        # Wearables keep the intentional site split from V1.
        wearable_split = {
            "Jafurah": {"Smart Helmet": 1348, "Smart Watch": 0},
            "Yanbu": {"Smart Helmet": 0, "Smart Watch": 423},
            "MGS": {"Smart Helmet": 0, "Smart Watch": 35},
            "Ras Tanura": {"Smart Helmet": 0, "Smart Watch": 44},
        }
        for site, counts in matrix.items():
            split = wearable_split.get(site)
            if split:
                counts["Smart Helmet"] = split["Smart Helmet"]
                counts["Smart Watch"] = split["Smart Watch"]
            else:
                counts["Smart Helmet"] = 0
                counts["Smart Watch"] = 0
        with self._lock, self._sessions() as session:
            row = session.get(AppStateRow, "hw")
            value = {
                "project": matrix,
                "department": (row.value or {}).get("department")
                if row
                else self._empty_hw_dept(),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
            if row:
                # Preserve department block if present.
                if row.value and isinstance(row.value.get("department"), dict):
                    value["department"] = row.value["department"]
                row.value = value
                flag_modified(row, "value")
            else:
                session.add(AppStateRow(key="hw", value=value))
            session.commit()

    def _empty_hw_dept(self) -> dict[str, dict[str, int]]:
        return {
            item["label"]: {"avl": 0, "dashcam": 0}
            for item in self.catalog.get("department")
        }

    def next_case_id(self) -> str:
        with self._lock, self._sessions() as session:
            row = session.get(AppStateRow, "case_seq")
            current = int(row.value) if row else 1800
            current += 1
            if row:
                row.value = current
            else:
                session.add(AppStateRow(key="case_seq", value=current))
            session.commit()
            return f"SCC-{current:04d}"

    def next_itqan_case_id(self) -> str:
        yy = datetime.now(AST).year % 100
        with self._lock, self._sessions() as session:
            row = session.get(AppStateRow, "itqan_case_seq")
            current = int(row.value) if row else 1100
            current += 1
            if row:
                row.value = current
            else:
                session.add(AppStateRow(key="itqan_case_seq", value=current))
            session.commit()
            return f"ITQ-{yy:02d}-{current:04d}"

    def next_itqan_ref(self) -> str:
        with self._lock, self._sessions() as session:
            row = session.get(AppStateRow, "itqan_ref_seq")
            current = int(row.value) if row else 146000
            current += 1
            if row:
                row.value = current
            else:
                session.add(AppStateRow(key="itqan_ref_seq", value=current))
            session.commit()
            return f"ITQ-{current}"

    @staticmethod
    def _itqan_violation_from_source(record: dict) -> str:
        if record.get("record_type") == "speed":
            return "Speeding"
        raw = str((record.get("fields") or {}).get("violation_type") or "").strip()
        mapped = DASHCAM_TO_ITQAN_VIOLATION.get(raw.lower())
        return mapped or "Distracted Driving"

    @staticmethod
    def _case_status_for_itqan(itqan_status: str) -> str:
        return "closed" if itqan_status == "Closed" else "under_process"

    def _require_assign(self, payload) -> tuple[str | None, str | None]:
        if payload.assign_to == "project":
            if not payload.project_id:
                raise ValueError("Project is required when Assign to is Project.")
            return self.catalog.label("project", payload.project_id), None
        if not payload.department_id:
            raise ValueError("Department is required when Assign to is Department.")
        return None, self.catalog.label("department", payload.department_id)

    def _check_rental(self, rental: bool, iqama: str | None) -> str | None:
        if rental and not (iqama and iqama.strip()):
            raise ValueError("Iqama Number is required when Rental driver is Yes.")
        return iqama.strip() if iqama else None

    def create_ai_camera(self, payload) -> dict:
        project = self.catalog.label("project", payload.project_id)
        if not project:
            raise ValueError("Unknown or inactive project.")
        alert_type = self.catalog.label("alert_type", payload.alert_type_id)
        if not alert_type:
            raise ValueError("Unknown or inactive alert type.")
        category = self.catalog.label("ai_camera_category", payload.category_id)
        if not category:
            raise ValueError("Unknown or inactive category.")
        if category.strip().lower().startswith("other"):
            other = (getattr(payload, "category_other", None) or "").strip()
            if not other:
                raise ValueError("Please describe the Other category.")
            category = other
        risk_level = None
        if (alert_type or "").strip().lower() != "positive":
            risk_level = self.catalog.label("risk_level", payload.risk_level_id or "")
            if not risk_level:
                raise ValueError("Risk level is required for this alert type.")
        year, week = week_from_date(payload.occurred_on)
        record = {
            "id": str(uuid4()),
            "case_id": self.next_case_id(),
            "record_type": "ai_camera",
            "status": "open",
            "project": project,
            "department": None,
            "title": payload.alert_summary[:80],
            "date": payload.occurred_on.isoformat(),
            "week_year": year,
            "week_number": week,
            "risk_level": risk_level,
            "created_at": datetime.now(timezone.utc),
            "fields": {
                "location": payload.location,
                "occurred_time": payload.occurred_time.strftime("%H:%M"),
                "alert_summary": payload.alert_summary,
                "alert_type": alert_type,
                "category": category,
                "detection_method": self.catalog.label(
                    "detection_method", payload.detection_method_id
                ),
                "reported_by": payload.reported_by,
                "observation_picture": (payload.observation_picture or "").strip() or None,
                "camera_id": (payload.camera_id or "").strip() or None,
                "safelife_update": bool(payload.updated_in_safelife),
                "safelife_ref": (
                    (payload.safelife_reference or "").strip()
                    if payload.updated_in_safelife
                    else None
                ),
                "safelife_skip_reason": (
                    None
                    if bool(payload.updated_in_safelife)
                    else (
                        (getattr(payload, "safelife_skip_reason", None) or "").strip()
                        or None
                    )
                ),
            },
        }
        return self._insert_case(record)

    def create_dashcam(self, payload) -> dict:
        project, department = self._require_assign(payload)
        iqama = self._check_rental(payload.rental_driver, payload.iqama_number)
        violation = self.catalog.label(
            "dashcam_observation_type", payload.violation_type_id
        )
        if not violation:
            raise ValueError("Unknown or inactive violation type.")
        if violation.strip().lower().startswith("other"):
            other = (getattr(payload, "violation_other", None) or "").strip()
            if not other:
                raise ValueError("Please describe the Other violation type.")
            violation = other
        year, week = week_from_date(payload.occurred_on)
        record = {
            "id": str(uuid4()),
            "case_id": self.next_case_id(),
            "record_type": "dashcam",
            "status": "open",
            "project": project,
            "department": department,
            "title": payload.alert_summary[:80],
            "date": payload.occurred_on.isoformat(),
            "week_year": year,
            "week_number": week,
            "risk_level": self.catalog.label("risk_level", payload.risk_level_id),
            "created_at": datetime.now(timezone.utc),
            "fields": {
                "assign_to": payload.assign_to,
                "vehicle_type": self.catalog.label("vehicle_type", payload.vehicle_type_id),
                "model": self.catalog.label("model", payload.model_id),
                "asset_number": payload.asset_number,
                "driver_name": payload.driver_name,
                "driver_badge_number": payload.driver_badge_number,
                "rental_driver": payload.rental_driver,
                "iqama_number": iqama,
                "location_coordinates": payload.location_coordinates,
                "occurred_time": payload.occurred_time.strftime("%H:%M"),
                "violation_type": violation,
                "alert_summary": payload.alert_summary,
                "reported_by": payload.reported_by,
                "violation_picture": (payload.violation_picture or "").strip() or None,
                "upload_to_itqan": bool(getattr(payload, "upload_to_itqan", True)),
                "itqan_skip_reason": (
                    None
                    if bool(getattr(payload, "upload_to_itqan", True))
                    else ((getattr(payload, "itqan_skip_reason", None) or "").strip() or None)
                ),
            },
        }
        return self._insert_case(record)

    def create_speed(self, payload) -> dict:
        project, department = self._require_assign(payload)
        iqama = self._check_rental(payload.rental_driver, payload.iqama_number)
        kind = self.catalog.label("speed_violation_type", payload.speed_violation_type_id) or ""
        vehicle = self.catalog.label("vehicle_type", payload.vehicle_type_id) or ""
        exceedance = payload.vehicle_speed_kmh - payload.permitted_speed_kmh
        summary = _speed_summary(
            kind, vehicle, payload.permitted_speed_kmh, payload.vehicle_speed_kmh
        )
        year, week = week_from_date(payload.occurred_on)
        record = {
            "id": str(uuid4()),
            "case_id": self.next_case_id(),
            "record_type": "speed",
            "status": "open",
            "project": project,
            "department": department,
            "title": summary[:80],
            "date": payload.occurred_on.isoformat(),
            "week_year": year,
            "week_number": week,
            "risk_level": _speed_risk_from_exceedance(exceedance),
            "created_at": datetime.now(timezone.utc),
            "fields": {
                "assign_to": payload.assign_to,
                "speed_violation_type": kind,
                "vehicle_type": vehicle,
                "model": self.catalog.label("model", payload.model_id),
                "asset_number": payload.asset_number,
                "driver_name": payload.driver_name,
                "driver_badge_number": payload.driver_badge_number,
                "position": payload.position,
                "rental_driver": payload.rental_driver,
                "iqama_number": iqama,
                "location_coordinates": payload.location_coordinates,
                "occurred_time": payload.occurred_time.strftime("%H:%M"),
                "permitted_speed_kmh": payload.permitted_speed_kmh,
                "vehicle_speed_kmh": payload.vehicle_speed_kmh,
                "exceedance_kmh": exceedance,
                "alert_summary": summary,
                "reported_by": payload.reported_by,
                "fms_evidence": (payload.fms_evidence or "").strip() or None,
                "upload_to_itqan": bool(getattr(payload, "upload_to_itqan", True)),
                "itqan_skip_reason": (
                    None
                    if bool(getattr(payload, "upload_to_itqan", True))
                    else (
                        (getattr(payload, "itqan_skip_reason", None) or "").strip()
                        or None
                    )
                ),
            },
        }
        return self._insert_case(record)

    def create_sos(self, payload, actor: str | None = None) -> dict:
        project = self.catalog.label("project", payload.project_id)
        if not project:
            raise ValueError("Unknown or inactive project.")
        created = payload.sos_created_at
        year, week = week_from_date(created.date())
        delta = payload.seen_at - payload.sos_created_at
        record = {
            "id": str(uuid4()),
            "case_id": self.next_case_id(),
            "record_type": "sos",
            "status": "open",
            "project": project,
            "department": None,
            "title": payload.worker_name_badge,
            "date": created.date().isoformat(),
            "week_year": year,
            "week_number": week,
            "risk_level": None,
            "created_at": datetime.now(timezone.utc),
            "fields": {
                "worker_name_badge": payload.worker_name_badge,
                "sos_created_at": payload.sos_created_at.isoformat(),
                "seen_at": payload.seen_at.isoformat(),
                "time_to_see_seconds": int(delta.total_seconds()),
                "location": payload.location,
                "source": self.catalog.label("sos_source", payload.source_id),
                "reported_by": (actor or "").strip() or None,
            },
        }
        return self._insert_case(record)

    def close_out_ai_camera(self, case_id: str, payload, actor: str | None = None) -> dict | None:
        def mutate(record: dict) -> None:
            if record["status"] != "open":
                raise ValueError("Close-out can only be submitted while the record is Open.")
            record["status"] = "under_process"
            record["fields"]["hseo_name_badge"] = payload.hseo_name_badge.strip()
            record["fields"]["close_out_action"] = payload.close_out_action.strip()
            record["fields"]["close_out_picture"] = payload.close_out_picture.strip()
            record["fields"]["close_out_submitted_by"] = actor or "Operator"

        return self._patch_case(case_id, "ai_camera", mutate)

    def confirm_driver(
        self, case_id: str, record_type: str, payload, actor: str | None = None
    ) -> dict | None:
        if record_type not in {"dashcam", "speed"}:
            raise ValueError("Confirm Driver applies to DashCam and Speed only.")

        def mutate(record: dict) -> None:
            if record["status"] != "open":
                raise ValueError("Confirm Driver can only be submitted while the record is Open.")
            fields = record["fields"]
            upload = getattr(payload, "upload_to_itqan", None)
            if upload is None:
                upload = bool(fields.get("upload_to_itqan", True))
            else:
                upload = bool(upload)
            fields["upload_to_itqan"] = upload
            if upload:
                proof = (getattr(payload, "itqan_proof", None) or "").strip()
                if not proof:
                    raise ValueError("ITQAN upload proof is required when uploading to ITQAN.")
                fields["itqan_upload_proof"] = proof
                fields["itqan_skip_reason"] = None
                fields["close_out_action"] = ITQAN_CLOSE_OUT
            else:
                reason = (getattr(payload, "itqan_skip_reason", None) or "").strip()
                if not reason:
                    reason = (fields.get("itqan_skip_reason") or "").strip()
                if not reason:
                    raise ValueError("Reason for not uploading to ITQAN is required.")
                fields["itqan_skip_reason"] = reason
                fields["itqan_upload_proof"] = None
                fields["close_out_action"] = f"Not uploaded to ITQAN · {reason}"
            fields["uploaded_by"] = payload.uploaded_by.strip()
            fields["confirmed_at"] = datetime.now(timezone.utc).isoformat()
            if actor:
                fields["close_out_submitted_by"] = actor
            record["status"] = "under_process"

        updated = self._patch_case(case_id, record_type, mutate)
        if (
            updated
            and bool((updated.get("fields") or {}).get("upload_to_itqan", True))
            and not (updated.get("fields") or {}).get("itqan_case_id")
        ):
            itq = self._create_itqan_from_source(updated, actor=actor)
            if itq:

                def link(record: dict) -> None:
                    record["fields"]["itqan_case_id"] = itq["id"]
                    record["fields"]["itqan_ref"] = (itq.get("fields") or {}).get(
                        "itqan_ref"
                    )

                self._patch_case(case_id, record_type, link)
                refreshed = self.get_case(case_id)
                return refreshed or updated
        return updated

    def create_itqan(self, payload, actor: str | None = None) -> dict:
        project, department = self._require_assign(payload)
        vehicle = self.catalog.label("vehicle_type", payload.vehicle_type_id)
        violation = self.catalog.label("itqan_violation_type", payload.violation_type_id)
        itqan_status = self.catalog.label("itqan_status", payload.itqan_status_id)
        if not vehicle:
            raise ValueError("Unknown or inactive vehicle type.")
        if not violation:
            raise ValueError("Unknown or inactive ITQAN violation type.")
        if not itqan_status:
            raise ValueError("Unknown or inactive ITQAN status.")
        year, week = week_from_date(payload.occurred_on)
        occurred_dt = datetime.combine(payload.occurred_on, payload.occurred_time, tzinfo=AST)
        pic = (payload.itqan_record_picture or "").strip() or None
        record = {
            "id": str(uuid4()),
            "case_id": self.next_itqan_case_id(),
            "record_type": "itqan",
            "status": self._case_status_for_itqan(itqan_status),
            "project": project,
            "department": department,
            "title": violation[:80],
            "date": payload.occurred_on.isoformat(),
            "week_year": year,
            "week_number": week,
            "risk_level": None,
            "created_at": datetime.now(timezone.utc),
            "fields": {
                "assign_to": payload.assign_to,
                "itqan_ref": payload.itqan_ref.strip(),
                "itqan_status": itqan_status,
                "violation_type": violation,
                "vehicle_type": vehicle,
                "driver_name": payload.driver_name.strip(),
                "driver_badge_number": payload.driver_badge_number.strip(),
                "occurred_time": payload.occurred_time.strftime("%H:%M"),
                "source": "Manual entry",
                "source_case_id": None,
                "source_record_type": None,
                "source_case_label": None,
                "itqan_upload_proof": pic,
                "reported_by": (actor or payload.reported_by).strip(),
                "registered_at": occurred_dt.astimezone(timezone.utc).isoformat(),
            },
        }
        return self._insert_case(record)

    def update_itqan_status(
        self, case_id: str, payload, actor: str | None = None
    ) -> dict | None:
        status_label = self.catalog.label("itqan_status", payload.itqan_status_id)
        if not status_label:
            raise ValueError("Unknown or inactive ITQAN status.")

        def mutate(record: dict) -> None:
            if record["record_type"] != "itqan":
                raise ValueError("ITQAN status updates apply to ITQAN records only.")
            prev = (record["fields"] or {}).get("itqan_status")
            record["fields"]["itqan_status"] = status_label
            record["status"] = self._case_status_for_itqan(status_label)
            record["fields"]["itqan_status_updated_at"] = datetime.now(
                timezone.utc
            ).isoformat()
            if actor:
                record["fields"]["itqan_status_updated_by"] = actor
            hist = list(record["fields"].get("status_history") or [])
            hist.append(
                {
                    "at": datetime.now(timezone.utc).isoformat(),
                    "by": actor or "Admin",
                    "from": prev,
                    "to": status_label,
                }
            )
            record["fields"]["status_history"] = hist[-40:]

        return self._patch_case(case_id, "itqan", mutate)

    def _create_itqan_from_source(
        self, source: dict, actor: str | None = None
    ) -> dict | None:
        fields = dict(source.get("fields") or {})
        if fields.get("itqan_case_id"):
            return None
        source_type = source.get("record_type")
        if source_type not in {"dashcam", "speed"}:
            return None
        violation = self._itqan_violation_from_source(source)
        vehicle = str(fields.get("vehicle_type") or "Light Vehicle")
        itqan_ref = str(fields.get("itqan_ref") or "").strip() or self.next_itqan_ref()
        itqan_status = ITQAN_STATUS_DEFAULT
        occurred = date.fromisoformat(source["date"])
        year, week = week_from_date(occurred)
        time_raw = str(fields.get("occurred_time") or "00:00")
        confirmed = fields.get("confirmed_at") or datetime.now(timezone.utc).isoformat()
        proof = (fields.get("itqan_upload_proof") or "").strip() or None
        if proof and not (
            proof.startswith("/uploads/")
            or proof.startswith("http")
            or proof.startswith("data:")
        ):
            proof = ensure_demo_image(
                proof.rsplit(".", 1)[0] or f"itqan-from-{source.get('case_id')}",
                hue=25 + (hash(source.get("case_id") or "") % 80),
            )
        record = {
            "id": str(uuid4()),
            "case_id": self.next_itqan_case_id(),
            "record_type": "itqan",
            "status": self._case_status_for_itqan(itqan_status),
            "project": source.get("project"),
            "department": source.get("department"),
            "title": violation[:80],
            "date": source["date"],
            "week_year": year,
            "week_number": week,
            "risk_level": source.get("risk_level"),
            "created_at": datetime.now(timezone.utc),
            "fields": {
                "assign_to": "project" if source.get("project") else "department",
                "itqan_ref": itqan_ref,
                "itqan_status": itqan_status,
                "violation_type": violation,
                "vehicle_type": vehicle,
                "driver_name": fields.get("driver_name"),
                "driver_badge_number": fields.get("driver_badge_number"),
                "occurred_time": time_raw[:5],
                "source": ITQAN_SOURCE_LABELS.get(source_type, source_type),
                "source_case_id": source["id"],
                "source_record_type": source_type,
                "source_case_label": source.get("case_id"),
                "itqan_upload_proof": proof,
                "reported_by": fields.get("uploaded_by")
                or fields.get("reported_by")
                or actor
                or "Operator",
                "registered_at": confirmed,
                "linked_from": source.get("case_id"),
            },
        }
        return self._insert_case(record)

    def close_sos(self, case_id: str, payload, actor: str | None = None) -> dict | None:
        def mutate(record: dict) -> None:
            if record["status"] != "open":
                raise ValueError("Only Open SOS alerts can be closed.")
            record["status"] = "closed"
            record["fields"]["alarm"] = payload.alarm.strip()
            pic = (getattr(payload, "worker_picture", None) or "").strip()
            record["fields"]["worker_picture"] = pic or None
            record["fields"]["picture_shared_by"] = payload.picture_shared_by
            record["fields"]["closure_closed_at"] = payload.closed_at.isoformat()
            record["fields"]["close_out_report"] = payload.close_out_report
            closer = (actor or "").strip() or "Operator"
            record["fields"]["closed_by"] = closer
            # Older SOS rows had no reported_by; credit the closer for registration too.
            if not record["fields"].get("reported_by"):
                record["fields"]["reported_by"] = closer

        return self._patch_case(case_id, "sos", mutate)

    def approve_case(self, case_id: str, actor: str) -> dict | None:
        with self._lock, self._sessions() as session:
            row = session.get(CaseRow, case_id)
            if not row or row.is_deleted:
                return None
            if row.record_type == "sos":
                raise ValueError("SOS alerts close without Admin approval.")
            if row.status != "under_process":
                raise ValueError("Only Under Process records can be approved.")
            row.status = "closed"
            fields = dict(row.fields or {})
            fields["closed_by"] = actor
            fields["approved_at"] = datetime.now(timezone.utc).isoformat()
            row.fields = fields
            flag_modified(row, "fields")
            session.commit()
            session.refresh(row)
            return _case_dict(row)

    def reject_case(self, case_id: str, reason: str, actor: str) -> dict | None:
        reason = reason.strip()
        if not reason:
            raise ValueError("A reject reason is required.")
        with self._lock, self._sessions() as session:
            row = session.get(CaseRow, case_id)
            if not row or row.is_deleted:
                return None
            if row.record_type == "sos":
                raise ValueError("SOS alerts close without Admin approval.")
            if row.status != "under_process":
                raise ValueError("Only Under Process records can be rejected.")
            row.status = "open"
            fields = dict(row.fields or {})
            fields["reject_reason"] = reason
            fields["rejected_by"] = actor
            row.fields = fields
            flag_modified(row, "fields")
            session.commit()
            session.refresh(row)
            return _case_dict(row)

    def delete_case(self, case_id: str, confirm: bool, actor: str) -> dict | None:
        if not confirm:
            raise ValueError("Delete requires confirmation.")
        with self._lock, self._sessions() as session:
            row = session.get(CaseRow, case_id)
            if not row or row.is_deleted:
                return None
            row.is_deleted = True
            fields = dict(row.fields or {})
            fields["deleted_by"] = actor
            fields["deleted_at"] = datetime.now(timezone.utc).isoformat()
            row.fields = fields
            flag_modified(row, "fields")
            session.commit()
            return _case_dict(row)

    _ADMIN_EDITABLE_FIELDS: dict[str, set[str]] = {
        "ai_camera": {
            "location",
            "occurred_time",
            "alert_summary",
            "alert_type",
            "category",
            "detection_method",
        },
        "dashcam": {
            "violation_type",
            "vehicle_type",
            "model",
            "asset_number",
            "driver_name",
            "driver_badge_number",
            "location_coordinates",
            "alert_summary",
            "iqama_number",
            "rental_driver",
        },
        "speed": {
            "speed_violation_type",
            "vehicle_type",
            "model",
            "asset_number",
            "driver_name",
            "driver_badge_number",
            "position",
            "location_coordinates",
            "permitted_speed_kmh",
            "vehicle_speed_kmh",
            "iqama_number",
            "rental_driver",
        },
        "sos": {
            "worker_name_badge",
            "location",
            "source",
            "sos_created_at",
            "seen_at",
            "close_out_report",
        },
        "itqan": {
            "violation_type",
            "vehicle_type",
            "driver_name",
            "driver_badge_number",
            "itqan_ref",
            "itqan_status",
            "occurred_time",
        },
    }

    def update_case_admin(self, case_id: str, payload) -> dict | None:
        with self._lock, self._sessions() as session:
            row = session.get(CaseRow, case_id)
            if not row or row.is_deleted:
                return None
            allowed = self._ADMIN_EDITABLE_FIELDS.get(row.record_type, set())
            fields = dict(row.fields or {})
            incoming = dict(payload.fields or {})
            for key, value in incoming.items():
                if key not in allowed:
                    continue
                if isinstance(value, str):
                    value = value.strip()
                    fields[key] = value or None
                else:
                    fields[key] = value

            if payload.project is not None:
                project = payload.project.strip()
                row.project = project or None
                if row.project and row.record_type in {"dashcam", "speed"}:
                    row.department = None
            if payload.department is not None:
                department = payload.department.strip()
                row.department = department or None
                if row.department and row.record_type in {"dashcam", "speed"}:
                    row.project = None
            if payload.risk_level is not None:
                risk = payload.risk_level.strip()
                row.risk_level = risk or None
            if payload.occurred_on is not None:
                row.occurred_on = payload.occurred_on
                year, week = week_from_date(payload.occurred_on)
                row.week_year = year
                row.week_number = week
            if payload.title is not None:
                title = payload.title.strip()
                if not title:
                    raise ValueError("Title cannot be empty.")
                row.title = title
            elif "alert_summary" in incoming and incoming.get("alert_summary"):
                summary = str(incoming["alert_summary"]).strip()
                if summary:
                    row.title = summary[:200]

            row.fields = fields
            flag_modified(row, "fields")
            session.commit()
            session.refresh(row)
            return _case_dict(row)

    def filter_cases_for_user(
        self, rows: list[dict], user: dict | None
    ) -> list[dict]:
        if not user:
            return rows
        allowed = user.get("projects")
        if not allowed:
            return rows
        allowed_set = {str(item) for item in allowed}
        return [
            row
            for row in rows
            if not row.get("project") or row.get("project") in allowed_set
        ]

    def list_cases(
        self,
        record_type: str | None = None,
        status: str | None = None,
        project: str | None = None,
    ) -> list[dict]:
        with self._sessions() as session:
            query = session.query(CaseRow).filter(CaseRow.is_deleted.is_(False))
            if record_type:
                query = query.filter(CaseRow.record_type == record_type)
            if status:
                query = query.filter(CaseRow.status == status)
            if project:
                query = query.filter(CaseRow.project == project)
            rows = query.order_by(CaseRow.created_at.desc()).all()
            return [_case_dict(row) for row in rows]

    def get_case(self, case_id: str) -> dict | None:
        with self._sessions() as session:
            row = session.get(CaseRow, case_id)
            if not row or row.is_deleted:
                return None
            return _case_dict(row)

    def period_bounds(
        self,
        period: str,
        start_date: date | None = None,
        end_date: date | None = None,
    ) -> tuple[date, date]:
        today = datetime.now(AST).date()
        if period == "custom":
            if not start_date or not end_date:
                raise ValueError("Custom period requires start_date and end_date.")
            if start_date > end_date:
                raise ValueError("start_date must be on or before end_date.")
            return start_date, end_date
        if period == "last_week":
            offset = (today.weekday() + 1) % 7
            this_sunday = today - timedelta(days=offset)
            start = this_sunday - timedelta(days=7)
            return start, this_sunday - timedelta(days=1)
        if period == "this_month":
            return today.replace(day=1), today
        offset = (today.weekday() + 1) % 7
        start = today - timedelta(days=offset)
        return start, today

    def in_period(self, row: dict, start: date, end: date) -> bool:
        value = date.fromisoformat(row["date"])
        return start <= value <= end

    def _apply_view(
        self,
        rows: list[dict],
        view: str,
        project: str | None,
        department: str | None,
    ) -> list[dict]:
        if view == "projects":
            rows = [row for row in rows if row.get("project")]
            if project:
                rows = [row for row in rows if row["project"] == project]
        elif view == "departments":
            rows = [row for row in rows if row.get("department")]
            if department:
                rows = [row for row in rows if row["department"] == department]
        elif view != "overall":
            raise ValueError("View must be overall, projects, or departments.")
        return rows

    def dashboard(
        self,
        period: str = "this_week",
        view: str = "overall",
        project: str | None = None,
        department: str | None = None,
        start_date: date | None = None,
        end_date: date | None = None,
        user: dict | None = None,
    ) -> dict:
        start, end = self.period_bounds(period, start_date, end_date)
        allowed = user.get("projects") if user else None
        allowed_set = {str(item) for item in allowed} if allowed else None
        if allowed_set and project and project not in allowed_set:
            project = None
        base_rows = self.filter_cases_for_user(self.list_cases(), user)
        scoped = self._apply_view(base_rows, view, project, department)
        rows = [row for row in scoped if self.in_period(row, start, end)]
        by_type = {"ai_camera": 0, "dashcam": 0, "speed": 0, "sos": 0, "itqan": 0}
        by_status = {"open": 0, "under_process": 0, "closed": 0}
        by_project: dict[str, int] = {}
        for row in rows:
            by_type[row["record_type"]] = by_type.get(row["record_type"], 0) + 1
            by_status[row["status"]] = by_status.get(row["status"], 0) + 1
            if row["project"]:
                by_project[row["project"]] = by_project.get(row["project"], 0) + 1
        confirm = [
            row
            for row in scoped
            if row["record_type"] in {"dashcam", "speed"} and row["status"] == "open"
        ]
        review = [row for row in scoped if row["status"] == "under_process"]
        open_sos = [
            row
            for row in scoped
            if row["record_type"] == "sos" and row["status"] == "open"
        ]
        aged = []
        cutoff = datetime.now(AST).date() - timedelta(days=7)
        for row in scoped:
            if (
                row["record_type"] == "ai_camera"
                and row["status"] == "open"
                and date.fromisoformat(row["date"]) <= cutoff
            ):
                aged.append(row)
        series = []
        today = datetime.now(AST).date()
        for i in range(7, -1, -1):
            day = today - timedelta(days=i * 7)
            _y, week = week_from_date(day)
            counts = {"ai_camera": 0, "dashcam": 0, "speed": 0, "sos": 0, "itqan": 0}
            for row in scoped:
                if row["week_number"] == week and row["record_type"] in counts:
                    counts[row["record_type"]] += 1
            series.append({"week": week, **counts})
        by_department: dict[str, int] = {}
        for row in rows:
            if row.get("department"):
                by_department[row["department"]] = by_department.get(row["department"], 0) + 1
        weather = self._weather_summary(
            view=view, project=project, allowed_projects=allowed_set
        )
        catalog_projects = [item["label"] for item in self.catalog.get("project")]
        if allowed_set:
            projects = [p for p in catalog_projects if p in allowed_set]
            if not projects:
                projects = sorted(allowed_set)
        else:
            projects = catalog_projects
        return {
            "prototype": True,
            "authentication": "disabled",
            "storage": self.storage_label(),
            "period": period,
            "view": view,
            "project": project,
            "department": department,
            "period_start": start.isoformat(),
            "period_end": end.isoformat(),
            "projects": projects,
            "departments": [item["label"] for item in self.catalog.get("department")],
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "kpis": {
                "total": len(rows),
                **by_type,
                **{f"status_{key}": value for key, value in by_status.items()},
            },
            "by_status": by_status,
            "by_project": by_project,
            "by_department": by_department,
            "series_8_weeks": series,
            "needs_attention": {
                "confirm_driver": {
                    "count": len(confirm),
                    "case_id": confirm[0]["id"] if confirm else None,
                },
                "admin_review": {
                    "count": len(review),
                    "case_id": review[0]["id"] if review else None,
                },
                "open_sos": {
                    "count": len(open_sos),
                    "case_id": open_sos[0]["id"] if open_sos else None,
                },
                "ai_camera_open_over_7_days": {
                    "count": len(aged),
                    "case_id": aged[0]["id"] if aged else None,
                },
            },
            "latest": rows[:6],
            "weather_summary": weather,
            "category": self._category_stats(rows),
        }

    def _weather_summary(
        self,
        view: str = "overall",
        project: str | None = None,
        allowed_projects: set[str] | None = None,
    ) -> dict | None:
        """Highest weather readings from filled tables, scoped by dashboard project filter."""
        sheets = [
            sheet
            for sheet in self.get_weather()
            if sheet.get("observed_on")
            and (
                sheet.get("project_id")
                or sheet.get("location")
                or any(
                    reading.get(key) is not None
                    for reading in sheet.get("readings") or []
                    for key in (
                        "wind_speed_ms",
                        "temperature_c",
                        "rh_percent",
                        "co2_ppm",
                        "pm25",
                        "pm10",
                        "heat_index",
                    )
                )
            )
        ]
        if view == "projects" and project:
            sheets = [sheet for sheet in sheets if sheet.get("project") == project]
        elif allowed_projects:
            sheets = [
                sheet
                for sheet in sheets
                if not sheet.get("project") or sheet.get("project") in allowed_projects
            ]
        if not sheets:
            return None

        def max_metric(key: str) -> float | None:
            values = [
                reading[key]
                for sheet in sheets
                for reading in sheet.get("readings") or []
                if isinstance(reading.get(key), (int, float))
            ]
            return max(values) if values else None

        if view == "projects" and project and len(sheets) == 1:
            sheet = sheets[0]
            return {
                "project": sheet.get("project"),
                "location": sheet.get("location"),
                "observed_on": sheet.get("observed_on"),
                "scope": "project",
                "wind_speed_ms": max_metric("wind_speed_ms"),
                "temperature_c": max_metric("temperature_c"),
                "rh_percent": max_metric("rh_percent"),
                "heat_index": max_metric("heat_index"),
            }

        latest_on = max(
            (sheet["observed_on"] for sheet in sheets if sheet.get("observed_on")),
            default=None,
        )
        projects = sorted(
            {
                sheet["project"]
                for sheet in sheets
                if sheet.get("project")
            }
        )
        if view == "projects" and project:
            locations = sorted(
                {
                    sheet["location"]
                    for sheet in sheets
                    if sheet.get("location")
                }
            )
            return {
                "project": project,
                "location": ", ".join(locations) if locations else None,
                "observed_on": latest_on,
                "scope": "project",
                "wind_speed_ms": max_metric("wind_speed_ms"),
                "temperature_c": max_metric("temperature_c"),
                "rh_percent": max_metric("rh_percent"),
                "heat_index": max_metric("heat_index"),
            }

        return {
            "project": "All weather tables" if len(projects) != 1 else projects[0],
            "location": (
                f"{len(sheets)} tables"
                if len(sheets) > 1
                else next((sheet.get("location") for sheet in sheets), None)
            ),
            "observed_on": latest_on,
            "scope": "all",
            "wind_speed_ms": max_metric("wind_speed_ms"),
            "temperature_c": max_metric("temperature_c"),
            "rh_percent": max_metric("rh_percent"),
            "heat_index": max_metric("heat_index"),
        }

    def _category_stats(self, rows: list[dict]) -> dict:
        def slice_type(kind: str) -> list[dict]:
            return [row for row in rows if row["record_type"] == kind]

        ai = slice_type("ai_camera")
        dash = slice_type("dashcam")
        speed = slice_type("speed")
        sos = slice_type("sos")

        def status_counts(items: list[dict]) -> dict[str, int]:
            counts = {"open": 0, "under_process": 0, "closed": 0}
            for item in items:
                counts[item["status"]] += 1
            return counts

        exceedances = [
            item["fields"].get("exceedance_kmh", 0) for item in speed
        ]
        times = [
            item["fields"].get("time_to_see_seconds")
            for item in sos
            if item["fields"].get("time_to_see_seconds") is not None
        ]
        return {
            "ai_camera": {
                **status_counts(ai),
                "positive": sum(
                    1
                    for item in ai
                    if item["fields"].get("alert_type") == "Positive"
                ),
            },
            "dashcam": {
                **status_counts(dash),
                "high_risk": sum(1 for item in dash if item.get("risk_level") == "High Risk"),
            },
            "speed": {
                **status_counts(speed),
                "average_exceedance": (sum(exceedances) / len(exceedances)) if exceedances else 0,
                "bands": {
                    "up_to_10": sum(1 for value in exceedances if value <= 10),
                    "11_to_20": sum(1 for value in exceedances if 11 <= value <= 20),
                    "over_20": sum(1 for value in exceedances if value > 20),
                },
            },
            "sos": {
                "open": status_counts(sos)["open"],
                "closed": status_counts(sos)["closed"],
                "average_time_to_see_seconds": (sum(times) / len(times)) if times else 0,
                "fastest_seconds": min(times) if times else None,
                "slowest_seconds": max(times) if times else None,
            },
        }

    def get_weather(self) -> list[dict]:
        with self._sessions() as session:
            row = session.get(AppStateRow, "weather")
            sheets = row.value if row else self._empty_weather()
            return [dict(sheet) for sheet in sheets]

    def save_weather(self, sheets: list) -> list[dict]:
        saved = []
        for incoming in sheets:
            slot = incoming.slot
            filled = bool(incoming.project_id or incoming.location or incoming.observed_on)
            if filled and not (incoming.project_id and incoming.location and incoming.observed_on):
                raise ValueError(
                    "Project, Location and Date are required in each table you fill."
                )
            week = None
            project = None
            if incoming.observed_on:
                _y, week = week_from_date(incoming.observed_on)
            if incoming.project_id:
                project = self.catalog.label("project", incoming.project_id)
            readings = incoming.readings or [
                {
                    "time": hour,
                    "wind_speed_ms": None,
                    "temperature_c": None,
                    "rh_percent": None,
                    "co2_ppm": None,
                    "pm25": None,
                    "pm10": None,
                    "heat_index": None,
                    "remarks": None,
                }
                for hour in WEATHER_HOURS
            ]
            sheet = {
                "slot": slot,
                "project_id": incoming.project_id,
                "project": project,
                "location": incoming.location,
                "observed_on": incoming.observed_on.isoformat() if incoming.observed_on else None,
                "week_number": week,
                "readings": [item.model_dump() if hasattr(item, "model_dump") else item for item in readings],
            }
            saved.append(sheet)
        saved.sort(key=lambda item: item["slot"])
        with self._lock, self._sessions() as session:
            row = session.get(AppStateRow, "weather")
            if row:
                row.value = saved
            else:
                session.add(AppStateRow(key="weather", value=saved))
            session.commit()
        return saved

    def list_weather_stations(self, project: str | None = None) -> list[dict]:
        rows = WEATHER_STATIONS
        if project and project != "All":
            rows = [s for s in rows if s["project"] == project]
        return [dict(s) for s in rows]

    def get_weather_hourly(
        self,
        project: str,
        observed_on: date,
    ) -> list[dict]:
        stations = [s for s in WEATHER_STATIONS if s["project"] == project]
        with self._sessions() as session:
            saved = (
                session.query(WeatherHourlyReadingRow)
                .filter(
                    WeatherHourlyReadingRow.project == project,
                    WeatherHourlyReadingRow.observed_on == observed_on,
                )
                .all()
            )
            by_key = {(r.station_id, r.hour): r for r in saved}

        tables = []
        now = datetime.now(AST)
        today = now.date()
        for index, station in enumerate(stations, start=1):
            hours = []
            for hour in WEATHER_DAY_HOURS:
                row = by_key.get((station["id"], hour))
                upcoming = observed_on > today or (
                    observed_on == today and hour > now.hour
                )
                if row:
                    hours.append(
                        {
                            "hour": hour,
                            "timeLabel": _hour_label(hour),
                            "status": row.status,
                            "wind": row.wind_ms,
                            "temp": row.temp_c,
                            "rh": row.rh_percent,
                            "co2": row.co2_ppm,
                            "pm25": row.pm25,
                            "pm10": row.pm10,
                            "heatIndex": row.heat_index,
                            "category": (
                                {
                                    "level": row.category_level or 0,
                                    "name": row.category_name or "Normal",
                                    "prevention": _heat_category(
                                        row.heat_index or 0
                                    ).get("prevention", ""),
                                }
                                if row.heat_index is not None
                                else _heat_category(0)
                            ),
                            "remarks": row.remarks or "",
                            "loggedBy": row.logged_by,
                        }
                    )
                elif upcoming:
                    hours.append(
                        {
                            "hour": hour,
                            "timeLabel": _hour_label(hour),
                            "status": "upcoming",
                        }
                    )
                else:
                    hours.append(
                        {
                            "hour": hour,
                            "timeLabel": _hour_label(hour),
                            "status": "missing",
                        }
                    )
            tables.append(
                {
                    "stationId": station["id"],
                    "project": station["project"],
                    "location": station["loc"],
                    "tableIndex": index,
                    "tableCount": len(stations),
                    "dateIso": observed_on.isoformat(),
                    "hours": hours,
                }
            )
        return tables

    def save_weather_hourly(self, payload) -> list[dict]:
        observed_on = payload.observed_on
        station_id = payload.station_id.strip()
        project = payload.project.strip()
        location = payload.location.strip()
        if not any(s["id"] == station_id and s["project"] == project for s in WEATHER_STATIONS):
            # Allow unknown station ids only if project/location provided (future stations).
            if not project or not location:
                raise ValueError("Unknown weather station.")
        now = datetime.now(timezone.utc)
        logged_by = (payload.logged_by or "").strip() or None

        with self._lock, self._sessions() as session:
            for cell in payload.readings:
                hour = int(cell.hour)
                if hour not in WEATHER_DAY_HOURS:
                    raise ValueError(f"Hour {hour} is outside the 7:00–14:00 window.")
                existing = (
                    session.query(WeatherHourlyReadingRow)
                    .filter(
                        WeatherHourlyReadingRow.station_id == station_id,
                        WeatherHourlyReadingRow.observed_on == observed_on,
                        WeatherHourlyReadingRow.hour == hour,
                    )
                    .one_or_none()
                )
                temp = cell.temp
                rh = cell.rh
                heat = cell.heat_index
                if heat is None and temp is not None and rh is not None:
                    heat = _calc_heat_index(float(temp), float(rh))
                cat = _heat_category(float(heat or 0)) if heat is not None else None
                has_values = any(
                    v is not None
                    for v in (cell.wind, temp, rh, cell.co2, cell.pm25, cell.pm10, heat)
                )
                status = cell.status if cell.status in {"ok", "missing"} else (
                    "ok" if has_values else "missing"
                )
                if existing is None:
                    existing = WeatherHourlyReadingRow(
                        id=str(uuid4()),
                        station_id=station_id,
                        project=project,
                        location=location,
                        observed_on=observed_on,
                        hour=hour,
                    )
                    session.add(existing)
                existing.project = project
                existing.location = location
                existing.wind_ms = cell.wind
                existing.temp_c = temp
                existing.rh_percent = rh
                existing.co2_ppm = cell.co2
                existing.pm25 = cell.pm25
                existing.pm10 = cell.pm10
                existing.heat_index = heat
                existing.category_level = cat["level"] if cat else None
                existing.category_name = cat["name"] if cat else None
                existing.remarks = cell.remarks
                existing.status = status
                existing.logged_by = logged_by
                existing.updated_at = now
            session.commit()
        return self.get_weather_hourly(project, observed_on)

    def _day_max_from_rows(
        self,
        rows: list[WeatherHourlyReadingRow],
        day: date,
    ) -> dict:
        ok_rows = [r for r in rows if r.status == "ok"]
        expected = len(WEATHER_DAY_HOURS)
        if not ok_rows:
            return {
                "dateIso": day.isoformat(),
                "dayLabel": f"{_format_day_name(day)} {_format_short_day(day)}",
                "hoursLogged": 0,
                "hoursExpected": expected,
                "wind": 0,
                "temp": 0,
                "rh": 0,
                "co2": 0,
                "pm10": 0,
                "heatIndex": 0,
                "category": _heat_category(0),
            }
        wind = max((r.wind_ms or 0) for r in ok_rows)
        temp = max((r.temp_c or 0) for r in ok_rows)
        rh = max((r.rh_percent or 0) for r in ok_rows)
        co2 = max((r.co2_ppm or 0) for r in ok_rows)
        pm10 = max((r.pm10 or 0) for r in ok_rows)
        heat = max((r.heat_index or 0) for r in ok_rows)
        return {
            "dateIso": day.isoformat(),
            "dayLabel": f"{_format_day_name(day)} {_format_short_day(day)}",
            "hoursLogged": len(ok_rows),
            "hoursExpected": expected,
            "wind": round(wind, 1),
            "temp": round(temp, 1),
            "rh": rh,
            "co2": co2,
            "pm10": pm10,
            "heatIndex": round(heat, 1),
            "category": _heat_category(heat),
        }

    def build_weather_weekly_preview(
        self,
        project: str,
        week_start: date,
    ) -> dict:
        week_start, week_end = _sunday_week_bounds(week_start)
        stations = [s for s in WEATHER_STATIONS if s["project"] == project]
        if not stations:
            raise ValueError("Unknown project for weather weekly log.")
        year, week = week_from_date(week_end)
        seen: list[str] = []
        for s in WEATHER_STATIONS:
            if s["project"] not in seen:
                seen.append(s["project"])
        project_index = seen.index(project) if project in seen else 0

        with self._sessions() as session:
            rows = (
                session.query(WeatherHourlyReadingRow)
                .filter(
                    WeatherHourlyReadingRow.project == project,
                    WeatherHourlyReadingRow.observed_on >= week_start,
                    WeatherHourlyReadingRow.observed_on <= week_end,
                )
                .all()
            )
        by_station_day: dict[tuple[str, date], list[WeatherHourlyReadingRow]] = {}
        for row in rows:
            by_station_day.setdefault((row.station_id, row.observed_on), []).append(row)

        days_by_station = []
        hours_logged = 0
        hours_expected = 0
        max_temp = 0.0
        max_humidity = 0.0
        max_heat = 0.0
        highest = _heat_category(0)
        for table_index, station in enumerate(stations, start=1):
            days = []
            for i in range(7):
                day = week_start + timedelta(days=i)
                day_rows = by_station_day.get((station["id"], day), [])
                day_max = self._day_max_from_rows(day_rows, day)
                days.append(day_max)
                hours_logged += day_max["hoursLogged"]
                hours_expected += day_max["hoursExpected"]
                if day_max["hoursLogged"] <= 0:
                    continue
                max_temp = max(max_temp, float(day_max["temp"]))
                max_humidity = max(max_humidity, float(day_max["rh"]))
                if float(day_max["heatIndex"]) >= max_heat:
                    max_heat = float(day_max["heatIndex"])
                    highest = day_max["category"]
            days_by_station.append(
                {
                    "location": station["loc"],
                    "tableIndex": table_index,
                    "tableCount": len(stations),
                    "days": days,
                }
            )

        log_id = f"WWL-{week}-{_project_code(project, project_index)}"
        return {
            "id": log_id,
            "project": project,
            "week": week,
            "weekYear": year,
            "weekStartIso": week_start.isoformat(),
            "weekEndIso": week_end.isoformat(),
            "weekLabel": f"Week {week} · {_format_short_day(week_start)}",
            "location": stations[0]["loc"],
            "stationCount": len(stations),
            "hoursLogged": hours_logged,
            "hoursExpected": hours_expected,
            "maxTemp": round(max_temp, 1),
            "maxHumidity": max_humidity,
            "maxHeatIndex": round(max_heat, 1),
            "highestCategory": highest,
            "remarks": "",
            "submittedBy": "",
            "submittedAtLabel": "",
            "daysByStation": days_by_station,
            "submitted": False,
        }

    def list_weather_weekly_logs(self, projects: list[str] | None = None) -> list[dict]:
        with self._sessions() as session:
            query = session.query(WeatherWeeklyLogRow).order_by(
                WeatherWeeklyLogRow.week_start.desc(),
                WeatherWeeklyLogRow.project.asc(),
            )
            if projects:
                query = query.filter(WeatherWeeklyLogRow.project.in_(projects))
            rows = query.all()
            return [self._weekly_log_dict(row) for row in rows]

    def get_weather_weekly_log(self, log_id: str) -> dict | None:
        with self._sessions() as session:
            row = session.get(WeatherWeeklyLogRow, log_id)
            return self._weekly_log_dict(row) if row else None

    def submit_weather_weekly(self, payload) -> dict:
        preview = self.build_weather_weekly_preview(payload.project, payload.week_start)
        now = datetime.now(timezone.utc)
        remarks = (payload.remarks or "").strip()
        submitted_by = (payload.submitted_by or "").strip()
        if not submitted_by:
            raise ValueError("Submitted by is required.")
        with self._lock, self._sessions() as session:
            existing = session.get(WeatherWeeklyLogRow, preview["id"])
            if existing is None:
                existing = WeatherWeeklyLogRow(id=preview["id"])
                session.add(existing)
            existing.project = preview["project"]
            existing.week_year = preview["weekYear"]
            existing.week_number = preview["week"]
            existing.week_start = date.fromisoformat(preview["weekStartIso"])
            existing.week_end = date.fromisoformat(preview["weekEndIso"])
            existing.location = preview["location"]
            existing.station_count = preview["stationCount"]
            existing.hours_logged = preview["hoursLogged"]
            existing.hours_expected = preview["hoursExpected"]
            existing.max_temp = preview["maxTemp"]
            existing.max_humidity = preview["maxHumidity"]
            existing.max_heat_index = preview["maxHeatIndex"]
            existing.highest_category = preview["highestCategory"]
            existing.remarks = remarks
            existing.submitted_by = submitted_by
            existing.submitted_at = now
            existing.days_by_station = preview["daysByStation"]
            session.commit()
            session.refresh(existing)
            return self._weekly_log_dict(existing)

    def _weekly_log_dict(self, row: WeatherWeeklyLogRow) -> dict:
        return {
            "id": row.id,
            "project": row.project,
            "week": row.week_number,
            "weekYear": row.week_year,
            "weekStartIso": row.week_start.isoformat(),
            "weekEndIso": row.week_end.isoformat(),
            "weekLabel": f"Week {row.week_number} · {_format_short_day(row.week_start)}",
            "location": row.location,
            "stationCount": row.station_count,
            "hoursLogged": row.hours_logged,
            "hoursExpected": row.hours_expected,
            "maxTemp": row.max_temp,
            "maxHumidity": row.max_humidity,
            "maxHeatIndex": row.max_heat_index,
            "highestCategory": row.highest_category or _heat_category(0),
            "remarks": row.remarks or "",
            "submittedBy": row.submitted_by,
            "submittedAtLabel": _format_submitted_at(row.submitted_at),
            "daysByStation": row.days_by_station or [],
            "submitted": True,
        }

    def list_contacts(self, project_id: str | None = None) -> list[dict]:
        with self._sessions() as session:
            query = session.query(ContactRow)
            if project_id:
                query = query.filter(ContactRow.project_id == project_id)
            return [_contact_dict(row) for row in query.all()]

    def add_contact(self, payload) -> dict:
        if payload.category not in CONTACT_CATEGORIES:
            raise ValueError("Unknown contact category.")
        project = self.catalog.label("project", payload.project_id)
        if not project:
            raise ValueError("Unknown project.")
        item = {
            "id": str(uuid4()),
            "project_id": payload.project_id,
            "project": project,
            "category": payload.category,
            "name": payload.name,
            "job_title": payload.job_title,
            "role": payload.role,
            "contact_number": payload.contact_number,
            "email": payload.email,
        }
        with self._lock, self._sessions() as session:
            session.add(
                ContactRow(
                    id=item["id"],
                    project_id=item["project_id"],
                    project=item["project"],
                    category=item["category"],
                    name=item["name"],
                    job_title=item["job_title"],
                    role=item["role"],
                    contact_number=item["contact_number"],
                    email=item["email"],
                )
            )
            session.commit()
        return item

    def update_contact(self, contact_id: str, payload) -> dict | None:
        if payload.category not in CONTACT_CATEGORIES:
            raise ValueError("Unknown contact category.")
        with self._lock, self._sessions() as session:
            row = session.get(ContactRow, contact_id)
            if not row:
                return None
            row.category = payload.category
            row.name = payload.name.strip()
            row.job_title = (payload.job_title or "").strip() or None
            row.role = (payload.role or "").strip() or None
            row.contact_number = (payload.contact_number or "").strip() or None
            row.email = (payload.email or "").strip() or None
            session.commit()
            session.refresh(row)
            return _contact_dict(row)

    def delete_contact(self, contact_id: str) -> dict | None:
        with self._lock, self._sessions() as session:
            row = session.get(ContactRow, contact_id)
            if not row:
                return None
            item = _contact_dict(row)
            session.delete(row)
            session.commit()
            return item

    def _hw_state(self) -> dict:
        with self._sessions() as session:
            row = session.get(AppStateRow, "hw")
            if row:
                return dict(row.value)
        return {
            "project": self._empty_hw_project(),
            "department": self._empty_hw_dept(),
            "updated_at": None,
        }

    def _align_hw(self, state: dict) -> dict:
        project = self._empty_hw_project()
        dept = self._empty_hw_dept()
        saved_project = state.get("project") or {}
        saved_dept = state.get("department") or {}
        for site, counts in project.items():
            previous = dict(saved_project.get(site) or {})
            # Legacy combined bucket → helmet unless watch-only deploy site handled in migrate.
            if "SOS Devices" in previous and "Smart Helmet" not in previous:
                previous["Smart Helmet"] = int(previous.get("Smart Helmet", 0) or 0) + int(
                    previous.get("SOS Devices", 0) or 0
                )
            for dtype in counts:
                counts[dtype] = int(previous.get(dtype, 0) or 0)
        for name, counts in dept.items():
            previous = saved_dept.get(name) or {}
            for key in counts:
                counts[key] = int(previous.get(key, 0) or 0)
        return {
            "project": project,
            "department": dept,
            "updated_at": state.get("updated_at"),
        }

    def get_hw(self) -> dict:
        state = self._align_hw(self._hw_state())
        project = {site: dict(counts) for site, counts in state["project"].items()}
        dept = {name: dict(counts) for name, counts in state["department"].items()}
        updated = state.get("updated_at")
        totals = {}
        grand = 0
        for site, counts in project.items():
            totals[site] = sum(counts.values())
            grand += totals[site]
        return {
            "prototype": True,
            "last_updated_at": updated,
            "project_counts": project,
            "project_totals": totals,
            "all_projects": grand,
            "department_counts": dept,
        }

    def save_hw(self, payload) -> dict:
        with self._lock, self._sessions() as session:
            row = session.get(AppStateRow, "hw")
            raw = dict(row.value) if row else {
                "project": {},
                "department": {},
                "updated_at": None,
            }
            state = self._align_hw(raw)
            project = {site: dict(counts) for site, counts in state["project"].items()}
            dept = {name: dict(counts) for name, counts in state["department"].items()}
            for site, counts in payload.project_counts.items():
                if site in project:
                    project[site].update(counts)
            for name, counts in payload.department_counts.items():
                if name in dept:
                    dept[name].update(counts)
            value = {
                "project": project,
                "department": dept,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
            if row:
                row.value = value
            else:
                session.add(AppStateRow(key="hw", value=value))
            session.commit()
        return self.get_hw()

    def hw_register_template_path(self) -> Path:
        path = (
            Path(__file__).resolve().parents[2]
            / "data"
            / "SCC_HW_Device_Register_Template.xlsx"
        )
        if not path.is_file():
            raise FileNotFoundError("HW device register template is missing.")
        return path

    def get_hw_register(self) -> dict:
        with self._sessions() as session:
            row = session.get(AppStateRow, "hw_register")
            items = []
            if row and isinstance(row.value, dict):
                raw_items = row.value.get("items")
                if isinstance(raw_items, list):
                    items = [item for item in raw_items if isinstance(item, dict)]
            return {"items": items, "total": len(items)}

    def _save_hw_register_items(self, items: list[dict]) -> None:
        value = {
            "items": items,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        with self._lock, self._sessions() as session:
            row = session.get(AppStateRow, "hw_register")
            if row:
                row.value = value
            else:
                session.add(AppStateRow(key="hw_register", value=value))
            session.commit()

    def _hw_device_aliases(self) -> dict[str, str]:
        aliases = {
            "ai cameras": "AI Camera",
            "ai camera": "AI Camera",
            "edge servers": "Edge Server",
            "edge server": "Edge Server",
            "routers": "Router",
            "router": "Router",
            "nvrs": "NVR",
            "nvr": "NVR",
            "smart helmets": "Smart Helmet",
            "smart helmet": "Smart Helmet",
            "smart watches": "Smart Watch",
            "smart watch": "Smart Watch",
            "weather stations": "Weather Station",
            "weather station": "Weather Station",
            "avl": "GPS",
            "gps": "GPS",
            "dashcams": "Dashcam",
            "dashcam": "Dashcam",
            "weight sensors": "Weight Sensor",
            "weight sensor": "Weight Sensor",
            "pwas": "PWAS",
            "sos devices": "Smart Helmet",
        }
        for item in self.catalog.get("scc_device_type"):
            label = str(item.get("label") or "").strip()
            if label:
                aliases[label.lower()] = label
        return aliases

    def _hw_status_aliases(self) -> dict[str, str]:
        allowed = {
            "Installed",
            "Assigned",
            "In Stock",
            "Under Maintenance",
            "Damaged",
            "Lost",
        }
        aliases = {name.lower(): name for name in allowed}
        aliases.update(
            {
                "in-stock": "In Stock",
                "stock": "In Stock",
                "maintenance": "Under Maintenance",
                "under maintainance": "Under Maintenance",
            }
        )
        return aliases

    def _adjust_hw_project_count(
        self,
        project_counts: dict[str, dict[str, int]],
        site: str,
        device: str,
        delta: int,
    ) -> None:
        if site not in project_counts or device not in project_counts[site]:
            return
        project_counts[site][device] = max(
            0, int(project_counts[site].get(device) or 0) + delta
        )

    def import_hw_register_excel(self, content: bytes) -> dict:
        """Parse Device Register Excel and merge into HW register + dashboard counts."""
        try:
            from openpyxl import load_workbook
        except ImportError as exc:  # pragma: no cover
            raise RuntimeError(
                "openpyxl is required to import the HW device register."
            ) from exc
        from io import BytesIO

        wb = load_workbook(BytesIO(content), data_only=True)
        ws = wb[wb.sheetnames[0]]
        headers: dict[str, int] = {}
        for col in range(1, (ws.max_column or 0) + 1):
            raw = ws.cell(1, col).value
            if raw is None:
                continue
            key = str(raw).strip().lower().replace("_", " ")
            headers[key] = col
        device_col = headers.get("device")
        serial_col = headers.get("serial number") or headers.get("serial")
        status_col = headers.get("status")
        project_col = headers.get("project") or headers.get("project / location")
        if not all([device_col, serial_col, status_col, project_col]):
            raise ValueError(
                "Template must include Device, Serial Number, Status, and Project columns."
            )

        device_aliases = self._hw_device_aliases()
        status_aliases = self._hw_status_aliases()
        valid_sites = {
            str(item.get("label") or "").strip()
            for item in self.catalog.get("hw_site")
        }
        system_by_device = {
            "AI Camera": "4S",
            "Edge Server": "4S",
            "Router": "4S",
            "NVR": "4S",
            "Smart Helmet": "4S",
            "Smart Watch": "4S",
            "Weather Station": "4S",
            "GPS": "FMS",
            "Dashcam": "FMS",
            "Weight Sensor": "FMS",
            "PWAS": "PWAS",
        }

        parsed: list[dict] = []
        errors: list[str] = []
        seen_serials: set[str] = set()
        for row_idx in range(2, (ws.max_row or 1) + 1):
            device_raw = ws.cell(row_idx, device_col).value
            serial_raw = ws.cell(row_idx, serial_col).value
            status_raw = ws.cell(row_idx, status_col).value
            project_raw = ws.cell(row_idx, project_col).value
            if all(v is None or str(v).strip() == "" for v in (device_raw, serial_raw, status_raw, project_raw)):
                continue
            # Skip instruction rows under the sample data.
            device_text = str(device_raw or "").strip()
            if device_text.lower().startswith("device:") or device_text.lower().startswith("status:"):
                continue
            serial = str(serial_raw or "").strip()
            if not serial:
                errors.append(f"Row {row_idx}: serial number is required.")
                continue
            if serial.lower() in seen_serials:
                errors.append(f"Row {row_idx}: duplicate serial “{serial}” in file.")
                continue
            seen_serials.add(serial.lower())
            device = device_aliases.get(device_text.lower())
            if not device:
                errors.append(f"Row {row_idx}: unknown device “{device_text}”.")
                continue
            status = status_aliases.get(str(status_raw or "").strip().lower())
            if not status:
                errors.append(f"Row {row_idx}: unknown status “{status_raw}”.")
                continue
            project = str(project_raw or "").strip()
            if project not in valid_sites:
                errors.append(f"Row {row_idx}: unknown project “{project}”.")
                continue
            parsed.append(
                {
                    "id": f"DEV-{serial}",
                    "device": device,
                    "system": system_by_device.get(device, "4S"),
                    "serial": serial,
                    "status": status,
                    "project": project,
                    "lastSignal": None,
                    "updatedIso": datetime.now(timezone.utc).isoformat(),
                }
            )

        if errors and not parsed:
            raise ValueError("; ".join(errors[:5]))

        existing = self.get_hw_register()["items"]
        by_serial = {
            str(item.get("serial") or "").strip().lower(): dict(item)
            for item in existing
            if str(item.get("serial") or "").strip()
        }
        state = self._align_hw(self._hw_state())
        project_counts = {
            site: dict(counts) for site, counts in state["project"].items()
        }
        added = 0
        updated = 0
        for item in parsed:
            key = item["serial"].lower()
            prev = by_serial.get(key)
            if prev is None:
                self._adjust_hw_project_count(
                    project_counts, item["project"], item["device"], 1
                )
                by_serial[key] = item
                added += 1
                continue
            old_project = str(prev.get("project") or "")
            old_device = str(prev.get("device") or "")
            if old_project != item["project"] or old_device != item["device"]:
                self._adjust_hw_project_count(
                    project_counts, old_project, old_device, -1
                )
                self._adjust_hw_project_count(
                    project_counts, item["project"], item["device"], 1
                )
            merged = {**prev, **item, "id": prev.get("id") or item["id"]}
            by_serial[key] = merged
            updated += 1

        items = list(by_serial.values())
        items.sort(key=lambda row: str(row.get("serial") or ""))
        self._save_hw_register_items(items)

        with self._lock, self._sessions() as session:
            row = session.get(AppStateRow, "hw")
            value = {
                "project": project_counts,
                "department": {
                    name: dict(counts) for name, counts in state["department"].items()
                },
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
            if row:
                row.value = value
            else:
                session.add(AppStateRow(key="hw", value=value))
            session.commit()

        return {
            "imported": len(parsed),
            "added": added,
            "updated": updated,
            "skipped_errors": errors[:20],
            "items": items,
            "hw": self.get_hw(),
        }

    def reports(self, user: dict | None = None) -> dict:
        # Daily reports are all-project scope — always return full case details.
        # Weekly/monthly packets are filtered to the caller's assigned projects.
        rows = self.list_cases()
        catalog_projects = [item["label"] for item in self.catalog.get("project")]
        allowed = user.get("projects") if user else None
        allowed_set = {str(item) for item in allowed} if allowed else None
        by_project = []
        for name in catalog_projects:
            subset = [row for row in rows if row["project"] == name]
            by_project.append(
                {
                    "project": name,
                    "ai_camera": sum(1 for row in subset if row["record_type"] == "ai_camera"),
                    "dashcam": sum(1 for row in subset if row["record_type"] == "dashcam"),
                    "speed": sum(1 for row in subset if row["record_type"] == "speed"),
                    "sos": sum(1 for row in subset if row["record_type"] == "sos"),
                    "open": sum(1 for row in subset if row["status"] == "open"),
                    "under_process": sum(1 for row in subset if row["status"] == "under_process"),
                    "closed": sum(1 for row in subset if row["status"] == "closed"),
                    "total": len(subset),
                }
            )
        departments = []
        for item in self.catalog.get("department"):
            subset = [row for row in rows if row["department"] == item["label"]]
            departments.append(
                {
                    "department": item["label"],
                    "dashcam": sum(1 for row in subset if row["record_type"] == "dashcam"),
                    "speed": sum(1 for row in subset if row["record_type"] == "speed"),
                    "total": len(subset),
                }
            )
        packets = self._report_packets()
        if allowed_set:
            packets = [
                packet
                for packet in packets
                if packet.get("kind") not in {"weekly", "monthly"}
                or (packet.get("scope") or "") in allowed_set
            ]
        return {
            "prototype": True,
            "by_project": by_project,
            "by_department": departments,
            "details": rows,
            "packets": packets,
            "settings": self.get_platform_settings(),
        }

    def _default_platform_settings(self) -> dict:
        return {
            "sla": {
                "High": {"hours": 24, "label": "24 h"},
                "Medium": {"hours": 72, "label": "3 days"},
                "Low": {"hours": 168, "label": "7 days"},
                "dueSoon": 0.75,
                "escalate": 2,
            },
            "safelifeDefault": True,
            "itqanDefault": True,
            "safelifeAsk": True,
            "itqanAsk": True,
            "notifyOperator": True,
            "notifyAdmin": True,
            "notifyHSE": True,
            "dailyAt": "23:59",
            "weeklyDay": "Saturday",
            "monthlyDay": 1,
        }

    def _ensure_sla_deadlines(self) -> None:
        """Fill missing SLA keys only — never overwrite admin-configured hours."""
        current = self.get_platform_settings()
        sla = dict(current.get("sla") or {})
        defaults = self._default_platform_settings()["sla"]
        changed = False
        for key in ("High", "Medium", "Low"):
            default = defaults[key]
            entry = dict(sla.get(key) or {})
            if entry.get("hours") is None:
                entry["hours"] = default["hours"]
                entry["label"] = default.get("label") or f"{default['hours']} hours"
                changed = True
            elif not entry.get("label"):
                hours = int(entry["hours"])
                if hours == default["hours"]:
                    entry["label"] = default.get("label") or f"{hours} hours"
                elif hours % 24 == 0:
                    days = hours // 24
                    entry["label"] = f"{days} day{'s' if days != 1 else ''}"
                else:
                    entry["label"] = f"{hours} hours"
                changed = True
            sla[key] = entry
        if sla.get("dueSoon") is None:
            sla["dueSoon"] = defaults.get("dueSoon", 0.75)
            changed = True
        if sla.get("escalate") is None:
            sla["escalate"] = defaults.get("escalate", 2)
            changed = True
        if changed:
            self.save_platform_settings({"sla": sla})

    def _seed_sla_demo_cases(self) -> None:
        """Backdated open AI Camera rows so Overdue / Due soon / Escalated can be verified."""
        with self._sessions() as session:
            if session.get(AppStateRow, "sla_demo_seeded_v2") is not None:
                return
        projects = [item["label"] for item in self.catalog.get("project") if item.get("is_active")]
        if not projects:
            projects = ["Jafurah", "MGS", "Yanbu"]
        now = datetime.now(timezone.utc)
        demos = [
            # High 24h · overdue (~6h past deadline)
            {
                "title": "[SLA TEST] High overdue — needs close-out",
                "risk": "High Risk",
                "age_h": 30,
                "project": projects[0],
                "location": "Pad A — SLA overdue",
                "status": "open",
            },
            # High 24h · escalated (2× = 48h)
            {
                "title": "[SLA TEST] High escalated to Dept HSE",
                "risk": "High Risk",
                "age_h": 55,
                "project": projects[0],
                "location": "Pad B — SLA escalated",
                "status": "open",
            },
            # Medium 72h · overdue
            {
                "title": "[SLA TEST] Medium overdue",
                "risk": "Medium Risk",
                "age_h": 80,
                "project": projects[1 % len(projects)],
                "location": "Yard — SLA overdue",
                "status": "under_process",
            },
            # Medium 72h · escalated (2× = 144h)
            {
                "title": "[SLA TEST] Medium escalated",
                "risk": "Medium Risk",
                "age_h": 150,
                "project": projects[1 % len(projects)],
                "location": "Gate 2 — SLA escalated",
                "status": "open",
            },
            # Low 168h · due soon (after 75% = 126h)
            {
                "title": "[SLA TEST] Low due soon reminder",
                "risk": "Low Risk",
                "age_h": 140,
                "project": projects[2 % len(projects)],
                "location": "Workshop — due soon",
                "status": "open",
            },
            # Low 168h · overdue
            {
                "title": "[SLA TEST] Low overdue",
                "risk": "Low Risk",
                "age_h": 180,
                "project": projects[2 % len(projects)],
                "location": "Laydown — SLA overdue",
                "status": "open",
            },
        ]
        for demo in demos:
            created = now - timedelta(hours=float(demo["age_h"]))
            occurred = created.date()
            year, week = week_from_date(occurred)
            self._insert_case(
                {
                    "id": str(uuid4()),
                    "case_id": self.next_case_id(),
                    "record_type": "ai_camera",
                    "status": demo["status"],
                    "project": demo["project"],
                    "department": None,
                    "title": demo["title"][:80],
                    "date": occurred.isoformat(),
                    "week_year": year,
                    "week_number": week,
                    "risk_level": demo["risk"],
                    "created_at": created,
                    "fields": {
                        "location": demo["location"],
                        "occurred_time": created.strftime("%H:%M"),
                        "alert_summary": demo["title"],
                        "alert_type": "Unsafe Act",
                        "category": "General Safety & Health Provisions",
                        "detection_method": "AI",
                        "reported_by": "Operator",
                        "observation_picture": None,
                        "camera_id": "CAM-SLA-01",
                        "safelife_update": False,
                        "safelife_ref": None,
                        "sla_demo": True,
                    },
                }
            )
        with self._lock, self._sessions() as session:
            session.add(AppStateRow(key="sla_demo_seeded_v2", value=True))
            session.commit()

    def _seed_dashcam_demo_cases(self) -> None:
        """Populate dashcam log + charts, including SLA overdue / due soon rows."""
        with self._sessions() as session:
            if session.get(AppStateRow, "dashcam_demo_seeded_v2") is not None:
                return
            # Replace noisy v1 demos (old open rows flooded overdue notifications).
            demo_rows = (
                session.query(CaseRow)
                .filter(CaseRow.record_type == "dashcam")
                .all()
            )
            for row in demo_rows:
                fields = row.fields or {}
                if fields.get("dashcam_demo"):
                    session.delete(row)
            old = session.get(AppStateRow, "dashcam_demo_seeded_v1")
            if old:
                session.delete(old)
            session.commit()
        projects = [item["label"] for item in self.catalog.get("project") if item.get("is_active")]
        departments = [
            item["label"] for item in self.catalog.get("department") if item.get("is_active")
        ]
        if not projects:
            projects = ["Jafurah", "MGS", "Yanbu", "Ras Tanura"]
        if not departments:
            departments = ["Transportation", "Workshop", "Logistics"]
        violations = [
            item["label"]
            for item in self.catalog.get("dashcam_observation_type")
            if item.get("is_active")
        ] or ["Camera Covered", "Tampering", "Smoking", "Using Phone", "Seat Belt"]
        vehicles = [
            item["label"] for item in self.catalog.get("vehicle_type") if item.get("is_active")
        ] or ["Light Vehicle", "Heavy Vehicle"]
        models = [
            item["label"] for item in self.catalog.get("model") if item.get("is_active")
        ] or ["Bus", "Pickup", "Car", "Van", "Truck"]
        risks = ["High Risk", "Medium Risk", "Low Risk"]
        now = datetime.now(timezone.utc)

        # Chart fillers: older opens get ITQAN so they don't spam SLA notifications.
        # Pending close-out = recent opens + dedicated SLA rows (age_h set).
        demos: list[dict] = [
            {"days": 1, "hh": 9, "status": "open", "risk": "High Risk", "viol": 3, "veh": 0, "model": 2, "assign": "project", "summary": "Phone use at junction", "driver": "Khalid M", "badge": "D210"},
            {"days": 2, "hh": 14, "status": "open", "risk": "Medium Risk", "viol": 4, "veh": 1, "model": 4, "assign": "project", "summary": "Seat belt not fastened — haul road", "driver": "Fahad S", "badge": "D211"},
            {"days": 3, "hh": 11, "status": "open", "risk": "Low Risk", "viol": 2, "veh": 0, "model": 1, "assign": "department", "summary": "Smoking inside cabin", "driver": "Nasser A", "badge": "D212"},
            {"days": 5, "hh": 10, "status": "under_process", "risk": "Medium Risk", "viol": 0, "veh": 1, "model": 0, "assign": "project", "summary": "Camera covered — under review", "driver": "Salem R", "badge": "D213", "itqan": True},
            {"days": 7, "hh": 16, "status": "closed", "risk": "High Risk", "viol": 1, "veh": 0, "model": 3, "assign": "project", "summary": "Tampering — camera replaced", "driver": "Yousef H", "badge": "D214", "itqan": True},
            {"days": 9, "hh": 11, "status": "closed", "risk": "Low Risk", "viol": 4, "veh": 0, "model": 2, "assign": "department", "summary": "Seat belt reminder closed", "driver": "Majed B", "badge": "D215", "itqan": True},
            {"days": 12, "hh": 13, "status": "under_process", "risk": "Medium Risk", "viol": 3, "veh": 1, "model": 4, "assign": "project", "summary": "Using phone while reversing", "driver": "Ibrahim T", "badge": "D216", "itqan": True},
            {"days": 14, "hh": 7, "status": "closed", "risk": "High Risk", "viol": 0, "veh": 1, "model": 4, "assign": "project", "summary": "Lens obstructed on truck", "driver": "Hassan Q", "badge": "D217", "itqan": True},
            {"days": 18, "hh": 15, "status": "closed", "risk": "Medium Risk", "viol": 2, "veh": 0, "model": 1, "assign": "department", "summary": "Smoking — coaching complete", "driver": "Omar Z", "badge": "D218", "itqan": True},
            {"days": 21, "hh": 12, "status": "under_process", "risk": "Low Risk", "viol": 4, "veh": 0, "model": 2, "assign": "project", "summary": "Seat belt lag after start", "driver": "Rami K", "badge": "D219", "itqan": True},
            {"days": 25, "hh": 10, "status": "closed", "risk": "High Risk", "viol": 1, "veh": 1, "model": 0, "assign": "project", "summary": "Cable check complete", "driver": "Badr N", "badge": "D220", "itqan": True},
            {"days": 28, "hh": 8, "status": "closed", "risk": "Medium Risk", "viol": 3, "veh": 0, "model": 3, "assign": "department", "summary": "Phone use — workshop run", "driver": "Tariq L", "badge": "D221", "itqan": True},
            {"days": 35, "hh": 17, "status": "closed", "risk": "Low Risk", "viol": 2, "veh": 1, "model": 4, "assign": "project", "summary": "Smoking near fuel bay", "driver": "Waleed F", "badge": "D222", "itqan": True},
            {"days": 42, "hh": 9, "status": "closed", "risk": "Medium Risk", "viol": 0, "veh": 0, "model": 1, "assign": "project", "summary": "Camera cover cleared", "driver": "Sami J", "badge": "D223", "itqan": True},
            {"days": 50, "hh": 14, "status": "closed", "risk": "High Risk", "viol": 1, "veh": 1, "model": 4, "assign": "department", "summary": "Dashcam reconnect closed", "driver": "Adel P", "badge": "D224", "itqan": True},
            {"days": 58, "hh": 11, "status": "closed", "risk": "Low Risk", "viol": 4, "veh": 0, "model": 2, "assign": "project", "summary": "Seat belt — archived", "driver": "Hani C", "badge": "D225", "itqan": True},
            {"days": 68, "hh": 16, "status": "closed", "risk": "Medium Risk", "viol": 3, "veh": 0, "model": 0, "assign": "project", "summary": "Phone use — older week", "driver": "Ziad E", "badge": "D226", "itqan": True},
            {"days": 80, "hh": 8, "status": "closed", "risk": "High Risk", "viol": 0, "veh": 1, "model": 4, "assign": "department", "summary": "Camera covered — Q3 close", "driver": "Faisal G", "badge": "D227", "itqan": True},
            # SLA demos (open, no ITQAN) — High 24h / Medium 72h / Low 168h
            {"days": 0, "hh": 6, "status": "open", "risk": "High Risk", "viol": 3, "veh": 0, "model": 2, "assign": "project", "summary": "[SLA] Dashcam High overdue", "driver": "SLA High", "badge": "SLA-H", "age_h": 30, "loc": "Gate 1 — SLA overdue"},
            {"days": 0, "hh": 6, "status": "open", "risk": "High Risk", "viol": 1, "veh": 1, "model": 4, "assign": "project", "summary": "[SLA] Dashcam High escalated", "driver": "SLA Esc", "badge": "SLA-E", "age_h": 55, "loc": "Pad C — SLA escalated"},
            {"days": 0, "hh": 6, "status": "open", "risk": "Medium Risk", "viol": 4, "veh": 0, "model": 1, "assign": "department", "summary": "[SLA] Dashcam Medium overdue", "driver": "SLA Med", "badge": "SLA-M", "age_h": 80, "loc": "Yard — SLA overdue"},
            {"days": 0, "hh": 6, "status": "open", "risk": "Low Risk", "viol": 2, "veh": 0, "model": 3, "assign": "project", "summary": "[SLA] Dashcam Low due soon", "driver": "SLA Soon", "badge": "SLA-S", "age_h": 140, "loc": "Workshop — due soon"},
            {"days": 0, "hh": 6, "status": "open", "risk": "Low Risk", "viol": 0, "veh": 1, "model": 0, "assign": "project", "summary": "[SLA] Dashcam Low overdue", "driver": "SLA Low", "badge": "SLA-L", "age_h": 180, "loc": "Laydown — SLA overdue"},
        ]

        for index, demo in enumerate(demos):
            age_h = demo.get("age_h")
            if age_h is not None:
                created = now - timedelta(hours=float(age_h))
            else:
                created = now - timedelta(days=int(demo["days"]), hours=int(demo["hh"]))
            occurred = created.date()
            year, week = week_from_date(occurred)
            use_project = demo["assign"] == "project"
            project = projects[index % len(projects)] if use_project else None
            department = (
                None if use_project else departments[index % len(departments)]
            )
            viol = violations[int(demo["viol"]) % len(violations)]
            vehicle = vehicles[int(demo["veh"]) % len(vehicles)]
            model = models[int(demo["model"]) % len(models)]
            summary = str(demo["summary"])
            fields: dict = {
                "assign_to": demo["assign"],
                "vehicle_type": vehicle,
                "model": model,
                "asset_number": f"DC-{1800 + index:04d}",
                "driver_name": demo["driver"],
                "driver_badge_number": demo["badge"],
                "rental_driver": False,
                "iqama_number": None,
                "location_coordinates": demo.get("loc") or f"26.{index % 9}, 50.{index % 9}",
                "occurred_time": created.strftime("%H:%M"),
                "violation_type": viol,
                "alert_summary": summary,
                "reported_by": "Operator" if index % 2 == 0 else "Admin",
                "violation_picture": None,
                "upload_to_itqan": True,
                "itqan_skip_reason": None,
                "dashcam_demo": True,
            }
            if demo.get("itqan"):
                fields["itqan_upload_proof"] = f"demo-itqan-{index}.png"
                fields["uploaded_by"] = "Operator"
                fields["close_out_action"] = ITQAN_CLOSE_OUT
                fields["confirmed_at"] = (created + timedelta(hours=4)).isoformat()
                fields["close_out_submitted_by"] = "Operator"
            self._insert_case(
                {
                    "id": str(uuid4()),
                    "case_id": self.next_case_id(),
                    "record_type": "dashcam",
                    "status": demo["status"],
                    "project": project,
                    "department": department,
                    "title": summary[:80],
                    "date": occurred.isoformat(),
                    "week_year": year,
                    "week_number": week,
                    "risk_level": demo["risk"] if demo["risk"] in risks else "Medium Risk",
                    "created_at": created,
                    "fields": fields,
                }
            )
        with self._lock, self._sessions() as session:
            session.add(AppStateRow(key="dashcam_demo_seeded_v2", value=True))
            session.commit()

    def _seed_speed_demo_cases(self) -> None:
        """Populate speed log + charts, including SLA overdue / due soon rows."""
        with self._sessions() as session:
            if session.get(AppStateRow, "speed_demo_seeded_v2") is not None:
                return
            demo_rows = (
                session.query(CaseRow)
                .filter(CaseRow.record_type == "speed")
                .all()
            )
            for row in demo_rows:
                fields = row.fields or {}
                if fields.get("speed_demo"):
                    session.delete(row)
            old = session.get(AppStateRow, "speed_demo_seeded_v1")
            if old is not None:
                session.delete(old)
            session.commit()
        projects = [item["label"] for item in self.catalog.get("project") if item.get("is_active")]
        departments = [
            item["label"] for item in self.catalog.get("department") if item.get("is_active")
        ]
        if not projects:
            projects = ["Jafurah", "MGS", "Yanbu", "Ras Tanura"]
        if not departments:
            departments = ["Transportation", "Workshop", "Logistics"]
        kinds = [
            item["label"]
            for item in self.catalog.get("speed_violation_type")
            if item.get("is_active")
        ] or ["ROW", "Public Road"]
        vehicles = [
            item["label"] for item in self.catalog.get("vehicle_type") if item.get("is_active")
        ] or ["Light Vehicle", "Heavy Vehicle"]
        models = [
            item["label"] for item in self.catalog.get("model") if item.get("is_active")
        ] or ["Bus", "Pickup", "Car", "Van", "Truck"]
        positions = ["Driver", "Operator", "Supervisor", "Technician"]
        risks = ["High Risk", "Medium Risk", "Low Risk"]
        now = datetime.now(timezone.utc)

        # kind_i: 0 Public Road (120), 1 ROW (40) — prefer public first when available
        public_i = next((i for i, k in enumerate(kinds) if "public" in k.lower()), 0)
        row_i = next((i for i, k in enumerate(kinds) if "row" in k.lower()), len(kinds) - 1)

        demos: list[dict] = [
            # Chart / log fillers (older opens closed out so they don't spam SLA)
            {"days": 1, "hh": 8, "status": "open", "kind": public_i, "veh": 0, "model": 2, "perm": 120, "rec": 130, "assign": "project", "driver": "Khalid M", "badge": "SP210", "pos": 0},
            {"days": 2, "hh": 11, "status": "open", "kind": row_i, "veh": 1, "model": 4, "perm": 40, "rec": 52, "assign": "project", "driver": "Fahad S", "badge": "SP211", "pos": 1},
            {"days": 3, "hh": 15, "status": "open", "kind": public_i, "veh": 0, "model": 1, "perm": 120, "rec": 138, "assign": "department", "driver": "Nasser A", "badge": "SP212", "pos": 0},
            {"days": 5, "hh": 9, "status": "under_process", "kind": public_i, "veh": 1, "model": 4, "perm": 120, "rec": 145, "assign": "project", "driver": "Salem R", "badge": "SP213", "pos": 2, "itqan": True},
            {"days": 7, "hh": 14, "status": "closed", "kind": row_i, "veh": 0, "model": 2, "perm": 40, "rec": 48, "assign": "project", "driver": "Yousef H", "badge": "SP214", "pos": 0, "itqan": True},
            {"days": 9, "hh": 10, "status": "closed", "kind": public_i, "veh": 0, "model": 3, "perm": 120, "rec": 125, "assign": "department", "driver": "Majed B", "badge": "SP215", "pos": 3, "itqan": True},
            {"days": 12, "hh": 16, "status": "under_process", "kind": row_i, "veh": 1, "model": 0, "perm": 40, "rec": 58, "assign": "project", "driver": "Ibrahim T", "badge": "SP216", "pos": 1, "itqan": True},
            {"days": 14, "hh": 7, "status": "closed", "kind": public_i, "veh": 1, "model": 4, "perm": 120, "rec": 150, "assign": "project", "driver": "Hassan Q", "badge": "SP217", "pos": 2, "itqan": True},
            {"days": 18, "hh": 13, "status": "closed", "kind": public_i, "veh": 0, "model": 1, "perm": 120, "rec": 133, "assign": "department", "driver": "Omar Z", "badge": "SP218", "pos": 0, "itqan": True},
            {"days": 21, "hh": 12, "status": "under_process", "kind": row_i, "veh": 0, "model": 2, "perm": 40, "rec": 45, "assign": "project", "driver": "Rami K", "badge": "SP219", "pos": 0, "itqan": True},
            {"days": 25, "hh": 9, "status": "closed", "kind": public_i, "veh": 1, "model": 4, "perm": 120, "rec": 142, "assign": "project", "driver": "Badr N", "badge": "SP220", "pos": 1, "itqan": True},
            {"days": 28, "hh": 17, "status": "closed", "kind": row_i, "veh": 0, "model": 3, "perm": 40, "rec": 62, "assign": "department", "driver": "Tariq L", "badge": "SP221", "pos": 2, "itqan": True},
            {"days": 35, "hh": 11, "status": "closed", "kind": public_i, "veh": 0, "model": 2, "perm": 120, "rec": 128, "assign": "project", "driver": "Waleed F", "badge": "SP222", "pos": 0, "itqan": True},
            {"days": 42, "hh": 8, "status": "closed", "kind": public_i, "veh": 1, "model": 0, "perm": 120, "rec": 136, "assign": "project", "driver": "Sami J", "badge": "SP223", "pos": 3, "itqan": True},
            {"days": 50, "hh": 14, "status": "closed", "kind": row_i, "veh": 1, "model": 4, "perm": 40, "rec": 55, "assign": "department", "driver": "Adel P", "badge": "SP224", "pos": 1, "itqan": True},
            {"days": 58, "hh": 10, "status": "closed", "kind": public_i, "veh": 0, "model": 1, "perm": 120, "rec": 148, "assign": "project", "driver": "Hani C", "badge": "SP225", "pos": 0, "itqan": True},
            {"days": 68, "hh": 15, "status": "closed", "kind": row_i, "veh": 0, "model": 2, "perm": 40, "rec": 50, "assign": "project", "driver": "Ziad E", "badge": "SP226", "pos": 0, "itqan": True},
            {"days": 80, "hh": 9, "status": "closed", "kind": public_i, "veh": 1, "model": 4, "perm": 120, "rec": 155, "assign": "department", "driver": "Faisal G", "badge": "SP227", "pos": 2, "itqan": True},
            # SLA demos (open, no ITQAN) — High 24h / Medium 72h / Low 168h
            {"days": 0, "hh": 6, "status": "open", "kind": public_i, "veh": 0, "model": 2, "perm": 120, "rec": 145, "assign": "project", "driver": "SLA High", "badge": "SLA-SH", "pos": 0, "age_h": 30, "loc": "Highway 95 — SLA overdue"},
            {"days": 0, "hh": 6, "status": "open", "kind": row_i, "veh": 1, "model": 4, "perm": 40, "rec": 68, "assign": "project", "driver": "SLA Esc", "badge": "SLA-SE", "pos": 1, "age_h": 55, "loc": "ROW Zone B — SLA escalated"},
            {"days": 0, "hh": 6, "status": "open", "kind": public_i, "veh": 0, "model": 1, "perm": 120, "rec": 135, "assign": "department", "driver": "SLA Med", "badge": "SLA-SM", "pos": 0, "age_h": 80, "loc": "Access road — SLA overdue"},
            {"days": 0, "hh": 6, "status": "open", "kind": row_i, "veh": 0, "model": 2, "perm": 40, "rec": 48, "assign": "project", "driver": "SLA Soon", "badge": "SLA-SS", "pos": 0, "age_h": 140, "loc": "ROW Gate — due soon"},
            {"days": 0, "hh": 6, "status": "open", "kind": public_i, "veh": 1, "model": 4, "perm": 120, "rec": 128, "assign": "project", "driver": "SLA Low", "badge": "SLA-SL", "pos": 2, "age_h": 180, "loc": "Public road — SLA overdue"},
        ]

        for index, demo in enumerate(demos):
            age_h = demo.get("age_h")
            if age_h is not None:
                created = now - timedelta(hours=float(age_h))
            else:
                created = now - timedelta(days=int(demo["days"]), hours=int(demo["hh"]))
            occurred = created.date()
            year, week = week_from_date(occurred)
            use_project = demo["assign"] == "project"
            project = projects[index % len(projects)] if use_project else None
            department = (
                None if use_project else departments[index % len(departments)]
            )
            kind = kinds[int(demo["kind"]) % len(kinds)]
            vehicle = vehicles[int(demo["veh"]) % len(vehicles)]
            model = models[int(demo["model"]) % len(models)]
            position = positions[int(demo["pos"]) % len(positions)]
            permitted = float(demo["perm"])
            recorded = float(demo["rec"])
            exceedance = recorded - permitted
            risk = _speed_risk_from_exceedance(exceedance)
            summary = _speed_summary(kind, vehicle, permitted, recorded)
            if age_h is not None:
                tag = "escalated" if float(age_h) > 48 and risk == "High Risk" else (
                    "due soon" if risk == "Low Risk" and float(age_h) < 168 else "overdue"
                )
                title = f"[SLA] Speed {risk.replace(' Risk', '')} {tag}"
                summary = f"{title}. {summary}"
            else:
                title = summary
            fields: dict = {
                "assign_to": demo["assign"],
                "speed_violation_type": kind,
                "vehicle_type": vehicle,
                "model": model,
                "asset_number": f"SP-{1900 + index:04d}",
                "driver_name": demo["driver"],
                "driver_badge_number": demo["badge"],
                "position": position,
                "rental_driver": index % 7 == 0,
                "iqama_number": f"2{100000000 + index}" if index % 7 == 0 else None,
                "location_coordinates": demo.get("loc") or f"26.{index % 9}, 49.{index % 9}",
                "occurred_time": created.strftime("%H:%M"),
                "permitted_speed_kmh": permitted,
                "vehicle_speed_kmh": recorded,
                "exceedance_kmh": exceedance,
                "alert_summary": summary,
                "reported_by": "Operator" if index % 2 == 0 else "Admin",
                "fms_evidence": ensure_demo_image(f"demo-fms-{index}", hue=200 + index * 17),
                "speed_demo": True,
            }
            if demo.get("itqan"):
                fields["itqan_upload_proof"] = f"demo-speed-itqan-{index}.png"
                fields["uploaded_by"] = "Operator"
                fields["close_out_action"] = ITQAN_CLOSE_OUT
                fields["confirmed_at"] = (created + timedelta(hours=4)).isoformat()
                fields["close_out_submitted_by"] = "Operator"
            self._insert_case(
                {
                    "id": str(uuid4()),
                    "case_id": self.next_case_id(),
                    "record_type": "speed",
                    "status": demo["status"],
                    "project": project,
                    "department": department,
                    "title": title[:80],
                    "date": occurred.isoformat(),
                    "week_year": year,
                    "week_number": week,
                    "risk_level": risk if risk in risks else "Medium Risk",
                    "created_at": created,
                    "fields": fields,
                }
            )
        with self._lock, self._sessions() as session:
            session.add(AppStateRow(key="speed_demo_seeded_v2", value=True))
            session.commit()

    def _seed_sos_demo_cases(self) -> None:
        """Populate wearables SOS log + charts, including 2h SLA overdue rows."""
        with self._sessions() as session:
            if session.get(AppStateRow, "sos_demo_seeded_v2") is not None:
                return
            for row in session.query(CaseRow).filter(CaseRow.record_type == "sos").all():
                fields = row.fields or {}
                if fields.get("sos_demo"):
                    session.delete(row)
            old = session.get(AppStateRow, "sos_demo_seeded_v1")
            if old is not None:
                session.delete(old)
            session.commit()
        projects = [item["label"] for item in self.catalog.get("project") if item.get("is_active")]
        if not projects:
            projects = ["Jafurah", "MGS", "Yanbu", "Ras Tanura"]
        sources = [
            item["label"] for item in self.catalog.get("sos_source") if item.get("is_active")
        ] or ["Smart Helmet", "Smart Watch"]
        locations = [
            "TCF Riyas",
            "Riyas Laydown",
            "Jafurah South",
            "Pad 4",
            "Gate 1",
            "Workshop",
            "Laydown",
            "Yard",
        ]
        workers = [
            ("Arslan Ahmad / 4412", "Arslan Ahmad"),
            ("Khalid M / D210", "Khalid M"),
            ("Fahad S / D211", "Fahad S"),
            ("Nasser A / D212", "Nasser A"),
            ("Salem R / D213", "Salem R"),
            ("Yousef H / D214", "Yousef H"),
            ("Majed B / D215", "Majed B"),
            ("Ibrahim T / D216", "Ibrahim T"),
            ("Hassan Q / D217", "Hassan Q"),
            ("Omar Z / D218", "Omar Z"),
        ]
        now = datetime.now(timezone.utc)

        # SOS SLA = 2h from created_at. due soon >1.5h, overdue >2h, escalated >4h.
        demos: list[dict] = [
            {"days": 0, "hh": 1, "see_s": 45, "status": "open", "src": 0, "loc": 0, "worker": 0, "age_h": 3.0, "sla": "overdue"},
            {"days": 0, "hh": 2, "see_s": 90, "status": "open", "src": 1, "loc": 1, "worker": 1, "age_h": 5.0, "sla": "escalated"},
            {"days": 0, "hh": 3, "see_s": 25, "status": "open", "src": 0, "loc": 2, "worker": 2, "age_h": 1.7, "sla": "due soon"},
            {"days": 1, "hh": 9, "see_s": 40, "status": "closed", "src": 0, "loc": 0, "worker": 3, "alarm": "False Alarm"},
            {"days": 1, "hh": 14, "see_s": 120, "status": "closed", "src": 1, "loc": 3, "worker": 4, "alarm": "False Alarm"},
            {"days": 2, "hh": 10, "see_s": 55, "status": "closed", "src": 0, "loc": 1, "worker": 5, "alarm": "True Alarm"},
            {"days": 2, "hh": 16, "see_s": 200, "status": "closed", "src": 0, "loc": 4, "worker": 6, "alarm": "False Alarm"},
            {"days": 3, "hh": 8, "see_s": 30, "status": "closed", "src": 1, "loc": 5, "worker": 7, "alarm": "False Alarm"},
            {"days": 4, "hh": 11, "see_s": 75, "status": "closed", "src": 0, "loc": 0, "worker": 8, "alarm": "False Alarm"},
            {"days": 5, "hh": 13, "see_s": 18, "status": "closed", "src": 0, "loc": 2, "worker": 9, "alarm": "False Alarm"},
            {"days": 7, "hh": 9, "see_s": 95, "status": "closed", "src": 1, "loc": 6, "worker": 0, "alarm": "False Alarm"},
            {"days": 9, "hh": 15, "see_s": 140, "status": "closed", "src": 0, "loc": 1, "worker": 1, "alarm": "False Alarm"},
            {"days": 12, "hh": 10, "see_s": 50, "status": "closed", "src": 0, "loc": 7, "worker": 2, "alarm": "False Alarm"},
            {"days": 14, "hh": 7, "see_s": 220, "status": "closed", "src": 1, "loc": 0, "worker": 3, "alarm": "False Alarm"},
            {"days": 18, "hh": 12, "see_s": 35, "status": "closed", "src": 0, "loc": 3, "worker": 4, "alarm": "True Alarm"},
            {"days": 21, "hh": 14, "see_s": 60, "status": "closed", "src": 0, "loc": 1, "worker": 5, "alarm": "False Alarm"},
            {"days": 25, "hh": 9, "see_s": 80, "status": "closed", "src": 1, "loc": 4, "worker": 6, "alarm": "False Alarm"},
            {"days": 28, "hh": 16, "see_s": 42, "status": "closed", "src": 0, "loc": 0, "worker": 7, "alarm": "False Alarm"},
            {"days": 35, "hh": 11, "see_s": 110, "status": "closed", "src": 0, "loc": 2, "worker": 8, "alarm": "False Alarm"},
            {"days": 42, "hh": 8, "see_s": 28, "status": "closed", "src": 1, "loc": 5, "worker": 9, "alarm": "False Alarm"},
            {"days": 50, "hh": 13, "see_s": 70, "status": "closed", "src": 0, "loc": 1, "worker": 0, "alarm": "False Alarm"},
            {"days": 58, "hh": 10, "see_s": 155, "status": "closed", "src": 0, "loc": 6, "worker": 1, "alarm": "False Alarm"},
            {"days": 68, "hh": 15, "see_s": 48, "status": "closed", "src": 1, "loc": 0, "worker": 2, "alarm": "False Alarm"},
            {"days": 80, "hh": 9, "see_s": 33, "status": "closed", "src": 0, "loc": 3, "worker": 3, "alarm": "False Alarm"},
        ]

        for index, demo in enumerate(demos):
            age_h = demo.get("age_h")
            if age_h is not None:
                created = now - timedelta(hours=float(age_h))
            else:
                created = now - timedelta(days=int(demo["days"]), hours=int(demo["hh"]))
            see_s = int(demo["see_s"])
            seen_at = created + timedelta(seconds=see_s)
            occurred = created.date()
            year, week = week_from_date(occurred)
            project = projects[index % len(projects)]
            source = sources[int(demo["src"]) % len(sources)]
            location = locations[int(demo["loc"]) % len(locations)]
            worker_badge, worker_name = workers[int(demo["worker"]) % len(workers)]
            title = worker_badge
            if demo.get("sla"):
                title = f"[SLA] SOS {demo['sla']} — {worker_name}"
            fields: dict = {
                "worker_name_badge": worker_badge,
                "sos_created_at": created.isoformat(),
                "seen_at": seen_at.isoformat(),
                "time_to_see_seconds": see_s,
                "location": location,
                "source": source,
                "reported_by": "Operator" if index % 2 == 0 else "Admin",
                "sos_demo": True,
            }
            if demo["status"] == "closed":
                fields["alarm"] = demo.get("alarm") or "False Alarm"
                fields["worker_picture"] = ensure_demo_image(
                    f"demo-sos-worker-{index}", hue=160 + index * 23
                )
                fields["picture_shared_by"] = "Site HSE / 9001"
                fields["closed_at"] = (created + timedelta(hours=1)).isoformat()
                fields["close_out_report"] = "Demo close-out — worker accounted for."
                fields["close_out_submitted_by"] = "Operator"
            else:
                # Open SOS rows still get a small thumb in the log (like Dashcam).
                fields["worker_picture"] = ensure_demo_image(
                    f"demo-sos-open-{index}", hue=140 + index * 19
                )
            self._insert_case(
                {
                    "id": str(uuid4()),
                    "case_id": self.next_case_id(),
                    "record_type": "sos",
                    "status": demo["status"],
                    "project": project,
                    "department": None,
                    "title": title[:80],
                    "date": occurred.isoformat(),
                    "week_year": year,
                    "week_number": week,
                    "risk_level": None,
                    "created_at": created,
                    "fields": fields,
                }
            )
        with self._lock, self._sessions() as session:
            session.add(AppStateRow(key="sos_demo_seeded_v2", value=True))
            session.commit()

    def _seed_itqan_demo_cases(self) -> None:
        """ITQAN log: sync from confirmed Dashcam/Speed + weighted demo volume."""
        with self._sessions() as session:
            if session.get(AppStateRow, "itqan_demo_seeded_v2") is not None:
                return
            for row in session.query(CaseRow).filter(CaseRow.record_type == "itqan").all():
                session.delete(row)
            old = session.get(AppStateRow, "itqan_demo_seeded_v1")
            if old is not None:
                session.delete(old)
            # Clear source→ITQAN links so sync can recreate with resolvable thumbs.
            for row in session.query(CaseRow).filter(
                CaseRow.record_type.in_(("dashcam", "speed"))
            ).all():
                fields = dict(row.fields or {})
                if fields.pop("itqan_case_id", None) is not None or "itqan_ref" in fields:
                    fields.pop("itqan_ref", None)
                    row.fields = fields
                    flag_modified(row, "fields")
            session.commit()

        # Link existing confirmed dashcam/speed rows into ITQAN.
        with self._sessions() as session:
            sources = (
                session.query(CaseRow)
                .filter(
                    CaseRow.record_type.in_(("dashcam", "speed")),
                    CaseRow.is_deleted.is_(False),
                )
                .all()
            )
            source_dicts = [_case_dict(r) for r in sources]

        for src in source_dicts:
            fields = src.get("fields") or {}
            if not (fields.get("itqan_upload_proof") or fields.get("close_out_action")):
                continue
            if fields.get("itqan_case_id"):
                continue
            itq = self._create_itqan_from_source(src, actor=fields.get("uploaded_by"))
            if not itq:
                continue

            def link(record: dict, itq_id=itq["id"], ref=(itq.get("fields") or {}).get("itqan_ref")) -> None:
                record["fields"]["itqan_case_id"] = itq_id
                record["fields"]["itqan_ref"] = ref

            self._patch_case(src["id"], src["record_type"], link)

        projects = [item["label"] for item in self.catalog.get("project") if item.get("is_active")]
        departments = [
            item["label"] for item in self.catalog.get("department") if item.get("is_active")
        ]
        if not projects:
            projects = ["Jafurah", "MGS", "Yanbu", "Ras Tanura"]
        if not departments:
            departments = ["Logistics", "Transportation"]
        scopes = [(p, None) for p in projects] + [
            (None, d) for d in departments if d in {"Logistics", "Transportation", "Workshop"}
        ] or [(projects[0], None)]
        violations = [
            ("Speeding", "Speed Violation", 0.55),
            ("Using Mobile Phone", "Dashcam Observation", 0.14),
            ("Not Using Seat Belt", "Dashcam Observation", 0.10),
            ("Tampering with Device", "Dashcam Observation", 0.08),
            ("Negligence / Reckless Driving", "Manual entry", 0.07),
            ("Distracted Driving", "Dashcam Observation", 0.06),
        ]
        statuses = [
            ("Under Safety", 0.31),
            ("Under HR Action", 0.19),
            ("Under Payroll", 0.08),
            ("Under Announcement", 0.01),
            ("Closed", 0.41),
        ]
        drivers = [
            ("Rajendrakumar Makwana", "81665"),
            ("Fahad S", "D211"),
            ("Nasser A", "D212"),
            ("Salem R", "D213"),
            ("Yousef H", "D214"),
            ("Majed B", "D215"),
            ("Ibrahim T", "D216"),
            ("Hassan Q", "D217"),
            ("Omar Z", "D218"),
            ("Rami K", "D219"),
        ]
        now = datetime.now(AST)
        demo_n = 72
        for index in range(demo_n):
            # Weighted pick without random module dependency beyond index hash.
            h = (index * 37 + 11) % 1000
            v_acc = 0.0
            violation, source, _ = violations[0]
            for label, src, w in violations:
                v_acc += w * 1000
                if h < v_acc:
                    violation, source = label, src
                    break
            h2 = (index * 53 + 7) % 1000
            s_acc = 0.0
            itqan_status = statuses[0][0]
            for label, w in statuses:
                s_acc += w * 1000
                if h2 < s_acc:
                    itqan_status = label
                    break
            if index > 45 and itqan_status != "Closed" and index % 3 == 0:
                itqan_status = "Closed"
            project, department = scopes[index % len(scopes)]
            driver, badge = drivers[index % len(drivers)]
            vehicle = "Heavy Vehicle" if index % 2 == 0 else "Light Vehicle"
            days = (index * 2) % 90
            hh = 7 + (index * 3) % 12
            mm = (index * 7) % 60
            occurred = (now - timedelta(days=days)).date()
            created = datetime.combine(occurred, time(hh, mm), tzinfo=AST).astimezone(
                timezone.utc
            )
            year, week = week_from_date(occurred)
            proof = ensure_demo_image(f"demo-itqan-{index}", hue=10 + index * 13)
            self._insert_case(
                {
                    "id": str(uuid4()),
                    "case_id": self.next_itqan_case_id(),
                    "record_type": "itqan",
                    "status": self._case_status_for_itqan(itqan_status),
                    "project": project,
                    "department": department,
                    "title": violation[:80],
                    "date": occurred.isoformat(),
                    "week_year": year,
                    "week_number": week,
                    "risk_level": None,
                    "created_at": created,
                    "fields": {
                        "assign_to": "project" if project else "department",
                        "itqan_ref": self.next_itqan_ref(),
                        "itqan_status": itqan_status,
                        "violation_type": violation,
                        "vehicle_type": vehicle,
                        "driver_name": driver,
                        "driver_badge_number": badge,
                        "occurred_time": f"{hh:02d}:{mm:02d}",
                        "source": source,
                        "source_case_id": None,
                        "source_record_type": None,
                        "source_case_label": None,
                        "itqan_upload_proof": proof,
                        "reported_by": "Operator" if index % 2 == 0 else "Admin",
                        "registered_at": created.isoformat(),
                        "itqan_demo": True,
                    },
                }
            )
        with self._lock, self._sessions() as session:
            session.add(AppStateRow(key="itqan_demo_seeded_v2", value=True))
            session.commit()

    def get_platform_settings(self) -> dict:
        with self._sessions() as session:
            row = session.get(AppStateRow, "platform_settings")
            if not row:
                return self._default_platform_settings()
            merged = self._default_platform_settings()
            if isinstance(row.value, dict):
                merged.update(row.value)
                if isinstance(row.value.get("sla"), dict):
                    merged["sla"] = {
                        **self._default_platform_settings()["sla"],
                        **row.value["sla"],
                    }
            return merged

    def save_platform_settings(self, payload: dict) -> dict:
        current = self.get_platform_settings()
        next_value = {**current, **(payload or {})}
        if isinstance(payload.get("sla"), dict):
            next_value["sla"] = {**current.get("sla", {}), **payload["sla"]}
        with self._lock, self._sessions() as session:
            row = session.get(AppStateRow, "platform_settings")
            if row:
                row.value = next_value
            else:
                session.add(AppStateRow(key="platform_settings", value=next_value))
            session.commit()
        return self.get_platform_settings()

    def _project_code(self, name: str, index: int) -> str:
        letters = "".join(ch for ch in (name or "").upper() if ch.isalpha())
        return (letters[:3] or f"P{index + 1}").ljust(3, "X")[:3]

    def _sunday_week_bounds(self, day) -> tuple:
        """Return (Sunday, Saturday) for the week containing day."""
        days_since_sunday = (day.weekday() + 1) % 7
        week_start = day - timedelta(days=days_since_sunday)
        week_end = week_start + timedelta(days=6)
        return week_start, week_end

    def _weekly_report_id(self, day, project_name: str, index: int) -> str:
        year, week = week_from_date(day)
        code = self._project_code(project_name, index)
        return f"WR-{year}-W{week:02d}-{code}"

    def _report_local_now(self) -> datetime:
        return datetime.now(AST)

    def _parse_daily_at(self, raw: object) -> tuple[int, int]:
        text = str(raw or "23:59").strip() or "23:59"
        match = re.match(r"^(\d{1,2}):(\d{2})$", text)
        if not match:
            return 23, 59
        hour = min(23, max(0, int(match.group(1))))
        minute = min(59, max(0, int(match.group(2))))
        return hour, minute

    def _rebuild_daily_packets(self, existing: list[dict]) -> list[dict]:
        """Ensure one saved daily packet per calendar day (incl. empty days).

        Before the Administration dailyAt cutoff, today stays Compiling.
        At/after cutoff (and for every past day), status becomes Generated and
        generated_at is stamped so the report remains viewable.
        """
        settings = self.get_platform_settings()
        hour, minute = self._parse_daily_at(settings.get("dailyAt"))
        now = self._report_local_now()
        today = now.date()
        past_cutoff = (now.hour * 60 + now.minute) >= (hour * 60 + minute)
        by_id = {
            str(item.get("id") or ""): dict(item)
            for item in existing
            if isinstance(item, dict)
        }
        rebuilt: list[dict] = []
        # Keep ~30 days so quiet days still appear between active ones.
        for offset in range(30):
            day = today - timedelta(days=offset)
            report_id = f"DR-{day.strftime('%Y%m%d')}"
            is_today = day == today
            compiling = is_today and not past_cutoff
            status = "Compiling" if compiling else "Generated"
            generated_at = None
            if not compiling:
                generated_at = datetime(
                    day.year, day.month, day.day, hour, minute, tzinfo=AST
                ).isoformat()
            prev = by_id.get(report_id) or {}
            item = {
                "id": report_id,
                "kind": "daily",
                "scope": "All projects",
                "label": day.isoformat(),
                "status": status,
                "a": day.isoformat(),
                "b": day.isoformat(),
                "signed": prev.get("signed"),
                "issued": prev.get("issued"),
                "generated_at": prev.get("generated_at") or generated_at,
            }
            # Never reopen a day that already finalized.
            if str(prev.get("status") or "") == "Generated" and compiling:
                item["status"] = "Generated"
                item["generated_at"] = prev.get("generated_at") or generated_at
            rebuilt.append(item)
        return rebuilt

    def _report_packets(self) -> list[dict]:
        projects = [item["label"] for item in self.catalog.get("project")][:4]

        with self._sessions() as session:
            row = session.get(AppStateRow, "report_packets")
            packets = list(row.value) if row and isinstance(row.value, list) else []

        # Keep unrelated packets; rebuild daily/weekly/monthly from schedule.
        other = [
            p
            for p in packets
            if p.get("kind") not in {"daily", "weekly", "monthly"}
        ]
        rebuilt_daily = self._rebuild_daily_packets(
            [p for p in packets if p.get("kind") == "daily"]
        )
        rebuilt_weekly = self._rebuild_weekly_packets(
            [p for p in packets if p.get("kind") == "weekly"],
            projects,
        )
        rebuilt_monthly = self._rebuild_monthly_packets(
            [p for p in packets if p.get("kind") == "monthly"],
            projects,
        )

        packets = other + rebuilt_daily + rebuilt_weekly + rebuilt_monthly
        self._save_report_packets(packets)
        return packets

    def _weekday_offset_from_sunday(self, name: str) -> int:
        order = [
            "Sunday",
            "Monday",
            "Tuesday",
            "Wednesday",
            "Thursday",
            "Friday",
            "Saturday",
        ]
        clean = str(name or "Saturday").strip().title()
        if clean not in order:
            clean = "Saturday"
        return order.index(clean)

    def _calendar_month_shift(self, day: date, months: int) -> date:
        month_index = day.year * 12 + (day.month - 1) + months
        year = month_index // 12
        month = month_index % 12 + 1
        return date(year, month, 1)

    def _month_last_day(self, day: date) -> date:
        nxt = self._calendar_month_shift(day, 1)
        return nxt - timedelta(days=1)

    def _rebuild_weekly_packets(
        self, existing: list[dict], projects: list[str]
    ) -> list[dict]:
        """One weekly packet per project × recent week, even with 0 cases.

        Current week stays Compiling until Administration weeklyDay at dailyAt;
        then it becomes Awaiting HSE signature (and stays signed if already signed).
        """
        settings = self.get_platform_settings()
        weekly_day = str(settings.get("weeklyDay") or "Saturday")
        hour, minute = self._parse_daily_at(settings.get("dailyAt"))
        now = self._report_local_now()
        today = now.date()
        past_cutoff = (now.hour * 60 + now.minute) >= (hour * 60 + minute)
        compile_offset = self._weekday_offset_from_sunday(weekly_day)

        by_id = {
            str(item.get("id") or ""): dict(item)
            for item in existing
            if isinstance(item, dict)
        }
        by_scope_range = {
            (
                str(item.get("scope") or ""),
                str(item.get("a") or ""),
                str(item.get("b") or ""),
            ): dict(item)
            for item in existing
            if isinstance(item, dict) and item.get("scope")
        }

        rebuilt: list[dict] = []
        current_sunday, _ = self._sunday_week_bounds(today)
        for week_offset in range(6):
            week_start = current_sunday - timedelta(days=7 * week_offset)
            week_end = week_start + timedelta(days=6)
            compile_day = week_start + timedelta(days=compile_offset)
            a = week_start.isoformat()
            b = week_end.isoformat()
            _, week_no = week_from_date(week_end)
            finalized = today > compile_day or (today == compile_day and past_cutoff)
            for index, name in enumerate(projects):
                report_id = self._weekly_report_id(week_end, name, index)
                prev = by_id.get(report_id) or by_scope_range.get((name, a, b)) or {}
                if not prev and week_offset == 0:
                    prev = next(
                        (
                            dict(p)
                            for p in existing
                            if str(p.get("scope") or "") == name
                            and str(p.get("id") or "").startswith(f"WR-{today.year}-")
                            and "-W" not in str(p.get("id") or "")
                        ),
                        {},
                    )
                signed = prev.get("signed")
                if signed:
                    status = "Signed"
                elif finalized:
                    status = "Awaiting HSE signature"
                else:
                    status = "Compiling"
                generated_at = None
                if finalized:
                    generated_at = datetime(
                        compile_day.year,
                        compile_day.month,
                        compile_day.day,
                        hour,
                        minute,
                        tzinfo=AST,
                    ).isoformat()
                # Signed stays signed; otherwise follow the schedule even with 0 cases.
                if signed or str(prev.get("status") or "") == "Signed":
                    status = "Signed"
                item = {
                    "id": report_id,
                    "kind": "weekly",
                    "scope": name,
                    "label": f"Week {week_no:02d} · {name}",
                    "status": status,
                    "a": a,
                    "b": b,
                    "signed": signed,
                    "issued": prev.get("issued"),
                    "generated_at": prev.get("generated_at") or generated_at,
                }
                rebuilt.append(item)
        return rebuilt

    def _rebuild_monthly_packets(
        self, existing: list[dict], projects: list[str]
    ) -> list[dict]:
        """One monthly packet per project × recent month, even with 0 cases.

        A month becomes Ready to issue on Administration monthlyDay of the
        following month (00:00 local). Until then it stays Compiling.
        """
        settings = self.get_platform_settings()
        monthly_day = min(10, max(1, int(settings.get("monthlyDay") or 1)))
        now = self._report_local_now()
        today = now.date()

        by_id = {
            str(item.get("id") or ""): dict(item)
            for item in existing
            if isinstance(item, dict)
        }
        by_scope_month = {
            (str(item.get("scope") or ""), str(item.get("a") or "")[:7]): dict(item)
            for item in existing
            if isinstance(item, dict) and item.get("scope") and item.get("a")
        }

        rebuilt: list[dict] = []
        current_month_start = today.replace(day=1)
        for month_offset in range(6):
            month_start = self._calendar_month_shift(current_month_start, -month_offset)
            month_end = self._month_last_day(month_start)
            next_month = self._calendar_month_shift(month_start, 1)
            ready_day = min(monthly_day, self._month_last_day(next_month).day)
            ready_on = date(next_month.year, next_month.month, ready_day)
            finalized = today >= ready_on
            month_label = month_start.strftime("%B %Y")
            a = month_start.isoformat()
            b = month_end.isoformat()
            for index, name in enumerate(projects):
                code = self._project_code(name, index)
                report_id = (
                    f"MR-{month_start.year}-{month_start.month:02d}-{code}"
                )
                prev = (
                    by_id.get(report_id)
                    or by_scope_month.get((name, a[:7]))
                    or {}
                )
                issued = prev.get("issued")
                if issued or str(prev.get("status") or "") == "Issued":
                    status = "Issued"
                elif finalized:
                    status = "Ready to issue"
                else:
                    status = "Compiling"
                generated_at = None
                if finalized:
                    generated_at = datetime(
                        ready_on.year,
                        ready_on.month,
                        ready_on.day,
                        0,
                        0,
                        tzinfo=AST,
                    ).isoformat()
                # Issued stays issued; otherwise follow monthlyDay even with 0 cases.
                if issued or str(prev.get("status") or "") == "Issued":
                    status = "Issued"
                item = {
                    "id": report_id,
                    "kind": "monthly",
                    "scope": name,
                    "label": month_label,
                    "status": status,
                    "a": a,
                    "b": b,
                    "signed": prev.get("signed"),
                    "issued": issued,
                    "generated_at": prev.get("generated_at") or generated_at,
                }
                rebuilt.append(item)
        return rebuilt

    def _save_report_packets(self, packets: list[dict]) -> None:
        with self._lock, self._sessions() as session:
            row = session.get(AppStateRow, "report_packets")
            if row:
                row.value = packets
            else:
                session.add(AppStateRow(key="report_packets", value=packets))
            session.commit()

    def sign_report(self, report_id: str, *, actor: str, signature: str) -> dict:
        packets = self._report_packets()
        for item in packets:
            if item.get("id") == report_id:
                if item.get("kind") != "weekly":
                    raise ValueError("Only weekly reports can be signed by Dept HSE.")
                item["signed"] = {
                    "by": actor,
                    "signature": signature,
                    "at": datetime.now(timezone.utc).isoformat(),
                }
                item["status"] = "Signed"
                self._save_report_packets(packets)
                return item
        raise KeyError(report_id)

    def issue_report(self, report_id: str, *, actor: str, recipient: str) -> dict:
        packets = self._report_packets()
        for item in packets:
            if item.get("id") == report_id:
                if item.get("kind") != "monthly":
                    raise ValueError("Only monthly reports can be issued to Project PM.")
                item["issued"] = {
                    "by": actor,
                    "to": recipient,
                    "at": datetime.now(timezone.utc).isoformat(),
                }
                item["status"] = "Issued"
                self._save_report_packets(packets)
                return item
        raise KeyError(report_id)

    def _closeout_deadline_pending(self, row: dict) -> bool:
        """True while the close-out / confirm-driver / SOS close deadline still applies."""
        status = row.get("status")
        if status == "closed":
            return False
        record_type = row.get("record_type")
        fields = row.get("fields") or {}
        if record_type == "ai_camera":
            if status != "open":
                return False
            if fields.get("close_out_action") or fields.get("close_out_picture"):
                return False
            return True
        if record_type in {"dashcam", "speed"}:
            if status != "open":
                return False
            if fields.get("itqan_upload_proof") or fields.get("close_out_action"):
                return False
            return True
        if record_type == "sos":
            return status == "open"
        return status == "open"

    def overdue_notifications(self, user: dict | None = None) -> dict:
        """Close-out deadline reminders (due soon), overdue, and 2× escalations."""
        settings = self.get_platform_settings()
        sla = settings.get("sla") or {}
        due_soon = float(sla.get("dueSoon") or 0.75)
        escalate = float(sla.get("escalate") or 2)
        type_labels = {
            "ai_camera": "AI Camera Observation",
            "dashcam": "Dashcam Observation",
            "speed": "Speed Violation",
            "sos": "SOS Alert",
        }
        status_labels = {
            "open": "Open",
            "under_process": "Under Review",
            "closed": "Closed",
        }
        now = datetime.now(timezone.utc)
        items: list[dict] = []
        for row in self.filter_cases_for_user(self.list_cases(), user):
            # Close-out deadline alerts only while close-out / confirm / SOS close
            # is still pending. Submitting close-out clears the notification.
            if not self._closeout_deadline_pending(row):
                continue
            risk = row.get("risk_level") or "Medium Risk"
            risk_key = str(risk).replace(" Risk", "").strip() or "Medium"
            if row.get("record_type") == "sos":
                hours = 2.0
            else:
                hours = float(
                    (sla.get(risk_key) or sla.get("Medium") or {}).get("hours") or 72
                )
            created = row.get("created_at")
            if isinstance(created, datetime):
                created_at = created
            else:
                try:
                    created_at = datetime.fromisoformat(
                        str(created).replace("Z", "+00:00")
                    )
                except ValueError:
                    continue
            if created_at.tzinfo is None:
                created_at = created_at.replace(tzinfo=timezone.utc)
            age_h = (now - created_at).total_seconds() / 3600.0
            state = "ok"
            if age_h > hours * escalate:
                state = "esc"
            elif age_h > hours:
                state = "over"
            elif age_h > hours * due_soon:
                state = "soon"
            if state == "ok":
                continue
            fields = row.get("fields") or {}
            over_h = max(0.0, age_h - hours)
            left_h = max(0.0, hours - age_h)
            place = fields.get("location") or row.get("project") or row.get("department") or "—"
            if state == "esc":
                detail = f"{place} · {risk} · {status_labels.get(row['status'], row['status'])} · escalated to Dept HSE"
                state_label = "escalated"
            elif state == "over":
                detail = f"{place} · {risk} · {status_labels.get(row['status'], row['status'])} · overdue close-out"
                state_label = "overdue"
            else:
                detail = f"{place} · {risk} · {status_labels.get(row['status'], row['status'])} · reminder before deadline"
                state_label = "due soon"
            items.append(
                {
                    "id": row["id"],
                    "case_id": row["case_id"],
                    "record_type": row["record_type"],
                    "record_label": type_labels.get(
                        row["record_type"], row["record_type"]
                    ),
                    "project": row.get("project"),
                    "department": row.get("department"),
                    "location": fields.get("location"),
                    "risk_level": risk,
                    "risk_key": risk_key,
                    "status": row["status"],
                    "status_label": status_labels.get(row["status"], row["status"]),
                    "state": state,
                    "state_label": state_label,
                    "detail": detail,
                    "age_hours": round(age_h, 1),
                    "over_hours": round(over_h, 1),
                    "left_hours": round(left_h, 1),
                    "deadline_hours": hours,
                }
            )

        role = (user or {}).get("role") or ""
        notify_op = bool(settings.get("notifyOperator", True))
        notify_admin = bool(settings.get("notifyAdmin", True))
        notify_hse = bool(settings.get("notifyHSE", True))
        if role == "dept_hse":
            items = [item for item in items if item["state"] == "esc"] if notify_hse else []
        elif role == "admin":
            if not notify_admin:
                items = []
        elif role == "operator":
            if not notify_op:
                items = []
        # Project PM / receiver: project-scoped rows already filtered; show all states.

        items.sort(key=lambda item: item["age_hours"], reverse=True)
        return {
            "items": items,
            "counts": {
                "esc": sum(1 for item in items if item["state"] == "esc"),
                "over": sum(1 for item in items if item["state"] == "over"),
                "soon": sum(1 for item in items if item["state"] == "soon"),
                "all": len(items),
            },
            "deadlines": {
                "High": (sla.get("High") or {}).get("hours", 24),
                "Medium": (sla.get("Medium") or {}).get("hours", 72),
                "Low": (sla.get("Low") or {}).get("hours", 168),
                "SOS": 2,
                "dueSoon": due_soon,
                "escalate": escalate,
            },
        }

    def get_hw_transfers(self) -> dict:
        with self._sessions() as session:
            row = session.get(AppStateRow, "hw_transfers")
            if row and isinstance(row.value, dict):
                return row.value
        sample = {
            "items": [
                {
                    "id": "TRF-0007",
                    "kind": "delivery",
                    "from": "Warehouse",
                    "to": "Jafurah",
                    "type": "Smart Helmet",
                    "qty": 5,
                    "status": "transit",
                }
            ],
            "register": [],
        }
        with self._lock, self._sessions() as session:
            session.add(AppStateRow(key="hw_transfers", value=sample))
            session.commit()
        return sample

    def receive_hw_transfer(self, transfer_id: str, *, actor: str) -> dict:
        state = self.get_hw_transfers()
        items = list(state.get("items") or [])
        for item in items:
            if item.get("id") == transfer_id:
                if item.get("status") == "received":
                    return item
                item["status"] = "received"
                item["received_by"] = actor
                item["received_at"] = datetime.now(timezone.utc).isoformat()
                with self._lock, self._sessions() as session:
                    row = session.get(AppStateRow, "hw_transfers")
                    if row:
                        value = dict(row.value or {})
                        value["items"] = items
                        row.value = value
                    session.commit()
                return item
        raise KeyError(transfer_id)

    def _user_badge_map(self) -> dict[str, str | None]:
        from app.schemas.auth import format_user_label

        with self._sessions() as session:
            mapping: dict[str, str | None] = {}
            for row in session.query(UserRow).all():
                label = format_user_label(row.display_name, row.badge_number)
                mapping[label] = row.badge_number
                mapping[row.display_name] = row.badge_number
            return mapping

    def _admin_display_names(self) -> set[str]:
        """Display names that should be hidden from Operator Performance.

        If the same display name exists as both admin and operator, keep it —
        this page attributes work by name, and operator activity must remain visible.
        """
        from app.schemas.auth import format_user_label

        with self._sessions() as session:
            admins = {
                format_user_label(row.display_name, row.badge_number)
                for row in session.query(UserRow).filter(UserRow.role == "admin").all()
            }
            admins |= {
                row.display_name
                for row in session.query(UserRow).filter(UserRow.role == "admin").all()
            }
            operators = {
                format_user_label(row.display_name, row.badge_number)
                for row in session.query(UserRow)
                .filter(UserRow.role == "operator")
                .all()
            }
            operators |= {
                row.display_name
                for row in session.query(UserRow)
                .filter(UserRow.role == "operator")
                .all()
            }
            return admins - operators

    def _operator_badge_map(self) -> dict[str, str | None]:
        """Canonical operator label -> badge (for API consumers)."""
        return dict(self._operator_identity_maps()[1])

    def _operator_identity_maps(
        self,
    ) -> tuple[dict[str, str], dict[str, str | None]]:
        """alias/plain/label -> canonical `badge - Name`, and canonical -> badge."""
        from app.schemas.auth import format_user_label

        alias_to_canonical: dict[str, str] = {}
        badge_by_canonical: dict[str, str | None] = {}
        with self._sessions() as session:
            for row in session.query(UserRow).filter(UserRow.role == "operator").all():
                label = format_user_label(row.display_name, row.badge_number)
                badge_by_canonical[label] = row.badge_number
                alias_to_canonical[label] = label
                if row.display_name:
                    alias_to_canonical[row.display_name] = label
        return alias_to_canonical, badge_by_canonical

    def _performance_activity_events(self, rows: list[dict]) -> list[dict]:
        events: list[dict] = []
        type_label = {
            "ai_camera": "AI Camera",
            "dashcam": "DashCam",
            "speed": "Speed",
            "sos": "SOS",
        }
        for row in rows:
            fields = row["fields"] or {}
            place = row["project"] or row["department"] or "—"
            kind = type_label.get(row["record_type"], row["record_type"])
            created = (
                row["created_at"].isoformat()
                if hasattr(row["created_at"], "isoformat")
                else str(row["created_at"])
            )
            events.append(
                {
                    "at": created,
                    "operator": fields.get("reported_by") or "Unknown",
                    "action": "Registered",
                    "case_id": row["case_id"],
                    "details": f"Registered {kind} · {place}",
                    "record_type": row["record_type"],
                    "project": row.get("project"),
                }
            )
            if fields.get("uploaded_by") or fields.get("itqan_upload_proof"):
                events.append(
                    {
                        "at": fields.get("confirmed_at") or created,
                        "operator": fields.get("uploaded_by")
                        or fields.get("close_out_submitted_by")
                        or fields.get("reported_by")
                        or "Unknown",
                        "action": "Uploaded to ITQAN",
                        "case_id": row["case_id"],
                        "details": f"Confirm Driver & Submit · {place}",
                        "record_type": row["record_type"],
                        "project": row.get("project"),
                    }
                )
            if row["record_type"] == "ai_camera" and fields.get("close_out_action"):
                events.append(
                    {
                        "at": fields.get("approved_at") or created,
                        "operator": fields.get("close_out_submitted_by")
                        or fields.get("reported_by")
                        or "Unknown",
                        "action": "Close-out",
                        "case_id": row["case_id"],
                        "details": f"AI Camera close-out · {place}",
                        "record_type": row["record_type"],
                        "project": row.get("project"),
                    }
                )
            if row["record_type"] == "sos" and row["status"] == "closed":
                events.append(
                    {
                        "at": fields.get("closure_closed_at") or created,
                        "operator": fields.get("closed_by")
                        or fields.get("reported_by")
                        or "Unknown",
                        "action": "Closed",
                        "case_id": row["case_id"],
                        "details": f"SOS closed · {place}",
                        "record_type": row["record_type"],
                        "project": row.get("project"),
                    }
                )
            if fields.get("reject_reason"):
                events.append(
                    {
                        "at": created,
                        "operator": fields.get("rejected_by") or "Admin",
                        "action": "Edited",
                        "case_id": row["case_id"],
                        "details": f"Rejected close-out · {place}",
                        "record_type": row["record_type"],
                        "project": row.get("project"),
                    }
                )
        events.sort(key=lambda item: str(item["at"]), reverse=True)
        return events

    def operator_performance(
        self,
        period: str = "this_week",
        start_date: date | None = None,
        end_date: date | None = None,
        operator: str | None = None,
        record_type: str | None = None,
        project: str | None = None,
        action: str | None = None,
    ) -> dict:
        start, end = self.period_bounds(period, start_date, end_date)
        all_rows = self.list_cases()
        rows = [row for row in all_rows if self.in_period(row, start, end)]
        if record_type:
            rows = [row for row in rows if row["record_type"] == record_type]
        if project:
            rows = [row for row in rows if row.get("project") == project]

        admin_names = self._admin_display_names()
        alias_to_canonical, badge_by_canonical = self._operator_identity_maps()
        operators: dict[str, dict] = {}

        def resolve_operator(name: str | None) -> str | None:
            raw = (name or "").strip()
            if not raw:
                return None
            return alias_to_canonical.get(raw)

        def is_activity_actor(name: str | None) -> bool:
            # Activity log keeps historical names, including deleted operators.
            raw = (name or "").strip()
            if not raw:
                return False
            canonical = alias_to_canonical.get(raw, raw)
            return canonical not in admin_names and raw not in admin_names

        def bucket_for(name: str) -> dict | None:
            canonical = resolve_operator(name)
            if not canonical:
                return None
            return operators.setdefault(
                canonical,
                {
                    "operator": canonical,
                    "badge_number": badge_by_canonical.get(canonical),
                    "ai_camera": 0,
                    "dashcam": 0,
                    "speed": 0,
                    "sos": 0,
                    "uploaded": 0,
                    "close_outs": 0,
                    "registered": 0,
                    "last_activity": None,
                },
            )

        for row in rows:
            fields = row["fields"] or {}
            reporter = fields.get("reported_by") or "Unknown"
            created = (
                row["created_at"].isoformat()
                if hasattr(row["created_at"], "isoformat")
                else str(row["created_at"])
            )
            bucket = bucket_for(reporter)
            if bucket is not None:
                bucket[row["record_type"]] = bucket.get(row["record_type"], 0) + 1
                bucket["registered"] += 1
                bucket["last_activity"] = max(
                    filter(None, [bucket["last_activity"], created])
                )

            if fields.get("uploaded_by") or fields.get("itqan_upload_proof"):
                uploader = fields.get("uploaded_by") or reporter
                up_bucket = bucket_for(uploader)
                if up_bucket is not None:
                    up_bucket["uploaded"] += 1
                    stamp = fields.get("confirmed_at") or created
                    up_bucket["last_activity"] = max(
                        filter(None, [up_bucket["last_activity"], stamp])
                    )

            if row["record_type"] == "ai_camera" and fields.get("close_out_action"):
                closer = fields.get("close_out_submitted_by") or reporter
                close_bucket = bucket_for(closer)
                if close_bucket is not None:
                    close_bucket["close_outs"] += 1
                    close_bucket["last_activity"] = max(
                        filter(None, [close_bucket["last_activity"], created])
                    )
            if row["record_type"] == "sos" and row["status"] == "closed":
                closer = fields.get("closed_by") or reporter
                close_bucket = bucket_for(closer)
                if close_bucket is not None:
                    close_bucket["close_outs"] += 1
                    stamp = fields.get("closure_closed_at") or created
                    close_bucket["last_activity"] = max(
                        filter(None, [close_bucket["last_activity"], stamp])
                    )

        operator_canonical = resolve_operator(operator) if operator else None
        if operator:
            operators = {
                name: bucket
                for name, bucket in operators.items()
                if name == operator_canonical or name == operator
            }

        table = []
        for bucket in operators.values():
            total = (
                bucket["registered"]
                + bucket["uploaded"]
                + bucket["close_outs"]
            )
            table.append({**bucket, "total_actions": total})
        table.sort(key=lambda item: item["total_actions"], reverse=True)

        events = []
        for item in self._performance_activity_events(rows):
            raw_op = item.get("operator")
            if not is_activity_actor(raw_op):
                continue
            canonical = resolve_operator(raw_op) or raw_op
            events.append({**item, "operator": canonical})
        if operator:
            events = [
                item
                for item in events
                if item["operator"] == operator_canonical
                or item["operator"] == operator
            ]
        if action:
            events = [item for item in events if item["action"] == action]
        if project:
            events = [item for item in events if item.get("project") == project]
        if record_type:
            events = [item for item in events if item.get("record_type") == record_type]

        def actor_matches(name: str | None, target: str | None) -> bool:
            canonical = resolve_operator(name)
            if not canonical:
                return False
            if not target:
                return True
            target_canonical = resolve_operator(target) or target
            return canonical == target_canonical

        def count_metrics(
            source: list[dict], operator_name: str | None = None
        ) -> dict[str, int]:
            registered = 0
            observations = 0
            ai = 0
            dash = 0
            speed = 0
            uploaded = 0
            close_outs = 0
            for row in source:
                fields = row["fields"] or {}
                reporter = fields.get("reported_by")
                if actor_matches(reporter, operator_name):
                    registered += 1
                    if row["record_type"] == "ai_camera":
                        ai += 1
                        observations += 1
                    elif row["record_type"] == "dashcam":
                        dash += 1
                        observations += 1
                    elif row["record_type"] == "speed":
                        speed += 1
                uploader = fields.get("uploaded_by") or (
                    reporter if fields.get("itqan_upload_proof") else None
                )
                if uploader and (
                    fields.get("uploaded_by") or fields.get("itqan_upload_proof")
                ):
                    if actor_matches(uploader, operator_name):
                        uploaded += 1
                if row["record_type"] == "ai_camera" and fields.get("close_out_action"):
                    closer = fields.get("close_out_submitted_by") or reporter
                    if actor_matches(closer, operator_name):
                        close_outs += 1
                if row["record_type"] == "sos" and row["status"] == "closed":
                    closer = fields.get("closed_by") or reporter
                    if actor_matches(closer, operator_name):
                        close_outs += 1
            return {
                "registered": registered,
                "observations": observations,
                "ai_camera": ai,
                "dashcam": dash,
                "speed": speed,
                "uploaded": uploaded,
                "close_outs": close_outs,
            }

        series = []
        today = datetime.now(AST).date()
        for i in range(7, -1, -1):
            day = today - timedelta(days=i * 7)
            _y, week = week_from_date(day)
            week_rows = [row for row in all_rows if row["week_number"] == week]
            if record_type:
                week_rows = [
                    row for row in week_rows if row["record_type"] == record_type
                ]
            if project:
                week_rows = [row for row in week_rows if row.get("project") == project]
            metrics = count_metrics(week_rows, operator)
            series.append(
                {
                    "week": week,
                    "registered": metrics["registered"],
                    "uploaded": metrics["uploaded"],
                    "close_outs": metrics["close_outs"],
                }
            )

        # Previous comparable window for deltas.
        span_days = max((end - start).days + 1, 1)
        prev_end = start - timedelta(days=1)
        prev_start = prev_end - timedelta(days=span_days - 1)
        prev_rows = [
            row for row in all_rows if self.in_period(row, prev_start, prev_end)
        ]
        if record_type:
            prev_rows = [row for row in prev_rows if row["record_type"] == record_type]
        if project:
            prev_rows = [row for row in prev_rows if row.get("project") == project]

        def pct(current: int, previous: int) -> int:
            if not previous:
                return 100 if current else 0
            return round(((current - previous) / previous) * 100)

        current = count_metrics(rows, operator)
        previous = count_metrics(prev_rows, operator)
        kpis = {
            "registered": {
                "value": current["registered"],
                "delta": pct(current["registered"], previous["registered"]),
                "hint": "Observations, violations and SOS alerts",
            },
            "observations": {
                "value": current["observations"],
                "delta": pct(current["observations"], previous["observations"]),
                "hint": f"AI Camera {current['ai_camera']}, DashCam {current['dashcam']}",
            },
            "speed": {
                "value": current["speed"],
                "delta": pct(current["speed"], previous["speed"]),
                "hint": "Registered by Operators",
            },
            "uploaded": {
                "value": current["uploaded"],
                "delta": pct(current["uploaded"], previous["uploaded"]),
                "hint": "Confirm Driver & Submit completed",
            },
            "close_outs": {
                "value": current["close_outs"],
                "delta": pct(current["close_outs"], previous["close_outs"]),
                "hint": "AI Camera close-out and SOS closed",
            },
        }

        operator_names = sorted(current_operators)
        projects = sorted(
            {row["project"] for row in all_rows if row.get("project")}
        )

        return {
            "prototype": True,
            "period": period,
            "period_start": start.isoformat(),
            "period_end": end.isoformat(),
            "compare_start": prev_start.isoformat(),
            "compare_end": prev_end.isoformat(),
            "kpis": kpis,
            "series_8_weeks": series,
            "operators": table,
            "activity": [
                {
                    "at": item["at"],
                    "operator": item["operator"],
                    "action": item["action"],
                    "case_id": item["case_id"],
                    "details": item["details"],
                }
                for item in events[:40]
            ],
            "filters": {
                "operators": [name for name in operator_names if name],
                "projects": projects,
                "actions": [
                    "Registered",
                    "Uploaded to ITQAN",
                    "Close-out",
                    "Closed",
                    "Edited",
                ],
                "record_types": [
                    {"id": "ai_camera", "label": "AI Camera"},
                    {"id": "dashcam", "label": "DashCam"},
                    {"id": "speed", "label": "Speed"},
                    {"id": "sos", "label": "SOS"},
                ],
            },
        }


    def rename_list_item(
        self,
        list_type: str,
        item_id: str,
        label: str,
        *,
        is_active: bool | None = None,
    ) -> dict:
        current = self.catalog.get_item(list_type, item_id)
        if not current:
            raise KeyError(item_id)
        updated = self.catalog.update(
            list_type, item_id, label, is_active=is_active
        )
        if current["label"] != updated["label"]:
            self._retarget_list_label(list_type, current["label"], updated["label"])
        return updated

    def add_list_item(self, list_type: str, label: str) -> dict:
        item = self.catalog.add(list_type, label)
        self._forget_list_tombstone(list_type, item["label"])
        return item

    def delete_list_item(self, list_type: str, item_id: str) -> dict:
        deleted = self.catalog.delete(list_type, item_id)
        self._remember_list_tombstone(list_type, deleted.get("label") or "")
        return deleted

    def _rename_map_key(self, mapping: dict, old: str, new: str) -> dict:
        if old not in mapping or old == new:
            return mapping
        renamed = dict(mapping)
        renamed[new] = renamed.pop(old)
        return renamed

    def _retarget_list_label(self, list_type: str, old: str, new: str) -> None:
        with self._lock, self._sessions() as session:
            if list_type == "project":
                session.query(CaseRow).filter(CaseRow.project == old).update(
                    {CaseRow.project: new}
                )
                session.query(ContactRow).filter(ContactRow.project == old).update(
                    {ContactRow.project: new}
                )
            if list_type == "department":
                session.query(CaseRow).filter(CaseRow.department == old).update(
                    {CaseRow.department: new}
                )
            if list_type == "risk_level":
                session.query(CaseRow).filter(CaseRow.risk_level == old).update(
                    {CaseRow.risk_level: new}
                )
            field_keys = LIST_FIELD_KEYS.get(list_type, [])
            if field_keys:
                for row in session.query(CaseRow).all():
                    fields = dict(row.fields or {})
                    changed = False
                    for key in field_keys:
                        if fields.get(key) == old:
                            fields[key] = new
                            changed = True
                    if changed:
                        row.fields = fields
                        flag_modified(row, "fields")
            if list_type in {"project", "hw_site", "department", "scc_device_type"}:
                hw = session.get(AppStateRow, "hw")
                if hw:
                    value = dict(hw.value or {})
                    project = dict(value.get("project") or {})
                    dept = dict(value.get("department") or {})
                    if list_type in {"project", "hw_site"}:
                        project = self._rename_map_key(project, old, new)
                    if list_type == "department":
                        dept = self._rename_map_key(dept, old, new)
                    if list_type == "scc_device_type":
                        project = {
                            site: self._rename_map_key(dict(counts), old, new)
                            for site, counts in project.items()
                        }
                    value["project"] = project
                    value["department"] = dept
                    hw.value = value
                    flag_modified(hw, "value")
            if list_type == "project":
                weather = session.get(AppStateRow, "weather")
                if weather:
                    sheets = []
                    for sheet in weather.value or []:
                        item = dict(sheet)
                        if item.get("project") == old:
                            item["project"] = new
                        sheets.append(item)
                    weather.value = sheets
                    flag_modified(weather, "value")
            session.commit()

    def record_audit(
        self,
        *,
        actor_name: str,
        action: str,
        category: str,
        summary: str,
        actor_user_id: str | None = None,
        details: dict | None = None,
        case_id: str | None = None,
    ) -> dict:
        row = AuditEventRow(
            id=str(uuid4()),
            occurred_at=datetime.now(timezone.utc),
            actor_user_id=actor_user_id,
            actor_name=actor_name.strip() or "Admin",
            action=action,
            category=category,
            summary=summary.strip(),
            details=details or {},
            case_id=case_id,
        )
        with self._lock, self._sessions() as session:
            session.add(row)
            session.commit()
            session.refresh(row)
            return self._audit_out(row)

    def list_admin_audit(self, *, limit: int = 200) -> list[dict]:
        capped = max(1, min(int(limit or 200), 500))
        with self._sessions() as session:
            rows = (
                session.query(AuditEventRow)
                .order_by(AuditEventRow.occurred_at.desc())
                .limit(capped)
                .all()
            )
            return [self._audit_out(row) for row in rows]

    def _audit_out(self, row: AuditEventRow) -> dict:
        occurred = row.occurred_at
        if occurred is not None and occurred.tzinfo is None:
            occurred = occurred.replace(tzinfo=timezone.utc)
        return {
            "id": row.id,
            "occurred_at": occurred.isoformat() if occurred else None,
            "actor_user_id": row.actor_user_id,
            "actor_name": row.actor_name,
            "action": row.action,
            "category": row.category,
            "summary": row.summary,
            "details": row.details or {},
            "case_id": row.case_id,
        }


platform_store = PlatformStore(
    database_url=get_settings().database_url or default_sqlite_url()
)
