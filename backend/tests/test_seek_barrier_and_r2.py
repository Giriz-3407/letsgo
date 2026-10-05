import pytest
import time
from unittest.mock import MagicMock, patch
from httpx import AsyncClient, ASGITransport
from fastapi.testclient import TestClient

from app.main import app
from app.rooms.manager import RoomManager
from app.rooms.repository import InMemoryRoomRepository
from app.models.room import ControlMode, Participant, VideoMetadata
from app.storage.r2 import R2StorageService
from app.config import settings

@pytest.fixture
def manager():
    repo = InMemoryRoomRepository()
    return RoomManager(repo=repo)

@pytest.mark.asyncio
async def test_seek_creates_barrier_and_freezes_authoritative_clock(manager: RoomManager):
    """
    1. SEEK creates a barrier operation.
    2. SEEK does not advance authoritative playback while waiting.
    """
    room = await manager.create_room(
        room_id="SEEK1",
        host_id="alice",
        host_display_name="Alice",
        control_mode=ControlMode.HOST_ONLY
    )
    # Alice starts playback at 10.0s
    await manager.handle_play("SEEK1", "alice", 10.0)

    # Bob connects with media loaded
    await manager.handle_join("SEEK1", "bob", "Bob")
    await manager.handle_media_loaded("SEEK1", "bob", True)
    await manager.handle_media_loaded("SEEK1", "alice", True)

    # Alice seeks to 100.0s
    updated, s_time = await manager.handle_seek("SEEK1", "alice", 100.0)
    assert updated.seekOperationId == 1
    assert updated.seekBarrierActive is True
    assert updated.seekTargetPosition == 100.0
    assert updated.position == 100.0

    # 2. Verify authoritative clock does NOT advance during barrier
    future_time = s_time + 5000.0  # +5 seconds
    pos_frozen = manager.calculate_current_position(updated, future_time)
    assert pos_frozen == 100.0, "Authoritative playback clock must remain frozen during seek barrier"

@pytest.mark.asyncio
async def test_seek_barrier_multi_client_readiness_and_stale_rejection(manager: RoomManager):
    """
    3. First client READY does not resume room when another required client is not ready.
    4. Final required READY causes synchronized resume.
    5. Stale SEEK_READY from an old operationId is ignored.
    6. Newer operation invalidates older readiness.
    """
    await manager.create_room(
        room_id="BARRIER1",
        host_id="alice",
        host_display_name="Alice"
    )
    await manager.handle_join("BARRIER1", "alice", "Alice")
    await manager.handle_join("BARRIER1", "bob", "Bob")
    await manager.handle_media_loaded("BARRIER1", "alice", True)
    await manager.handle_media_loaded("BARRIER1", "bob", True)
    await manager.handle_play("BARRIER1", "alice", 0.0)

    # Operation 1: Seek to 50s
    room, s_time = await manager.handle_seek("BARRIER1", "alice", 50.0)
    assert room.seekOperationId == 1
    assert room.seekBarrierActive is True

    # 3. Alice becomes ready first (local file) -> room remains waiting for Bob
    room_after_alice, resumed_1 = await manager.handle_seek_ready("BARRIER1", "alice", 1)
    assert resumed_1 is False
    assert room_after_alice.seekBarrierActive is True
    assert "alice" in room_after_alice.seekReadyParticipants
    assert "bob" not in room_after_alice.seekReadyParticipants

    # 6. Host initiates a NEW seek (Operation 2 to 75s) before Bob ever readied for Operation 1
    room_op2, _ = await manager.handle_seek("BARRIER1", "alice", 75.0)
    assert room_op2.seekOperationId == 2
    assert room_op2.seekBarrierActive is True
    assert len(room_op2.seekReadyParticipants) == 0, "New seek must reset ready set"

    # 5. Stale ready from Bob for Operation 1 arrives -> MUST BE IGNORED
    room_stale, resumed_stale = await manager.handle_seek_ready("BARRIER1", "bob", 1)
    assert resumed_stale is False
    assert "bob" not in room_stale.seekReadyParticipants, "Stale operation ready must be ignored"

    # Alice readies for Operation 2
    _, res_a2 = await manager.handle_seek_ready("BARRIER1", "alice", 2)
    assert res_a2 is False

    # 4. Bob readies for Operation 2 -> all required ready -> RESUME
    room_final, resumed_final = await manager.handle_seek_ready("BARRIER1", "bob", 2)
    assert resumed_final is True
    assert room_final.seekBarrierActive is False
    assert room_final.position == 75.0

@pytest.mark.asyncio
async def test_participant_disconnect_resolves_active_barrier(manager: RoomManager):
    """
    7. Participant disconnect removes them from the barrier.
    """
    await manager.create_room(
        room_id="LEAVE_BARRIER",
        host_id="alice",
        host_display_name="Alice"
    )
    await manager.handle_join("LEAVE_BARRIER", "alice", "Alice")
    await manager.handle_join("LEAVE_BARRIER", "bob", "Bob")
    await manager.handle_media_loaded("LEAVE_BARRIER", "alice", True)
    await manager.handle_media_loaded("LEAVE_BARRIER", "bob", True)

    # Seek to 200s
    await manager.handle_seek("LEAVE_BARRIER", "alice", 200.0)

    # Alice is ready
    room, _ = await manager.handle_seek_ready("LEAVE_BARRIER", "alice", 1)
    assert room.seekBarrierActive is True

    # Bob disconnects while buffering -> Bob is removed from required set -> Alice was ready -> barrier releases
    updated_room, _ = await manager.handle_leave("LEAVE_BARRIER", "bob")
    assert updated_room.seekBarrierActive is False, "Barrier should resolve when lagging client leaves"
    assert updated_room.position == 200.0

@pytest.mark.asyncio
async def test_r2_service_mocked_listing_and_presigned_url():
    """
    12. R2 presigned URL generation works with mocked R2/S3 client.
    13. R2 credentials are never exposed in API responses.
    14. R2 object listing works.
    """
    mock_s3 = MagicMock()
    # Mock list_objects_v2 paginator
    mock_paginator = MagicMock()
    mock_paginator.paginate.return_value = [
        {
            "Contents": [
                {"Key": "movies/matrix.mp4", "Size": 2147483648},
                {"Key": "movies/avatar.webm", "Size": 1073741824},
                {"Key": "notes.txt", "Size": 100},  # Non-video, should be filtered
            ]
        }
    ]
    mock_s3.get_paginator.return_value = mock_paginator
    mock_s3.generate_presigned_url.return_value = "https://mock-account.r2.cloudflarestorage.com/letsgo-backend/movies/matrix.mp4?X-Amz-Signature=mock123"

    service = R2StorageService(s3_client=mock_s3)

    # Test listing
    videos = await service.list_videos()
    assert len(videos) == 2
    assert videos[0]["name"] == "matrix.mp4"
    assert videos[0]["mimeType"] == "video/mp4"
    assert videos[0]["provider"] == "r2"
    assert videos[1]["name"] == "avatar.webm"
    assert videos[1]["mimeType"] == "video/webm"

    # Test presigned URL generation
    signed_url = await service.generate_presigned_playback_url("movies/matrix.mp4", expires_in=1800)
    assert "https://mock-account.r2.cloudflarestorage.com" in signed_url
    assert "X-Amz-Signature" in signed_url
    mock_s3.generate_presigned_url.assert_called_once_with(
        ClientMethod="get_object",
        Params={"Bucket": settings.R2_BUCKET_NAME, "Key": "movies/matrix.mp4"},
        ExpiresIn=1800
    )

    # Test invalid object key validation
    with pytest.raises(Exception):
        await service.generate_presigned_playback_url("../etc/passwd")

    with pytest.raises(Exception):
        await service.generate_presigned_playback_url("virus.exe")

@pytest.mark.asyncio
async def test_r2_api_routes_with_service_patch():
    """
    Tests GET /api/videos/r2 and POST /api/videos/r2/play-url endpoints.
    Verifies credentials are not present in responses.
    """
    mock_videos = [
        {"key": "demo.mp4", "name": "demo.mp4", "size": 5000000, "mimeType": "video/mp4", "provider": "r2"}
    ]
    mock_url = "https://r2.example.com/demo.mp4?signature=valid"

    with patch("app.api.videos.r2_service.list_videos", return_value=mock_videos):
        with patch("app.api.videos.r2_service.generate_presigned_playback_url", return_value=mock_url):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                # 1. Listing
                list_resp = await client.get("/api/videos/r2")
                assert list_resp.status_code == 200
                items = list_resp.json()
                assert len(items) == 1
                assert items[0]["key"] == "demo.mp4"
                assert "secret" not in str(items).lower()
                assert "access_key" not in str(items).lower()

                # 2. Play URL POST
                play_resp = await client.post("/api/videos/r2/play-url", json={"key": "demo.mp4"})
                assert play_resp.status_code == 200
                data = play_resp.json()
                assert data["url"] == mock_url
                assert data["key"] == "demo.mp4"
                assert "secret" not in str(data).lower()
                assert "access_key" not in str(data).lower()
