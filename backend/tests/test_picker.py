import time
import pytest
from unittest.mock import AsyncMock, patch
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.auth.session import session_store
from app.config import settings

@pytest.mark.asyncio
async def test_picker_config_unauthorized():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # No session cookie or header
        resp = await client.get("/api/auth/google/picker-config")
        assert resp.status_code == 401

@pytest.mark.asyncio
async def test_picker_config_no_drive_connected():
    sess_id = session_store.create_session()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get(
            "/api/auth/google/picker-config",
            headers={"X-Session-ID": sess_id}
        )
        assert resp.status_code == 401
        assert "Google Drive is not connected" in resp.json()["detail"]

@pytest.mark.asyncio
async def test_picker_config_success_and_secret_isolation():
    sess_id = session_store.create_session()
    mock_tokens = {
        "access_token": "mock-ya29-token-12345",
        "refresh_token": "mock-refresh-token",
        "expires_in": 3600,
        "token_type": "Bearer"
    }
    session_store.set_google_tokens(sess_id, mock_tokens)

    # Set dummy credentials on settings for test
    settings.GOOGLE_CLIENT_ID = "mock-client-id.apps.googleusercontent.com"
    settings.GOOGLE_CLIENT_SECRET = "super-secret-client-key-never-leak"
    settings.GOOGLE_API_KEY = "mock-google-api-developer-key"
    settings.GOOGLE_APP_ID = "123456789012"

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get(
            "/api/auth/google/picker-config",
            headers={"X-Session-ID": sess_id}
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["accessToken"] == "mock-ya29-token-12345"
        assert data["apiKey"] == "mock-google-api-developer-key"
        assert data["appId"] == "123456789012"
        assert data["clientId"] == "mock-client-id.apps.googleusercontent.com"

        # Explicitly verify client_secret is NEVER present
        assert "client_secret" not in data
        assert "clientSecret" not in data
        assert "super-secret-client-key-never-leak" not in str(data)

@pytest.mark.asyncio
async def test_picker_config_auto_token_refresh():
    sess_id = session_store.create_session()
    # Expired token (expires_in = -100)
    mock_tokens = {
        "access_token": "expired-token",
        "refresh_token": "valid-refresh-token",
        "expires_in": -100,
        "token_type": "Bearer"
    }
    session_store.set_google_tokens(sess_id, mock_tokens)

    refreshed_tokens = {
        "access_token": "brand-new-fresh-access-token",
        "expires_in": 3600,
        "token_type": "Bearer"
    }

    with patch("app.auth.google_oauth.google_oauth.refresh_access_token", new=AsyncMock(return_value=refreshed_tokens)):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.get(
                "/api/auth/google/picker-config",
                headers={"X-Session-ID": sess_id}
            )
            assert resp.status_code == 200
            data = resp.json()
            assert data["accessToken"] == "brand-new-fresh-access-token"
            # Verify session store was updated and preserved refresh_token
            session = session_store.get_session(sess_id)
            assert session["google_tokens"]["refresh_token"] == "valid-refresh-token"

@pytest.mark.asyncio
async def test_drive_videos_endpoint_returns_empty_list():
    sess_id = session_store.create_session()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get(
            "/api/drive/videos",
            headers={"X-Session-ID": sess_id}
        )
        assert resp.status_code == 200
        assert resp.json() == []

@pytest.mark.asyncio
async def test_complete_drive_picker_to_watchroom_flow(tmp_path):
    """
    Tests the complete end-to-end flow:
    1. Connect Google Drive -> valid session tokens
    2. Frontend retrieves picker-config -> obtains valid access token & API key
    3. User picks video in Google Picker -> file ID received
    4. Call /api/videos/drive/import -> imported video metadata returned
    5. Host creates room with selected Drive video
    6. Video metadata and stream URL are attached to the room state
    """
    from app.models.room import VideoMetadata

    sess_id = session_store.create_session()
    session_store.set_google_tokens(sess_id, {
        "access_token": "ya29.test_token",
        "expires_in": 3600,
        "token_type": "Bearer"
    })

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # Step 1 & 2: Picker config retrieved
        picker_cfg_resp = await client.get(
            "/api/auth/google/picker-config",
            headers={"X-Session-ID": sess_id}
        )
        assert picker_cfg_resp.status_code == 200
        assert picker_cfg_resp.json()["accessToken"] == "ya29.test_token"

        # Step 3 & 4: Drive file ID selected in Picker and imported
        mock_imported = VideoMetadata(
            id="drive_sample_file_abc",
            name="Interstellar.mp4",
            mimeType="video/mp4",
            size=1048576,
            duration=7200.0,
            streamUrl="/api/videos/drive_sample_file_abc/stream",
            downloadUrl="/api/videos/drive_sample_file_abc/download",
            provider="local"
        )

        with patch("app.api.videos.drive_storage.import_video", new=AsyncMock(return_value=mock_imported)):
            # Simulate cached file created on disk by import_video
            cached_file = settings.MEDIA_DIR / "drive_sample_file_abc.mp4"
            cached_file.write_bytes(b"mock video byte content for range testing")
            try:
                import_resp = await client.post(
                    "/api/videos/drive/import?drive_file_id=sample_file_abc",
                    headers={"X-Session-ID": sess_id}
                )
                assert import_resp.status_code == 200
                imported_data = import_resp.json()
                assert imported_data["id"] == "drive_sample_file_abc"
                assert imported_data["name"] == "Interstellar.mp4"

                # Step 5: Host creates room with the imported Drive video
                create_resp = await client.post(
                    "/api/rooms",
                    json={
                        "hostDisplayName": "Alice",
                        "controlMode": "HOST_ONLY",
                        "videoId": imported_data["id"]
                    }
                )
                assert create_resp.status_code == 200
                room_info = create_resp.json()
                room_id = room_info["roomId"]

                # Step 6: Verify room state has the selected video
                get_resp = await client.get(f"/api/rooms/{room_id}")
                assert get_resp.status_code == 200
                room_state = get_resp.json()
                assert room_state["video"] is not None
                assert room_state["video"]["id"] == "drive_sample_file_abc"
                assert room_state["video"]["streamUrl"] == "/api/videos/drive_sample_file_abc/stream"

                # Step 7: Verify HTTP 206 Partial Content range stream works for participants
                stream_resp = await client.get(
                    f"/api/videos/{imported_data['id']}/stream",
                    headers={"Range": "bytes=0-10"}
                )
                assert stream_resp.status_code == 206
                assert stream_resp.headers["accept-ranges"] == "bytes"
            finally:
                if cached_file.exists():
                    cached_file.unlink()
