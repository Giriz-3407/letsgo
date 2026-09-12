export type ControlMode = 'HOST_ONLY' | 'EVERYONE';

export interface Participant {
  id: string;
  displayName: string;
  isHost: boolean;
  connected: boolean;
  joinedAt: number;
  isBuffering?: boolean;
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
}

export type SyncStatus = 'SYNCED' | 'SYNCHRONIZING' | 'BUFFERING' | 'DISCONNECTED';

export enum PlaybackChangeSource {
  USER = 'USER',
  REMOTE = 'REMOTE',
  SYNC = 'SYNC',
}

export interface InboundMessage {
  type: string;
  [key: string]: any;
}
