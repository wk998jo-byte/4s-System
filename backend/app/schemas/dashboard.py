from datetime import datetime

from pydantic import BaseModel


class DashboardKpis(BaseModel):
    total_records: int
    open: int
    under_process: int
    closed: int


class DashboardSummary(BaseModel):
    """Prototype dashboard payload derived from the current store.

    Not the full SCC dashboard specified in requirements §8.
    """

    prototype: bool = True
    storage: str
    authentication: str = "disabled"
    generated_at: datetime
    kpis: DashboardKpis
    by_module: dict[str, int]
    limitations: list[str]
