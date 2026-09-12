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
            self._sessions[session_id] = {"created_at": time.time()}
        self._sessions[session_id]["google_tokens"] = tokens

    def get_google_access_token(self, session_id: str) -> Optional[str]:
        session = self.get_session(session_id)
        if not session or not session.get("google_tokens"):
            return None
        return session["google_tokens"].get("access_token")

    def remove_google_tokens(self, session_id: str):
        if session_id in self._sessions:
            self._sessions[session_id]["google_tokens"] = None

session_store = SessionStore()
