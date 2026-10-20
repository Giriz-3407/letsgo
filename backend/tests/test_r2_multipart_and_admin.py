import pytest
import time
from unittest.mock import MagicMock, patch
from httpx import AsyncClient, ASGITransport
from botocore.exceptions import ClientError

from app.main import app
from app.config import settings
from app.auth.admin import admin_auth, AdminSession
from app.storage.r2 import R2StorageService

import uuid
from app.api.videos import r2_service

@pytest.fixture(autouse=True)
def reset_admin_auth():
    admin_auth._sessions.clear()
    admin_auth._failed_attempts.clear()
    settings.R2_ADMIN_PASSWORD = "admin123"
    settings.ENVIRONMENT = "development"
    settings.DEBUG = True
    if r2_service and r2_service._reservation_store:
        r2_service._reservation_store.clear_all()

@pytest.fixture
def mock_s3():
    s3 = MagicMock()
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

@pytest.mark.asyncio
async def test_admin_verify_password_success_and_failure():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # 1. Invalid password
        bad_resp = await client.post("/api/videos/r2/admin/verify", json={"password": "wrongpassword"})
        assert bad_resp.status_code == 401
        assert "Invalid admin password" in bad_resp.json()["detail"]

        # 2. Correct password
        good_resp = await client.post("/api/videos/r2/admin/verify", json={"password": "admin123"})
        assert good_resp.status_code == 200
        data = good_resp.json()
        assert "token" in data
        assert data["expiresIn"] == 7200
        # Password itself is never returned
        assert "admin123" not in str(data)

@pytest.mark.asyncio
async def test_admin_verify_rate_limiting():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        for _ in range(5):
            r = await client.post("/api/videos/r2/admin/verify", json={"password": "wrong"})
            assert r.status_code == 401

        # 6th attempt should be rate limited with 429
        rate_resp = await client.post("/api/videos/r2/admin/verify", json={"password": "wrong"})
        assert rate_resp.status_code == 429
        assert "Too many failed admin login attempts" in rate_resp.json()["detail"]

@pytest.mark.asyncio
async def test_admin_verify_production_safeguard():
    settings.ENVIRONMENT = "production"
    settings.R2_ADMIN_PASSWORD = "admin123"

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post("/api/videos/r2/admin/verify", json={"password": "admin123"})
        assert resp.status_code == 500
        assert "Default admin password" in resp.json()["detail"]

@pytest.mark.asyncio
async def test_unauthorized_endpoints():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # Initiate without token
        init_resp = await client.post("/api/videos/r2/uploads/initiate", json={"filename": "test.mp4", "fileSize": 1000})
        assert init_resp.status_code == 401

        # Part URLs without token
        part_resp = await client.post("/api/videos/r2/uploads/dummy-id/part-urls", json={"objectKey": "test.mp4", "partNumbers": [1]})
        assert part_resp.status_code == 401

        # Complete without token
        comp_resp = await client.post("/api/videos/r2/uploads/dummy-id/complete", json={"objectKey": "test.mp4", "parts": []})
        assert comp_resp.status_code == 401

        # Delete without token
        del_resp = await client.delete("/api/videos/r2/videos/test.mp4")
        assert del_resp.status_code == 401

@pytest.mark.asyncio
async def test_multipart_upload_lifecycle(mock_s3):
    with patch("app.api.videos.r2_service._s3_client", mock_s3):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            # 1. Login
            auth_resp = await client.post("/api/videos/r2/admin/verify", json={"password": "admin123"})
            assert auth_resp.status_code == 200
            token = auth_resp.json()["token"]
            headers = {"X-R2-Admin-Token": token}

            # 2. Initiate upload
            file_size = 150 * 1024 * 1024  # 150 MB -> 3 parts of 64MB, 64MB, 22MB
            init_resp = await client.post(
                "/api/videos/r2/uploads/initiate",
                json={"filename": "My Vacation Movie.mp4", "fileSize": file_size},
                headers=headers
            )
            assert init_resp.status_code == 200
            init_data = init_resp.json()
            upload_id = init_data["uploadId"]
            object_key = init_data["objectKey"]
            assert "My_Vacation_Movie.mp4" in object_key
            assert init_data["totalParts"] == 3
            assert init_data["partSize"] == 64 * 1024 * 1024

            # 3. Generate presigned part URLs
            part_resp = await client.post(
                f"/api/videos/r2/uploads/{upload_id}/part-urls",
                json={"objectKey": object_key, "partNumbers": [1, 2, 3]},
                headers=headers
            )
            assert part_resp.status_code == 200
            part_data = part_resp.json()
            assert len(part_data) == 3
            assert part_data[0]["partNumber"] == 1
            assert "upload-part" in part_data[0]["url"]

            # 4. Try requesting invalid part number (out of range)
            bad_part_resp = await client.post(
                f"/api/videos/r2/uploads/{upload_id}/part-urls",
                json={"objectKey": object_key, "partNumbers": [4]},
                headers=headers
            )
            assert bad_part_resp.status_code == 400

            # 5. Complete multipart upload
            complete_resp = await client.post(
                f"/api/videos/r2/uploads/{upload_id}/complete",
                json={
                    "objectKey": object_key,
                    "parts": [
                        {"partNumber": 1, "etag": "etag-chunk-1"},
                        {"partNumber": 2, "etag": "etag-chunk-2"},
                        {"partNumber": 3, "etag": "etag-chunk-3"},
                    ]
                },
                headers=headers
            )
            assert complete_resp.status_code == 200
            comp_data = complete_resp.json()
            assert comp_data["status"] == "completed"
            assert comp_data["objectKey"] == object_key

            # 6. Duplicate completion request is idempotent and returns completed
            dup_complete = await client.post(
                f"/api/videos/r2/uploads/{upload_id}/complete",
                json={
                    "objectKey": object_key,
                    "parts": [
                        {"partNumber": 1, "etag": "etag-chunk-1"},
                        {"partNumber": 2, "etag": "etag-chunk-2"},
                        {"partNumber": 3, "etag": "etag-chunk-3"},
                    ]
                },
                headers=headers
            )
            assert dup_complete.status_code == 200
            assert dup_complete.json()["status"] == "completed"

@pytest.mark.asyncio
async def test_multipart_abort_lifecycle(mock_s3):
    with patch("app.api.videos.r2_service._s3_client", mock_s3):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            auth_resp = await client.post("/api/videos/r2/admin/verify", json={"password": "admin123"})
            token = auth_resp.json()["token"]
            headers = {"X-R2-Admin-Token": token}

            # Initiate
            init_resp = await client.post(
                "/api/videos/r2/uploads/initiate",
                json={"filename": "cancel_me.mp4", "fileSize": 10 * 1024 * 1024},
                headers=headers
            )
            upload_id = init_resp.json()["uploadId"]
            object_key = init_resp.json()["objectKey"]

            # Abort
            abort_resp = await client.post(
                f"/api/videos/r2/uploads/{upload_id}/abort",
                json={"objectKey": object_key},
                headers=headers
            )
            assert abort_resp.status_code == 200
            assert abort_resp.json()["status"] == "aborted"

            # Retrying abort is safe
            retry_abort = await client.post(
                f"/api/videos/r2/uploads/{upload_id}/abort",
                json={"objectKey": object_key},
                headers=headers
            )
            assert retry_abort.status_code == 200
            assert retry_abort.json()["status"] == "aborted"

            # Attempting to complete aborted upload fails
            comp_fail = await client.post(
                f"/api/videos/r2/uploads/{upload_id}/complete",
                json={"objectKey": object_key, "parts": [{"partNumber": 1, "etag": "abc"}]},
                headers=headers
            )
            assert comp_fail.status_code == 400
            assert "aborted" in comp_fail.json()["detail"]

@pytest.mark.asyncio
async def test_delete_video_flow(mock_s3):
    with patch("app.api.videos.r2_service._s3_client", mock_s3):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            auth_resp = await client.post("/api/videos/r2/admin/verify", json={"password": "admin123"})
            token = auth_resp.json()["token"]
            headers = {"X-R2-Admin-Token": token}

            # Delete valid video
            del_resp = await client.delete("/api/videos/r2/videos/sample_to_delete.mp4", headers=headers)
            assert del_resp.status_code == 200
            data = del_resp.json()
            assert data["status"] == "deleted"
            assert data["key"] == "videos/sample_to_delete.mp4"

            # Delete invalid path traversal
            bad_del = await client.delete("/api/videos/r2/../secret.txt", headers=headers)
            assert bad_del.status_code in (400, 404)

            # Delete non-existent object
            mock_s3.head_object.side_effect = ClientError({"Error": {"Code": "404", "Message": "Not Found"}}, "HeadObject")
            not_found_del = await client.delete("/api/videos/r2/videos/ghost.mp4", headers=headers)
            assert not_found_del.status_code == 404

@pytest.mark.asyncio
async def test_upload_ownership_isolation(mock_s3):
    with patch("app.api.videos.r2_service._s3_client", mock_s3):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            # Create session 1
            auth1 = await client.post("/api/videos/r2/admin/verify", json={"password": "admin123"})
            token1 = auth1.json()["token"]

            # Create session 2
            auth2 = await client.post("/api/videos/r2/admin/verify", json={"password": "admin123"})
            token2 = auth2.json()["token"]

            # Admin 1 initiates upload
            init_resp = await client.post(
                "/api/videos/r2/uploads/initiate",
                json={"filename": "alice_movie.mp4", "fileSize": 100000000},
                headers={"X-R2-Admin-Token": token1}
            )
            upload_id = init_resp.json()["uploadId"]
            object_key = init_resp.json()["objectKey"]

            # Admin 2 cannot request part URLs for Admin 1's upload
            hijack_part = await client.post(
                f"/api/videos/r2/uploads/{upload_id}/part-urls",
                json={"objectKey": object_key, "partNumbers": [1]},
                headers={"X-R2-Admin-Token": token2}
            )
            assert hijack_part.status_code == 403

            # Admin 2 cannot complete Admin 1's upload
            hijack_comp = await client.post(
                f"/api/videos/r2/uploads/{upload_id}/complete",
                json={"objectKey": object_key, "parts": [{"partNumber": 1, "etag": "etag"}]},
                headers={"X-R2-Admin-Token": token2}
            )
            assert hijack_comp.status_code == 403

            # Admin 2 cannot abort Admin 1's upload
            hijack_abort = await client.post(
                f"/api/videos/r2/uploads/{upload_id}/abort",
                json={"objectKey": object_key},
                headers={"X-R2-Admin-Token": token2}
            )
            assert hijack_abort.status_code == 403
