from pydantic import BaseModel, Field


def format_user_label(
    display_name: str | None, badge_number: str | None = None
) -> str:
    """Canonical on-screen person label: `badge - Name` when badge exists."""
    name = (display_name or "").strip()
    badge = (badge_number or "").strip()
    if badge and name:
        return f"{badge} - {name}"
    return name or badge


def actor_label(user: "UserOut") -> str:
    return format_user_label(user.display_name, user.badge_number)


class LoginRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=80)
    password: str = Field(..., min_length=1, max_length=200)


class UserOut(BaseModel):
    id: str
    username: str
    display_name: str
    badge_number: str | None = None
    email: str | None = None
    role: str
    capabilities: dict[str, bool]
    projects: list[str] | None = None
    must_change_password: bool = False


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(..., min_length=1, max_length=200)
    new_password: str = Field(..., min_length=1, max_length=200)


class PasswordRecoveryRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=80)
    email: str = Field(..., min_length=1, max_length=200)


class PasswordRecoveryReset(BaseModel):
    username: str = Field(..., min_length=1, max_length=80)
    email: str = Field(..., min_length=1, max_length=200)
    code: str = Field(..., min_length=4, max_length=12)
    new_password: str = Field(..., min_length=1, max_length=200)


class UserCreate(BaseModel):
    username: str = Field(..., min_length=1, max_length=80)
    password: str = Field(..., min_length=1, max_length=200)
    display_name: str = Field(..., min_length=1, max_length=120)
    badge_number: str = Field(..., min_length=1, max_length=80)
    email: str | None = Field(default=None, max_length=200)
    role: str
    projects: list[str] | None = None


class UserUpdate(BaseModel):
    username: str = Field(..., min_length=1, max_length=80)
    display_name: str = Field(..., min_length=1, max_length=120)
    badge_number: str = Field(..., min_length=1, max_length=80)
    email: str | None = Field(default=None, max_length=200)
    role: str
    password: str | None = Field(default=None, max_length=200)
    projects: list[str] | None = None


class RejectBody(BaseModel):
    reason: str = Field(..., min_length=1, max_length=2000)


class ConfirmDelete(BaseModel):
    confirm: bool
