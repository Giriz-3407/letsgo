import mimetypes
from pathlib import Path
from typing import List, Optional, Dict, Any
from fastapi import HTTPException
import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from ..config import settings
from ..models.room import VideoMetadata

SUPPORTED_VIDEO_EXTS = {".mp4", ".webm", ".mov", ".mkv"}

class R2StorageService:
    def __init__(self, s3_client: Optional[Any] = None):
        self._s3_client = s3_client

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

r2_service = R2StorageService()
