import os
from pathlib import Path
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .config import settings
from .api import rooms_router, videos_router, auth_router, drive_router
from .websocket.handler import handle_websocket_connection

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Ensure media directory exists
    settings.MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    yield

app = FastAPI(
    title=settings.APP_NAME,
    description="Synchronized Watch-Room Web Application with decoupled video delivery and WebSocket control.",
    version="1.0.0",
    lifespan=lifespan
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API Routers
app.include_router(rooms_router)
app.include_router(videos_router)
app.include_router(auth_router)
app.include_router(drive_router)

# WebSocket Endpoint
@app.websocket("/ws/rooms/{room_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str):
    await handle_websocket_connection(websocket, room_id)

# Health Check
@app.get("/api/health")
async def health_check():
    return {
        "status": "healthy",
        "app": settings.APP_NAME,
        "storageProvider": settings.STORAGE_PROVIDER,
        "mediaDir": str(settings.MEDIA_DIR)
    }
