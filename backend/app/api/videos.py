from pathlib import Path
from typing import List, Optional
from fastapi import APIRouter, HTTPException, Header, UploadFile, File, Request
from fastapi.responses import FileResponse, StreamingResponse
import aiofiles

from ..storage.local import LocalStorageProvider
from ..storage.google_drive import GoogleDriveStorageProvider
from ..models.room import VideoMetadata
from ..auth.session import session_store
from ..config import settings

router = APIRouter(prefix="/api/videos", tags=["videos"])
local_storage = LocalStorageProvider()
drive_storage = GoogleDriveStorageProvider()

@router.get("", response_model=List[VideoMetadata])
async def list_videos():
    return await local_storage.list_videos()

@router.get("/{video_id}/stream")
async def stream_video(video_id: str, range: Optional[str] = Header(None)):
    file_path = local_storage.get_file_path(video_id)
    if not file_path or not file_path.exists():
        raise HTTPException(status_code=404, detail="Video file not found")

    return await LocalStorageProvider.create_range_response(file_path, range)

@router.get("/{video_id}/download")
async def download_video(video_id: str):
    file_path = local_storage.get_file_path(video_id)
    if not file_path or not file_path.exists():
        raise HTTPException(status_code=404, detail="Video file not found")

    return FileResponse(
        path=str(file_path),
        filename=file_path.name,
        media_type="application/octet-stream"
    )

@router.post("/upload", response_model=VideoMetadata)
async def upload_video(file: UploadFile = File(...)):
    if not file.filename.lower().endswith((".mp4", ".webm", ".mov", ".mkv")):
        raise HTTPException(status_code=400, detail="Unsupported video format. Please upload MP4 or WebM.")

    safe_stem = Path(file.filename).stem.replace(" ", "_")
    target_path = settings.MEDIA_DIR / f"{safe_stem}{Path(file.filename).suffix.lower()}"

    async with aiofiles.open(target_path, "wb") as out_f:
        while chunk := await file.read(1024 * 1024):
            await out_f.write(chunk)

    meta = await local_storage.get_video_metadata(safe_stem)
    if not meta:
        raise HTTPException(status_code=500, detail="Failed to load uploaded video metadata")
    return meta

@router.post("/drive/import", response_model=VideoMetadata)
async def import_drive_video(drive_file_id: str, request: Request):
    session_id = request.cookies.get("session_id") or request.headers.get("X-Session-ID")
    if not session_id:
        raise HTTPException(status_code=401, detail="Session required")

    access_token = session_store.get_google_access_token(session_id)
    if not access_token:
        raise HTTPException(status_code=401, detail="Google Drive not connected for this session")

    return await drive_storage.import_video(drive_file_id, user_token=access_token)
