import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.rooms.manager import room_manager
from app.models.room import ControlMode

@pytest.mark.asyncio
async def test_websocket_full_sync_flow():
    # 1. Create a room first
    room = await room_manager.create_room(
        room_id="WSROOM",
        host_id="ws_host",
        host_display_name="Alice",
        control_mode=ControlMode.HOST_ONLY
    )

    client = TestClient(app)

    # 2. Connect Host via WebSocket
    with client.websocket_connect("/ws/rooms/WSROOM?participant_id=ws_host&display_name=Alice") as ws_host:
        # Initial ROOM_STATE received
        state = ws_host.receive_json()
        assert state["type"] == "ROOM_STATE"
        assert state["roomId"] == "WSROOM"
        assert state["isPlaying"] is False
        assert state["position"] == 0.0

        # Test NTP Time Sync
        ws_host.send_json({"type": "TIME_SYNC", "t1": 1000.0})
        reply = ws_host.receive_json()
        assert reply["type"] == "TIME_SYNC_REPLY"
        assert reply["t1"] == 1000.0
        assert "serverTime" in reply

        # 3. Connect Bob (participant)
        with client.websocket_connect("/ws/rooms/WSROOM?participant_id=ws_bob&display_name=Bob") as ws_bob:
            # Bob receives ROOM_STATE
            bob_state = ws_bob.receive_json()
            assert bob_state["type"] == "ROOM_STATE"

            # Host receives PARTICIPANT_JOINED for Bob
            joined_msg = ws_host.receive_json()
            assert joined_msg["type"] == "PARTICIPANT_JOINED"
            assert joined_msg["participant"]["id"] == "ws_bob"

            # 4. Host presses PLAY at pos 12.5
            ws_host.send_json({"type": "PLAY", "position": 12.5})

            # Both host and bob receive PLAY broadcast
            play_for_host = ws_host.receive_json()
            play_for_bob = ws_bob.receive_json()
            assert play_for_host["type"] == "PLAY"
            assert play_for_host["position"] == 12.5
            assert play_for_bob["type"] == "PLAY"
            assert play_for_bob["position"] == 12.5

            # 5. Bob attempts to PAUSE (unauthorized, because mode is HOST_ONLY)
            ws_bob.send_json({"type": "PAUSE", "position": 15.0})
            bob_err = ws_bob.receive_json()
            assert bob_err["type"] == "ERROR"
            assert bob_err["code"] == "PAUSE_ERROR"

            # 6. Host pauses at pos 18.0
            ws_host.send_json({"type": "PAUSE", "position": 18.0})
            pause_for_host = ws_host.receive_json()
            pause_for_bob = ws_bob.receive_json()
            assert pause_for_host["type"] == "PAUSE"
            assert pause_for_host["position"] == 18.0
            assert pause_for_bob["type"] == "PAUSE"
            assert pause_for_bob["position"] == 18.0
