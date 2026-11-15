"""Fail-closed project authorization for hardware and report API paths.

Admin is the existing global role. Missing assignments are not a global grant.
``None`` as the user is reserved for trusted, internal store callers.
"""


def project_scope(user: dict | None) -> frozenset[str] | None:
    if user is None or user.get("role") == "admin":
        return None
    assigned = user.get("projects")
    if not isinstance(assigned, list):
        return frozenset()
    return frozenset(p.strip() for p in assigned if isinstance(p, str) and p.strip())


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
