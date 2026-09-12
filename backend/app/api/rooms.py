import random
import string
import time
from typing import Optional
from fastapi import APIRouter, HTTPException, Header, Depends
from pydantic import BaseModel

from ..rooms.manager import room_manager
from ..websocket.handler import connection_manager
from ..storage.local import LocalStorageProvider
from ..models.room import ControlMode, VideoMetadata, RoomState
from ..models.messages import VideoChangedBroadcast, SettingsChangedBroadcast

router = APIRouter(prefix="/api/rooms", tags=["rooms"])
local_storage = LocalStorageProvider()

def generate_room_id(length: int = 6) -> str:
    chars = string.ascii_uppercase + string.digits
    # Exclude ambiguous characters like 0, O, 1, I
    clean_chars = [c for c in chars if c not in "0O1I"]
    return "".join(random.choices(clean_chars, k=length))

class CreateRoomRequest(BaseModel):
    hostDisplayName: str = "Host"
    controlMode: ControlMode = ControlMode.HOST_ONLY
    videoId: Optional[str] = None
    pauseOnBuffer: bool = False

class CreateRoomResponse(BaseModel):
    roomId: str
    hostId: str
    joinUrl: str
    controlMode: ControlMode

class UpdateVideoRequest(BaseModel):
    videoId: str
    hostId: str

class UpdateSettingsRequest(BaseModel):
    hostId: str
    controlMode: Optional[ControlMode] = None
    pauseOnBuffer: Optional[bool] = None

@router.post("", response_model=CreateRoomResponse)
async def create_room(req: CreateRoomRequest):
    room_id = generate_room_id()
    host_id = f"user_{generate_room_id(8).lower()}"

    video_meta = None
    if req.videoId:
        video_meta = await local_storage.get_video_metadata(req.videoId)

    room = await room_manager.create_room(
        room_id=room_id,
        host_id=host_id,
        host_display_name=req.hostDisplayName,
        control_mode=req.controlMode,
        video=video_meta,
        pause_on_buffer=req.pauseOnBuffer
    )

    return CreateRoomResponse(
        roomId=room.roomId,
        hostId=room.hostId,
        joinUrl=f"/room/{room.roomId}",
        controlMode=room.controlMode
    )

@router.get("/{room_id}")
async def get_room(room_id: str):
    room = await room_manager.get_room(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    
    cur_time = room_manager.current_server_time_ms()
    pos = room_manager.calculate_current_position(room, cur_time)
    
    return {
        "roomId": room.roomId,
        "hostId": room.hostId,
        "video": room.video,
        "isPlaying": room.isPlaying,
        "position": pos,
        "lastStateChangeServerTime": room.lastStateChangeServerTime,
        "controlMode": room.controlMode,
        "pauseOnBuffer": room.pauseOnBuffer,
        "participants": room.participants,
        "serverTime": cur_time
    }

@router.delete("/{room_id}")
async def delete_room(room_id: str, host_id: str):
    room = await room_manager.get_room(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    if room.hostId != host_id:
        raise HTTPException(status_code=403, detail="Only host can delete room")

    await room_manager.delete_room(room_id)
    return {"status": "deleted", "roomId": room_id}

@router.post("/{room_id}/video")
async def set_room_video(room_id: str, req: UpdateVideoRequest):
    room = await room_manager.get_room(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    if room.hostId != req.hostId:
        raise HTTPException(status_code=403, detail="Only host can change the video")

    video = await local_storage.get_video_metadata(req.videoId)
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")

    updated_room = await room_manager.handle_change_video(room_id, req.hostId, video)

    # Broadcast to all connected clients
    bc = VideoChangedBroadcast(video=updated_room.video, serverTime=room_manager.current_server_time_ms())
    await connection_manager.broadcast(room_id, bc.model_dump(mode="json"))

    return {"status": "updated", "video": updated_room.video}

@router.post("/{room_id}/settings")
async def set_room_settings(room_id: str, req: UpdateSettingsRequest):
    room = await room_manager.get_room(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    if room.hostId != req.hostId:
        raise HTTPException(status_code=403, detail="Only host can change room settings")

    updated_room = await room_manager.handle_change_settings(
        room_id, req.hostId, control_mode=req.controlMode, pause_on_buffer=req.pauseOnBuffer
    )

    bc = SettingsChangedBroadcast(
        controlMode=updated_room.controlMode,
        pauseOnBuffer=updated_room.pauseOnBuffer,
        serverTime=room_manager.current_server_time_ms()
    )
    await connection_manager.broadcast(room_id, bc.model_dump(mode="json"))

    return {
        "status": "updated",
        "controlMode": updated_room.controlMode,
        "pauseOnBuffer": updated_room.pauseOnBuffer
    }
