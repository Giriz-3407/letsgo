import {
  RoomState,
  VideoMetadata,
  ControlMode,
  R2VideoItem,
  R2AdminAuthResponse,
  R2InitiateUploadResponse,
  R2PartUrlItem,
  R2PartETag,
  R2CompleteUploadResponse,
  R2StorageInfo
} from '../types';
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

export interface GooglePickerConfig {
  accessToken: string;
  apiKey: string;
  appId: string;
  clientId: string;
}

class ApiClient {
  private r2AdminToken: string | null = null;

  constructor() {
    if (typeof localStorage !== 'undefined') {
      this.r2AdminToken = localStorage.getItem('wt_r2_admin_token');
    }
  }

  public setR2AdminToken(token: string | null): void {
    this.r2AdminToken = token;
    if (typeof localStorage !== 'undefined') {
      if (token) {
        localStorage.setItem('wt_r2_admin_token', token);
      } else {
        localStorage.removeItem('wt_r2_admin_token');
      }
    }
  }

  public getR2AdminToken(): string | null {
    if (!this.r2AdminToken && typeof localStorage !== 'undefined') {
      this.r2AdminToken = localStorage.getItem('wt_r2_admin_token');
    }
    return this.r2AdminToken;
  }

  private getHeaders(): HeadersInit {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (typeof localStorage !== 'undefined') {
      const savedSession = localStorage.getItem('wt_session_id');
      if (savedSession) {
        headers['X-Session-ID'] = savedSession;
      }
    }
    const adminToken = this.getR2AdminToken();
    if (adminToken) {
      headers['X-R2-Admin-Token'] = adminToken;
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

  public async getGooglePickerConfig(): Promise<GooglePickerConfig> {
    const res = await fetch(this.buildUrl('/api/auth/google/picker-config'), {
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Failed to fetch Google Picker configuration');
    }
    return res.json();
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

  public async listR2Videos(): Promise<R2VideoItem[]> {
    const res = await fetch(this.buildUrl('/api/videos/r2'), {
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to list R2 videos');
    }
    return res.json();
  }

  public async getR2PlayUrl(key: string): Promise<{ url: string; key: string; expiresIn: number }> {
    const res = await fetch(this.buildUrl('/api/videos/r2/play-url'), {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ key }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to obtain R2 playback URL');
    }
    return res.json();
  }

  public async verifyR2Admin(password: string): Promise<R2AdminAuthResponse> {
    const res = await fetch(this.buildUrl('/api/videos/r2/admin/verify'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Admin authentication failed');
    }
    const data: R2AdminAuthResponse = await res.json();
    this.setR2AdminToken(data.token);
    return data;
  }

  public async initiateR2Upload(
    filename: string,
    fileSize: number,
    contentType?: string
  ): Promise<R2InitiateUploadResponse> {
    const res = await fetch(this.buildUrl('/api/videos/r2/uploads/initiate'), {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ filename, fileSize, contentType }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to initiate R2 multipart upload');
    }
    return res.json();
  }

  public async getR2PartUrls(
    uploadId: string,
    objectKey: string,
    partNumbers: number[]
  ): Promise<R2PartUrlItem[]> {
    const res = await fetch(this.buildUrl(`/api/videos/r2/uploads/${encodeURIComponent(uploadId)}/part-urls`), {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ objectKey, partNumbers }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to generate presigned part URLs');
    }
    return res.json();
  }

  public async completeR2Upload(
    uploadId: string,
    objectKey: string,
    parts: R2PartETag[]
  ): Promise<R2CompleteUploadResponse> {
    const res = await fetch(this.buildUrl(`/api/videos/r2/uploads/${encodeURIComponent(uploadId)}/complete`), {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ objectKey, parts }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to complete R2 upload');
    }
    return res.json();
  }

  public async abortR2Upload(
    uploadId: string,
    objectKey?: string
  ): Promise<{ status: string; uploadId: string }> {
    const res = await fetch(this.buildUrl(`/api/videos/r2/uploads/${encodeURIComponent(uploadId)}/abort`), {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ objectKey }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to abort multipart upload');
    }
    return res.json();
  }

  public async deleteR2Video(objectKey: string): Promise<{ status: string; key: string; message: string }> {
    const res = await fetch(this.buildUrl(`/api/videos/r2/${encodeURIComponent(objectKey)}`), {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to delete video from R2');
    }
    return res.json();
  }

  public async getR2StorageInfo(): Promise<R2StorageInfo> {
    const res = await fetch(this.buildUrl('/api/videos/r2/storage-info'), {
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to fetch R2 storage info');
    }
    return res.json();
  }
}

export const api = new ApiClient();
