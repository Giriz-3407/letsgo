import { ClockSynchronizer } from './ClockSynchronizer';
import { WebSocketRoomClient } from './WebSocketRoomClient';
import { PlaybackChangeSource, RoomState, SyncStatus } from '../types';

export interface SyncStats {
  authoritativePosition: number;
  localPosition: number;
  driftMs: number;
  rttMs: number;
  clockOffsetMs: number;
  playbackRate: number;
  syncStatus: SyncStatus;
  bufferedUntil: number;
  bufferPercent: number;
}

export type StatsListener = (stats: SyncStats) => void;

export class PlaybackSynchronizer {
  private video: HTML5VideoElementWithCustom | null = null;
  private clockSync: ClockSynchronizer;
  private wsClient: WebSocketRoomClient;
  private currentRoomState: RoomState | null = null;
  private checkInterval: number | null = null;
  private statsListeners: Set<StatsListener> = new Set();
  
  // Guard to prevent feedback loops
  private changeSource: PlaybackChangeSource = PlaybackChangeSource.USER;
  private isBuffering: boolean = false;
  private isUserSeeking: boolean = false;

  constructor(wsClient: WebSocketRoomClient, clockSync: ClockSynchronizer) {
    this.wsClient = wsClient;
    this.clockSync = clockSync;
  }

  public attachVideo(videoElement: HTMLVideoElement): () => void {
    this.video = videoElement;
    this.setupVideoListeners();
    this.startPeriodicDriftCheck();

    return () => {
      this.detachVideo();
    };
  }

  public detachVideo(): void {
    this.stopPeriodicDriftCheck();
    this.video = null;
  }

  public updateRoomState(state: RoomState): void {
    this.currentRoomState = state;
    this.synchronizeToState(state, true);
  }

  public getCurrentState(): RoomState | null {
    return this.currentRoomState;
  }

  public getChangeSource(): PlaybackChangeSource {
    return this.changeSource;
  }

  public setChangeSource(source: PlaybackChangeSource): void {
    this.changeSource = source;
  }

  /**
   * Calculates the authoritative room playback position at the current estimated server time.
   */
  public calculateAuthoritativePosition(): number {
    if (!this.currentRoomState) return 0;
    if (!this.currentRoomState.isPlaying) {
      return this.currentRoomState.position;
    }

    const currentServerTime = this.clockSync.getEstimatedServerTime();
    const elapsedSec = (currentServerTime - this.currentRoomState.lastStateChangeServerTime) / 1000.0;
    let pos = this.currentRoomState.position + elapsedSec;

    if (this.currentRoomState.video?.duration && pos > this.currentRoomState.video.duration) {
      pos = this.currentRoomState.video.duration;
    }
    return Math.max(0, pos);
  }

  /**
   * Synchronize local HTML5 video element to authoritative state.
   */
  public synchronizeToState(state: RoomState, forceSeek: boolean = false): void {
    if (!this.video) return;

    this.currentRoomState = state;
    const targetPosition = this.calculateAuthoritativePosition();
    const drift = Math.abs(targetPosition - this.video.currentTime);

    // If drift is significant (> 1.5s) or explicitly forced (e.g. on late join or seek)
    if (forceSeek || drift > 1.5) {
      this.executeProgrammaticChange(PlaybackChangeSource.REMOTE, () => {
        if (this.video) {
          this.video.currentTime = targetPosition;
          this.video.playbackRate = 1.0;
        }
      });
    }

    if (state.isPlaying) {
      if (this.video.paused) {
        this.executeProgrammaticChange(PlaybackChangeSource.REMOTE, () => {
          this.video?.play().catch((err) => {
            console.warn('[Sync] Autoplay prevented, waiting for user gesture', err);
          });
        });
      }
    } else {
      if (!this.video.paused) {
        this.executeProgrammaticChange(PlaybackChangeSource.REMOTE, () => {
          this.video?.pause();
        });
      }
    }
  }

  /**
   * Programmatic change wrapper that temporarily sets the changeSource to avoid feedback loops.
   */
  private executeProgrammaticChange(source: PlaybackChangeSource, action: () => void): void {
    this.changeSource = source;
    try {
      action();
    } finally {
      // Allow the DOM event to fire and be ignored, then reset to USER
      setTimeout(() => {
        this.changeSource = PlaybackChangeSource.USER;
      }, 60);
    }
  }

  /**
   * Periodic drift detection and micro-adjustment loop. Runs every 1.5 seconds.
   */
  private startPeriodicDriftCheck(): void {
    this.stopPeriodicDriftCheck();
    this.checkInterval = window.setInterval(() => {
      this.checkAndCorrectDrift();
    }, 1500);
  }

  private stopPeriodicDriftCheck(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  public checkAndCorrectDrift(): void {
    if (!this.video || !this.currentRoomState || this.isUserSeeking) return;

    // Only apply drift correction when room is actively playing
    if (!this.currentRoomState.isPlaying) {
      if (this.video.playbackRate !== 1.0) {
        this.video.playbackRate = 1.0;
      }
      this.publishStats();
      return;
    }

    const targetPosition = this.calculateAuthoritativePosition();
    const localPosition = this.video.currentTime;
    const drift = targetPosition - localPosition; // Positive means local is behind, negative means ahead
    const absDrift = Math.abs(drift);

    // Band 1: Imperceptible drift (< 150ms) -> do nothing, restore normal playbackRate
    if (absDrift < 0.15) {
      if (this.video.playbackRate !== 1.0) {
        this.video.playbackRate = 1.0;
      }
    }
    // Band 2: Minor drift (150ms - 1500ms) -> subtle micro-stepping to avoid audio/video stutter
    else if (absDrift <= 1.5) {
      if (drift > 0) {
        // Local is lagging -> speed up slightly (1.05x)
        this.video.playbackRate = 1.05;
      } else {
        // Local is leading -> slow down slightly (0.95x)
        this.video.playbackRate = 0.95;
      }
    }
    // Band 3: Major drift (> 1500ms) -> hard seek
    else {
      this.executeProgrammaticChange(PlaybackChangeSource.SYNC, () => {
        if (this.video) {
          this.video.currentTime = targetPosition;
          this.video.playbackRate = 1.0;
        }
      });
    }

    this.publishStats();
  }

  private setupVideoListeners(): void {
    if (!this.video) return;

    // User initiated Play
    this.video.addEventListener('play', () => {
      if (this.changeSource === PlaybackChangeSource.USER && this.video) {
        this.wsClient.sendPlay(this.video.currentTime);
      }
      this.publishStats();
    });

    // User initiated Pause
    this.video.addEventListener('pause', () => {
      if (this.changeSource === PlaybackChangeSource.USER && this.video) {
        this.wsClient.sendPause(this.video.currentTime);
      }
      this.publishStats();
    });

    // Seeking handlers
    this.video.addEventListener('seeking', () => {
      if (this.changeSource === PlaybackChangeSource.USER) {
        this.isUserSeeking = true;
      }
    });

    this.video.addEventListener('seeked', () => {
      if (this.changeSource === PlaybackChangeSource.USER && this.video) {
        this.isUserSeeking = false;
        this.wsClient.sendSeek(this.video.currentTime);
      }
      this.publishStats();
    });

    // Buffering detection
    this.video.addEventListener('waiting', () => {
      this.isBuffering = true;
      this.wsClient.sendBuffering(true, this.video?.currentTime);
      this.publishStats();
    });

    this.video.addEventListener('canplay', () => {
      if (this.isBuffering) {
        this.isBuffering = false;
        this.wsClient.sendBuffering(false, this.video?.currentTime);
      }
      this.publishStats();
    });

    this.video.addEventListener('playing', () => {
      if (this.isBuffering) {
        this.isBuffering = false;
        this.wsClient.sendBuffering(false, this.video?.currentTime);
      }
      this.publishStats();
    });

    this.video.addEventListener('timeupdate', () => {
      this.publishStats();
    });
  }

  public getBufferedUntil(): number {
    if (!this.video || this.video.buffered.length === 0) return 0;
    const curTime = this.video.currentTime;
    for (let i = 0; i < this.video.buffered.length; i++) {
      if (this.video.buffered.start(i) <= curTime && curTime <= this.video.buffered.end(i)) {
        return this.video.buffered.end(i);
      }
    }
    return this.video.buffered.end(this.video.buffered.length - 1);
  }

  public getBufferPercentage(): number {
    if (!this.video || !this.video.duration || isNaN(this.video.duration)) return 0;
    const bufferedEnd = this.getBufferedUntil();
    return Math.min(100, Math.round((bufferedEnd / this.video.duration) * 100));
  }

  public getSyncStatus(): SyncStatus {
    if (!this.wsClient.isConnected()) return 'DISCONNECTED';
    if (this.isBuffering) return 'BUFFERING';
    if (!this.currentRoomState) return 'SYNCHRONIZING';

    const drift = Math.abs(this.calculateAuthoritativePosition() - (this.video?.currentTime || 0));
    if (drift > 0.25) return 'SYNCHRONIZING';
    return 'SYNCED';
  }

  public onStats(listener: StatsListener): () => void {
    this.statsListeners.add(listener);
    this.publishStats();
    return () => this.statsListeners.delete(listener);
  }

  private publishStats(): void {
    if (this.statsListeners.size === 0) return;

    const authPos = this.calculateAuthoritativePosition();
    const localPos = this.video?.currentTime || 0;
    const driftMs = Math.round((authPos - localPos) * 1000);

    const stats: SyncStats = {
      authoritativePosition: authPos,
      localPosition: localPos,
      driftMs,
      rttMs: this.clockSync.getLastRtt(),
      clockOffsetMs: Math.round(this.clockSync.getOffset()),
      playbackRate: this.video?.playbackRate || 1.0,
      syncStatus: this.getSyncStatus(),
      bufferedUntil: this.getBufferedUntil(),
      bufferPercent: this.getBufferPercentage(),
    };

    this.statsListeners.forEach((fn) => fn(stats));
  }
}

type HTML5VideoElementWithCustom = HTMLVideoElement;
