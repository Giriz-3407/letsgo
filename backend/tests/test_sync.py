import pytest
import time
from app.rooms.manager import RoomManager
from app.rooms.repository import InMemoryRoomRepository
from app.models.room import ControlMode, VideoMetadata, RoomState

@pytest.fixture
def manager():
    repo = InMemoryRoomRepository()
    return RoomManager(repo=repo)

@pytest.mark.asyncio
async def test_room_creation_and_authoritative_position(manager: RoomManager):
    room = await manager.create_room(
        room_id="ROOM12",
        host_id="host_1",
        host_display_name="Alice",
        control_mode=ControlMode.HOST_ONLY
    )
    assert room.roomId == "ROOM12"
    assert room.hostId == "host_1"
    assert room.isPlaying is False
    assert room.position == 0.0

    # Test play event at pos 10.0
    updated_room, server_time = await manager.handle_play("ROOM12", "host_1", 10.0)
    assert updated_room.isPlaying is True
    assert updated_room.position == 10.0

    # Calculate position after 3 simulated seconds
    simulated_future_time = server_time + 3000.0  # +3 seconds
    future_pos = manager.calculate_current_position(updated_room, simulated_future_time)
    assert future_pos == 13.0

    # Test pause event at 5 simulated seconds
    simulated_pause_time = server_time + 5000.0
    paused_room, pause_server_time = await manager.handle_pause("ROOM12", "host_1", None)
    assert paused_room.isPlaying is False
    assert paused_room.position >= 10.0

@pytest.mark.asyncio
async def test_permissions_enforcement(manager: RoomManager):
    await manager.create_room(
        room_id="ROOM_PERM",
        host_id="host_alice",
        host_display_name="Alice",
        control_mode=ControlMode.HOST_ONLY
    )

    # Bob tries to play in HOST_ONLY room -> should raise 403
    with pytest.raises(Exception) as exc_info:
        await manager.handle_play("ROOM_PERM", "bob", 15.0)
    assert "Permission denied" in str(exc_info.value)

    # Bob tries to seek in HOST_ONLY room -> should raise 403
    with pytest.raises(Exception) as exc_info:
        await manager.handle_seek("ROOM_PERM", "bob", 30.0)
    assert "Permission denied" in str(exc_info.value)

    # Alice switches control mode to EVERYONE
    await manager.handle_change_settings("ROOM_PERM", "host_alice", control_mode=ControlMode.EVERYONE)

    # Now Bob can play and seek!
    room, _ = await manager.handle_play("ROOM_PERM", "bob", 25.0)
    assert room.isPlaying is True
    assert room.position == 25.0

    room, _ = await manager.handle_seek("ROOM_PERM", "bob", 40.0)
    assert room.position == 40.0

@pytest.mark.asyncio
async def test_late_joiner_and_host_transfer(manager: RoomManager):
    room = await manager.create_room(
        room_id="ROOM_LATE",
        host_id="host_alice",
        host_display_name="Alice"
    )

    # Alice connects
    await manager.handle_join("ROOM_LATE", "host_alice", "Alice")
    # Alice starts movie at 50s
    await manager.handle_play("ROOM_LATE", "host_alice", 50.0)

    # Late joiner Charlie joins
    room_charlie, charlie, _ = await manager.handle_join("ROOM_LATE", "user_charlie", "Charlie")
    assert charlie.isHost is False
    assert charlie.connected is True
    assert len(room_charlie.participants) == 2
    assert room_charlie.isPlaying is True
    assert room_charlie.position >= 50.0

    # Alice disconnects -> host transfers to Charlie
    updated_room, new_host = await manager.handle_leave("ROOM_LATE", "host_alice")
    assert new_host == "user_charlie"
    assert updated_room.hostId == "user_charlie"
