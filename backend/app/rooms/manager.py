import time
from typing import Optional, Tuple, List
from fastapi import HTTPException

from .repository import RoomRepository, room_repository
from ..models.room import RoomState, Participant, VideoMetadata, ControlMode

class RoomManager:
    def __init__(self, repo: RoomRepository = room_repository):
        self.repo = repo

    @staticmethod
    def current_server_time_ms() -> float:
        return time.time() * 1000.0

    def calculate_current_position(self, room: RoomState, server_time_ms: Optional[float] = None) -> float:
        now_ms = server_time_ms if server_time_ms is not None else self.current_server_time_ms()
        if not room.isPlaying:
            return round(room.position, 3)

        elapsed_seconds = (now_ms - room.lastStateChangeServerTime) / 1000.0
        rate = getattr(room, "playbackRate", 1.0) or 1.0
        current_pos = room.position + (elapsed_seconds * rate)

        if room.video and room.video.duration:
            if current_pos >= room.video.duration:
                return round(room.video.duration, 3)

        return round(max(0.0, current_pos), 3)

    def can_control(self, room: RoomState, participant_id: str) -> bool:
        if room.controlMode == ControlMode.EVERYONE:
            return True
        return room.hostId == participant_id

    async def create_room(
        self,
        room_id: str,
        host_id: str,
        host_display_name: str,
        control_mode: ControlMode = ControlMode.HOST_ONLY,
        video: Optional[VideoMetadata] = None,
        pause_on_buffer: bool = False
    ) -> RoomState:
        now_ms = self.current_server_time_ms()
        host = Participant(
            id=host_id,
            displayName=host_display_name,
            isHost=True,
            connected=False,
            joinedAt=now_ms
        )
        room = RoomState(
            roomId=room_id,
            hostId=host_id,
            ownerId=host_id,
            video=video,
            isPlaying=False,
            position=0.0,
            playbackRate=1.0,
            lastStateChangeServerTime=now_ms,
            controlMode=control_mode,
            pauseOnBuffer=pause_on_buffer,
            participants=[host],
            createdAt=now_ms
        )
        await self.repo.save_room(room)
        return room

    async def get_room(self, room_id: str) -> Optional[RoomState]:
        return await self.repo.get_room(room_id)

    async def delete_room(self, room_id: str) -> bool:
        return await self.repo.delete_room(room_id)

    async def handle_join(
        self, room_id: str, participant_id: str, display_name: str
    ) -> Tuple[RoomState, Participant, Optional[str]]:
        """
        Add or reconnect participant. Returns (room, participant, new_host_id_if_changed).
        """
        room = await self.repo.get_room(room_id)
        if not room:
            raise HTTPException(status_code=404, detail="Room not found")

        now_ms = self.current_server_time_ms()
        new_host_id = None

        existing = next((p for p in room.participants if p.id == participant_id), None)
        if existing:
            existing.connected = True
            existing.displayName = display_name
            participant = existing
            # If the room owner / creator reconnects, always ensure they reclaim host role
            if getattr(room, "ownerId", None) == participant_id or room.hostId == participant_id:
                if room.hostId != participant_id:
                    for p in room.participants:
                        p.isHost = (p.id == participant_id)
                    room.hostId = participant_id
                    new_host_id = participant_id
                else:
                    existing.isHost = True
        else:
            # A new participant is ONLY host if they are the designated owner/host
            is_owner = (getattr(room, "ownerId", None) == participant_id) or (room.hostId == participant_id)
            participant = Participant(
                id=participant_id,
                displayName=display_name,
                isHost=is_owner,
                connected=True,
                joinedAt=now_ms
            )
            room.participants.append(participant)
            if is_owner and room.hostId != participant_id:
                for p in room.participants:
                    p.isHost = (p.id == participant_id)
                room.hostId = participant_id
                new_host_id = participant_id

        # Update position if playing
        if room.isPlaying:
            room.position = self.calculate_current_position(room, now_ms)
            room.lastStateChangeServerTime = now_ms

        await self.repo.save_room(room)
        return room, participant, new_host_id

    async def handle_leave(
        self, room_id: str, participant_id: str
    ) -> Tuple[Optional[RoomState], Optional[str]]:
        """
        Handles participant disconnect. Returns (room, new_host_id_if_changed).
        """
        room = await self.repo.get_room(room_id)
        if not room:
            return None, None

        participant = next((p for p in room.participants if p.id == participant_id), None)
        if participant:
            participant.connected = False

        new_host_id = None
        # If host left, transfer host role to the next connected participant
        if room.hostId == participant_id:
            connected_participants = [p for p in room.participants if p.connected and p.id != participant_id]
            if connected_participants:
                next_host = connected_participants[0]
                next_host.isHost = True
                room.hostId = next_host.id
                new_host_id = next_host.id
                if participant:
                    participant.isHost = False

        # Update authoritative position before saving
        now_ms = self.current_server_time_ms()
        if room.isPlaying:
            room.position = self.calculate_current_position(room, now_ms)
            room.lastStateChangeServerTime = now_ms

        await self.repo.save_room(room)
        return room, new_host_id

    async def handle_play(
        self, room_id: str, participant_id: str, position: float
    ) -> Tuple[RoomState, float]:
        room = await self.repo.get_room(room_id)
        if not room:
            raise HTTPException(status_code=404, detail="Room not found")

        if not self.can_control(room, participant_id):
            raise HTTPException(status_code=403, detail="Permission denied: only host can control playback")

        now_ms = self.current_server_time_ms()
        room.isPlaying = True
        room.position = max(0.0, position)
        room.lastStateChangeServerTime = now_ms

        await self.repo.save_room(room)
        return room, now_ms

    async def handle_pause(
        self, room_id: str, participant_id: str, position: Optional[float] = None
    ) -> Tuple[RoomState, float]:
        room = await self.repo.get_room(room_id)
        if not room:
            raise HTTPException(status_code=404, detail="Room not found")

        if not self.can_control(room, participant_id):
            raise HTTPException(status_code=403, detail="Permission denied: only host can control playback")

        now_ms = self.current_server_time_ms()
        if position is not None:
            actual_pos = max(0.0, position)
        else:
            actual_pos = self.calculate_current_position(room, now_ms)

        room.isPlaying = False
        room.position = actual_pos
        room.lastStateChangeServerTime = now_ms

        await self.repo.save_room(room)
        return room, now_ms

    async def handle_seek(
        self, room_id: str, participant_id: str, position: float
    ) -> Tuple[RoomState, float]:
        room = await self.repo.get_room(room_id)
        if not room:
            raise HTTPException(status_code=404, detail="Room not found")

        if not self.can_control(room, participant_id):
            raise HTTPException(status_code=403, detail="Permission denied: only host can control playback")

        now_ms = self.current_server_time_ms()
        room.position = max(0.0, position)
        room.lastStateChangeServerTime = now_ms

        await self.repo.save_room(room)
        return room, now_ms

    async def handle_playback_rate(
        self, room_id: str, participant_id: str, rate: float
    ) -> Tuple[RoomState, float]:
        room = await self.repo.get_room(room_id)
        if not room:
            raise HTTPException(status_code=404, detail="Room not found")

        if not self.can_control(room, participant_id):
            raise HTTPException(status_code=403, detail="Permission denied: only host can control playback")

        if rate <= 0.0 or rate > 4.0:
            raise HTTPException(status_code=400, detail="Invalid playback rate: must be between 0.25 and 4.0")

        now_ms = self.current_server_time_ms()
        if room.isPlaying:
            room.position = self.calculate_current_position(room, now_ms)
            room.lastStateChangeServerTime = now_ms

        room.playbackRate = round(rate, 3)
        await self.repo.save_room(room)
        return room, now_ms

    async def handle_change_settings(
        self,
        room_id: str,
        participant_id: str,
        control_mode: Optional[ControlMode] = None,
        pause_on_buffer: Optional[bool] = None
    ) -> RoomState:
        room = await self.repo.get_room(room_id)
        if not room:
            raise HTTPException(status_code=404, detail="Room not found")

        if room.hostId != participant_id:
            raise HTTPException(status_code=403, detail="Only the room host can change room settings")

        if control_mode is not None:
            room.controlMode = control_mode
        if pause_on_buffer is not None:
            room.pauseOnBuffer = pause_on_buffer

        await self.repo.save_room(room)
        return room

    async def handle_change_video(
        self, room_id: str, participant_id: str, video: VideoMetadata
    ) -> RoomState:
        room = await self.repo.get_room(room_id)
        if not room:
            raise HTTPException(status_code=404, detail="Room not found")

        if room.hostId != participant_id:
            raise HTTPException(status_code=403, detail="Only the room host can change the video")

        now_ms = self.current_server_time_ms()
        room.video = video
        room.position = 0.0
        room.isPlaying = False
        room.lastStateChangeServerTime = now_ms

        await self.repo.save_room(room)
        return room

    async def handle_buffering(
        self, room_id: str, participant_id: str, is_buffering: bool
    ) -> Tuple[RoomState, bool]:
        """
        Updates buffer state. Returns (room, should_broadcast_pause).
        """
        room = await self.repo.get_room(room_id)
        if not room:
            raise HTTPException(status_code=404, detail="Room not found")

        participant = next((p for p in room.participants if p.id == participant_id), None)
        if participant:
            participant.isBuffering = is_buffering

        should_broadcast_pause = False
        if room.pauseOnBuffer and is_buffering and room.isPlaying:
            now_ms = self.current_server_time_ms()
            room.position = self.calculate_current_position(room, now_ms)
            room.isPlaying = False
            room.lastStateChangeServerTime = now_ms
            should_broadcast_pause = True

        await self.repo.save_room(room)
        return room, should_broadcast_pause

room_manager = RoomManager()
