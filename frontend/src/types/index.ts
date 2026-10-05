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
