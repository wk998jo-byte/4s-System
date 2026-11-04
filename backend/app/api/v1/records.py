from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.deps import get_record_store
from app.schemas.records import (
    PrototypeRecord,
    PrototypeRecordCreate,
    PrototypeRecordList,
)
from app.services.record_store import InMemoryRecordStore

router = APIRouter(tags=["Prototype records"])


@router.get("/records", response_model=PrototypeRecordList)
def list_records(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    record_store: InMemoryRecordStore = Depends(get_record_store),
) -> PrototypeRecordList:
    items, total = record_store.list_records(page=page, page_size=page_size)
    return PrototypeRecordList(
        items=items,
        page=page,
        page_size=page_size,
        total=total,
        storage=record_store.storage_label(),
        prototype=True,
    )


@router.post("/records", response_model=PrototypeRecord, status_code=201)
def create_record(
    payload: PrototypeRecordCreate,
    record_store: InMemoryRecordStore = Depends(get_record_store),
) -> PrototypeRecord:
    return record_store.create_record(payload)


@router.get("/records/{record_id}", response_model=PrototypeRecord)
def get_record(
    record_id: UUID,
    record_store: InMemoryRecordStore = Depends(get_record_store),
):
    record = record_store.get_record(record_id)
    if record is None:
        raise HTTPException(
            status_code=404,
            detail=f"No prototype record exists with id {record_id}.",
        )
    return record
