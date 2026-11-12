"""Isolated backup/restore drill for disposable SQLite + uploads only.

Never targets backend/data/scc_platform.db or operational uploads.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _manifest(root: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not root.exists():
        return out
    for path in sorted(root.rglob("*")):
        if path.is_file():
            out[str(path.relative_to(root)).replace("\\", "/")] = _sha256(path)
    return out


def main() -> int:
    import tempfile

    from app.db.engine import sqlite_file_url
    from app.services.platform_store import PlatformStore

    work = Path(tempfile.mkdtemp(prefix="scc_phase5_backup_"))
    try:
        src_db = work / "src" / "phase5.db"
        src_uploads = work / "src" / "uploads"
        src_db.parent.mkdir(parents=True)
        src_uploads.mkdir(parents=True)

        # Synthetic store (dev seeds OK for disposable drill)
        store = PlatformStore(database_url=sqlite_file_url(src_db))
        users = store.list_users()
        cases = store.list_cases()
        (src_uploads / "phase5_probe.bin").write_bytes(b"phase5-media-probe")

        backup = work / "backup"
        backup.mkdir()
        shutil.copy2(src_db, backup / "phase5.db")
        shutil.copytree(src_uploads, backup / "uploads")
        meta = {
            "users": len(users),
            "cases": len(cases),
            "db_sha256": _sha256(backup / "phase5.db"),
            "uploads": _manifest(backup / "uploads"),
        }
        (backup / "manifest.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")

        # Restore into a separate empty tree
        restore = work / "restore"
        restore.mkdir()
        shutil.copy2(backup / "phase5.db", restore / "phase5.db")
        shutil.copytree(backup / "uploads", restore / "uploads")

        restored = PlatformStore(database_url=sqlite_file_url(restore / "phase5.db"))
        r_users = restored.list_users()
        r_cases = restored.list_cases()
        restored_manifest = _manifest(restore / "uploads")

        ok = (
            len(r_users) == meta["users"]
            and len(r_cases) == meta["cases"]
            and _sha256(restore / "phase5.db") == meta["db_sha256"]
            and restored_manifest == meta["uploads"]
            and (restore / "uploads" / "phase5_probe.bin").read_bytes()
            == b"phase5-media-probe"
        )
        report = {
            "work_dir": str(work),
            "source_users": meta["users"],
            "source_cases": meta["cases"],
            "restored_users": len(r_users),
            "restored_cases": len(r_cases),
            "db_hash_match": _sha256(restore / "phase5.db") == meta["db_sha256"],
            "uploads_match": restored_manifest == meta["uploads"],
            "ok": ok,
            "note": "SQLite+local-uploads drill only; Replit object storage NOT VERIFIED",
        }
        print(json.dumps(report, indent=2))
        return 0 if ok else 1
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
