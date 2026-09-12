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

@pytest.mark.asyncio
async def test_playback_rate_default_and_calculation(manager: RoomManager):
    room = await manager.create_room(
        room_id="ROOM_SPEED",
        host_id="host_1",
        host_display_name="Alice",
        control_mode=ControlMode.HOST_ONLY
    )
    assert room.playbackRate == 1.0

    # Start playback at pos 10.0
    updated_room, play_time = await manager.handle_play("ROOM_SPEED", "host_1", 10.0)

    # Change playback speed to 1.5x
    rate_room, rate_time = await manager.handle_playback_rate("ROOM_SPEED", "host_1", 1.5)
    assert rate_room.playbackRate == 1.5

    # 4 simulated seconds later at 1.5x -> position should advance by 6.0s
    simulated_future_time = rate_time + 4000.0
    future_pos = manager.calculate_current_position(rate_room, simulated_future_time)
    assert future_pos == round(rate_room.position + 6.0, 3)

@pytest.mark.asyncio
async def test_playback_rate_permissions_and_validation(manager: RoomManager):
    room = await manager.create_room(
        room_id="ROOM_PERM_RATE",
        host_id="host_alice",
        host_display_name="Alice",
        control_mode=ControlMode.HOST_ONLY
    )

    # Bob tries to change playback rate in HOST_ONLY room -> 403
    with pytest.raises(Exception) as exc_info:
        await manager.handle_playback_rate("ROOM_PERM_RATE", "bob", 1.25)
    assert "Permission denied" in str(exc_info.value)

    # Host changes rate -> success
    updated, _ = await manager.handle_playback_rate("ROOM_PERM_RATE", "host_alice", 1.25)
    assert updated.playbackRate == 1.25

    # Test invalid rate: <= 0 or > 4.0
    with pytest.raises(Exception) as exc_info:
        await manager.handle_playback_rate("ROOM_PERM_RATE", "host_alice", 0.0)
    assert "Invalid playback rate" in str(exc_info.value)

    with pytest.raises(Exception) as exc_info:
        await manager.handle_playback_rate("ROOM_PERM_RATE", "host_alice", -1.0)
    assert "Invalid playback rate" in str(exc_info.value)

    with pytest.raises(Exception) as exc_info:
        await manager.handle_playback_rate("ROOM_PERM_RATE", "host_alice", 5.0)
    assert "Invalid playback rate" in str(exc_info.value)

    # Switch to EVERYONE mode
    await manager.handle_change_settings("ROOM_PERM_RATE", "host_alice", control_mode=ControlMode.EVERYONE)
    bob_room, _ = await manager.handle_playback_rate("ROOM_PERM_RATE", "bob", 2.0)
    assert bob_room.playbackRate == 2.0

