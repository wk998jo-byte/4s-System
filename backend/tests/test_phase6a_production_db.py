"""Phase 6A: production database URL safety (no live PG required)."""

from __future__ import annotations

import pytest

from app.core.config import get_settings
from app.db.engine import resolve_database_url


def test_production_requires_postgres_url(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("CORS_ORIGINS", "https://example.replit.app")
    monkeypatch.setenv("DATABASE_URL", "")
    get_settings.cache_clear()
    with pytest.raises(RuntimeError, match="DATABASE_URL"):
        resolve_database_url()
    get_settings.cache_clear()


def test_production_rejects_sqlite_url(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("CORS_ORIGINS", "https://example.replit.app")
    monkeypatch.setenv("DATABASE_URL", "sqlite+pysqlite:///./data/scc_platform.db")
    get_settings.cache_clear()
    with pytest.raises(RuntimeError, match="forbids SQLite"):
        resolve_database_url()
    get_settings.cache_clear()


def test_dev_falls_back_to_sqlite(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.delenv("DATABASE_URL", raising=False)
    get_settings.cache_clear()
    url = resolve_database_url("")
    assert url.startswith("sqlite")
    get_settings.cache_clear()
