import math
import mimetypes
import re
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Dict, Any
from fastapi import HTTPException
import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from ..config import settings
from ..models.room import VideoMetadata
from .reservations import ReservationStore, TOTAL_LIMIT_BYTES, format_gib

SUPPORTED_VIDEO_EXTS = {".mp4", ".webm", ".mov", ".mkv"}
MIN_PART_SIZE = 5 * 1024 * 1024       # 5 MiB (S3 minimum part size except last)
DEFAULT_PART_SIZE = 64 * 1024 * 1024  # 64 MiB
MAX_PART_COUNT = 10000
MAX_FILE_SIZE = 100 * 1024 * 1024 * 1024  # 100 GiB

@dataclass
class UploadSessionData:
    upload_id: str
    object_key: str
    bucket: str
    filename: str
    file_size: int
    part_size: int
    total_parts: int
    admin_session_id: str
    created_at: float
    status: str  # "in_progress", "completed", "aborted"

class R2StorageService:
    def __init__(
        self,
        s3_client: Optional[Any] = None,
        reservation_store: Optional[ReservationStore] = None
    ):
        self._s3_client = s3_client
        self._upload_sessions: Dict[str, UploadSessionData] = {}
        self._reservation_store = reservation_store or ReservationStore(settings.R2_RESERVATIONS_DB_PATH)

    def is_configured(self) -> bool:
        return bool(
            settings.R2_ACCOUNT_ID
            and settings.R2_ACCESS_KEY_ID
            and settings.R2_SECRET_ACCESS_KEY
            and settings.R2_BUCKET_NAME
        )

    def _get_client(self):
        if self._s3_client is not None:
            return self._s3_client
        if not self.is_configured():
            raise HTTPException(
                status_code=503,
                detail="Cloudflare R2 storage is not configured. Please set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY."
            )
        return boto3.client(
            "s3",
            endpoint_url=settings.r2_endpoint_url,
            aws_access_key_id=settings.R2_ACCESS_KEY_ID,
            aws_secret_access_key=settings.R2_SECRET_ACCESS_KEY,
            config=Config(signature_version="s3v4"),
            region_name="auto",
        )

    def validate_object_key(self, object_key: str) -> None:
        if not object_key or not object_key.strip():
            raise HTTPException(status_code=400, detail="Invalid object key")
        clean_key = object_key.strip()
        if clean_key.startswith("/") or ".." in clean_key:
            raise HTTPException(status_code=400, detail="Invalid path in object key")
        suffix = Path(clean_key).suffix.lower()
        if suffix not in SUPPORTED_VIDEO_EXTS:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported video format: {suffix}. Allowed formats: {', '.join(SUPPORTED_VIDEO_EXTS)}"
            )

    def sanitize_filename(self, filename: str) -> str:
        if not filename or not filename.strip():
            raise HTTPException(status_code=400, detail="Filename cannot be empty")
        # Keep only the base filename (strip any path directory traversal)
        base = Path(filename).name
        # Replace non-alphanumeric (except . - _) with _
        clean = re.sub(r"[^a-zA-Z0-9.\-_]", "_", base)
        # Squeeze duplicate underscores
        clean = re.sub(r"_+", "_", clean).strip("._")
        if not clean:
            clean = f"video_{uuid.uuid4().hex[:6]}"
        suffix = Path(clean).suffix.lower()
        if suffix not in SUPPORTED_VIDEO_EXTS:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported video format: {suffix}. Allowed formats: {', '.join(SUPPORTED_VIDEO_EXTS)}"
            )
        return clean

    def generate_unique_object_key(self, sanitized_filename: str) -> str:
        unique_prefix = uuid.uuid4().hex[:12]
        return f"videos/{unique_prefix}_{sanitized_filename}"

    def calculate_part_sizing(self, file_size: int) -> tuple[int, int]:
        if file_size <= 0:
            raise HTTPException(status_code=400, detail="File size must be greater than 0 bytes")
        if file_size > MAX_FILE_SIZE:
            raise HTTPException(
                status_code=400,
                detail=f"File exceeds maximum allowed size of {MAX_FILE_SIZE // (1024**3)} GB"
            )

        if file_size <= DEFAULT_PART_SIZE:
            return file_size, 1

        part_size = DEFAULT_PART_SIZE
        total_parts = math.ceil(file_size / part_size)
        if total_parts > MAX_PART_COUNT:
            part_size = math.ceil(file_size / MAX_PART_COUNT)
            total_parts = math.ceil(file_size / part_size)

        return part_size, total_parts

    async def list_videos(self) -> List[Dict[str, Any]]:
        client = self._get_client()
        videos: List[Dict[str, Any]] = []

        try:
            paginator = client.get_paginator("list_objects_v2")
            page_iterator = paginator.paginate(Bucket=settings.R2_BUCKET_NAME)

            for page in page_iterator:
                for item in page.get("Contents", []):
                    key = item.get("Key", "")
                    suffix = Path(key).suffix.lower()
                    if suffix in SUPPORTED_VIDEO_EXTS:
                        mime = "video/mp4" if suffix == ".mp4" else f"video/{suffix[1:]}"
                        videos.append({
                            "key": key,
                            "name": Path(key).name,
                            "size": item.get("Size", 0),
                            "mimeType": mime,
                            "provider": "r2",
                            "lastModified": item.get("LastModified", "").isoformat() if hasattr(item.get("LastModified", ""), "isoformat") else None,
                        })
        except ClientError as e:
            raise HTTPException(
                status_code=502,
                detail=f"Error communicating with Cloudflare R2: {e.response.get('Error', {}).get('Message', str(e))}"
            )
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to list R2 videos: {str(e)}")

        return videos

    async def get_bucket_storage_usage(self) -> tuple[int, int]:
        """
        Query Cloudflare R2 using the S3-compatible API and calculate the total size
        of existing video objects in the configured bucket.
        Uses paginated ListObjectsV2 results and sums each object's Size in bytes.
        Includes all existing video objects, including files uploaded outside WatchTogether.
        Excludes non-video objects and folder placeholders.
        """
        client = self._get_client()
        total_bytes = 0
        video_count = 0

        try:
            paginator = client.get_paginator("list_objects_v2")
            for page in paginator.paginate(Bucket=settings.R2_BUCKET_NAME):
                for item in page.get("Contents", []):
                    key = item.get("Key", "")
                    suffix = Path(key).suffix.lower()
                    if suffix in SUPPORTED_VIDEO_EXTS:
                        total_bytes += item.get("Size", 0)
                        video_count += 1
        except ClientError as e:
            raise HTTPException(
                status_code=502,
                detail=f"Error querying bucket storage usage from R2: {e.response.get('Error', {}).get('Message', str(e))}"
            )
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to calculate R2 storage usage: {str(e)}")

        return total_bytes, video_count

    async def get_storage_info(self) -> Dict[str, Any]:
        """
        Returns confirmed server-side storage metrics including:
        - Current stored video size (from R2 ListObjectsV2)
        - Reserved space for active uploads (from shared persistent DB)
        - Available upload capacity (strictly < 10 GiB)
        - The 10 GiB limit
        """
        stored_bytes, video_count = await self.get_bucket_storage_usage()
        now = time.time()
        self._reservation_store.clean_expired(now)
        reserved_bytes = self._reservation_store.get_reserved_bytes(now)
        active_reservations = self._reservation_store.get_active_reservation_count(now)
        available_bytes = max(0, TOTAL_LIMIT_BYTES - (stored_bytes + reserved_bytes))

        return {
            "limitBytes": TOTAL_LIMIT_BYTES,
            "storedBytes": stored_bytes,
            "reservedBytes": reserved_bytes,
            "availableBytes": available_bytes,
            "videoCount": video_count,
            "activeUploadCount": active_reservations,
            "limitFormatted": format_gib(TOTAL_LIMIT_BYTES),
            "storedFormatted": format_gib(stored_bytes),
            "reservedFormatted": format_gib(reserved_bytes),
            "availableFormatted": format_gib(available_bytes),
        }

    async def generate_presigned_playback_url(self, object_key: str, expires_in: int = 3600) -> str:
        self.validate_object_key(object_key)
        client = self._get_client()

        try:
            url = client.generate_presigned_url(
                ClientMethod="get_object",
                Params={
                    "Bucket": settings.R2_BUCKET_NAME,
                    "Key": object_key,
                },
                ExpiresIn=expires_in,
            )
            return url
        except ClientError as e:
            raise HTTPException(
                status_code=502,
                detail=f"Error generating presigned URL: {e.response.get('Error', {}).get('Message', str(e))}"
            )
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to generate presigned URL: {str(e)}")

    async def initiate_multipart_upload(
        self,
        filename: str,
        file_size: int,
        content_type: Optional[str],
        admin_session_id: str
    ) -> Dict[str, Any]:
        sanitized_name = self.sanitize_filename(filename)
        part_size, total_parts = self.calculate_part_sizing(file_size)
        object_key = self.generate_unique_object_key(sanitized_name)

        if not content_type or "/" not in content_type:
            suffix = Path(sanitized_name).suffix.lower()
            content_type = "video/mp4" if suffix == ".mp4" else f"video/{suffix[1:]}"

        # 1. Strict Storage Capacity Check BEFORE calling CreateMultipartUpload
        stored_bytes, _ = await self.get_bucket_storage_usage()
        temp_id = f"pending_{uuid.uuid4().hex}"

        success, err_msg, _ = self._reservation_store.reserve(
            upload_id=temp_id,
            object_key=object_key,
            file_size=file_size,
            existing_stored_bytes=stored_bytes,
            ttl_seconds=settings.R2_UPLOAD_EXPIRY_SECONDS
        )
        if not success:
            raise HTTPException(status_code=400, detail=err_msg)

        client = self._get_client()
        try:
            response = client.create_multipart_upload(
                Bucket=settings.R2_BUCKET_NAME,
                Key=object_key,
                ContentType=content_type,
            )
            upload_id = response["UploadId"]
            self._reservation_store.rebind_upload_id(temp_id, upload_id)
        except ClientError as e:
            self._reservation_store.release(temp_id)
            raise HTTPException(
                status_code=502,
                detail=f"Failed to initiate multipart upload in R2: {e.response.get('Error', {}).get('Message', str(e))}"
            )
        except Exception:
            self._reservation_store.release(temp_id)
            raise

        session = UploadSessionData(
            upload_id=upload_id,
            object_key=object_key,
            bucket=settings.R2_BUCKET_NAME,
            filename=sanitized_name,
            file_size=file_size,
            part_size=part_size,
            total_parts=total_parts,
            admin_session_id=admin_session_id,
            created_at=time.time(),
            status="in_progress"
        )
        self._upload_sessions[upload_id] = session

        return {
            "uploadId": upload_id,
            "objectKey": object_key,
            "partSize": part_size,
            "totalParts": total_parts,
            "filename": sanitized_name,
            "fileSize": file_size,
            "bucket": settings.R2_BUCKET_NAME,
            "contentType": content_type
        }

    async def generate_presigned_part_urls(
        self,
        upload_id: str,
        object_key: str,
        part_numbers: List[int],
        admin_session_id: str,
        expires_in: int = 3600
    ) -> List[Dict[str, Any]]:
        self.validate_object_key(object_key)

        session = self._upload_sessions.get(upload_id)
        if not session:
            raise HTTPException(status_code=404, detail="Upload session not found or expired")

        if session.status != "in_progress":
            raise HTTPException(status_code=400, detail=f"Upload session is already {session.status}")

        if session.object_key != object_key:
            raise HTTPException(status_code=400, detail="Object key mismatch for upload session")

        if session.admin_session_id != admin_session_id:
            raise HTTPException(status_code=403, detail="Upload does not belong to the current admin session")

        if not part_numbers or len(part_numbers) > 500:
            raise HTTPException(status_code=400, detail="Invalid part numbers list (must be 1-500 parts per batch)")

        client = self._get_client()
        part_urls = []
        for p_num in part_numbers:
            if not isinstance(p_num, int) or p_num < 1 or p_num > session.total_parts:
                raise HTTPException(
                    status_code=400,
                    detail=f"Part number {p_num} out of valid range (1..{session.total_parts})"
                )

            try:
                signed_url = client.generate_presigned_url(
                    ClientMethod="upload_part",
                    Params={
                        "Bucket": settings.R2_BUCKET_NAME,
                        "Key": object_key,
                        "UploadId": upload_id,
                        "PartNumber": p_num,
                    },
                    ExpiresIn=expires_in,
                )
                part_urls.append({
                    "partNumber": p_num,
                    "url": signed_url,
                    "expiresIn": expires_in
                })
            except ClientError as e:
                raise HTTPException(
                    status_code=502,
                    detail=f"Failed to generate presigned part URL: {e.response.get('Error', {}).get('Message', str(e))}"
                )

        return part_urls

    async def complete_multipart_upload(
        self,
        upload_id: str,
        object_key: str,
        parts: List[Dict[str, Any]],
        admin_session_id: str
    ) -> Dict[str, Any]:
        self.validate_object_key(object_key)

        session = self._upload_sessions.get(upload_id)
        if session:
            if session.status == "completed":
                return {
                    "status": "completed",
                    "objectKey": object_key,
                    "uploadId": upload_id,
                    "message": "Upload already completed"
                }
            if session.status == "aborted":
                raise HTTPException(status_code=400, detail="Upload has been aborted and cannot be completed")
            if session.object_key != object_key:
                raise HTTPException(status_code=400, detail="Object key mismatch for upload session")
            if session.admin_session_id != admin_session_id:
                raise HTTPException(status_code=403, detail="Upload does not belong to the current admin session")
            if len(parts) != session.total_parts:
                raise HTTPException(
                    status_code=400,
                    detail=f"Incomplete parts: expected {session.total_parts} parts, got {len(parts)}"
                )

        if not parts:
            raise HTTPException(status_code=400, detail="Parts list cannot be empty")

        # Validate and format parts
        formatted_parts = []
        seen_part_numbers = set()
        for p in parts:
            part_num = p.get("partNumber") or p.get("PartNumber")
            etag = p.get("etag") or p.get("ETag")
            if not part_num or not isinstance(part_num, int):
                raise HTTPException(status_code=400, detail="Each part must have an integer partNumber")
            if not etag or not isinstance(etag, str):
                raise HTTPException(status_code=400, detail=f"Part {part_num} is missing a valid ETag")
            if part_num in seen_part_numbers:
                raise HTTPException(status_code=400, detail=f"Duplicate part number: {part_num}")
            seen_part_numbers.add(part_num)

            # Strip external quotes and re-wrap in double quotes if not present
            clean_etag = etag.strip().strip('"')
            formatted_parts.append({
                "PartNumber": part_num,
                "ETag": f'"{clean_etag}"'
            })

        # S3 requires parts sorted in ascending order by PartNumber
        formatted_parts.sort(key=lambda x: x["PartNumber"])

        # Check contiguous part numbers from 1 to N
        for i, p in enumerate(formatted_parts, start=1):
            if p["PartNumber"] != i:
                raise HTTPException(status_code=400, detail=f"Missing part number {i} in multipart upload")

        client = self._get_client()
        try:
            res = client.complete_multipart_upload(
                Bucket=settings.R2_BUCKET_NAME,
                Key=object_key,
                UploadId=upload_id,
                MultipartUpload={"Parts": formatted_parts}
            )
        except ClientError as e:
            error_code = e.response.get("Error", {}).get("Code", "")
            error_msg = e.response.get("Error", {}).get("Message", str(e))
            if error_code in ("NoSuchUpload", "InvalidPart", "InvalidPartOrder", "EntityTooSmall"):
                raise HTTPException(status_code=400, detail=f"Multipart upload completion failed: {error_msg}")
            raise HTTPException(status_code=502, detail=f"R2 error completing upload: {error_msg}")

        if session:
            session.status = "completed"

        # Complete and reconcile reservation against actual stored bytes
        self._reservation_store.complete(upload_id)

        return {
            "status": "completed",
            "objectKey": object_key,
            "uploadId": upload_id,
            "location": res.get("Location", "")
        }

    async def abort_multipart_upload(
        self,
        upload_id: str,
        object_key: Optional[str],
        admin_session_id: str
    ) -> Dict[str, Any]:
        session = self._upload_sessions.get(upload_id)
        target_key = object_key or (session.object_key if session else None)

        if not target_key:
            raise HTTPException(status_code=400, detail="Object key required to abort upload")

        self.validate_object_key(target_key)

        if session:
            if session.status == "aborted":
                return {"status": "aborted", "uploadId": upload_id, "message": "Upload already aborted"}
            if session.admin_session_id != admin_session_id:
                raise HTTPException(status_code=403, detail="Upload does not belong to the current admin session")

        client = self._get_client()
        try:
            client.abort_multipart_upload(
                Bucket=settings.R2_BUCKET_NAME,
                Key=target_key,
                UploadId=upload_id
            )
        except ClientError as e:
            error_code = e.response.get("Error", {}).get("Code", "")
            if error_code != "NoSuchUpload":
                raise HTTPException(
                    status_code=502,
                    detail=f"Failed to abort multipart upload: {e.response.get('Error', {}).get('Message', str(e))}"
                )

        if session:
            session.status = "aborted"

        self._reservation_store.release(upload_id)

        return {"status": "aborted", "uploadId": upload_id, "message": "Multipart upload aborted successfully"}

    async def delete_video(self, object_key: str) -> Dict[str, Any]:
        self.validate_object_key(object_key)
        client = self._get_client()

        try:
            # Check object exists
            client.head_object(Bucket=settings.R2_BUCKET_NAME, Key=object_key)
        except ClientError as e:
            error_code = e.response.get("Error", {}).get("Code", "")
            if error_code in ("404", "NoSuchKey"):
                raise HTTPException(status_code=404, detail="Video object not found in R2 bucket")
            raise HTTPException(
                status_code=502,
                detail=f"Error accessing video object: {e.response.get('Error', {}).get('Message', str(e))}"
            )

        try:
            client.delete_object(Bucket=settings.R2_BUCKET_NAME, Key=object_key)
        except ClientError as e:
            raise HTTPException(
                status_code=502,
                detail=f"Error deleting object from R2: {e.response.get('Error', {}).get('Message', str(e))}"
            )

        return {
            "status": "deleted",
            "key": object_key,
            "message": f"Successfully deleted video '{Path(object_key).name}'"
        }

    async def cleanup_abandoned_uploads(self, max_age_seconds: int = 86400) -> Dict[str, Any]:
        """
        Server-side cleanup for abandoned multipart uploads older than max_age_seconds.
        Never touches completed video objects.
        """
        client = self._get_client()
        aborted_count = 0
        now = time.time()

        try:
            paginator = client.get_paginator("list_multipart_uploads")
            for page in paginator.paginate(Bucket=settings.R2_BUCKET_NAME):
                for upload in page.get("Uploads", []):
                    initiated = upload.get("Initiated")
                    initiated_time = initiated.timestamp() if hasattr(initiated, "timestamp") else 0
                    if now - initiated_time > max_age_seconds:
                        try:
                            client.abort_multipart_upload(
                                Bucket=settings.R2_BUCKET_NAME,
                                Key=upload.get("Key"),
                                UploadId=upload.get("UploadId")
                            )
                            aborted_count += 1
                        except Exception:
                            pass
        except ClientError as e:
            raise HTTPException(
                status_code=502,
                detail=f"Failed to list or abort abandoned multipart uploads: {str(e)}"
            )

        # Clean up any expired reservations
        self._reservation_store.clean_expired(now)

        return {
            "status": "cleanup_completed",
            "abortedCount": aborted_count
        }

r2_service = R2StorageService()
