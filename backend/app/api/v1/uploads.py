from fastapi import APIRouter, Depends, File, UploadFile

from app.api.deps import get_current_user
from app.schemas.auth import UserOut
from app.services.uploads import save_upload

router = APIRouter(tags=["Uploads"], dependencies=[Depends(get_current_user)])


@router.post("/uploads")
async def upload_image(
    file: UploadFile = File(...),
    _user: UserOut = Depends(get_current_user),
) -> dict:
    """Store an observation / close-out image and return a public URL path."""
    return await save_upload(file)
