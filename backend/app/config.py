import os
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List

BASE_DIR = Path(__file__).resolve().parent.parent

class Settings(BaseSettings):
    APP_NAME: str = "WatchTogether API"
    DEBUG: bool = False
    
    # Server & Ports
    HOST: str = "0.0.0.0"
    PORT: int = int(os.getenv("PORT", "8000"))
    FRONTEND_URL: str = "http://localhost:5173"
    
    # Storage
    STORAGE_PROVIDER: str = "local"  # "local", "google_drive", "s3"
    MEDIA_DIR: Path = BASE_DIR / "sample_media"
    
    # Google OAuth & Picker
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    GOOGLE_REDIRECT_URI: str = "http://localhost:8000/api/auth/google/callback"
    GOOGLE_API_KEY: str = ""
    GOOGLE_APP_ID: str = ""
    
    # Security
    SESSION_SECRET: str = "watchtogether-secret-key-change-in-production-12345"
    
    model_config = SettingsConfigDict(
        env_file=str(BASE_DIR.parent / ".env"),
        env_file_encoding="utf-8",
        extra="ignore"
    )

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
