from pathlib import Path

from sqlalchemy import URL, create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.db import models  # noqa: F401


def sqlite_file_url(path: Path) -> str:
    return URL.create("sqlite", database=str(path.resolve())).render_as_string(
        hide_password=False
    )


def default_sqlite_url() -> str:
    data_dir = Path(__file__).resolve().parents[2] / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    return sqlite_file_url(data_dir / "scc_platform.db")


def make_engine(url: str) -> Engine:
    kwargs: dict = {"future": True}
    if url.startswith("sqlite"):
        kwargs["connect_args"] = {"check_same_thread": False}
        if ":memory:" in url:
            kwargs["poolclass"] = StaticPool
    return create_engine(url, **kwargs)


def _migrate_sqlite(engine: Engine) -> None:
    if engine.dialect.name != "sqlite":
        return
    with engine.begin() as conn:
        case_cols = conn.execute(text("PRAGMA table_info(cases)")).fetchall()
        case_names = {row[1] for row in case_cols}
        if case_names and "is_deleted" not in case_names:
            conn.execute(
                text("ALTER TABLE cases ADD COLUMN is_deleted BOOLEAN DEFAULT 0 NOT NULL")
            )
        user_cols = conn.execute(text("PRAGMA table_info(users)")).fetchall()
        user_names = {row[1] for row in user_cols}
        if user_names and "badge_number" not in user_names:
            conn.execute(text("ALTER TABLE users ADD COLUMN badge_number VARCHAR(80)"))
        if user_names and "projects" not in user_names:
            conn.execute(text("ALTER TABLE users ADD COLUMN projects JSON"))


def make_session_factory(engine: Engine) -> sessionmaker[Session]:
    Base.metadata.create_all(engine)
    _migrate_sqlite(engine)
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)
