from pathlib import Path
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, HTTPException, Header, UploadFile, File, Request, Depends
from fastapi.responses import FileResponse, StreamingResponse
import aiofiles
from pydantic import BaseModel, Field

from ..storage.local import LocalStorageProvider
from ..storage.google_drive import GoogleDriveStorageProvider
from ..storage.r2 import r2_service
from ..models.room import VideoMetadata
from ..auth.session import session_store
from ..auth.admin import admin_auth, get_admin_session, AdminSession
from ..config import settings

router = APIRouter(prefix="/api/videos", tags=["videos"])
local_storage = LocalStorageProvider()
drive_storage = GoogleDriveStorageProvider()

# --- Models ---

class AdminVerifyRequest(BaseModel):
    password: str

class AdminVerifyResponse(BaseModel):
    token: str
    expiresIn: int

class R2PlayUrlRequest(BaseModel):
    key: str
    expiresIn: Optional[int] = 3600

class R2PlayUrlResponse(BaseModel):
    url: str
    key: str
    expiresIn: int

class R2InitiateUploadRequest(BaseModel):
    filename: str
    fileSize: int = Field(gt=0, description="File size in bytes")
    contentType: Optional[str] = None

class R2InitiateUploadResponse(BaseModel):
    uploadId: str
    objectKey: str
    partSize: int
    totalParts: int
    filename: str
    fileSize: int
    bucket: str
    contentType: str

class R2PartUrlsRequest(BaseModel):
    objectKey: str
    partNumbers: List[int]

class R2PartUrlItem(BaseModel):
    partNumber: int
    url: str
    expiresIn: int

class R2PartETag(BaseModel):
    partNumber: int
    etag: str

class R2CompleteUploadRequest(BaseModel):
    objectKey: str
    parts: List[R2PartETag]

class R2CompleteUploadResponse(BaseModel):
    status: str
    objectKey: str
    uploadId: str
    location: Optional[str] = ""

class R2AbortUploadRequest(BaseModel):
    objectKey: Optional[str] = None

class R2DeleteResponse(BaseModel):
    status: str
    key: str
    message: str

class R2StorageInfoResponse(BaseModel):
    limitBytes: int
    storedBytes: int
    reservedBytes: int
    availableBytes: int
    videoCount: int
    activeUploadCount: int
    limitFormatted: str
    storedFormatted: str
    reservedFormatted: str
    availableFormatted: str

# --- Admin & R2 Video Management Endpoints ---

@router.post("/r2/admin/verify", response_model=AdminVerifyResponse)
async def verify_r2_admin(req: AdminVerifyRequest, request: Request):
    client_ip = request.client.host if request.client else "unknown"
    token, ttl = admin_auth.verify_password_and_create_session(req.password, client_ip)
    return AdminVerifyResponse(token=token, expiresIn=ttl)

@router.get("/r2")
async def list_r2_videos():
    return await r2_service.list_videos()

@router.get("/r2/storage-info", response_model=R2StorageInfoResponse)
async def get_r2_storage_info():
    res = await r2_service.get_storage_info()
    return R2StorageInfoResponse(**res)

@router.post("/r2/play-url", response_model=R2PlayUrlResponse)
async def get_r2_play_url(req: R2PlayUrlRequest):
    expires = req.expiresIn or 3600
    url = await r2_service.generate_presigned_playback_url(req.key, expires_in=expires)
    return R2PlayUrlResponse(url=url, key=req.key, expiresIn=expires)

@router.get("/r2/{object_key:path}/play-url", response_model=R2PlayUrlResponse)
async def get_r2_play_url_by_path(object_key: str):
    expires = 3600
    url = await r2_service.generate_presigned_playback_url(object_key, expires_in=expires)
    return R2PlayUrlResponse(url=url, key=object_key, expiresIn=expires)

@router.post("/r2/uploads/initiate", response_model=R2InitiateUploadResponse)
async def initiate_r2_upload(
    req: R2InitiateUploadRequest,
    admin: AdminSession = Depends(get_admin_session)
):
    res = await r2_service.initiate_multipart_upload(
        filename=req.filename,
        file_size=req.fileSize,
        content_type=req.contentType,
        admin_session_id=admin.session_id
    )
    return R2InitiateUploadResponse(**res)

@router.post("/r2/uploads/{upload_id}/part-urls", response_model=List[R2PartUrlItem])
async def get_r2_part_urls(
    upload_id: str,
    req: R2PartUrlsRequest,
    admin: AdminSession = Depends(get_admin_session)
):
    res = await r2_service.generate_presigned_part_urls(
        upload_id=upload_id,
        object_key=req.objectKey,
        part_numbers=req.partNumbers,
        admin_session_id=admin.session_id
    )
    return [R2PartUrlItem(**item) for item in res]

@router.post("/r2/uploads/{upload_id}/complete", response_model=R2CompleteUploadResponse)
async def complete_r2_upload(
    upload_id: str,
    req: R2CompleteUploadRequest,
    admin: AdminSession = Depends(get_admin_session)
):
    parts_data = [{"partNumber": p.partNumber, "etag": p.etag} for p in req.parts]
    res = await r2_service.complete_multipart_upload(
        upload_id=upload_id,
        object_key=req.objectKey,
        parts=parts_data,
        admin_session_id=admin.session_id
    )
    return R2CompleteUploadResponse(**res)

@router.post("/r2/uploads/{upload_id}/abort")
async def abort_r2_upload(
    upload_id: str,
    req: Optional[R2AbortUploadRequest] = None,
    admin: AdminSession = Depends(get_admin_session)
):
    key = req.objectKey if req else None
    return await r2_service.abort_multipart_upload(
        upload_id=upload_id,
        object_key=key,
        admin_session_id=admin.session_id
    )

@router.delete("/r2/{object_key:path}", response_model=R2DeleteResponse)
async def delete_r2_video(
    object_key: str,
    admin: AdminSession = Depends(get_admin_session)
):
    res = await r2_service.delete_video(object_key)
    return R2DeleteResponse(**res)

@router.post("/r2/uploads/cleanup")
async def cleanup_r2_uploads(
    max_age_seconds: int = 86400,
    admin: AdminSession = Depends(get_admin_session)
):
    return await r2_service.cleanup_abandoned_uploads(max_age_seconds=max_age_seconds)

# --- Local & Drive Endpoints (Preserved Unmodified) ---

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
