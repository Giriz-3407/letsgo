from abc import ABC, abstractmethod
from typing import List, Optional
from ..models.room import VideoMetadata

class StorageProvider(ABC):
    @abstractmethod
    async def list_videos(self, user_token: Optional[str] = None) -> List[VideoMetadata]:
        """List accessible videos from this storage provider."""
        pass

    @abstractmethod
    async def get_video_metadata(self, video_id: str, user_token: Optional[str] = None) -> Optional[VideoMetadata]:
        """Retrieve metadata for a specific video."""
        pass

    @abstractmethod
    async def get_stream_url(self, video_id: str, base_url: str) -> str:
        """Return the URL where the browser can directly stream the video."""
        pass

    @abstractmethod
    async def import_video(self, source_id: str, user_token: Optional[str] = None) -> VideoMetadata:
        """Import/cache a video into application storage for high-speed streaming."""
        pass
