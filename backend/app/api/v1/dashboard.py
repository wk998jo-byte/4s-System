from datetime import datetime, timezone

from fastapi import APIRouter, Depends

from app.api.deps import get_record_store
from app.schemas.dashboard import DashboardKpis, DashboardSummary
from app.services.record_store import InMemoryRecordStore

router = APIRouter(tags=["Dashboard"])

LIMITATIONS = [
    "Unauthenticated prototype. Login is not implemented until the company confirms the method.",
    "Counts come from an in-memory store and reset when the backend restarts.",
    "Generic test records only — not AI Camera, DashCam, Speed, or SOS operational cases.",
    "This summary is not the full SCC dashboard specified in requirements §8.",
]


@router.get("/dashboard/summary", response_model=DashboardSummary)
def dashboard_summary(
    record_store: InMemoryRecordStore = Depends(get_record_store),
) -> DashboardSummary:
    status_counts = record_store.counts_by_status()
    return DashboardSummary(
        prototype=True,
        storage=record_store.storage_label(),
        authentication="disabled",
        generated_at=datetime.now(timezone.utc),
        kpis=DashboardKpis(
            total_records=status_counts["total_records"],
            open=status_counts["open"],
            under_process=status_counts["under_process"],
            closed=status_counts["closed"],
        ),
        by_module=record_store.counts_by_module(),
        limitations=LIMITATIONS,
    )
