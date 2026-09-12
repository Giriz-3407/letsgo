from enum import Enum
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field
import time
from .room import ControlMode, Participant, VideoMetadata

class MessageType(str, Enum):
    # Inbound / Outbound Shared
    PLAY = "PLAY"
    PAUSE = "PAUSE"
    SEEK = "SEEK"
    BUFFERING = "BUFFERING"
    PLAYBACK_RATE = "PLAYBACK_RATE"
    
    # Inbound
    JOIN = "JOIN"
    SYNC_REQUEST = "SYNC_REQUEST"
    TIME_SYNC = "TIME_SYNC"
    CHANGE_SETTINGS = "CHANGE_SETTINGS"
    CHANGE_VIDEO = "CHANGE_VIDEO"
    KICK_PARTICIPANT = "KICK_PARTICIPANT"
    PING = "PING"

    # Outbound
    ROOM_STATE = "ROOM_STATE"
    TIME_SYNC_REPLY = "TIME_SYNC_REPLY"
    PARTICIPANT_JOINED = "PARTICIPANT_JOINED"
    PARTICIPANT_LEFT = "PARTICIPANT_LEFT"
    HOST_CHANGED = "HOST_CHANGED"
    VIDEO_CHANGED = "VIDEO_CHANGED"
    SETTINGS_CHANGED = "SETTINGS_CHANGED"
    BUFFER_STATE = "BUFFER_STATE"
    ERROR = "ERROR"
    PONG = "PONG"

class BaseMessage(BaseModel):
    type: MessageType

# Inbound messages
class JoinMessage(BaseModel):
    type: MessageType = MessageType.JOIN
    participantId: str
    displayName: str

class PlayMessage(BaseModel):
    type: MessageType = MessageType.PLAY
    position: float
    clientTime: Optional[float] = None

class PauseMessage(BaseModel):
    type: MessageType = MessageType.PAUSE
    position: Optional[float] = None

class SeekMessage(BaseModel):
    type: MessageType = MessageType.SEEK
    position: float

class BufferingMessage(BaseModel):
    type: MessageType = MessageType.BUFFERING
    isBuffering: bool
    position: Optional[float] = None

class TimeSyncMessage(BaseModel):
    type: MessageType = MessageType.TIME_SYNC
    t1: float

class ChangeSettingsMessage(BaseModel):
    type: MessageType = MessageType.CHANGE_SETTINGS
    controlMode: Optional[ControlMode] = None
    pauseOnBuffer: Optional[bool] = None

class ChangeVideoMessage(BaseModel):
    type: MessageType = MessageType.CHANGE_VIDEO
    videoId: str

class PlaybackRateMessage(BaseModel):
    type: MessageType = MessageType.PLAYBACK_RATE
    rate: float

# Outbound messages
class RoomStateBroadcast(BaseModel):
    type: MessageType = MessageType.ROOM_STATE
    roomId: str
    hostId: str
    video: Optional[VideoMetadata] = None
    isPlaying: bool
    position: float
    lastStateChangeServerTime: float
    controlMode: ControlMode
    pauseOnBuffer: bool
    participants: List[Participant]
    playbackRate: float = 1.0
    serverTime: float = Field(default_factory=lambda: time.time() * 1000)

class PlayBroadcast(BaseModel):
    type: MessageType = MessageType.PLAY
    position: float
    serverTime: float = Field(default_factory=lambda: time.time() * 1000)

class PauseBroadcast(BaseModel):
    type: MessageType = MessageType.PAUSE
    position: float
    serverTime: float = Field(default_factory=lambda: time.time() * 1000)

class SeekBroadcast(BaseModel):
    type: MessageType = MessageType.SEEK
    position: float
    isPlaying: bool
    serverTime: float = Field(default_factory=lambda: time.time() * 1000)

class PlaybackRateBroadcast(BaseModel):
    type: MessageType = MessageType.PLAYBACK_RATE
    rate: float
    position: float
    serverTime: float = Field(default_factory=lambda: time.time() * 1000)

class TimeSyncReply(BaseModel):
    type: MessageType = MessageType.TIME_SYNC_REPLY
    t1: float
    serverTime: float = Field(default_factory=lambda: time.time() * 1000)

class ParticipantJoinedBroadcast(BaseModel):
    type: MessageType = MessageType.PARTICIPANT_JOINED
    participant: Participant
    serverTime: float = Field(default_factory=lambda: time.time() * 1000)

class ParticipantLeftBroadcast(BaseModel):
    type: MessageType = MessageType.PARTICIPANT_LEFT
    participantId: str
    serverTime: float = Field(default_factory=lambda: time.time() * 1000)

class HostChangedBroadcast(BaseModel):
    type: MessageType = MessageType.HOST_CHANGED
    hostId: str
    serverTime: float = Field(default_factory=lambda: time.time() * 1000)

class VideoChangedBroadcast(BaseModel):
    type: MessageType = MessageType.VIDEO_CHANGED
    video: Optional[VideoMetadata]
    serverTime: float = Field(default_factory=lambda: time.time() * 1000)

class SettingsChangedBroadcast(BaseModel):
    type: MessageType = MessageType.SETTINGS_CHANGED
    controlMode: ControlMode
    pauseOnBuffer: bool
    serverTime: float = Field(default_factory=lambda: time.time() * 1000)

class ErrorBroadcast(BaseModel):
    type: MessageType = MessageType.ERROR
    message: str
    code: str = "GENERIC_ERROR"
