"""Platform accounts for the prototype (SSO is still unconfirmed)."""

from __future__ import annotations

import hashlib
import secrets

ROLES = ("admin", "operator", "dept_hse", "receiver")

ROLE_LABELS = {
    "admin": "Admin",
    "operator": "Operator",
    "dept_hse": "Dept HSE",
    # Product name is Project PM; internal id stays "receiver".
    "receiver": "Project PM",
}

PERMISSION_MATRIX = [
    {
        "capability": "View dashboards",
        "operator": True,
        "admin": True,
        "dept_hse": True,
        "receiver": True,
    },
    {
        "capability": "Register records",
        "operator": True,
        "admin": True,
        "dept_hse": False,
        "receiver": False,
    },
    {
        "capability": "Submit close-out / Confirm Driver & Submit",
        "operator": True,
        "admin": True,
        "dept_hse": False,
        "receiver": False,
    },
    {
        "capability": "Approve or return (Closed)",
        "operator": False,
        "admin": True,
        "dept_hse": False,
        "receiver": False,
    },
    {
        "capability": "Edit submitted records",
        "operator": False,
        "admin": True,
        "dept_hse": False,
        "receiver": False,
    },
    {
        "capability": "Delete records and users",
        "operator": False,
        "admin": True,
        "dept_hse": False,
        "receiver": False,
    },
    {
        "capability": "Sign weekly reports",
        "operator": False,
        "admin": False,
        "dept_hse": True,
        "receiver": False,
    },
    {
        "capability": "Sign monthly reports",
        "operator": False,
        "admin": False,
        "dept_hse": False,
        "receiver": True,
    },
    {
        "capability": "Issue monthly reports",
        "operator": False,
        "admin": True,
        "dept_hse": False,
        "receiver": False,
    },
    {
        "capability": "Receive monthly reports",
        "operator": False,
        "admin": False,
        "dept_hse": False,
        "receiver": True,
    },
    {
        "capability": "KPI dashboard",
        "operator": False,
        "admin": True,
        "dept_hse": False,
        "receiver": False,
    },
    {
        "capability": "Operator Performance",
        "operator": False,
        "admin": True,
        "dept_hse": False,
        "receiver": False,
    },
    {
        "capability": "Manage lists, users, rules",
        "operator": False,
        "admin": True,
        "dept_hse": False,
        "receiver": False,
    },
]

SEED_USERS = [
    {
        "username": "admin",
        "password": "admin",
        "display_name": "Admin",
        "badge_number": "A-001",
        "role": "admin",
        "projects": None,
    },
    {
        "username": "operator",
        "password": "operator",
        "display_name": "Operator",
        "badge_number": "O-001",
        "role": "operator",
        "projects": None,
    },
    {
        "username": "hse",
        "password": "hse",
        "display_name": "Dept HSE",
        "badge_number": "H-001",
        "role": "dept_hse",
        "projects": None,
    },
    {
        "username": "pm",
        "password": "pm",
        "display_name": "Project PM",
        "badge_number": "P-001",
        "role": "receiver",
        "projects": None,
    },
]


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120_000)
    return f"{salt}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        salt, digest = stored.split("$", 1)
    except ValueError:
        return False
    check = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt.encode("utf-8"), 120_000
    ).hex()
    return secrets.compare_digest(check, digest)


def validate_password_strength(password: str) -> None:
    """User-chosen passwords: 10+ chars, 1 capital, 1 number."""
    value = password or ""
    if len(value) < 10:
        raise ValueError("Password must be at least 10 characters.")
    if not any(ch.isupper() for ch in value):
        raise ValueError("Password must include at least one capital letter.")
    if not any(ch.isdigit() for ch in value):
        raise ValueError("Password must include at least one number.")


def capabilities(role: str) -> dict[str, bool]:
    admin = role == "admin"
    operatorish = role in {"admin", "operator"}
    dept_hse = role == "dept_hse"
    receiver = role == "receiver"
    return {
        "register": operatorish,
        "close_out": operatorish,
        "close_sos": operatorish,
        "confirm_driver": operatorish,
        "record_weather": operatorish,
        "view_all_records": True,
        "export_reports": True,
        "edit_original": admin,
        "approve_reject": admin,
        "delete_record": admin,
        "manage_contacts": admin,
        "manage_hw": admin,
        # Project PM confirms HW transfers / receives monthly packets.
        "receive_hw": receiver,
        "operator_performance": admin,
        "manage_users": admin,
        "manage_lists": admin,
        "view_kpi": admin,
        # Dept HSE signs weekly reports and the HSE slot on monthly reports.
        "sign_reports": dept_hse,
        # Monthly signature slots: HSE + Project PM (both → Signed).
        "sign_monthly_reports": dept_hse or receiver,
        "issue_reports": admin,
        "manage_settings": admin,
    }
