"""Small SMTP / outbox helper for non-report emails (e.g. password recovery)."""

from __future__ import annotations

import smtplib
from datetime import datetime, timezone
from email.message import EmailMessage
from pathlib import Path

from app.core.config import get_settings


def _outbox_dir() -> Path:
    root = Path(__file__).resolve().parents[2] / "data" / "outbox"
    root.mkdir(parents=True, exist_ok=True)
    return root


def send_plain_email(
    *,
    to_email: str,
    to_name: str,
    subject: str,
    body: str,
) -> dict:
    to_email = (to_email or "").strip()
    if not to_email or "@" not in to_email:
        raise ValueError("No valid email address.")

    settings = get_settings()
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    safe_subject = "".join(
        ch if ch.isalnum() or ch in "-_" else "_" for ch in subject
    )[:80]
    folder = _outbox_dir() / f"{stamp}_{safe_subject}"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "message.txt").write_text(
        f"To: {to_name} <{to_email}>\nSubject: {subject}\n\n{body}\n",
        encoding="utf-8",
    )

    smtp_host = (settings.smtp_host or "").strip()
    if not smtp_host:
        return {
            "mode": "outbox",
            "to": to_email,
            "outbox_path": str(folder),
            "message": (
                f"Saved under backend/data/outbox "
                f"(set SMTP_HOST in backend/.env to email live)."
            ),
        }

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = (
        settings.smtp_from or settings.smtp_user or "scc-platform@localhost"
    ).strip()
    msg["To"] = f"{to_name} <{to_email}>" if to_name else to_email
    msg.set_content(body)

    port = int(settings.smtp_port or 587)
    use_tls = bool(settings.smtp_tls)
    with smtplib.SMTP(smtp_host, port, timeout=30) as smtp:
        if use_tls:
            smtp.starttls()
        user = (settings.smtp_user or "").strip()
        password = (settings.smtp_password or "").strip()
        if user:
            smtp.login(user, password)
        smtp.send_message(msg)

    return {
        "mode": "smtp",
        "to": to_email,
        "outbox_path": str(folder),
        "message": f"Sent to {to_email}",
    }
