from fastapi import APIRouter, Depends, Header, HTTPException

from app.api.deps import get_current_user, require_admin
from app.schemas.auth import (
    ChangePasswordRequest,
    ConfirmDelete,
    LoginRequest,
    LoginResponse,
    UserCreate,
    UserOut,
    UserUpdate,
    actor_label,
    format_user_label,
)
from app.services.auth import PERMISSION_MATRIX
from app.services.platform_store import platform_store

router = APIRouter(tags=["Auth"])


@router.post("/auth/login", response_model=LoginResponse)
def login(payload: LoginRequest) -> LoginResponse:
    result = platform_store.login(payload.username, payload.password)
    if not result:
        raise HTTPException(status_code=401, detail="Invalid username or password.")
    return LoginResponse(**result)


@router.post("/auth/change-password", response_model=UserOut)
def change_password(
    payload: ChangePasswordRequest,
    user: UserOut = Depends(get_current_user),
) -> UserOut:
    try:
        updated = platform_store.change_password(
            user.id,
            payload.current_password,
            payload.new_password,
        )
    except KeyError:
        raise HTTPException(status_code=404, detail="User not found.") from None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    platform_store.record_audit(
        actor_user_id=user.id,
        actor_name=actor_label(user),
        action="password_changed",
        category="users",
        summary="Changed sign-in password",
        details={"forced": bool(user.must_change_password)},
    )
    return UserOut(**updated)


@router.post("/auth/logout")
def logout(
    authorization: str | None = Header(default=None),
    user: UserOut = Depends(get_current_user),
) -> dict:
    del user
    token = None
    if authorization:
        scheme, _, value = authorization.partition(" ")
        if scheme.lower() == "bearer":
            token = value.strip()
    if token:
        platform_store.logout(token)
    return {"ok": True}


@router.get("/auth/me", response_model=UserOut)
def me(user: UserOut = Depends(get_current_user)) -> UserOut:
    return user


@router.get("/admin/users")
def list_users(user: UserOut = Depends(require_admin)) -> dict:
    del user
    return {"items": platform_store.list_users()}


@router.post("/admin/users", status_code=201)
def create_user(payload: UserCreate, user: UserOut = Depends(require_admin)) -> UserOut:
    try:
        created = platform_store.create_user(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    created_label = format_user_label(
        created.get("display_name"), created.get("badge_number")
    )
    platform_store.record_audit(
        actor_user_id=user.id,
        actor_name=actor_label(user),
        action="user_created",
        category="users",
        summary=f"Created {created['role']} account “{created_label}”",
        details={
            "username": created["username"],
            "role": created["role"],
            "badge_number": created.get("badge_number"),
        },
    )
    return UserOut(**created)


@router.patch("/admin/users/{user_id}", response_model=UserOut)
def update_user(
    user_id: str,
    payload: UserUpdate,
    user: UserOut = Depends(require_admin),
) -> UserOut:
    try:
        updated = platform_store.update_user(user_id, payload, actor_id=user.id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except KeyError:
        raise HTTPException(status_code=404, detail="User not found.") from None
    updated_label = format_user_label(
        updated.get("display_name"), updated.get("badge_number")
    )
    platform_store.record_audit(
        actor_user_id=user.id,
        actor_name=actor_label(user),
        action="user_updated",
        category="users",
        summary=f"Updated user “{updated_label}”",
        details={
            "username": updated["username"],
            "role": updated["role"],
            "badge_number": updated.get("badge_number"),
        },
    )
    return UserOut(**updated)


@router.post("/admin/users/{user_id}/delete")
def delete_user(
    user_id: str,
    payload: ConfirmDelete,
    user: UserOut = Depends(require_admin),
) -> dict:
    target = next(
        (item for item in platform_store.list_users() if item["id"] == user_id),
        None,
    )
    try:
        platform_store.delete_user(
            user_id, payload.confirm, actor_id=user.id
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except KeyError:
        raise HTTPException(status_code=404, detail="User not found.") from None
    name = format_user_label(
        (target or {}).get("display_name"),
        (target or {}).get("badge_number"),
    ) or user_id
    platform_store.record_audit(
        actor_user_id=user.id,
        actor_name=actor_label(user),
        action="user_deleted",
        category="users",
        summary=f"Deleted user “{name}”",
        details={
            "username": (target or {}).get("username"),
            "role": (target or {}).get("role"),
        },
    )
    return {"ok": True}


@router.get("/admin/permission-matrix")
def permission_matrix(user: UserOut = Depends(require_admin)) -> dict:
    del user
    return {"items": PERMISSION_MATRIX}


@router.get("/admin/audit-log")
def admin_audit_log(
    user: UserOut = Depends(require_admin),
    limit: int = 200,
) -> dict:
    del user
    return {"items": platform_store.list_admin_audit(limit=limit)}
