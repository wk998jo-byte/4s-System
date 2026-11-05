"""Admin-managed lists. Seeded from requirements §5 only.

Dashcam Alert Summary is empty until the requester supplies values
(OPEN_QUESTIONS A1). Reported-by is the signed-in user, not a list.
"""

from __future__ import annotations

from threading import Lock
from uuid import uuid4

from sqlalchemy.orm import Session, sessionmaker

from app.db.models import ListItemRow

LIST_SEEDS: dict[str, list[str]] = {
    "alert_type": ["Unsafe Act", "Unsafe Condition", "Positive"],
    "project": ["Jafurah", "MGS", "Yanbu", "Ras Tanura"],
    "hw_site": [
        "Jafurah",
        "Yanbu",
        "Dhahran",
        "MGS",
        "Salasil",
        "Ras Tanura",
        "Rig Move",
        "Medical Division",
        "Aramco Emergency Job",
        "Safaniya",
    ],
    "department": [
        "Salasil RMD Yard",
        "Dhahran Yard",
        "Salasil Fabrication Shop",
        "Rig Move",
        "Facility",
        "Pipe Dolly",
        "Logistics",
        "Medical Division",
        "Transportation",
        "4S Department",
        "Construction",
        "IT",
        "Workshop",
        "HR",
        "Zuluf",
        "Procurement",
        "Safaniya",
    ],
    "risk_level": ["Low Risk", "Medium Risk", "High Risk"],
    "dashcam_observation_type": [
        "Seat Belt",
        "Mobile Phone Use",
        "Over Passengers",
        "Smoking",
        "Camera Covered",
        "Tampering",
        "Other (please specify)",
    ],
    # Kept in sync with Dashcam form mapping (2.2 Violation Type / Alert Summary).
    "dashcam_alert_summary": [
        "Driver not wearing a seat belt while driving.",
        "Passenger not wearing a seat belt while the vehicle is moving.",
        "Driver using a mobile phone while driving.",
        "Vehicle carrying more passengers than its approved seating capacity.",
        "Driver smoking inside the vehicle.",
        "Passenger smoking inside the vehicle.",
        "Driver covering or blocking the vehicle camera.",
        "Driver tampering with the vehicle camera.",
    ],
    "ai_camera_category": [
        "General Safety & Health Provisions",
        "Personal Protective Equipment",
        "Fire Protection & Prevention",
        "Signs, Signals & Barricades",
        "Vehicular Safety",
        "Concrete & Masonry Construction",
        "Electrical & Overhead Power Lines",
        "Working at Height & Scaffolding",
        "Excavation Safety",
        "Environmental & Health Provisions",
        "Confined Space",
        "Danger Zone / Line of Fire",
        "Cranes & Heavy Lifting",
        "Lifting & Rigging",
        "Housekeeping",
        "Human / Machine Interface (HMI)",
        "Welding, Cutting & Brazing",
        "Heat Stress",
        "Positive Observation",
        "Fall Hazards",
        "Health & Safety",
        "Ergonomic Position",
        "Slip, Trip & Fall Hazards",
        "Health & Welfare",
        "Other (please specify)",
    ],
    "speed_violation_type": ["ROW", "Public Road"],
    "detection_method": ["AI", "Manual"],
    "vehicle_type": ["Light Vehicle", "Heavy Vehicle", "Heavy Equipment"],
    "model": [
        "Pick-up",
        "SUV",
        "Hiace Van",
        "Ambulance",
        "Sedan",
        "Tractor Head",
        "Tipping Truck",
        "Coaster Bus",
        "Boom Truck",
        "Water Tanker",
        "Diesel Tanker",
        "Passenger Bus",
        "Dyna Truck",
        "Service Truck",
        "Dump Truck",
        "Oil Field Bed Truck",
        "Welding Truck",
        "Vacuum Tanker",
        "Concrete Mixer Truck",
        "Lube Truck",
        "Crane",
    ],
    "sos_source": ["Smart Helmet", "Smart Watch"],
    "itqan_violation_type": [
        "Speeding",
        "Using Mobile Phone",
        "Not Using Seat Belt",
        "Tampering with Device",
        "Negligence / Reckless Driving",
        "Distracted Driving",
    ],
    "itqan_status": [
        "Under Safety",
        "Under HR Action",
        "Under Payroll",
        "Under Announcement",
        "Finished",
    ],
    "scc_device_type": [
        "AI Camera",
        "Edge Server",
        "Router",
        "NVR",
        "Smart Helmet",
        "Smart Watch",
        "Weather Station",
        "GPS",
        "Dashcam",
        "Weight Sensor",
        "PWAS",
    ],
}

CONTACT_CATEGORIES = [
    "key_project_personnel",
    "scc_team",
    "safety_team",
    "emergency_contacts",
    "ert",
]


def new_item(label: str, sort_order: int) -> dict:
    return {
        "id": str(uuid4()),
        "label": label,
        "is_active": True,
        "sort_order": sort_order,
    }


def _as_item(row: ListItemRow) -> dict:
    return {
        "id": row.id,
        "label": row.label,
        "is_active": row.is_active,
        "sort_order": row.sort_order,
    }


class Catalog:
    def __init__(self, session_factory: sessionmaker[Session] | None = None) -> None:
        self._lock = Lock()
        self._session_factory = session_factory
        self._lists: dict[str, list[dict]] = {
            key: [new_item(label, index) for index, label in enumerate(labels)]
            for key, labels in LIST_SEEDS.items()
        }
        if session_factory is not None:
            self._seed_if_empty()

    def _seed_if_empty(self) -> None:
        assert self._session_factory is not None
        with self._session_factory() as session:
            existing = {row.list_type for row in session.query(ListItemRow.list_type).distinct()}
            for list_type, labels in LIST_SEEDS.items():
                if list_type in existing:
                    continue
                for index, label in enumerate(labels):
                    item = new_item(label, index)
                    session.add(
                        ListItemRow(
                            id=item["id"],
                            list_type=list_type,
                            label=item["label"],
                            is_active=True,
                            sort_order=index,
                        )
                    )
            session.commit()

    def types(self) -> list[str]:
        return list(LIST_SEEDS.keys())

    def get(self, list_type: str, *, active_only: bool = True) -> list[dict]:
        if self._session_factory is None:
            with self._lock:
                items = list(self._lists.get(list_type, []))
            if active_only:
                items = [item for item in items if item["is_active"]]
            return items
        with self._session_factory() as session:
            query = session.query(ListItemRow).filter(ListItemRow.list_type == list_type)
            if active_only:
                query = query.filter(ListItemRow.is_active.is_(True))
            rows = query.order_by(ListItemRow.sort_order, ListItemRow.label).all()
            return [_as_item(row) for row in rows]

    def add(self, list_type: str, label: str) -> dict:
        if list_type not in LIST_SEEDS:
            raise KeyError(list_type)
        clean = label.strip()
        if not clean:
            raise ValueError("A list value is required.")
        if self._session_factory is None:
            with self._lock:
                if any(item["label"].lower() == clean.lower() for item in self._lists[list_type]):
                    raise ValueError("That value is already on the list.")
                item = new_item(clean, len(self._lists[list_type]))
                self._lists[list_type].append(item)
            return item
        with self._lock, self._session_factory() as session:
            match = (
                session.query(ListItemRow)
                .filter(ListItemRow.list_type == list_type, ListItemRow.label == clean)
                .one_or_none()
            )
            if match:
                raise ValueError("That value is already on the list.")
            sort_order = session.query(ListItemRow).filter(ListItemRow.list_type == list_type).count()
            item = new_item(clean, sort_order)
            session.add(
                ListItemRow(
                    id=item["id"],
                    list_type=list_type,
                    label=item["label"],
                    is_active=True,
                    sort_order=item["sort_order"],
                )
            )
            session.commit()
            return item

    def get_item(self, list_type: str, item_id: str) -> dict | None:
        for item in self.get(list_type, active_only=False):
            if item["id"] == item_id:
                return item
        return None

    def update(
        self,
        list_type: str,
        item_id: str,
        label: str,
        *,
        is_active: bool | None = None,
    ) -> dict:
        if list_type not in LIST_SEEDS:
            raise KeyError(list_type)
        clean = label.strip()
        if not clean:
            raise ValueError("A list value is required.")
        if self._session_factory is None:
            with self._lock:
                for item in self._lists.get(list_type, []):
                    if item["id"] != item_id and item["label"].lower() == clean.lower():
                        raise ValueError("That value is already on the list.")
                for item in self._lists.get(list_type, []):
                    if item["id"] == item_id:
                        item["label"] = clean
                        if is_active is not None:
                            item["is_active"] = bool(is_active)
                        return dict(item)
            raise KeyError(item_id)
        with self._lock, self._session_factory() as session:
            row = session.get(ListItemRow, item_id)
            if not row or row.list_type != list_type:
                raise KeyError(item_id)
            clash = (
                session.query(ListItemRow)
                .filter(
                    ListItemRow.list_type == list_type,
                    ListItemRow.label == clean,
                    ListItemRow.id != item_id,
                )
                .one_or_none()
            )
            if clash:
                raise ValueError("That value is already on the list.")
            row.label = clean
            if is_active is not None:
                row.is_active = bool(is_active)
            session.commit()
            return _as_item(row)

    def delete(self, list_type: str, item_id: str) -> dict:
        if list_type not in LIST_SEEDS:
            raise KeyError(list_type)
        if self._session_factory is None:
            with self._lock:
                items = self._lists.get(list_type, [])
                for index, item in enumerate(items):
                    if item["id"] == item_id:
                        return items.pop(index)
            raise KeyError(item_id)
        with self._lock, self._session_factory() as session:
            row = session.get(ListItemRow, item_id)
            if not row or row.list_type != list_type:
                raise KeyError(item_id)
            item = _as_item(row)
            session.delete(row)
            session.commit()
            return item

    def label(self, list_type: str, item_id: str | None) -> str | None:
        if not item_id:
            return None
        item = self.get_item(list_type, item_id)
        return item["label"] if item else None
