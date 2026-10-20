import asyncio
import pytest
import uuid
from unittest.mock import MagicMock, patch
from httpx import AsyncClient, ASGITransport
from botocore.exceptions import ClientError

from app.main import app
from app.config import settings
from app.auth.admin import admin_auth
from app.api.videos import r2_service

GIB = 1024 ** 3
LIMIT_10_GIB = 10 * GIB  # 10,737,418,240 bytes

@pytest.fixture(autouse=True)
def setup_test_env():
    admin_auth._sessions.clear()
    admin_auth._failed_attempts.clear()
    settings.R2_ADMIN_PASSWORD = "admin123"
    settings.ENVIRONMENT = "development"
    settings.DEBUG = True
    if r2_service and r2_service._reservation_store:
        r2_service._reservation_store.clear_all()

def create_mock_s3(existing_objects=None):
    s3 = MagicMock()
    mock_paginator = MagicMock()
    mock_paginator.paginate.return_value = [
        {"Contents": existing_objects or []}
    ]
    s3.get_paginator.return_value = mock_paginator

    def fake_create_multipart_upload(**kwargs):
        return {
            "UploadId": f"mock-upload-{uuid.uuid4().hex[:12]}",
            "Bucket": kwargs.get("Bucket", settings.R2_BUCKET_NAME),
            "Key": kwargs.get("Key", "videos/test_key.mp4")
        }
    s3.create_multipart_upload.side_effect = fake_create_multipart_upload
    s3.generate_presigned_url.return_value = "https://r2.test.com/upload-part?partNumber=1&signature=mock"
    s3.complete_multipart_upload.return_value = {
        "Bucket": settings.R2_BUCKET_NAME,
        "Key": "videos/test_key.mp4",
        "Location": "https://r2.test.com/videos/test_key.mp4"
    }
    s3.abort_multipart_upload.return_value = {}
    s3.delete_object.return_value = {}
    s3.head_object.return_value = {"ContentLength": 1000}
    return s3

async def get_admin_token(client: AsyncClient) -> str:
    res = await client.post("/api/videos/r2/admin/verify", json={"password": "admin123"})
    assert res.status_code == 200
    return res.json()["token"]

@pytest.mark.asyncio
async def test_upload_accepted_strictly_below_10gib():
    """
    An upload is accepted when the resulting total (stored + reserved + new)
    is strictly below 10 GiB.
    """
    # 9 GiB stored, new video is (1 GiB - 1 byte). Total = 10 GiB - 1 byte.
    existing_size = 9 * GIB
    new_video_size = (1 * GIB) - 1
    mock_s3 = create_mock_s3([{"Key": "existing_movie.mp4", "Size": existing_size}])

    with patch("app.api.videos.r2_service._s3_client", mock_s3):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            token = await get_admin_token(client)
            headers = {"X-R2-Admin-Token": token}

            resp = await client.post(
                "/api/videos/r2/uploads/initiate",
                json={"filename": "under_limit.mp4", "fileSize": new_video_size},
                headers=headers
            )
            assert resp.status_code == 200
            data = resp.json()
            assert "uploadId" in data
            assert mock_s3.create_multipart_upload.call_count == 1

@pytest.mark.asyncio
async def test_upload_rejected_equals_exactly_10gib():
    """
    An upload is rejected when the resulting total equals exactly 10 GiB.
    Must be strictly less than 10 GiB.
    """
    # 9 GiB stored, new video is exactly 1 GiB. Total = 10 GiB exactly.
    existing_size = 9 * GIB
    new_video_size = 1 * GIB
    mock_s3 = create_mock_s3([{"Key": "existing_movie.mp4", "Size": existing_size}])

    with patch("app.api.videos.r2_service._s3_client", mock_s3):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            token = await get_admin_token(client)
            headers = {"X-R2-Admin-Token": token}

            resp = await client.post(
                "/api/videos/r2/uploads/initiate",
                json={"filename": "exact_10gib.mp4", "fileSize": new_video_size},
                headers=headers
            )
            assert resp.status_code == 400
            detail = resp.json()["detail"]
            assert "Not enough storage for this video." in detail
            assert "Available storage: 1.00 GiB." in detail
            assert "This video requires 1.00 GiB." in detail
            assert "Clear at least 0.01 GiB of storage to upload it." in detail
            # CreateMultipartUpload must NOT have been called
            assert mock_s3.create_multipart_upload.call_count == 0

@pytest.mark.asyncio
async def test_upload_rejected_exceeds_10gib():
    """
    An upload is rejected when the resulting total exceeds 10 GiB.
    """
    # 8 GiB stored, new video is 3 GiB. Total = 11 GiB.
    existing_size = 8 * GIB
    new_video_size = 3 * GIB
    mock_s3 = create_mock_s3([{"Key": "existing_movie.mp4", "Size": existing_size}])

    with patch("app.api.videos.r2_service._s3_client", mock_s3):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            token = await get_admin_token(client)
            headers = {"X-R2-Admin-Token": token}

            resp = await client.post(
                "/api/videos/r2/uploads/initiate",
                json={"filename": "too_big.mp4", "fileSize": new_video_size},
                headers=headers
            )
            assert resp.status_code == 400
            detail = resp.json()["detail"]
            assert "Not enough storage for this video." in detail
            assert "Available storage: 2.00 GiB." in detail
            assert "This video requires 3.00 GiB." in detail
            assert "Clear at least 1.00 GiB of storage to upload it." in detail
            # CreateMultipartUpload must NOT have been called
            assert mock_s3.create_multipart_upload.call_count == 0

@pytest.mark.asyncio
async def test_external_r2_objects_included_and_non_videos_excluded():
    """
    Existing video objects uploaded outside the app are included in capacity calculations.
    Non-video objects and folder placeholders are excluded.
    """
    mock_s3 = create_mock_s3([
        {"Key": "external_dir/outside_video.mp4", "Size": 2 * GIB},
        {"Key": "raw_footage/clip.mkv", "Size": 3 * GIB},
        {"Key": "web_stream.webm", "Size": 1 * GIB},
        {"Key": "documents/readme.pdf", "Size": 500 * (1024 ** 2)},  # Non-video (should be excluded)
        {"Key": "thumbnails/cover.jpg", "Size": 50 * (1024 ** 2)},   # Non-video (should be excluded)
        {"Key": "folder_placeholder/", "Size": 0},                   # Folder (should be excluded)
    ])

    with patch("app.api.videos.r2_service._s3_client", mock_s3):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            # 1. Check storage-info endpoint
            info_resp = await client.get("/api/videos/r2/storage-info")
            assert info_resp.status_code == 200
            info = info_resp.json()
            # Stored should be exactly 2 + 3 + 1 = 6 GiB
            assert info["storedBytes"] == 6 * GIB
            assert info["videoCount"] == 3
            assert info["availableBytes"] == 4 * GIB

            token = await get_admin_token(client)
            headers = {"X-R2-Admin-Token": token}

            # 2. Upload of 4.5 GiB fails (6 + 4.5 = 10.5 > 10)
            fail_resp = await client.post(
                "/api/videos/r2/uploads/initiate",
                json={"filename": "heavy.mp4", "fileSize": int(4.5 * GIB)},
                headers=headers
            )
            assert fail_resp.status_code == 400

            # 3. Upload of 3.5 GiB succeeds (6 + 3.5 = 9.5 < 10)
            ok_resp = await client.post(
                "/api/videos/r2/uploads/initiate",
                json={"filename": "light.mp4", "fileSize": int(3.5 * GIB)},
                headers=headers
            )
            assert ok_resp.status_code == 200

@pytest.mark.asyncio
async def test_concurrent_upload_reservations():
    """
    Concurrent upload requests cannot over-reserve the available capacity.
    Atomically reserves size in persistent storage.
    """
    # 7 GiB stored, 3 GiB available.
    mock_s3 = create_mock_s3([{"Key": "video.mp4", "Size": 7 * GIB}])

    with patch("app.api.videos.r2_service._s3_client", mock_s3):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            token = await get_admin_token(client)
            headers = {"X-R2-Admin-Token": token}

            # First upload of 2 GiB succeeds
            r1 = await client.post(
                "/api/videos/r2/uploads/initiate",
                json={"filename": "upload1.mp4", "fileSize": 2 * GIB},
                headers=headers
            )
            assert r1.status_code == 200

            # Storage info should now show 2 GiB reserved, 1 GiB available
            info = (await client.get("/api/videos/r2/storage-info")).json()
            assert info["reservedBytes"] == 2 * GIB
            assert info["availableBytes"] == 1 * GIB

            # Second upload of 2 GiB fails because 7 + 2 + 2 = 11 > 10 GiB
            r2 = await client.post(
                "/api/videos/r2/uploads/initiate",
                json={"filename": "upload2.mp4", "fileSize": 2 * GIB},
                headers=headers
            )
            assert r2.status_code == 400
            assert "Available storage: 1.00 GiB" in r2.json()["detail"]

@pytest.mark.asyncio
async def test_simultaneous_race_condition_protection():
    """
    Test two simultaneous coroutines attempting to initiate uploads that would
    collectively exceed capacity. Exactly one must succeed and one must fail.
    """
    # 6 GiB stored, 4 GiB available.
    mock_s3 = create_mock_s3([{"Key": "video.mp4", "Size": 6 * GIB}])

    with patch("app.api.videos.r2_service._s3_client", mock_s3):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            token = await get_admin_token(client)
            headers = {"X-R2-Admin-Token": token}

            # Both request 3 GiB concurrently. 6 + 3 + 3 = 12 > 10 GiB.
            res1, res2 = await asyncio.gather(
                client.post("/api/videos/r2/uploads/initiate", json={"filename": "race1.mp4", "fileSize": 3 * GIB}, headers=headers),
                client.post("/api/videos/r2/uploads/initiate", json={"filename": "race2.mp4", "fileSize": 3 * GIB}, headers=headers),
            )

            status_codes = [res1.status_code, res2.status_code]
            assert 200 in status_codes
            assert 400 in status_codes

@pytest.mark.asyncio
async def test_reservations_released_after_abort_and_failure():
    """
    Reservations are released after cancellation or failure, restoring available capacity.
    """
    # 8 GiB stored, 2 GiB available.
    mock_s3 = create_mock_s3([{"Key": "video.mp4", "Size": 8 * GIB}])

    with patch("app.api.videos.r2_service._s3_client", mock_s3):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            token = await get_admin_token(client)
            headers = {"X-R2-Admin-Token": token}

            # 1. Initiate 1.5 GiB upload (reserves 1.5 GiB, 0.5 GiB left)
            init_resp = await client.post(
                "/api/videos/r2/uploads/initiate",
                json={"filename": "to_cancel.mp4", "fileSize": int(1.5 * GIB)},
                headers=headers
            )
            assert init_resp.status_code == 200
            upload_id = init_resp.json()["uploadId"]
            object_key = init_resp.json()["objectKey"]

            # 2. Next upload of 1 GiB fails
            failing = await client.post(
                "/api/videos/r2/uploads/initiate",
                json={"filename": "wait_for_space.mp4", "fileSize": 1 * GIB},
                headers=headers
            )
            assert failing.status_code == 400

            # 3. Abort the 1.5 GiB upload
            abort_resp = await client.post(
                f"/api/videos/r2/uploads/{upload_id}/abort",
                json={"objectKey": object_key},
                headers=headers
            )
            assert abort_resp.status_code == 200

            # 4. Storage info shows reservation released
            info = (await client.get("/api/videos/r2/storage-info")).json()
            assert info["reservedBytes"] == 0
            assert info["availableBytes"] == 2 * GIB

            # 5. The 1 GiB upload now succeeds
            success = await client.post(
                "/api/videos/r2/uploads/initiate",
                json={"filename": "wait_for_space.mp4", "fileSize": 1 * GIB},
                headers=headers
            )
            assert success.status_code == 200

@pytest.mark.asyncio
async def test_deleting_video_frees_capacity():
    """
    Deleting an existing video frees capacity and allows previously blocked uploads.
    """
    stored_objects = [
        {"Key": "videos/vid1.mp4", "Size": 3 * GIB},
        {"Key": "videos/vid2.mp4", "Size": 3 * GIB},
        {"Key": "videos/vid3.mp4", "Size": 3 * GIB},
    ]  # 9 GiB total stored, 1 GiB available
    mock_s3 = create_mock_s3(stored_objects)

    with patch("app.api.videos.r2_service._s3_client", mock_s3):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            token = await get_admin_token(client)
            headers = {"X-R2-Admin-Token": token}

            # 1. 1.5 GiB upload fails (9 + 1.5 = 10.5 > 10)
            r1 = await client.post(
                "/api/videos/r2/uploads/initiate",
                json={"filename": "need_space.mp4", "fileSize": int(1.5 * GIB)},
                headers=headers
            )
            assert r1.status_code == 400

            # 2. Delete vid3.mp4 (frees 3 GiB)
            del_resp = await client.delete("/api/videos/r2/videos/vid3.mp4", headers=headers)
            assert del_resp.status_code == 200

            # Update mocked R2 paginator to reflect that vid3 was deleted
            stored_objects.pop()
            mock_s3.get_paginator.return_value.paginate.return_value = [{"Contents": stored_objects}]

            # 3. Storage info shows 6 GiB stored, 4 GiB available
            info = (await client.get("/api/videos/r2/storage-info")).json()
            assert info["storedBytes"] == 6 * GIB
            assert info["availableBytes"] == 4 * GIB

            # 4. Upload of 1.5 GiB is retried and succeeds!
            retry_resp = await client.post(
                "/api/videos/r2/uploads/initiate",
                json={"filename": "need_space.mp4", "fileSize": int(1.5 * GIB)},
                headers=headers
            )
            assert retry_resp.status_code == 200

@pytest.mark.asyncio
async def test_capacity_check_runs_before_s3_multipart_create():
    """
    Ensures S3 CreateMultipartUpload is NEVER called if the capacity check fails.
    """
    mock_s3 = create_mock_s3([{"Key": "full.mp4", "Size": LIMIT_10_GIB}])

    with patch("app.api.videos.r2_service._s3_client", mock_s3):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            token = await get_admin_token(client)
            headers = {"X-R2-Admin-Token": token}

            resp = await client.post(
                "/api/videos/r2/uploads/initiate",
                json={"filename": "will_fail.mp4", "fileSize": 1000},
                headers=headers
            )
            assert resp.status_code == 400
            assert mock_s3.create_multipart_upload.call_count == 0
