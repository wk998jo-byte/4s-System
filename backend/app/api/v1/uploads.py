from fastapi import APIRouter, Depends, File, UploadFile

from app.api.deps import get_current_user
from app.schemas.auth import UserOut
from app.services.platform_store import platform_store
from app.services.uploads import save_upload

router = APIRouter(tags=["Uploads"], dependencies=[Depends(get_current_user)])


@router.post("/uploads")
async def upload_image(
    file: UploadFile = File(...),
    user: UserOut = Depends(get_current_user),
) -> dict:
    """Store an observation / close-out image and return a URL path."""
    result = await save_upload(file)
    stored = str(result.get("stored_name") or "")
    if stored:
        platform_store.record_upload_owner(stored, user.id)
    return result
