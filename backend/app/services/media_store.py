"""Media persistence backends: local disk or Replit App Storage (object API).

Replit App Storage is NOT a filesystem mount. Use the official Python SDK
(`replit.object_storage.Client`) when MEDIA_BACKEND=replit.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path
from typing import Final

_DEFAULT_UPLOAD_DIR: Final = Path(__file__).resolve().parents[2] / "data" / "uploads"


class MediaStore(ABC):
    """Byte-oriented media store keyed by safe stored_name (uuid + ext)."""

    @property
    @abstractmethod
    def backend_name(self) -> str: ...

    @abstractmethod
    def ensure_ready(self) -> None:
        """Create local dirs or verify object-storage reachability."""

    @abstractmethod
    def put_bytes(self, stored_name: str, data: bytes) -> None: ...

    @abstractmethod
    def get_bytes(self, stored_name: str) -> bytes | None: ...

    @abstractmethod
    def exists(self, stored_name: str) -> bool: ...

    @abstractmethod
    def delete(self, stored_name: str) -> None: ...

    @abstractmethod
    def probe_writable(self) -> None:
        """Raise if writes are not possible (used by /ready)."""


class LocalMediaStore(MediaStore):
    def __init__(self, root: Path | None = None) -> None:
        self._root = (root or _configured_local_root()).expanduser().resolve()

    @property
    def backend_name(self) -> str:
        return "local"

    @property
    def root(self) -> Path:
        return self._root

    def ensure_ready(self) -> None:
        self._root.mkdir(parents=True, exist_ok=True)

    def _path(self, stored_name: str) -> Path:
        return self._root / stored_name

    def put_bytes(self, stored_name: str, data: bytes) -> None:
        self.ensure_ready()
        dest = self._path(stored_name)
        dest.write_bytes(data)

    def get_bytes(self, stored_name: str) -> bytes | None:
        path = self._path(stored_name)
        if not path.is_file():
            return None
        return path.read_bytes()

    def exists(self, stored_name: str) -> bool:
        return self._path(stored_name).is_file()

    def delete(self, stored_name: str) -> None:
        self._path(stored_name).unlink(missing_ok=True)

    def probe_writable(self) -> None:
        self.ensure_ready()
        probe = self._root / ".ready_probe"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink(missing_ok=True)


class ReplitObjectMediaStore(MediaStore):
    """Private Replit App Storage via object API (not a disk mount)."""

    def __init__(
        self,
        *,
        bucket_id: str | None = None,
        key_prefix: str = "uploads/",
    ) -> None:
        self._bucket_id = (bucket_id or "").strip() or None
        prefix = (key_prefix or "uploads/").strip() or "uploads/"
        if not prefix.endswith("/"):
            prefix = f"{prefix}/"
        self._prefix = prefix
        self._client = None

    @property
    def backend_name(self) -> str:
        return "replit"

    def _object_key(self, stored_name: str) -> str:
        return f"{self._prefix}{stored_name}"

    def _get_client(self):
        if self._client is not None:
            return self._client
        try:
            from replit.object_storage import Client
        except ImportError as exc:  # pragma: no cover - optional dep off-Replit
            raise RuntimeError(
                "MEDIA_BACKEND=replit requires package replit-object-storage. "
                "Install it in the Replit environment."
            ) from exc
        self._client = Client(bucket_id=self._bucket_id) if self._bucket_id else Client()
        return self._client

    def ensure_ready(self) -> None:
        # Touch client construction; listing with max_results=1 validates access.
        client = self._get_client()
        client.list(prefix=self._prefix, max_results=1)

    def put_bytes(self, stored_name: str, data: bytes) -> None:
        self._get_client().upload_from_bytes(self._object_key(stored_name), data)

    def get_bytes(self, stored_name: str) -> bytes | None:
        client = self._get_client()
        key = self._object_key(stored_name)
        try:
            if not client.exists(key):
                return None
            return client.download_as_bytes(key)
        except Exception:
            # Some SDK versions raise instead of exists=False.
            try:
                return client.download_as_bytes(key)
            except Exception:
                return None

    def exists(self, stored_name: str) -> bool:
        try:
            return bool(self._get_client().exists(self._object_key(stored_name)))
        except Exception:
            return self.get_bytes(stored_name) is not None

    def delete(self, stored_name: str) -> None:
        try:
            self._get_client().delete(
                self._object_key(stored_name), ignore_not_found=True
            )
        except TypeError:
            # Older SDKs may lack ignore_not_found.
            try:
                self._get_client().delete(self._object_key(stored_name))
            except Exception:
                pass

    def probe_writable(self) -> None:
        client = self._get_client()
        key = f"{self._prefix}.ready_probe"
        client.upload_from_text(key, "ok")
        try:
            client.delete(key, ignore_not_found=True)
        except TypeError:
            try:
                client.delete(key)
            except Exception:
                pass


def _configured_local_root() -> Path:
    try:
        from app.core.config import get_settings

        raw = (get_settings().upload_dir or "").strip()
        if raw:
            return Path(raw).expanduser().resolve()
    except Exception:
        pass
    return _DEFAULT_UPLOAD_DIR


def build_media_store() -> MediaStore:
    from app.core.config import get_settings

    settings = get_settings()
    backend = (settings.media_backend or "local").strip().lower()
    if backend in {"replit", "replit_object", "object", "app_storage"}:
        return ReplitObjectMediaStore(
            bucket_id=settings.replit_bucket_id or None,
            key_prefix=settings.media_key_prefix or "uploads/",
        )
    return LocalMediaStore()


_STORE: MediaStore | None = None


def get_media_store() -> MediaStore:
    global _STORE
    if _STORE is None:
        _STORE = build_media_store()
    return _STORE


def reset_media_store_cache() -> None:
    """Drop cached store after env/settings changes (tests / startup)."""
    global _STORE
    _STORE = None
