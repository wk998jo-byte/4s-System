"""Project authorization for hardware and report API paths.

``project_scope`` return values:
- ``None`` — unrestricted (admin role, trusted internal ``user=None``, or
  explicit All-projects assignment stored as ``["*"]``).
- ``frozenset()`` — no authorized projects (missing / invalid assignment).
- ``frozenset({...})`` — restricted to those project labels.

Historical Admin UI saved All-projects as ``projects=null``. That is ambiguous
with missing assignments. New writes use the ``*`` sentinel; a one-time store
migration encodes legacy null/[] non-admin rows as ``["*"]``.
"""

from __future__ import annotations

# Stored in users.projects JSON to mean explicit All-projects (not missing).
ALL_PROJECTS_SENTINEL = "*"


def has_explicit_all_projects(projects: object) -> bool:
    """True when the assignment list explicitly grants all projects."""
    if not isinstance(projects, list):
        return False
    return any(
        isinstance(item, str) and item.strip() == ALL_PROJECTS_SENTINEL
        for item in projects
    )


def project_scope(user: dict | None) -> frozenset[str] | None:
    if user is None or user.get("role") == "admin":
        return None
    assigned = user.get("projects")
    if has_explicit_all_projects(assigned):
        return None
    if not isinstance(assigned, list):
        # Missing / non-list → fail closed (no global grant).
        return frozenset()
    cleaned = frozenset(
        p.strip()
        for p in assigned
        if isinstance(p, str) and p.strip() and p.strip() != ALL_PROJECTS_SENTINEL
    )
    return cleaned


def can_access_project(user: dict | None, project: object) -> bool:
    allowed = project_scope(user)
    return allowed is None or (
        isinstance(project, str) and bool(project.strip()) and project in allowed
    )


def can_view_transfer(user: dict | None, transfer: dict) -> bool:
    # Existing transfer lists show records involving either assigned endpoint.
    # Warehouse is a location, not a project assignment or a global grant.
    if project_scope(user) is None:
        return True
    return any(
        location != "Warehouse" and can_access_project(user, location)
        for location in (transfer.get("from"), transfer.get("to"))
    )


def can_view_report(user: dict | None, packet: dict) -> bool:
    """Daily / weekly / monthly packs share the same project-access rules.

    Unrestricted users see every pack (including ``All projects``).
    Scoped users only see packs whose ``scope`` matches an assigned project —
    never the shared ``All projects`` pack.
    """
    if project_scope(user) is None:
        return True
    scope = packet.get("scope")
    if scope == "All projects":
        return False
    return can_access_project(user, scope)
