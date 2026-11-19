"""SMTP helper for password-recovery email.

Recovery codes are secrets: this module never writes message bodies to disk and
never logs them. If SMTP is unavailable it fails instead of pretending to send.
"""

from __future__ import annotations

import logging
import smtplib
import ssl
from email.message import EmailMessage

from app.core.config import get_settings

logger = logging.getLogger(__name__)


class MailDeliveryError(RuntimeError):
    """Email could not be delivered. The message is safe to show to users."""


def smtp_configured() -> bool:
    return bool((get_settings().smtp_host or "").strip())


def send_plain_email(
    *,
    to_email: str,
    to_name: str,
    subject: str,
    body: str,
) -> None:
    """Send one email over SMTP, or raise MailDeliveryError."""
    to_email = (to_email or "").strip()
    if not to_email or "@" not in to_email:
        raise MailDeliveryError("No valid email address.")

    settings = get_settings()
    smtp_host = (settings.smtp_host or "").strip()
    if not smtp_host:
        raise MailDeliveryError("Email delivery is not configured.")

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = (
        settings.smtp_from or settings.smtp_user or "scc-platform@localhost"
    ).strip()
    msg["To"] = f"{to_name} <{to_email}>" if to_name else to_email
    msg.set_content(body)

    port = int(settings.smtp_port or 587)
    try:
        with smtplib.SMTP(smtp_host, port, timeout=30) as smtp:
            if settings.smtp_tls:
                smtp.starttls(context=ssl.create_default_context())
            user = (settings.smtp_user or "").strip()
            if user:
                smtp.login(user, (settings.smtp_password or "").strip())
            smtp.send_message(msg)
    except (smtplib.SMTPException, OSError) as exc:
        # Log only the exception type: never the message, recipient or credentials.
        logger.error("Recovery email delivery failed (%s).", type(exc).__name__)
        raise MailDeliveryError("Email delivery failed.") from None
