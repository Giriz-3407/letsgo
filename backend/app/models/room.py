from enum import Enum
from typing import List, Optional
from pydantic import BaseModel, Field
import time

class ControlMode(str, Enum):
    HOST_ONLY = "HOST_ONLY"
    EVERYONE = "EVERYONE"

class Participant(BaseModel):
    id: str
    displayName: str
    isHost: bool = False
    connected: bool = True
    joinedAt: float = Field(default_factory=lambda: time.time() * 1000)
    isBuffering: bool = False

class VideoMetadata(BaseModel):
    id: str
    name: str
    mimeType: str = "video/mp4"
    size: Optional[int] = None
    duration: Optional[float] = None
    streamUrl: str
    downloadUrl: Optional[str] = None
    provider: str = "local"

class RoomState(BaseModel):
    roomId: str
    hostId: str
    video: Optional[VideoMetadata] = None
    isPlaying: bool = False
    position: float = 0.0
    lastStateChangeServerTime: float = Field(default_factory=lambda: time.time() * 1000)
    controlMode: ControlMode = ControlMode.HOST_ONLY
    pauseOnBuffer: bool = False
    participants: List[Participant] = []
    createdAt: float = Field(default_factory=lambda: time.time() * 1000)
