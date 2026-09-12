import os
import re
from pathlib import Path
from typing import List, Optional, Tuple, Generator, AsyncGenerator
import aiofiles
from fastapi import HTTPException
from fastapi.responses import StreamingResponse

from .base import StorageProvider
from ..models.room import VideoMetadata
from ..config import settings

class LocalStorageProvider(StorageProvider):
    def __init__(self, media_dir: Optional[Path] = None):
        self.media_dir = media_dir or settings.MEDIA_DIR
        self.media_dir.mkdir(parents=True, exist_ok=True)

    async def list_videos(self, user_token: Optional[str] = None) -> List[VideoMetadata]:
        videos = []
        supported_exts = {".mp4", ".webm", ".mov", ".mkv"}
        
        for file_path in self.media_dir.glob("*"):
            if file_path.is_file() and file_path.suffix.lower() in supported_exts:
                stat = file_path.stat()
                vid_id = file_path.stem
                mime = "video/mp4" if file_path.suffix.lower() == ".mp4" else f"video/{file_path.suffix[1:]}"
                
                videos.append(
                    VideoMetadata(
                        id=vid_id,
                        name=file_path.name,
                        mimeType=mime,
                        size=stat.st_size,
                        duration=None,  # Populated dynamically by frontend HTML5 video
                        streamUrl=f"/api/videos/{vid_id}/stream",
                        downloadUrl=f"/api/videos/{vid_id}/download",
                        provider="local"
                    )
                )
        return videos

    async def get_video_metadata(self, video_id: str, user_token: Optional[str] = None) -> Optional[VideoMetadata]:
        for ext in [".mp4", ".webm", ".mov", ".mkv"]:
            candidate = self.media_dir / f"{video_id}{ext}"
            if candidate.exists():
                stat = candidate.stat()
                mime = "video/mp4" if ext == ".mp4" else f"video/{ext[1:]}"
                return VideoMetadata(
                    id=video_id,
                    name=candidate.name,
                    mimeType=mime,
                    size=stat.st_size,
                    duration=None,
                    streamUrl=f"/api/videos/{video_id}/stream",
                    downloadUrl=f"/api/videos/{video_id}/download",
                    provider="local"
                )
        return None

    def get_file_path(self, video_id: str) -> Optional[Path]:
        for ext in [".mp4", ".webm", ".mov", ".mkv"]:
            candidate = self.media_dir / f"{video_id}{ext}"
            if candidate.exists():
                return candidate
        return None

    async def get_stream_url(self, video_id: str, base_url: str) -> str:
        return f"{base_url.rstrip('/')}/api/videos/{video_id}/stream"

    async def import_video(self, source_id: str, user_token: Optional[str] = None) -> VideoMetadata:
        raise NotImplementedError("Local storage provider does not need import.")

    @staticmethod
    def parse_range_header(range_header: str, file_size: int) -> Tuple[int, int]:
        """
        Parse HTTP Range header, e.g. 'bytes=0-1024' or 'bytes=1024-'
        """
        match = re.match(r"bytes=(\d+)-(\d*)", range_header)
        if not match:
            return 0, file_size - 1
        
        start_str, end_str = match.groups()
        start = int(start_str)
        end = int(end_str) if end_str else file_size - 1
        
        if start >= file_size:
            raise HTTPException(status_code=416, detail="Requested Range Not Satisfiable")
        
        end = min(end, file_size - 1)
        return start, end

    @classmethod
    async def create_range_response(
        cls, file_path: Path, range_header: Optional[str], chunk_size: int = 1024 * 512
    ) -> StreamingResponse:
        file_size = file_path.stat().st_size
        mime_type = "video/mp4" if file_path.suffix.lower() == ".mp4" else f"video/{file_path.suffix[1:]}"

        if not range_header:
            async def full_file_iterator() -> AsyncGenerator[bytes, None]:
                async with aiofiles.open(file_path, mode="rb") as f:
                    while chunk := await f.read(chunk_size):
                        yield chunk

            return StreamingResponse(
                full_file_iterator(),
                status_code=200,
                headers={
                    "Content-Length": str(file_size),
                    "Accept-Ranges": "bytes",
                    "Content-Type": mime_type,
                    "Cache-Control": "public, max-age=3600"
                }
            )

        start, end = cls.parse_range_header(range_header, file_size)
        content_length = end - start + 1

        async def range_iterator() -> AsyncGenerator[bytes, None]:
            async with aiofiles.open(file_path, mode="rb") as f:
                await f.seek(start)
                bytes_left = content_length
                while bytes_left > 0:
                    read_len = min(chunk_size, bytes_left)
                    chunk = await f.read(read_len)
                    if not chunk:
                        break
                    bytes_left -= len(chunk)
                    yield chunk

        return StreamingResponse(
            range_iterator(),
            status_code=206,
            headers={
                "Content-Range": f"bytes {start}-{end}/{file_size}",
                "Accept-Ranges": "bytes",
                "Content-Length": str(content_length),
                "Content-Type": mime_type,
                "Cache-Control": "public, max-age=3600"
            }
        )
