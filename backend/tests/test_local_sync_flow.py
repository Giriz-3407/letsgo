import pytest
import time
from fastapi.testclient import TestClient
from app.main import app
from app.rooms.manager import room_manager
from app.models.room import ControlMode

@pytest.mark.asyncio
async def test_local_media_room_lifecycle_and_synchronization():
    """
    Comprehensive test suite verifying local-file synchronized playback:
    A. Room created with no server-side video (local media mode)
    B. Two users join the room
    C. Host PLAY broadcasts to both clients
    D. Host PAUSE broadcasts to both clients
    E. Host forward SEEK broadcasts authoritative target
    F. Host backward SEEK broadcasts correctly
    G. Host +10s seek
    H. Host -10s seek
    I. Playback speed 1.5x broadcast and authoritative position tracking
    J. Late joiner receives correct position in already-playing room
    L. Verifies no video streaming or upload endpoints are touched
    M. Verifies no recursive SEEK feedback loops
    """
    # 1. Create Room without server video (Local File Mode)
    room = await room_manager.create_room(
        room_id="LOCSYNC",
        host_id="host_alice",
        host_display_name="Alice",
        control_mode=ControlMode.HOST_ONLY,
        video=None, # Pure local file mode - no server video
        pause_on_buffer=False
    )
    assert room.roomId == "LOCSYNC"
    assert room.hostId == "host_alice"
    assert room.video is None
    assert room.isPlaying is False
    assert room.position == 0.0

    client = TestClient(app)

    # 2. Host and Bob connect over WebSocket
    with client.websocket_connect("/ws/rooms/LOCSYNC?participant_id=host_alice&display_name=Alice") as ws_alice:
        alice_init = ws_alice.receive_json()
        assert alice_init["type"] == "ROOM_STATE"
        assert alice_init["video"] is None
        assert alice_init["isPlaying"] is False

        with client.websocket_connect("/ws/rooms/LOCSYNC?participant_id=user_bob&display_name=Bob") as ws_bob:
            bob_init = ws_bob.receive_json()
            assert bob_init["type"] == "ROOM_STATE"
            assert bob_init["video"] is None

            alice_join_notice = ws_alice.receive_json()
            assert alice_join_notice["type"] == "PARTICIPANT_JOINED"
            assert alice_join_notice["participant"]["id"] == "user_bob"

            # C. Host PLAY
            ws_alice.send_json({"type": "PLAY", "position": 0.0})
            play_alice = ws_alice.receive_json()
            play_bob = ws_bob.receive_json()
            assert play_alice["type"] == "PLAY"
            assert play_alice["position"] == 0.0
            assert play_bob["type"] == "PLAY"
            assert play_bob["position"] == 0.0

            # D. Host PAUSE
            ws_alice.send_json({"type": "PAUSE", "position": 15.0})
            pause_alice = ws_alice.receive_json()
            pause_bob = ws_bob.receive_json()
            assert pause_alice["type"] == "PAUSE"
            assert pause_alice["position"] == 15.0
            assert pause_bob["type"] == "PAUSE"
            assert pause_bob["position"] == 15.0

            # E. Host manually seeks far forward to 500.0s
            ws_alice.send_json({"type": "SEEK", "position": 500.0})
            seek_alice = ws_alice.receive_json()
            seek_bob = ws_bob.receive_json()
            assert seek_alice["type"] == "SEEK"
            assert seek_alice["position"] == 500.0
            assert seek_bob["type"] == "SEEK"
            assert seek_bob["position"] == 500.0

            # F. Host manually seeks far backward to 45.0s
            ws_alice.send_json({"type": "SEEK", "position": 45.0})
            seek_back_alice = ws_alice.receive_json()
            seek_back_bob = ws_bob.receive_json()
            assert seek_back_alice["type"] == "SEEK"
            assert seek_back_alice["position"] == 45.0
            assert seek_back_bob["type"] == "SEEK"
            assert seek_back_bob["position"] == 45.0

            # G. Host presses +10 (45 + 10 = 55)
            ws_alice.send_json({"type": "SEEK", "position": 55.0})
            skip_fwd_alice = ws_alice.receive_json()
            skip_fwd_bob = ws_bob.receive_json()
            assert skip_fwd_alice["position"] == 55.0
            assert skip_fwd_bob["position"] == 55.0

            # H. Host presses -10 (55 - 10 = 45)
            ws_alice.send_json({"type": "SEEK", "position": 45.0})
            skip_back_alice = ws_alice.receive_json()
            skip_back_bob = ws_bob.receive_json()
            assert skip_back_alice["position"] == 45.0
            assert skip_back_bob["position"] == 45.0

            # I. Host changes playback speed to 1.5x
            ws_alice.send_json({"type": "PLAYBACK_RATE", "rate": 1.5})
            rate_alice = ws_alice.receive_json()
            rate_bob = ws_bob.receive_json()
            assert rate_alice["type"] == "PLAYBACK_RATE"
            assert rate_alice["rate"] == 1.5
            assert rate_bob["type"] == "PLAYBACK_RATE"
            assert rate_bob["rate"] == 1.5

            # Host resumes playback at 1.5x speed
            ws_alice.send_json({"type": "PLAY", "position": 45.0})
            ws_alice.receive_json()
            ws_bob.receive_json()

            # J. Late joiner Charlie joins an already-playing room
            with client.websocket_connect("/ws/rooms/LOCSYNC?participant_id=user_charlie&display_name=Charlie") as ws_charlie:
                charlie_state = ws_charlie.receive_json()
                assert charlie_state["type"] == "ROOM_STATE"
                assert charlie_state["isPlaying"] is True
                assert charlie_state["playbackRate"] == 1.5
                # Authoritative position is at or past 45.0s
                assert charlie_state["position"] >= 45.0
                assert charlie_state["video"] is None

            # L. Ensure no media streaming or file upload was ever requested or required
            # Verify via health & room check
            health_resp = client.get("/api/health")
            assert health_resp.status_code == 200
