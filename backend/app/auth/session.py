import time
from typing import Dict, Optional, Any, Tuple
import uuid

class SessionStore:
    def __init__(self):
        # Maps session_id -> { "google_tokens": dict, "created_at": float, ... }
        self._sessions: Dict[str, Dict[str, Any]] = {}

    def get_or_create_session(self, session_id: Optional[str] = None) -> Tuple[str, Dict[str, Any]]:
        if session_id and session_id in self._sessions:
            return session_id, self._sessions[session_id]
        new_id = self.create_session()
        return new_id, self._sessions[new_id]

    def create_session(self) -> str:
        session_id = str(uuid.uuid4())
        self._sessions[session_id] = {
            "created_at": time.time(),
            "google_tokens": None,
            "display_name": None
        }
        return session_id

    def get_session(self, session_id: str) -> Optional[Dict[str, Any]]:
        return self._sessions.get(session_id)

    def set_google_tokens(self, session_id: str, tokens: Dict[str, Any]):
        if session_id not in self._sessions:
            self._sessions[session_id] = {"created_at": time.time(), "google_tokens": None, "display_name": None}
        
        existing_tokens = self._sessions[session_id].get("google_tokens") or {}
        # Preserve refresh_token if not present in new tokens
        if not tokens.get("refresh_token") and existing_tokens.get("refresh_token"):
            tokens["refresh_token"] = existing_tokens["refresh_token"]
            
        expires_in = tokens.get("expires_in", 3600)
        tokens["expires_at"] = time.time() + expires_in
        self._sessions[session_id]["google_tokens"] = tokens

    def get_google_access_token(self, session_id: str) -> Optional[str]:
        session = self.get_session(session_id)
        if not session or not session.get("google_tokens"):
            return None
        return session["google_tokens"].get("access_token")

    async def get_valid_google_access_token(self, session_id: str) -> Optional[str]:
        session = self.get_session(session_id)
        if not session or not session.get("google_tokens"):
            return None

        tokens = session["google_tokens"]
        expires_at = tokens.get("expires_at", 0)
        refresh_token = tokens.get("refresh_token")

        # If token is expired or expiring within 60 seconds, refresh it
        if refresh_token and time.time() >= (expires_at - 60):
            try:
                from .google_oauth import google_oauth
                new_tokens = await google_oauth.refresh_access_token(refresh_token)
                self.set_google_tokens(session_id, new_tokens)
                return self._sessions[session_id]["google_tokens"].get("access_token")
            except Exception as e:
                # If refresh fails, fall back to current access_token or return None if completely unusable
                pass

        return tokens.get("access_token")

    def remove_google_tokens(self, session_id: str):
        if session_id in self._sessions:
            self._sessions[session_id]["google_tokens"] = None

session_store = SessionStore()
