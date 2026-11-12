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


def resolve_database_url(configured: str | None = None) -> str:
    """Resolve the active DB URL with production safety rules.

    Production must use PostgreSQL via DATABASE_URL — never fall back to SQLite.
    """
    from app.core.config import get_settings

    settings = get_settings()
    url = (configured if configured is not None else settings.database_url or "").strip()
    if settings.is_production:
        if not url:
            raise RuntimeError(
                "Production requires DATABASE_URL pointing at PostgreSQL."
            )
        lowered = url.lower()
        if lowered.startswith("sqlite") or "scc_platform.db" in lowered:
            raise RuntimeError(
                "Production forbids SQLite DATABASE_URL; configure PostgreSQL."
            )
        if not (
            lowered.startswith("postgresql")
            or lowered.startswith("postgres")
        ):
            raise RuntimeError(
                "Production DATABASE_URL must use a PostgreSQL dialect "
                "(postgresql+psycopg://…)."
            )
        return url
    return url or default_sqlite_url()


def make_engine(url: str) -> Engine:
    kwargs: dict = {"future": True}
    if url.startswith("sqlite"):
        kwargs["connect_args"] = {"check_same_thread": False}
        if ":memory:" in url:
            kwargs["poolclass"] = StaticPool
    elif url.startswith("postgresql") or url.startswith("postgres"):
        # Recycle dead connections after Replit / proxy idle timeouts.
        kwargs["pool_pre_ping"] = True
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
        if user_names and "email" not in user_names:
            conn.execute(text("ALTER TABLE users ADD COLUMN email VARCHAR(200)"))
        if user_names and "must_change_password" not in user_names:
            conn.execute(
                text(
                    "ALTER TABLE users ADD COLUMN must_change_password "
                    "BOOLEAN DEFAULT 0 NOT NULL"
                )
            )
        session_cols = conn.execute(text("PRAGMA table_info(sessions)")).fetchall()
        session_names = {row[1] for row in session_cols}
        if session_names and "expires_at" not in session_names:
            conn.execute(text("ALTER TABLE sessions ADD COLUMN expires_at DATETIME"))
        if session_names and "purpose" not in session_names:
            conn.execute(
                text(
                    "ALTER TABLE sessions ADD COLUMN purpose VARCHAR(16) "
                    "DEFAULT 'api' NOT NULL"
                )
            )


def make_session_factory(engine: Engine) -> sessionmaker[Session]:
    Base.metadata.create_all(engine)
    _migrate_sqlite(engine)
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)
