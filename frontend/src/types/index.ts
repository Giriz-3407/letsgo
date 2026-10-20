export type ControlMode = 'HOST_ONLY' | 'EVERYONE';

export interface Participant {
  id: string;
  displayName: string;
  isHost: boolean;
  connected: boolean;
  joinedAt: number;
  isBuffering?: boolean;
  hasMedia?: boolean;
}

export interface VideoMetadata {
  id: string;
  name: string;
  mimeType: string;
  size?: number | null;
  duration?: number | null;
  streamUrl: string;
  downloadUrl?: string | null;
  provider: string;
}

export type MediaSourceType = 'local' | 'r2';

export interface AppMediaSource {
  type: MediaSourceType;
  title: string;
  src: string;
  file?: File;
  r2Key?: string;
  size?: number | null;
}

export interface R2VideoItem {
  key: string;
  name: string;
  size: number;
  mimeType: string;
  provider: string;
  lastModified?: string | null;
}

export interface RoomState {
  roomId: string;
  hostId: string;
  video: VideoMetadata | null;
  isPlaying: boolean;
  position: number;
  lastStateChangeServerTime: number;
  controlMode: ControlMode;
  pauseOnBuffer: boolean;
  participants: Participant[];
  playbackRate?: number;
  serverTime: number;
  seekOperationId?: number;
  seekBarrierActive?: boolean;
  seekTargetPosition?: number | null;
  seekReadyParticipants?: string[];
}

export type SyncStatus = 'SYNCED' | 'SYNCHRONIZING' | 'BUFFERING' | 'DISCONNECTED' | 'WAITING_FOR_OTHERS';

export enum PlaybackChangeSource {
  USER = 'USER',
  REMOTE = 'REMOTE',
  SYNC = 'SYNC',
}

export interface InboundMessage {
  type: string;
  [key: string]: any;
}

export interface R2AdminAuthResponse {
  token: string;
  expiresIn: number;
}

export interface R2InitiateUploadResponse {
  uploadId: string;
  objectKey: string;
  partSize: number;
  totalParts: number;
  filename: string;
  fileSize: number;
  bucket: string;
  contentType: string;
}

export interface R2PartUrlItem {
  partNumber: number;
  url: string;
  expiresIn: number;
}

export interface R2PartETag {
  partNumber: number;
  etag: string;
}

export interface R2CompleteUploadResponse {
  status: string;
  objectKey: string;
  uploadId: string;
  location?: string;
}

export type UploadStatus =
  | 'idle'
  | 'authorizing'
  | 'initiating'
  | 'uploading'
  | 'completing'
  | 'completed'
  | 'error'
  | 'aborted'
  | 'paused';

export interface UploadProgress {
  uploadedBytes: number;
  totalBytes: number;
  percentage: number;
  speedBytesPerSec: number;
  currentPart: number;
  totalParts: number;
}

export interface UploadTask {
  id: string;
  uploadId?: string;
  objectKey?: string;
  file: File;
  filename: string;
  fileSize: number;
  partSize?: number;
  totalParts?: number;
  status: UploadStatus;
  progress: UploadProgress;
  error?: string | null;
  createdAt: number;
}

export interface PersistedUploadPart {
  partNumber: number;
  etag: string;
  size: number;
}

export interface PersistedUploadMetadata {
  uploadId: string;
  objectKey: string;
  filename: string;
  fileSize: number;
  partSize: number;
  totalParts: number;
  completedParts: PersistedUploadPart[];
  status: 'uploading' | 'completed' | 'aborted' | 'paused';
  createdAt: number;
  updatedAt: number;
}

export interface R2StorageInfo {
  limitBytes: number;
  storedBytes: number;
  reservedBytes: number;
  availableBytes: number;
  videoCount: number;
  activeUploadCount: number;
  limitFormatted: string;
  storedFormatted: string;
  reservedFormatted: string;
  availableFormatted: string;
}
