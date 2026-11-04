"""Prototype record storage.

Current implementation: process-local in-memory list.

Limitations (explicit):
- Records disappear when the backend process restarts.
- Not suitable for production.
- Not PostgreSQL. A later milestone should implement the same
  RecordStore protocol against PostgreSQL (see DATABASE_DESIGN.md).
"""

from __future__ import annotations

from datetime import datetime, timezone
from threading import Lock
from typing import Protocol
from uuid import UUID, uuid4

from app.schemas.records import (
    PrototypeModule,
    PrototypeRecord,
    PrototypeRecordCreate,
    PrototypeStatus,
)


class RecordStore(Protocol):
    def list_records(self, page: int, page_size: int) -> tuple[list[PrototypeRecord], int]:
        ...

    def get_record(self, record_id: UUID) -> PrototypeRecord | None:
        ...

    def create_record(self, payload: PrototypeRecordCreate) -> PrototypeRecord:
        ...

    def counts_by_status(self) -> dict[str, int]:
        ...

    def counts_by_module(self) -> dict[str, int]:
        ...

    def storage_label(self) -> str:
        ...


class InMemoryRecordStore:
    """Demonstration store only. Replace with a PostgreSQL implementation."""

    def __init__(self) -> None:
        self._lock = Lock()
        self._records: list[PrototypeRecord] = []

    def storage_label(self) -> str:
        return "in_memory"

    def list_records(self, page: int, page_size: int) -> tuple[list[PrototypeRecord], int]:
        with self._lock:
            ordered = sorted(self._records, key=lambda item: item.created_at, reverse=True)
            total = len(ordered)
            start = (page - 1) * page_size
            end = start + page_size
            return ordered[start:end], total

    def get_record(self, record_id: UUID) -> PrototypeRecord | None:
        with self._lock:
            for item in self._records:
                if item.id == record_id:
                    return item
        return None

    def create_record(self, payload: PrototypeRecordCreate) -> PrototypeRecord:
        record = PrototypeRecord(
            id=uuid4(),
            title=payload.title.strip(),
            module_type=payload.module_type,
            status=payload.status,
            notes=payload.notes.strip() if payload.notes else None,
            created_at=datetime.now(timezone.utc),
            prototype=True,
        )
        with self._lock:
            self._records.append(record)
        return record

    def counts_by_status(self) -> dict[str, int]:
        with self._lock:
            counts = {
                "total_records": len(self._records),
                "open": 0,
                "under_process": 0,
                "closed": 0,
            }
            for item in self._records:
                counts[item.status.value] += 1
            return counts

    def counts_by_module(self) -> dict[str, int]:
        with self._lock:
            counts = {module.value: 0 for module in PrototypeModule}
            for item in self._records:
                counts[item.module_type.value] += 1
            return counts


# Process-wide prototype store. Tests should construct their own instance.
store = InMemoryRecordStore()
