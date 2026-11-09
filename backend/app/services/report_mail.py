"""Send monthly report packets (PDF/HTML + Excel/CSV) to Project PM distribution."""

from __future__ import annotations

import smtplib
from email.message import EmailMessage
from pathlib import Path
from datetime import datetime, timezone

from app.core.config import get_settings


def _outbox_dir() -> Path:
    root = Path(__file__).resolve().parents[2] / "data" / "outbox"
    root.mkdir(parents=True, exist_ok=True)
    return root


def send_report_email(
    *,
    to_email: str,
    to_name: str,
    subject: str,
    body: str,
    attachments: list[tuple[str, bytes, str]],
) -> dict:
    """Deliver attachments via SMTP when configured; otherwise write an outbox copy.

    Returns delivery metadata for the API/UI (mode, path, recipient).
    """
    to_email = (to_email or "").strip()
    if not to_email or "@" not in to_email:
        raise ValueError(
            "No valid email. Set Administration → Report schedule → Test email "
            "override / Distribution / Dept HSE email."
        )

    settings = get_settings()
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    safe_subject = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in subject)[:80]
    folder = _outbox_dir() / f"{stamp}_{safe_subject}"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "message.txt").write_text(
        f"To: {to_name} <{to_email}>\nSubject: {subject}\n\n{body}\n",
        encoding="utf-8",
    )
    for filename, content, _mime in attachments or []:
        (folder / filename).write_bytes(content)

    smtp_host = (settings.smtp_host or "").strip()
    if not smtp_host:
        return {
            "mode": "outbox",
            "to": to_email,
            "to_name": to_name,
            "outbox_path": str(folder),
            "message": (
                f"Issued. PDF/Excel packed for {to_email} "
                f"(saved under backend/data/outbox — add SMTP_HOST in backend/.env to email live)."
            ),
        }

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = (settings.smtp_from or settings.smtp_user or "scc-platform@localhost").strip()
    msg["To"] = f"{to_name} <{to_email}>" if to_name else to_email
    msg.set_content(body)
    for filename, content, mime in attachments or []:
        maintype, _, subtype = (mime or "application/octet-stream").partition("/")
        if not subtype:
            maintype, subtype = "application", "octet-stream"
        msg.add_attachment(
            content,
            maintype=maintype,
            subtype=subtype,
            filename=filename,
        )

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
        "to_name": to_name,
        "outbox_path": str(folder),
        "message": f"Sent to {to_email}",
    }


def send_report_ready_notice(
    *,
    to_email: str,
    to_name: str,
    kind: str,
    role_hint: str,
    reports: list[dict],
) -> dict:
    """Notify a reviewer that compiled report(s) are ready to sign.

    ``reports`` items: {id, scope, label}. One email can cover several projects.
    """
    kind_label = "weekly" if kind == "weekly" else "monthly"
    rows = [
        r
        for r in reports
        if isinstance(r, dict) and (r.get("id") or r.get("scope") or r.get("label"))
    ]
    if not rows:
        raise ValueError("No reports to include in the ready-to-sign notice.")

    if len(rows) == 1:
        only = rows[0]
        subject = (
            f"SCC {kind_label.title()} report ready to sign · "
            f"{only.get('scope') or 'project'} · {only.get('label') or only.get('id')}"
        )
        listing = (
            f"Report ID: {only.get('id') or '—'}\n"
            f"Project: {only.get('scope') or '—'}\n"
            f"Period: {only.get('label') or '—'}\n"
        )
        intro = (
            f"A {kind_label} SCC report is ready for review and digital signature "
            f"({role_hint}).\n\n"
        )
    else:
        subject = (
            f"SCC {kind_label.title()} reports ready to sign · "
            f"{len(rows)} projects"
        )
        listing = "\n".join(
            f"• {r.get('id') or '—'} · {r.get('scope') or '—'} · {r.get('label') or '—'}"
            for r in rows
        ) + "\n"
        intro = (
            f"{len(rows)} {kind_label} SCC reports are ready for review and digital "
            f"signature ({role_hint}).\n\n"
        )

    body = (
        f"Hello {to_name or 'team'},\n\n"
        f"{intro}"
        f"{listing}\n"
        "Open SCC Platform → Reports, find these reports, and click Sign to upload "
        "your signature.\n\n"
        "— SCC Platform\n"
    )
    return send_report_email(
        to_email=to_email,
        to_name=to_name or role_hint,
        subject=subject,
        body=body,
        attachments=[],
    )
