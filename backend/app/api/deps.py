from fastapi import Depends, Header, HTTPException

from app.schemas.auth import UserOut
from app.services.platform_store import platform_store
from app.services.record_store import InMemoryRecordStore, store


def get_record_store() -> InMemoryRecordStore:
    """Dependency hook so tests (and later PostgreSQL) can swap the store."""
    return store


def _token_from_header(authorization: str | None) -> str | None:
    if not authorization:
        return None
    scheme, _, value = authorization.partition(" ")
    if scheme.lower() != "bearer" or not value:
        return None
    return value.strip()


def get_current_user(
    authorization: str | None = Header(default=None),
) -> UserOut:
    token = _token_from_header(authorization)
    if not token:
        raise HTTPException(
            status_code=401, detail="Sign in as Admin or Operator to continue."
        )
    user = platform_store.user_from_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="Session expired. Sign in again.")
    return UserOut(**user)


def require_admin(user: UserOut = Depends(get_current_user)) -> UserOut:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="This action is for Admin only.")
    return user


def require_capability(capability: str):
    """FastAPI dependency factory: require a named capability on the signed-in user."""

    def _check(user: UserOut = Depends(get_current_user)) -> UserOut:
        if not user.capabilities.get(capability):
            raise HTTPException(
                status_code=403,
                detail="Your role cannot perform this action.",
            )
        return user

    return _check
