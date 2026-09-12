import httpx
from pathlib import Path
from typing import List, Optional
import aiofiles
from fastapi import HTTPException

from .base import StorageProvider
from ..models.room import VideoMetadata
from ..config import settings

GOOGLE_DRIVE_API_BASE = "https://www.googleapis.com/drive/v3"

class GoogleDriveStorageProvider(StorageProvider):
    def __init__(self, cache_dir: Optional[Path] = None):
        self.cache_dir = cache_dir or settings.MEDIA_DIR
        self.cache_dir.mkdir(parents=True, exist_ok=True)

    async def list_videos(self, user_token: Optional[str] = None) -> List[VideoMetadata]:
        if not user_token:
            return []

        headers = {"Authorization": f"Bearer {user_token}"}
        query = "trashed = false and (mimeType contains 'video/' or name contains '.mp4' or name contains '.webm')"
        params = {
            "q": query,
            "fields": "files(id, name, mimeType, size, videoMediaMetadata)",
            "pageSize": 50,
            "orderBy": "modifiedTime desc"
        }

        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{GOOGLE_DRIVE_API_BASE}/files", headers=headers, params=params)
            if resp.status_code != 200:
                raise HTTPException(status_code=resp.status_code, detail=f"Google Drive API error: {resp.text}")

            data = resp.json()
            files = data.get("files", [])

            results: List[VideoMetadata] = []
            for f in files:
                duration_sec = None
                if "videoMediaMetadata" in f and "durationMillis" in f["videoMediaMetadata"]:
                    duration_sec = float(f["videoMediaMetadata"]["durationMillis"]) / 1000.0

                results.append(
                    VideoMetadata(
                        id=f["id"],
                        name=f["name"],
                        mimeType=f.get("mimeType", "video/mp4"),
                        size=int(f["size"]) if "size" in f else None,
                        duration=duration_sec,
                        streamUrl=f"/api/drive/videos/{f['id']}/stream",
                        downloadUrl=f"/api/drive/videos/{f['id']}/download",
                        provider="google_drive"
                    )
                )
            return results

    async def get_video_metadata(self, video_id: str, user_token: Optional[str] = None) -> Optional[VideoMetadata]:
        if not user_token:
            return None

        headers = {"Authorization": f"Bearer {user_token}"}
        params = {"fields": "id, name, mimeType, size, videoMediaMetadata"}

        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{GOOGLE_DRIVE_API_BASE}/files/{video_id}", headers=headers, params=params)
            if resp.status_code != 200:
                return None

            f = resp.json()
            duration_sec = None
            if "videoMediaMetadata" in f and "durationMillis" in f["videoMediaMetadata"]:
                duration_sec = float(f["videoMediaMetadata"]["durationMillis"]) / 1000.0

            return VideoMetadata(
                id=f["id"],
                name=f["name"],
                mimeType=f.get("mimeType", "video/mp4"),
                size=int(f["size"]) if "size" in f else None,
                duration=duration_sec,
                streamUrl=f"/api/drive/videos/{f['id']}/stream",
                downloadUrl=f"/api/drive/videos/{f['id']}/download",
                provider="google_drive"
            )

    async def get_stream_url(self, video_id: str, base_url: str) -> str:
        return f"{base_url.rstrip('/')}/api/drive/videos/{video_id}/stream"

    async def import_video(self, source_id: str, user_token: Optional[str] = None) -> VideoMetadata:
        """
        Download Drive file to local storage cache for high-performance range-request streaming.
        """
        if not user_token:
            raise HTTPException(status_code=401, detail="Google authentication required to import Drive video")

        metadata = await self.get_video_metadata(source_id, user_token)
        if not metadata:
            raise HTTPException(status_code=404, detail="Drive video not found")

        dest_filename = f"drive_{source_id}.mp4"
        dest_path = self.cache_dir / dest_filename

        # If already cached, return immediately
        if dest_path.exists() and dest_path.stat().st_size > 0:
            return VideoMetadata(
                id=f"drive_{source_id}",
                name=metadata.name,
                mimeType=metadata.mimeType,
                size=dest_path.stat().st_size,
                duration=metadata.duration,
                streamUrl=f"/api/videos/drive_{source_id}/stream",
                downloadUrl=f"/api/videos/drive_{source_id}/download",
                provider="local"
            )

        headers = {"Authorization": f"Bearer {user_token}"}
        url = f"{GOOGLE_DRIVE_API_BASE}/files/{source_id}?alt=media"

        async with httpx.AsyncClient(timeout=300.0) as client:
            async with client.stream("GET", url, headers=headers) as resp:
                if resp.status_code != 200:
                    raise HTTPException(status_code=resp.status_code, detail="Failed to fetch video from Google Drive")

                async with aiofiles.open(dest_path, "wb") as f:
                    async for chunk in resp.aiter_bytes(chunk_size=1024 * 1024):
                        await f.write(chunk)

        stat = dest_path.stat()
        return VideoMetadata(
            id=f"drive_{source_id}",
            name=metadata.name,
            mimeType=metadata.mimeType,
            size=stat.st_size,
            duration=metadata.duration,
            streamUrl=f"/api/videos/drive_{source_id}/stream",
            downloadUrl=f"/api/videos/drive_{source_id}/download",
            provider="local"
        )
