import base64
import hashlib
import hmac
import json
import secrets
import time
import uuid
from typing import Optional, Dict
from dataclasses import dataclass
from fastapi import Request, HTTPException, Header, Depends

from ..config import settings

@dataclass
class AdminSession:
    session_id: str
    created_at: float
    expires_at: float
    ip: str

class AdminAuthManager:
    def __init__(self):
        # session_id -> AdminSession
        self._sessions: Dict[str, AdminSession] = {}
        # ip -> list of failed attempt timestamps
        self._failed_attempts: Dict[str, list[float]] = {}
        self.max_failed_attempts: int = 5
        self.lockout_seconds: int = 60
        self.session_ttl: int = 7200  # 2 hours

    def _get_signing_key(self) -> bytes:
        secret = settings.R2_ADMIN_TOKEN_SECRET or settings.SESSION_SECRET
        return secret.encode("utf-8")

    def _clean_expired(self):
        now = time.time()
        expired_sessions = [sid for sid, sess in self._sessions.items() if sess.expires_at <= now]
        for sid in expired_sessions:
            self._sessions.pop(sid, None)

        # Clean old failed attempts
        for ip, timestamps in list(self._failed_attempts.items()):
            valid = [ts for ts in timestamps if now - ts < self.lockout_seconds]
            if valid:
                self._failed_attempts[ip] = valid
            else:
                self._failed_attempts.pop(ip, None)

    def check_rate_limit(self, ip: str):
        self._clean_expired()
        now = time.time()
        attempts = [ts for ts in self._failed_attempts.get(ip, []) if now - ts < self.lockout_seconds]
        if len(attempts) >= self.max_failed_attempts:
            raise HTTPException(
                status_code=429,
                detail="Too many failed admin login attempts. Please wait before retrying."
            )

    def record_failed_attempt(self, ip: str):
        now = time.time()
        if ip not in self._failed_attempts:
            self._failed_attempts[ip] = []
        self._failed_attempts[ip].append(now)

    def clear_failed_attempts(self, ip: str):
        self._failed_attempts.pop(ip, None)

    def verify_password_and_create_session(self, password: str, client_ip: str) -> tuple[str, int]:
        self.check_rate_limit(client_ip)

        # Enforce production security check
        if settings.is_production() and settings.R2_ADMIN_PASSWORD == "admin123":
            raise HTTPException(
                status_code=500,
                detail="Insecure configuration: Default admin password 'admin123' cannot be used in production. Set R2_ADMIN_PASSWORD."
            )

        if not settings.R2_ADMIN_PASSWORD:
            raise HTTPException(
                status_code=500,
                detail="Admin authentication is not configured on this server."
            )

        # Constant-time comparison
        is_valid = secrets.compare_digest(password.encode("utf-8"), settings.R2_ADMIN_PASSWORD.encode("utf-8"))
        if not is_valid:
            self.record_failed_attempt(client_ip)
            raise HTTPException(status_code=401, detail="Invalid admin password")

        self.clear_failed_attempts(client_ip)
        self._clean_expired()

        session_id = uuid.uuid4().hex
        now = time.time()
        expires_at = now + self.session_ttl

        session = AdminSession(
            session_id=session_id,
            created_at=now,
            expires_at=expires_at,
            ip=client_ip
        )
        self._sessions[session_id] = session

        # Generate HMAC-SHA256 signed token
        payload = {
            "sub": session_id,
            "iat": int(now),
            "exp": int(expires_at),
            "role": "admin"
        }
        payload_bytes = json.dumps(payload, separators=(',', ':')).encode("utf-8")
        b64_payload = base64.urlsafe_b64encode(payload_bytes).decode("utf-8").rstrip("=")
        
        signature = hmac.new(self._get_signing_key(), b64_payload.encode("utf-8"), hashlib.sha256).digest()
        b64_sig = base64.urlsafe_b64encode(signature).decode("utf-8").rstrip("=")

        token = f"{b64_payload}.{b64_sig}"
        return token, self.session_ttl

    def validate_token(self, token: str) -> AdminSession:
        if not token or "." not in token:
            raise HTTPException(status_code=401, detail="Invalid admin authorization token format")

        parts = token.split(".")
        if len(parts) != 2:
            raise HTTPException(status_code=401, detail="Malformed admin token")

        b64_payload, b64_sig = parts

        # Verify signature
        expected_sig = hmac.new(self._get_signing_key(), b64_payload.encode("utf-8"), hashlib.sha256).digest()
        
        # Add padding back if necessary
        rem = len(b64_sig) % 4
        padded_sig = b64_sig + ("=" * (4 - rem) if rem else "")
        try:
            provided_sig = base64.urlsafe_b64decode(padded_sig.encode("utf-8"))
        except Exception:
            raise HTTPException(status_code=401, detail="Invalid token signature encoding")

        if not hmac.compare_digest(provided_sig, expected_sig):
            raise HTTPException(status_code=401, detail="Invalid admin token signature")

        # Decode payload
        rem_p = len(b64_payload) % 4
        padded_p = b64_payload + ("=" * (4 - rem_p) if rem_p else "")
        try:
            payload_data = json.loads(base64.urlsafe_b64decode(padded_p.encode("utf-8")).decode("utf-8"))
        except Exception:
            raise HTTPException(status_code=401, detail="Invalid token payload")

        session_id = payload_data.get("sub")
        exp = payload_data.get("exp", 0)

        if time.time() > exp:
            raise HTTPException(status_code=401, detail="Admin token has expired")

        self._clean_expired()
        session = self._sessions.get(session_id)
        if not session:
            # If server restarted or session revoked
            raise HTTPException(status_code=401, detail="Admin session not found or revoked")

        return session

admin_auth = AdminAuthManager()

async def get_admin_session(
    request: Request,
    x_r2_admin_token: Optional[str] = Header(None, alias="X-R2-Admin-Token"),
    authorization: Optional[str] = Header(None)
) -> AdminSession:
    token: Optional[str] = None
    if x_r2_admin_token:
        token = x_r2_admin_token
    elif authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
    elif "r2_admin_token" in request.cookies:
        token = request.cookies.get("r2_admin_token")

    if not token:
        raise HTTPException(
            status_code=401,
            detail="Admin authorization required. Please provide a valid admin token."
        )

    return admin_auth.validate_token(token)
