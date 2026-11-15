from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Environment-driven settings for the prototype API."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "SCC Platform API"
    app_env: str = "development"
    app_version: str = "0.1.0-prototype"
    cors_origins: str = Field(
        default="http://localhost:5173,http://127.0.0.1:5173"
    )
    storage_backend: str = "sqlite"
    database_url: str = ""

    # Demo data controls. When unset, production disables demo seeds; other
    # environments keep local/dev demo setup enabled.
    seed_demo_cases: bool | None = None
    seed_demo_users: bool | None = None
    # Synthetic HW counts, sample transfers, and named Key Personnel packs.
    # Independent of case demos so production can stay empty after cleanup.
    seed_demo_fixtures: bool | None = None

    # Server-side session lifetime (minutes). Validated on every auth check.
    session_ttl_minutes: int = Field(default=720, ge=5, le=60 * 24 * 30)
    # Short-lived attachment-only tokens for <img src> (not full API sessions).
    media_token_ttl_minutes: int = Field(default=120, ge=5, le=60 * 24)
    # When false, GET /uploads rejects legacy ?access_token= (full session in URL).
    # Production defaults to false; development keeps true for older clients.
    allow_legacy_upload_access_token: bool | None = None

    # Auth endpoint rate limit (per client IP + username key, per minute).
    auth_rate_limit_per_minute: int = Field(default=20, ge=3, le=600)

    # Optional absolute path to Vite `dist/` for production SPA serving.
    frontend_dist: str = ""
    # Override local upload directory (MEDIA_BACKEND=local only).
    upload_dir: str = ""
    # Media persistence: local filesystem | replit App Storage object API.
    # Replit App Storage is NOT a disk mount — use media_backend=replit on Replit.
    media_backend: str = "local"
    # Optional explicit App Storage bucket id (default bucket when empty).
    replit_bucket_id: str = ""
    # Object key prefix inside the bucket (always private; app ACL still applies).
    media_key_prefix: str = "uploads/"

    # Production bootstrap: create a single initial admin when the user table is
    # empty and demo user seeds are disabled. Password must satisfy strength rules.
    # Never commit real passwords; set via environment only.
    bootstrap_admin_username: str = ""
    bootstrap_admin_password: str = ""
    bootstrap_admin_display_name: str = "Admin"
    bootstrap_admin_badge: str = "A-001"

    # Optional SMTP for monthly report issue emails. When SMTP_HOST is empty,
    # attachments are written to backend/data/outbox/ instead.
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = ""
    smtp_tls: bool = True

    @property
    def is_production(self) -> bool:
        return self.app_env.lower() in {"production", "prod"}

    @property
    def demo_cases_enabled(self) -> bool:
        if self.seed_demo_cases is not None:
            return bool(self.seed_demo_cases)
        return not self.is_production

    @property
    def demo_users_enabled(self) -> bool:
        if self.seed_demo_users is not None:
            return bool(self.seed_demo_users)
        return not self.is_production

    @property
    def demo_fixtures_enabled(self) -> bool:
        """HW inventory/department matrices, sample transfers, named KP packs."""
        if self.seed_demo_fixtures is not None:
            return bool(self.seed_demo_fixtures)
        return not self.is_production

    @property
    def legacy_upload_access_token_allowed(self) -> bool:
        if self.allow_legacy_upload_access_token is not None:
            return bool(self.allow_legacy_upload_access_token)
        return not self.is_production

    @property
    def cors_origin_list(self) -> list[str]:
        origins = [item.strip() for item in self.cors_origins.split(",") if item.strip()]
        if self.app_env.lower() == "production" and (
            not origins or origins == ["*"]
        ):
            raise ValueError(
                "CORS_ORIGINS must be an explicit allow-list in production; "
                "wildcard origins are not permitted."
            )
        return origins


@lru_cache
def get_settings() -> Settings:
    return Settings()
