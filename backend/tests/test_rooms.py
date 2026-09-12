import pytest
from pathlib import Path
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.storage.local import LocalStorageProvider

@pytest.mark.asyncio
async def test_health_check():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/api/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "healthy"

@pytest.mark.asyncio
async def test_room_creation_and_retrieval():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # Create Room
        create_resp = await client.post(
            "/api/rooms",
            json={"hostDisplayName": "Dave", "controlMode": "HOST_ONLY"}
        )
        assert create_resp.status_code == 200
        created = create_resp.json()
        room_id = created["roomId"]
        host_id = created["hostId"]
        assert len(room_id) == 6
        assert host_id.startswith("user_")

        # Get Room
        get_resp = await client.get(f"/api/rooms/{room_id}")
        assert get_resp.status_code == 200
        room_data = get_resp.json()
        assert room_data["roomId"] == room_id
        assert room_data["hostId"] == host_id

@pytest.mark.asyncio
async def test_video_listing_and_http_range_streaming():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # List videos
        list_resp = await client.get("/api/videos")
        assert list_resp.status_code == 200
        videos = list_resp.json()
        assert len(videos) >= 1

        vid_id = videos[0]["id"]

        # Stream without Range -> 200 OK
        stream_resp = await client.get(f"/api/videos/{vid_id}/stream")
        assert stream_resp.status_code == 200
        assert stream_resp.headers["accept-ranges"] == "bytes"

        # Stream with Range -> 206 Partial Content
        range_headers = {"Range": "bytes=0-1023"}
        range_resp = await client.get(f"/api/videos/{vid_id}/stream", headers=range_headers)
        assert range_resp.status_code == 206
        assert "bytes 0-1023/" in range_resp.headers["content-range"]
        assert range_resp.headers["content-length"] == "1024"
        assert len(range_resp.content) == 1024
