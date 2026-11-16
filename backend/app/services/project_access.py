"""Project authorization for hardware and report API paths.

``None`` return value = unrestricted (admin, trusted internal callers, or
operators with Admin UI “All projects”, stored as ``projects: null`` / ``[]``).

A non-empty assignment list restricts to those project labels. A list that
normalizes to no labels (e.g. blanks only) is fail-closed empty.
"""


def project_scope(user: dict | None) -> frozenset[str] | None:
    if user is None or user.get("role") == "admin":
        return None
    assigned = user.get("projects")
    # Product rule (Admin access dialog): null / empty = All projects.
    if not isinstance(assigned, list) or len(assigned) == 0:
        return None
    cleaned = frozenset(
        p.strip() for p in assigned if isinstance(p, str) and p.strip()
    )
    # Explicit list that cleaned to nothing → no authorized projects.
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
    if project_scope(user) is None:
        return True
    # Daily packets require a scoped projection at the response boundary.
    if packet.get("kind") == "daily":
        return bool(project_scope(user))
    return can_access_project(user, packet.get("scope"))
