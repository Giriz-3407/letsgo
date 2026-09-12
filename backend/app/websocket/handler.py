import json
import logging
from typing import Dict, Set, Optional, Tuple
from fastapi import WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from ..rooms.manager import room_manager
from ..models.messages import (
    MessageType,
    RoomStateBroadcast,
    PlayBroadcast,
    PauseBroadcast,
    SeekBroadcast,
    PlaybackRateBroadcast,
    TimeSyncReply,
    ParticipantJoinedBroadcast,
    ParticipantLeftBroadcast,
    HostChangedBroadcast,
    VideoChangedBroadcast,
    SettingsChangedBroadcast,
    ErrorBroadcast,
)
from ..models.room import ControlMode

logger = logging.getLogger("watchtogether.ws")

class ConnectionManager:
    def __init__(self):
        # Maps roomId -> Dict[participantId, WebSocket]
        self._room_connections: Dict[str, Dict[str, WebSocket]] = {}
        # Maps WebSocket -> (roomId, participantId)
        self._socket_map: Dict[WebSocket, Tuple[str, str]] = {}

    async def connect(self, room_id: str, participant_id: str, websocket: WebSocket):
        await websocket.accept()
        if room_id not in self._room_connections:
            self._room_connections[room_id] = {}
        self._room_connections[room_id][participant_id] = websocket
        self._socket_map[websocket] = (room_id, participant_id)

    def disconnect(self, websocket: WebSocket) -> Tuple[Optional[str], Optional[str]]:
        if websocket in self._socket_map:
            room_id, participant_id = self._socket_map.pop(websocket)
            if room_id in self._room_connections:
                self._room_connections[room_id].pop(participant_id, None)
                if not self._room_connections[room_id]:
                    del self._room_connections[room_id]
            return room_id, participant_id
        return None, None

    async def broadcast(self, room_id: str, data: dict, exclude_participant: Optional[str] = None):
        if room_id not in self._room_connections:
            return

        dead_participants = []
        for pid, ws in list(self._room_connections[room_id].items()):
            if exclude_participant and pid == exclude_participant:
                continue
            try:
                await ws.send_json(data)
            except Exception as e:
                logger.warning(f"Error broadcasting to {pid}: {e}")
                dead_participants.append((pid, ws))

        for pid, ws in dead_participants:
            self.disconnect(ws)

    async def send_personal(self, websocket: WebSocket, data: dict):
        try:
            await websocket.send_json(data)
        except Exception as e:
            logger.warning(f"Error sending personal message: {e}")

connection_manager = ConnectionManager()

async def handle_websocket_connection(websocket: WebSocket, room_id: str):
    # Retrieve query params if any
    query_params = websocket.query_params
    participant_id = query_params.get("participant_id")
    display_name = query_params.get("display_name", "Viewer")

    if not participant_id:
        await websocket.close(code=4001, reason="Missing participant_id")
        return

    # Check if room exists
    room = await room_manager.get_room(room_id)
    if not room:
        await websocket.close(code=4004, reason="Room not found")
        return

    # Join room in manager
    try:
        updated_room, participant, new_host = await room_manager.handle_join(
            room_id=room_id, participant_id=participant_id, display_name=display_name
        )
    except Exception as e:
        await websocket.close(code=4000, reason=str(e))
        return

    # Accept & register connection
    await connection_manager.connect(room_id, participant_id, websocket)

    # 1. Send current authoritative ROOM_STATE snapshot to the newly connected participant
    now_ms = room_manager.current_server_time_ms()
    current_pos = room_manager.calculate_current_position(updated_room, now_ms)
    
    state_msg = RoomStateBroadcast(
        roomId=updated_room.roomId,
        hostId=updated_room.hostId,
        video=updated_room.video,
        isPlaying=updated_room.isPlaying,
        position=current_pos,
        playbackRate=getattr(updated_room, "playbackRate", 1.0),
        lastStateChangeServerTime=updated_room.lastStateChangeServerTime,
        controlMode=updated_room.controlMode,
        pauseOnBuffer=updated_room.pauseOnBuffer,
        participants=updated_room.participants,
        serverTime=now_ms,
    )
    await connection_manager.send_personal(websocket, state_msg.model_dump(mode="json"))

    # 2. Broadcast PARTICIPANT_JOINED to all other participants
    join_broadcast = ParticipantJoinedBroadcast(participant=participant, serverTime=now_ms)
    await connection_manager.broadcast(room_id, join_broadcast.model_dump(mode="json"), exclude_participant=participant_id)

    if new_host:
        host_broadcast = HostChangedBroadcast(hostId=new_host, serverTime=now_ms)
        await connection_manager.broadcast(room_id, host_broadcast.model_dump(mode="json"))

    # Message loop
    try:
        while True:
            raw_data = await websocket.receive_text()
            try:
                msg = json.loads(raw_data)
            except json.JSONDecodeError:
                await connection_manager.send_personal(
                    websocket, ErrorBroadcast(message="Invalid JSON message").model_dump(mode="json")
                )
                continue

            msg_type = msg.get("type")

            if msg_type == MessageType.TIME_SYNC:
                # NTP-style ping
                t1 = msg.get("t1", 0.0)
                reply = TimeSyncReply(t1=t1, serverTime=room_manager.current_server_time_ms())
                await connection_manager.send_personal(websocket, reply.model_dump(mode="json"))

            elif msg_type == MessageType.SYNC_REQUEST:
                # Client explicitly asking for authoritative state
                r = await room_manager.get_room(room_id)
                if r:
                    cur_time = room_manager.current_server_time_ms()
                    pos = room_manager.calculate_current_position(r, cur_time)
                    s_msg = RoomStateBroadcast(
                        roomId=r.roomId,
                        hostId=r.hostId,
                        video=r.video,
                        isPlaying=r.isPlaying,
                        position=pos,
                        playbackRate=getattr(r, "playbackRate", 1.0),
                        lastStateChangeServerTime=r.lastStateChangeServerTime,
                        controlMode=r.controlMode,
                        pauseOnBuffer=r.pauseOnBuffer,
                        participants=r.participants,
                        serverTime=cur_time,
                    )
                    await connection_manager.send_personal(websocket, s_msg.model_dump(mode="json"))

            elif msg_type == MessageType.PLAY:
                pos = float(msg.get("position", 0.0))
                try:
                    r, s_time = await room_manager.handle_play(room_id, participant_id, pos)
                    broadcast = PlayBroadcast(position=r.position, serverTime=s_time)
                    await connection_manager.broadcast(room_id, broadcast.model_dump(mode="json"))
                except Exception as e:
                    await connection_manager.send_personal(
                        websocket, ErrorBroadcast(message=str(e), code="PLAY_ERROR").model_dump(mode="json")
                    )

            elif msg_type == MessageType.PAUSE:
                pos = msg.get("position")
                pos_val = float(pos) if pos is not None else None
                try:
                    r, s_time = await room_manager.handle_pause(room_id, participant_id, pos_val)
                    broadcast = PauseBroadcast(position=r.position, serverTime=s_time)
                    await connection_manager.broadcast(room_id, broadcast.model_dump(mode="json"))
                except Exception as e:
                    await connection_manager.send_personal(
                        websocket, ErrorBroadcast(message=str(e), code="PAUSE_ERROR").model_dump(mode="json")
                    )

            elif msg_type == MessageType.SEEK:
                pos = float(msg.get("position", 0.0))
                try:
                    r, s_time = await room_manager.handle_seek(room_id, participant_id, pos)
                    broadcast = SeekBroadcast(position=r.position, isPlaying=r.isPlaying, serverTime=s_time)
                    await connection_manager.broadcast(room_id, broadcast.model_dump(mode="json"))
                except Exception as e:
                    await connection_manager.send_personal(
                        websocket, ErrorBroadcast(message=str(e), code="SEEK_ERROR").model_dump(mode="json")
                    )

            elif msg_type == MessageType.PLAYBACK_RATE:
                rate_val = msg.get("rate")
                try:
                    if rate_val is None:
                        raise ValueError("Missing playback rate")
                    rate = float(rate_val)
                    r, s_time = await room_manager.handle_playback_rate(room_id, participant_id, rate)
                    broadcast = PlaybackRateBroadcast(rate=r.playbackRate, position=r.position, serverTime=s_time)
                    await connection_manager.broadcast(room_id, broadcast.model_dump(mode="json"))
                except Exception as e:
                    await connection_manager.send_personal(
                        websocket, ErrorBroadcast(message=str(e), code="PLAYBACK_RATE_ERROR").model_dump(mode="json")
                    )

            elif msg_type == MessageType.BUFFERING:
                is_buffering = bool(msg.get("isBuffering", False))
                try:
                    r, should_pause = await room_manager.handle_buffering(room_id, participant_id, is_buffering)
                    if should_pause:
                        pause_bc = PauseBroadcast(position=r.position, serverTime=r.lastStateChangeServerTime)
                        await connection_manager.broadcast(room_id, pause_bc.model_dump(mode="json"))
                except Exception as e:
                    logger.error(f"Error handling buffering: {e}")

            elif msg_type == MessageType.CHANGE_SETTINGS:
                ctrl_mode_raw = msg.get("controlMode")
                ctrl_mode = ControlMode(ctrl_mode_raw) if ctrl_mode_raw else None
                pause_buf = msg.get("pauseOnBuffer")
                try:
                    r = await room_manager.handle_change_settings(
                        room_id, participant_id, control_mode=ctrl_mode, pause_on_buffer=pause_buf
                    )
                    settings_bc = SettingsChangedBroadcast(
                        controlMode=r.controlMode, pauseOnBuffer=r.pauseOnBuffer, serverTime=room_manager.current_server_time_ms()
                    )
                    await connection_manager.broadcast(room_id, settings_bc.model_dump(mode="json"))
                except Exception as e:
                    await connection_manager.send_personal(
                        websocket, ErrorBroadcast(message=str(e), code="SETTINGS_ERROR").model_dump(mode="json")
                    )

            elif msg_type == MessageType.PING:
                await connection_manager.send_personal(websocket, {"type": "PONG", "serverTime": room_manager.current_server_time_ms()})

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error(f"WebSocket error for {participant_id} in {room_id}: {e}")
    finally:
        connection_manager.disconnect(websocket)
        updated_room, new_host = await room_manager.handle_leave(room_id, participant_id)
        if updated_room:
            leave_bc = ParticipantLeftBroadcast(
                participantId=participant_id, serverTime=room_manager.current_server_time_ms()
            )
            await connection_manager.broadcast(room_id, leave_bc.model_dump(mode="json"))
            if new_host:
                host_bc = HostChangedBroadcast(
                    hostId=new_host, serverTime=room_manager.current_server_time_ms()
                )
                await connection_manager.broadcast(room_id, host_bc.model_dump(mode="json"))
