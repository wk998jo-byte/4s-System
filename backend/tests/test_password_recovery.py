"""Password recovery: isolated tests (temp DB, fake SMTP, disposable users only)."""

import logging
import re
import smtplib
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

import app.services.mailer as mailer_module
from app.core.config import get_settings
from app.db.models import AppStateRow, SessionRow, UserRow
from app.main import create_app
from app.services.auth import hash_password
from tests.test_data_accuracy import store  # noqa: F401 (isolated temp-DB fixture)
from tests.test_phase4_production import _patch_store

OLD_PASSWORD = "OldPassword2026!"
NEW_PASSWORD = "BrandNewPass2026!"
SMTP_SECRET = "smtp-secret-do-not-leak-4821"
ENDPOINT = "/api/v1/auth/password-recovery"
NEUTRAL = "If the account details match, a recovery code will be emailed shortly."
RESET_ERROR = "Invalid or expired recovery code. Request a new code."


def _outbox_listing() -> list[str]:
    root = Path(mailer_module.__file__).resolve().parents[2] / "data" / "outbox"
    return sorted(p.name for p in root.iterdir()) if root.exists() else []


class FakeSMTP:
    """Records messages; never opens a socket."""

    sent: list[dict] = []
    fail_with: Exception | None = None

    def __init__(self, host, port, timeout=None):
        self.host, self.port = host, port

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def starttls(self, context=None):
        assert context is not None, "STARTTLS must verify certificates"

    def login(self, user, password):
        assert password == SMTP_SECRET

    def send_message(self, msg):
        if FakeSMTP.fail_with is not None:
            raise FakeSMTP.fail_with
        FakeSMTP.sent.append(
            {"to": str(msg["To"]), "subject": str(msg["Subject"]), "body": msg.get_content()}
        )


@pytest.fixture()
def rec(store, monkeypatch):  # noqa: F811
    FakeSMTP.sent = []
    FakeSMTP.fail_with = None
    monkeypatch.setenv("SMTP_HOST", "smtp.test.invalid")
    monkeypatch.setenv("SMTP_USER", "sender@test.invalid")
    monkeypatch.setenv("SMTP_PASSWORD", SMTP_SECRET)
    monkeypatch.setenv("SMTP_FROM", "sender@test.invalid")
    monkeypatch.setenv("FRONTEND_DIST", "")
    monkeypatch.setattr(smtplib, "SMTP", FakeSMTP)
    monkeypatch.setattr("app.services.rate_limit._auth_limiter", None)
    get_settings.cache_clear()
    _patch_store(monkeypatch, store)
    digest = hash_password(OLD_PASSWORD)
    with store._sessions() as session:
        session.add(UserRow(
            id="rec-user", username="rec-user", display_name="Recovery Tester",
            role="operator", projects=["Yanbu"], password_hash=digest, is_active=True,
            email="Rec.User@Test.Invalid",
        ))
        session.add(UserRow(
            id="rec-other", username="rec-other", display_name="Other Tester",
            role="operator", projects=["Yanbu"], password_hash=digest, is_active=True,
            email="other@test.invalid",
        ))
        session.add(UserRow(
            id="rec-off", username="rec-off", display_name="Inactive Tester",
            role="operator", projects=["Yanbu"], password_hash=digest, is_active=False,
            email="off@test.invalid",
        ))
        session.commit()
    outbox_before = _outbox_listing()
    yield SimpleNamespace(
        client=TestClient(create_app()), store=store, outbox_before=outbox_before
    )
    get_settings.cache_clear()


def _request(rec, username="rec-user", email="rec.user@test.invalid"):
    return rec.client.post(
        f"{ENDPOINT}/request", json={"username": username, "email": email}
    )


def _reset(rec, code, password=NEW_PASSWORD, username="rec-user", email="rec.user@test.invalid"):
    return rec.client.post(
        f"{ENDPOINT}/reset",
        json={"username": username, "email": email, "code": code, "new_password": password},
    )


def _last_code() -> str:
    match = re.search(r"code is: (\d{6})\b", FakeSMTP.sent[-1]["body"])
    assert match, "recovery email must contain the six-digit code"
    return match.group(1)


def _entry(rec, username="rec-user"):
    with rec.store._sessions() as session:
        state = session.get(AppStateRow, "password_recovery")
        return dict((state.value or {}).get(username) or {}) if state else {}


def _patch_entry(rec, **changes):
    with rec.store._sessions() as session:
        state = session.get(AppStateRow, "password_recovery")
        value = dict(state.value)
        value["rec-user"] = {**value["rec-user"], **changes}
        state.value = value
        from sqlalchemy.orm.attributes import flag_modified

        flag_modified(state, "value")
        session.commit()


def _login_ok(rec, password) -> bool:
    return (
        rec.client.post(
            "/api/v1/auth/login", json={"username": "rec-user", "password": password}
        ).status_code
        == 200
    )


# --- sending -----------------------------------------------------------------


def test_sends_six_digit_code_by_smtp_without_local_files_or_leaks(rec, caplog):
    caplog.set_level(logging.DEBUG)
    response = _request(rec)
    assert response.status_code == 200
    assert response.json() == {"ok": True, "message": NEUTRAL}

    assert len(FakeSMTP.sent) == 1
    mail = FakeSMTP.sent[0]
    assert "rec.user@test.invalid" in mail["to"].lower()
    code = _last_code()
    assert re.fullmatch(r"\d{6}", code)
    assert "15 minutes" in mail["body"]

    # Only a hash is stored, expiring in 15 minutes, never the code itself.
    entry = _entry(rec)
    assert code not in str(entry) and entry["code_hash"] != code
    expires = datetime.fromisoformat(entry["expires_at"])
    assert timedelta(minutes=14) < expires - datetime.now(timezone.utc) <= timedelta(minutes=15)

    # No outbox files, and nothing sensitive in the response or the logs.
    assert _outbox_listing() == rec.outbox_before
    leaked = response.text + caplog.text
    for secret in (code, SMTP_SECRET, "outbox"):
        assert secret not in leaked


# --- failed delivery ----------------------------------------------------------


def test_unavailable_smtp_in_production_fails_safely(rec, monkeypatch, caplog):
    caplog.set_level(logging.DEBUG)
    # The app object already exists (create_app refuses SQLite in production);
    # request handlers read settings per call, so flipping the env is enough.
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("SMTP_HOST", "")
    get_settings.cache_clear()
    assert get_settings().is_production
    client = rec.client
    for username, email in (("rec-user", "rec.user@test.invalid"), ("nobody", "x@test.invalid")):
        response = client.post(
            f"{ENDPOINT}/request", json={"username": username, "email": email}
        )
        # Same failure for every account: does not disclose which exist.
        assert response.status_code == 503
        assert "sent" not in response.text.lower()
    assert FakeSMTP.sent == []
    assert _entry(rec) == {}
    assert _outbox_listing() == rec.outbox_before
    assert SMTP_SECRET not in caplog.text


def test_smtp_failure_discards_code_and_discloses_nothing(rec, caplog):
    caplog.set_level(logging.DEBUG)
    FakeSMTP.fail_with = smtplib.SMTPAuthenticationError(535, SMTP_SECRET.encode())
    valid = _request(rec)
    unknown = _request(rec, username="nobody", email="nobody@test.invalid")
    assert valid.status_code == unknown.status_code == 200
    assert valid.json() == unknown.json() == {"ok": True, "message": NEUTRAL}
    assert FakeSMTP.sent == []
    assert _entry(rec) == {}, "an undeliverable code must not stay valid"
    assert _outbox_listing() == rec.outbox_before
    assert SMTP_SECRET not in caplog.text and SMTP_SECRET not in valid.text


# --- non-disclosure -----------------------------------------------------------


def test_responses_do_not_reveal_whether_account_exists(rec):
    requests = [
        _request(rec),
        _request(rec, username="nobody", email="nobody@test.invalid"),
        _request(rec, email="wrong@test.invalid"),
        _request(rec, username="rec-off", email="off@test.invalid"),
        _request(rec, username="rec-user", email="not-an-email"),
    ]
    assert {(r.status_code, r.text) for r in requests} == {
        (200, '{"ok":true,"message":"' + NEUTRAL + '"}')
    }
    assert len(FakeSMTP.sent) == 1  # only the valid account received mail
    _patch_entry(rec, requested_at=(datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat())

    failures = [
        _reset(rec, "000000"),  # valid account, wrong code
        _reset(rec, "123456", username="nobody", email="nobody@test.invalid"),
        _reset(rec, "123456", username="rec-other", email="other@test.invalid"),  # no pending code
        _reset(rec, "123456", username="rec-off", email="off@test.invalid"),
    ]
    assert {(r.status_code, r.json()["error"]["message"]) for r in failures} == {(400, RESET_ERROR)}


# --- expiry / wrong codes / replay ----------------------------------------------


def test_expired_code_is_rejected_and_cleared(rec):
    _request(rec)
    code = _last_code()
    _patch_entry(rec, expires_at=(datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat())
    response = _reset(rec, code)
    assert response.status_code == 400 and response.json()["error"]["message"] == RESET_ERROR
    assert _entry(rec) == {}
    assert _login_ok(rec, OLD_PASSWORD) and not _login_ok(rec, NEW_PASSWORD)


def test_five_incorrect_codes_lock_out_even_the_right_code(rec):
    _request(rec)
    code = _last_code()
    wrong = "000000" if code != "000000" else "111111"
    for attempt in range(1, 6):
        assert _reset(rec, wrong).status_code == 400
        assert _entry(rec)["attempts"] == attempt
    locked = _reset(rec, code)
    assert locked.status_code == 400 and locked.json()["error"]["message"] == RESET_ERROR
    assert _entry(rec) == {}
    assert _login_ok(rec, OLD_PASSWORD) and not _login_ok(rec, NEW_PASSWORD)


def test_right_code_with_wrong_email_counts_as_an_attempt(rec):
    _request(rec)
    code = _last_code()
    response = _reset(rec, code, email="other@test.invalid")
    assert response.status_code == 400 and response.json()["error"]["message"] == RESET_ERROR
    assert _entry(rec)["attempts"] == 1
    assert _login_ok(rec, OLD_PASSWORD)


def test_weak_password_does_not_consume_the_code(rec):
    _request(rec)
    code = _last_code()
    assert _reset(rec, code, password="short").status_code == 400
    assert _entry(rec)["attempts"] == 0
    assert _reset(rec, code).status_code == 200


def test_code_is_single_use_replay_is_rejected(rec):
    _request(rec)
    code = _last_code()
    assert _reset(rec, code).status_code == 200
    assert _entry(rec) == {}
    replay = _reset(rec, code, password="AnotherNewPass2026!")
    assert replay.status_code == 400 and replay.json()["error"]["message"] == RESET_ERROR
    assert _login_ok(rec, NEW_PASSWORD)
    assert not _login_ok(rec, "AnotherNewPass2026!") and not _login_ok(rec, OLD_PASSWORD)


def test_re_requesting_cannot_reset_the_attempt_counter(rec):
    _request(rec)
    code = _last_code()
    wrong = "000000" if code != "000000" else "111111"
    for _ in range(3):
        _reset(rec, wrong)
    again = _request(rec)  # inside the resend cooldown
    assert again.json() == {"ok": True, "message": NEUTRAL}
    assert len(FakeSMTP.sent) == 1, "no second email inside the cooldown"
    assert _entry(rec)["attempts"] == 3
    # After the cooldown a genuinely new code is issued.
    _patch_entry(rec, requested_at=(datetime.now(timezone.utc) - timedelta(minutes=2)).isoformat())
    _request(rec)
    assert len(FakeSMTP.sent) == 2 and _entry(rec)["attempts"] == 0


# --- session revocation ------------------------------------------------------------


def test_successful_reset_revokes_api_and_media_sessions(rec):
    session_a = rec.client.post(
        "/api/v1/auth/login", json={"username": "rec-user", "password": OLD_PASSWORD}
    ).json()
    session_b = rec.client.post(
        "/api/v1/auth/login", json={"username": "rec-user", "password": OLD_PASSWORD}
    ).json()
    other = rec.client.post(
        "/api/v1/auth/login", json={"username": "rec-other", "password": OLD_PASSWORD}
    ).json()
    bearer = {"Authorization": f"Bearer {session_a['access_token']}"}
    assert rec.client.get("/api/v1/auth/me", headers=bearer).status_code == 200
    assert rec.store.user_from_token(session_a["media_token"], allow_media=True)

    _request(rec)
    assert _reset(rec, _last_code()).status_code == 200

    for s in (session_a, session_b):
        headers = {"Authorization": f"Bearer {s['access_token']}"}
        assert rec.client.get("/api/v1/auth/me", headers=headers).status_code == 401
        assert rec.store.user_from_token(s["access_token"]) is None
        assert rec.store.user_from_token(s["media_token"], allow_media=True) is None
    with rec.store._sessions() as session:
        left = session.scalars(select(SessionRow).where(SessionRow.user_id == "rec-user")).all()
    assert left == []
    # Other users are unaffected.
    other_headers = {"Authorization": f"Bearer {other['access_token']}"}
    assert rec.client.get("/api/v1/auth/me", headers=other_headers).status_code == 200
    assert _login_ok(rec, NEW_PASSWORD)
