import os
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List

BASE_DIR = Path(__file__).resolve().parent.parent

class Settings(BaseSettings):
    APP_NAME: str = "WatchTogether API"
    DEBUG: bool = False
    ENVIRONMENT: str = os.getenv("ENVIRONMENT", "development")
    
    # Server & Ports
    HOST: str = "0.0.0.0"
    PORT: int = int(os.getenv("PORT", "8000"))
    FRONTEND_URL: str = "http://localhost:5173"
    
    # Storage
    STORAGE_PROVIDER: str = "local"  # "local", "google_drive", "s3", "r2"
    MEDIA_DIR: Path = BASE_DIR / "sample_media"
    
    # Cloudflare R2
    R2_ACCOUNT_ID: str = ""
    R2_ACCESS_KEY_ID: str = ""
    R2_SECRET_ACCESS_KEY: str = ""
    R2_BUCKET_NAME: str = "letsgo-backend"
    R2_ADMIN_PASSWORD: str = os.getenv("R2_ADMIN_PASSWORD", "admin123")
    R2_ADMIN_TOKEN_SECRET: str = ""
    R2_UPLOAD_EXPIRY_SECONDS: int = 86400  # 24 hours
    R2_STORAGE_LIMIT_BYTES: int = 10 * 1024 * 1024 * 1024  # 10 GiB
    R2_RESERVATIONS_DB_PATH: Path = BASE_DIR / "r2_reservations.db"
    
    # Google OAuth & Picker
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    GOOGLE_REDIRECT_URI: str = "http://localhost:8000/api/auth/google/callback"
    GOOGLE_API_KEY: str = ""
    GOOGLE_APP_ID: str = ""
    
    # Security
    SESSION_SECRET: str = "watchtogether-secret-key-change-in-production-12345"
    CORS_ORIGIN_REGEX: str = r"https://.*\.vercel\.app|https://.*\.onrender\.com|https?://localhost.*|https?://127\.0\.0\.1.*|https?://192\.168\..*|https?://10\..*"
    
    model_config = SettingsConfigDict(
        env_file=str(BASE_DIR.parent / ".env"),
        env_file_encoding="utf-8",
        extra="ignore"
    )

    def is_production(self) -> bool:
        env_lower = self.ENVIRONMENT.lower()
        if env_lower in ("production", "prod"):
            return True
        if not self.DEBUG and (os.getenv("RENDER") or os.getenv("RENDER_SERVICE_ID")):
            return True
        return False

    @property
    def r2_endpoint_url(self) -> str:
        if self.R2_ACCOUNT_ID:
            return f"https://{self.R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
        return ""

    def get_allowed_origins(self) -> List[str]:
        origins = [
            "http://localhost:5173",
            "http://localhost:3000",
            "http://127.0.0.1:5173",
            "http://127.0.0.1:3000",
        ]
        if self.FRONTEND_URL:
            clean_url = self.FRONTEND_URL.rstrip("/")
            if clean_url not in origins:
                origins.append(clean_url)
        return origins

settings = Settings()
