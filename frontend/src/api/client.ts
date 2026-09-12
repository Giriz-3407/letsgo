import { RoomState, VideoMetadata, ControlMode } from '../types';
import { API_BASE_URL } from '../config';

export interface CreateRoomParams {
  hostDisplayName: string;
  controlMode?: ControlMode;
  videoId?: string;
  pauseOnBuffer?: boolean;
}

export interface CreateRoomResult {
  roomId: string;
  hostId: string;
  joinUrl: string;
  controlMode: ControlMode;
}

export interface SessionStatus {
  sessionId: string;
  driveConnected: boolean;
  googleOAuthConfigured: boolean;
}

class ApiClient {
  private getHeaders(): HeadersInit {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };
    const savedSession = localStorage.getItem('wt_session_id');
    if (savedSession) {
      headers['X-Session-ID'] = savedSession;
    }
    return headers;
  }

  private buildUrl(path: string): string {
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    return `${API_BASE_URL}${cleanPath}`;
  }

  public async createRoom(params: CreateRoomParams): Promise<CreateRoomResult> {
    const res = await fetch(this.buildUrl('/api/rooms'), {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Failed to create room');
    }
    return res.json();
  }

  public async getRoom(roomId: string): Promise<RoomState> {
    const res = await fetch(this.buildUrl(`/api/rooms/${roomId}`), {
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Room not found');
    }
    return res.json();
  }

  public async deleteRoom(roomId: string, hostId: string): Promise<void> {
    const res = await fetch(this.buildUrl(`/api/rooms/${roomId}?host_id=${encodeURIComponent(hostId)}`), {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Failed to delete room');
    }
  }

  public async setRoomVideo(roomId: string, videoId: string, hostId: string): Promise<VideoMetadata> {
    const res = await fetch(this.buildUrl(`/api/rooms/${roomId}/video`), {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ videoId, hostId }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Failed to change video');
    }
    const data = await res.json();
    return data.video;
  }

  public async setRoomSettings(
    roomId: string,
    hostId: string,
    controlMode?: ControlMode,
    pauseOnBuffer?: boolean
  ): Promise<any> {
    const res = await fetch(this.buildUrl(`/api/rooms/${roomId}/settings`), {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ hostId, controlMode, pauseOnBuffer }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Failed to update settings');
    }
    return res.json();
  }

  public async listVideos(): Promise<VideoMetadata[]> {
    const res = await fetch(this.buildUrl('/api/videos'), {
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      throw new Error('Failed to fetch videos');
    }
    return res.json();
  }

  public async uploadVideo(file: File): Promise<VideoMetadata> {
    const formData = new FormData();
    formData.append('file', file);

    const headers: HeadersInit = {};
    const savedSession = localStorage.getItem('wt_session_id');
    if (savedSession) {
      headers['X-Session-ID'] = savedSession;
    }

    const res = await fetch(this.buildUrl('/api/videos/upload'), {
      method: 'POST',
      headers,
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Failed to upload video');
    }
    return res.json();
  }

  public async getSessionStatus(): Promise<SessionStatus> {
    const res = await fetch(this.buildUrl('/api/auth/session'), {
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      throw new Error('Failed to fetch session');
    }
    const data = await res.json();
    if (data.sessionId) {
      localStorage.setItem('wt_session_id', data.sessionId);
    }
    return data;
  }

  public async getGoogleOAuthUrl(redirectTo: string = '/create'): Promise<string> {
    const res = await fetch(this.buildUrl(`/api/auth/google/url?redirect_to=${encodeURIComponent(redirectTo)}`), {
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Google OAuth is not configured');
    }
    const data = await res.json();
    return data.url;
  }

  public async listDriveVideos(): Promise<VideoMetadata[]> {
    const res = await fetch(this.buildUrl('/api/drive/videos'), {
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Failed to list Google Drive videos');
    }
    return res.json();
  }

  public async importDriveVideo(driveFileId: string): Promise<VideoMetadata> {
    const res = await fetch(this.buildUrl(`/api/videos/drive/import?drive_file_id=${encodeURIComponent(driveFileId)}`), {
      method: 'POST',
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Failed to import video from Drive');
    }
    return res.json();
  }

  public async disconnectGoogle(): Promise<void> {
    await fetch(this.buildUrl('/api/auth/google/disconnect'), {
      method: 'POST',
      headers: this.getHeaders(),
    });
  }
}

export const api = new ApiClient();
