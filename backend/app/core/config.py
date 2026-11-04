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
