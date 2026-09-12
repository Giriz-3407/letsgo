from typing import Optional, List
from fastapi import APIRouter, HTTPException, Request, Response, Query
from fastapi.responses import RedirectResponse
from ..auth.session import session_store
from ..auth.google_oauth import google_oauth
from ..storage.google_drive import GoogleDriveStorageProvider
from ..models.room import VideoMetadata
from ..config import settings

router = APIRouter(prefix="/api/auth", tags=["auth"])
drive_storage = GoogleDriveStorageProvider()

def set_session_cookie(response: Response, session_id: str):
    is_secure = settings.FRONTEND_URL.startswith("https:")
    samesite_mode = "none" if is_secure else "lax"
    response.set_cookie(
        key="session_id",
        value=session_id,
        httponly=True,
        samesite=samesite_mode,
        secure=is_secure,
        max_age=30 * 24 * 3600
    )

@router.get("/session")
async def get_session_status(request: Request, response: Response):
    session_id = request.cookies.get("session_id") or request.headers.get("X-Session-ID")
    if not session_id or not session_store.get_session(session_id):
        session_id = session_store.create_session()
        set_session_cookie(response, session_id)

    has_drive = bool(session_store.get_google_access_token(session_id))
    return {
        "sessionId": session_id,
        "driveConnected": has_drive,
        "googleOAuthConfigured": google_oauth.is_configured()
    }

@router.get("/google/url")
async def get_google_oauth_url(request: Request, response: Response, redirect_to: Optional[str] = None):
    if not google_oauth.is_configured():
        raise HTTPException(
            status_code=503,
            detail="Google OAuth not configured on server. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET."
        )

    session_id = request.cookies.get("session_id") or request.headers.get("X-Session-ID")
    if not session_id:
        session_id = session_store.create_session()
        set_session_cookie(response, session_id)

    state = f"{session_id}:{redirect_to or '/create'}"
    auth_url = google_oauth.get_authorization_url(state=state)
    return {"url": auth_url}

@router.get("/google/callback")
async def google_oauth_callback(
    code: Optional[str] = None,
    state: Optional[str] = None,
    error: Optional[str] = None
):
    if error:
        raise HTTPException(status_code=400, detail=f"Google OAuth authorization rejected: {error}")

    if not code or not state:
        raise HTTPException(status_code=400, detail="Missing code or state parameter")

    parts = state.split(":", 1)
    session_id = parts[0]
    redirect_path = parts[1] if len(parts) > 1 else "/create"

    tokens = await google_oauth.exchange_code_for_tokens(code)
    session_store.set_google_tokens(session_id, tokens)

    # Redirect user back to the frontend page
    frontend_target = f"{settings.FRONTEND_URL.rstrip('/')}{redirect_path}?drive_connected=true"
    resp = RedirectResponse(url=frontend_target)
    set_session_cookie(resp, session_id)
    return resp

@router.post("/google/disconnect")
async def disconnect_google(request: Request):
    session_id = request.cookies.get("session_id") or request.headers.get("X-Session-ID")
    if session_id:
        session_store.remove_google_tokens(session_id)
    return {"status": "disconnected"}

drive_router = APIRouter(prefix="/api/drive", tags=["drive"])

@drive_router.get("/videos", response_model=List[VideoMetadata])
async def list_drive_videos(request: Request):
    session_id = request.cookies.get("session_id") or request.headers.get("X-Session-ID")
    if not session_id:
        raise HTTPException(status_code=401, detail="Session required")

    access_token = session_store.get_google_access_token(session_id)
    if not access_token:
        raise HTTPException(
            status_code=401,
            detail="Google Drive is not connected. Please connect your Google account first."
        )

    return await drive_storage.list_videos(user_token=access_token)
