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

  // Programmatic action tracking (deterministic, no arbitrary timeouts)
  private programmaticSeekCount: number = 0;
  private programmaticPlayCount: number = 0;
  private programmaticPauseCount: number = 0;
  private lastSeekTime: number = 0;

  // Decoupled playback rate & drift correction
  private userPlaybackRate: number = 1.0;
  private driftCorrectionFactor: number = 1.0;

  constructor(wsClient: WebSocketRoomClient, clockSync: ClockSynchronizer) {
    this.wsClient = wsClient;
    this.clockSync = clockSync;
  }

  public attachVideo(videoElement: HTMLVideoElement): () => void {
    this.video = videoElement;
    this.applyEffectivePlaybackRate();
    this.setupVideoListeners();
    this.startPeriodicDriftCheck();

    // If room state is already present and video metadata is already loaded, synchronize immediately
    if (this.currentRoomState && videoElement.readyState >= 1 /* HAVE_METADATA */) {
      this.synchronizeToState(this.currentRoomState, true);
    }

    return () => {
      this.detachVideo();
    };
  }

  public detachVideo(): void {
    this.stopPeriodicDriftCheck();
    this.video = null;
  }

  public getUserPlaybackRate(): number {
    return this.userPlaybackRate;
  }

  public setUserPlaybackRate(rate: number): void {
    this.userPlaybackRate = rate;
    this.applyEffectivePlaybackRate();
    this.publishStats();
  }

  public requestPlaybackRate(rate: number): void {
    this.userPlaybackRate = rate;
    this.applyEffectivePlaybackRate();
    this.wsClient.sendPlaybackRate(rate);
    this.publishStats();
  }

  /**
   * Request a synchronized seek across the room.
   * Rebases local expected position and transmits authoritative SEEK to server.
   * The actual video seek executes when the server broadcasts the authoritative SEEK.
   */
  public requestSeek(targetPosition: number): void {
    this.notifyUserSeek(targetPosition);
    this.wsClient.sendSeek(targetPosition);
    this.publishStats();
  }

  private applyEffectivePlaybackRate(): void {
    if (!this.video) return;
    const effectiveRate = this.userPlaybackRate * this.driftCorrectionFactor;
    if (Math.abs(this.video.playbackRate - effectiveRate) > 0.001) {
      this.video.playbackRate = effectiveRate;
    }
  }

  /**
   * Notifies the synchronizer that a user-initiated seek has begun.
   * Immediately rebases local expected position and resets drift factor
   * so drift calculations do not operate against pre-seek position.
   */
  public notifyUserSeek(targetPosition: number): void {
    this.isUserSeeking = true;
    this.driftCorrectionFactor = 1.0;
    this.applyEffectivePlaybackRate();
    this.lastSeekTime = Date.now();

    if (this.currentRoomState) {
      this.currentRoomState = {
        ...this.currentRoomState,
        position: targetPosition,
        lastStateChangeServerTime: this.clockSync.getEstimatedServerTime(),
      };
    }
  }

  public updateRoomState(state: RoomState): void {
    this.currentRoomState = state;
    if (state.playbackRate !== undefined && state.playbackRate !== null) {
      this.userPlaybackRate = state.playbackRate;
    }
    this.driftCorrectionFactor = 1.0;
    this.applyEffectivePlaybackRate();
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
    const rate = this.currentRoomState.playbackRate ?? this.userPlaybackRate ?? 1.0;
    let pos = this.currentRoomState.position + elapsedSec * rate;

    const maxDuration =
      this.video && this.video.duration && isFinite(this.video.duration) && this.video.duration > 0
        ? this.video.duration
        : this.currentRoomState.video?.duration;

    if (maxDuration && pos > maxDuration) {
      pos = maxDuration;
    }
    return Math.max(0, pos);
  }

  /**
   * Performs an asynchronous programmatic seek without triggering echo loops.
   */
  private executeProgrammaticSeek(targetPosition: number, source: PlaybackChangeSource): void {
    if (!this.video) return;

    // If already very close to target, skip redundant seek to avoid decoder stutter
    if (Math.abs(this.video.currentTime - targetPosition) < 0.05) {
      this.driftCorrectionFactor = 1.0;
      this.applyEffectivePlaybackRate();
      this.lastSeekTime = Date.now();
      return;
    }

    this.programmaticSeekCount++;
    this.changeSource = source;
    this.driftCorrectionFactor = 1.0;
    this.applyEffectivePlaybackRate();
    this.lastSeekTime = Date.now();
    this.video.currentTime = targetPosition;
  }

  private executeProgrammaticPlay(): void {
    if (!this.video) return;
    this.programmaticPlayCount++;
    this.changeSource = PlaybackChangeSource.REMOTE;
    this.video.play().catch((err) => {
      this.programmaticPlayCount = Math.max(0, this.programmaticPlayCount - 1);
      console.warn('[Sync] Autoplay prevented, waiting for user gesture', err);
    });
  }

  private executeProgrammaticPause(): void {
    if (!this.video) return;
    this.programmaticPauseCount++;
    this.changeSource = PlaybackChangeSource.REMOTE;
    this.video.pause();
  }

  /**
   * Synchronize local HTML5 video element to authoritative state.
   */
  public synchronizeToState(state: RoomState, forceSeek: boolean = false): void {
    if (!this.video) return;

    this.currentRoomState = state;
    this.isUserSeeking = false;
    this.driftCorrectionFactor = 1.0;
    this.applyEffectivePlaybackRate();
    this.lastSeekTime = Date.now();

    if (state.playbackRate !== undefined && state.playbackRate !== null) {
      this.userPlaybackRate = state.playbackRate;
    }
    const targetPosition = this.calculateAuthoritativePosition();
    const drift = Math.abs(targetPosition - this.video.currentTime);

    // Only seek if drift is significant (> 1.5s) or explicitly forced with drift > 0.15s.
    // If the local player is already at the target, do NOT re-seek!
    const shouldSeek = forceSeek ? (drift > 0.15) : (drift > 1.5);

    if (shouldSeek) {
      this.executeProgrammaticSeek(targetPosition, PlaybackChangeSource.REMOTE);
    }

    if (state.isPlaying) {
      if (this.video.paused) {
        this.executeProgrammaticPlay();
      }
    } else {
      if (!this.video.paused) {
        this.executeProgrammaticPause();
      }
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
    if (!this.video || !this.currentRoomState) return;

    // Suppress drift correction while any seek is in progress
    if (this.isUserSeeking || this.programmaticSeekCount > 0) {
      return;
    }

    // Post-seek stabilization period: suppress drift adjustments for 1.2s after a seek
    // to allow media decoders to settle and playback to resume smoothly
    if (Date.now() - this.lastSeekTime < 1200) {
      if (this.driftCorrectionFactor !== 1.0) {
        this.driftCorrectionFactor = 1.0;
        this.applyEffectivePlaybackRate();
      }
      this.publishStats();
      return;
    }

    // Only apply drift correction when room is actively playing
    if (!this.currentRoomState.isPlaying) {
      if (this.driftCorrectionFactor !== 1.0) {
        this.driftCorrectionFactor = 1.0;
        this.applyEffectivePlaybackRate();
      }
      this.publishStats();
      return;
    }

    const targetPosition = this.calculateAuthoritativePosition();
    const localPosition = this.video.currentTime;
    const drift = targetPosition - localPosition; // Positive means local is behind, negative means ahead
    const absDrift = Math.abs(drift);

    // Band 1: Imperceptible drift (< 150ms) -> do nothing, restore normal playbackRate (factor = 1.0)
    if (absDrift < 0.15) {
      if (this.driftCorrectionFactor !== 1.0) {
        this.driftCorrectionFactor = 1.0;
        this.applyEffectivePlaybackRate();
      }
    }
    // Band 2: Minor drift (150ms - 1500ms) -> subtle micro-stepping to avoid audio/video stutter
    else if (absDrift <= 1.5) {
      if (drift > 0) {
        // Local is lagging -> speed up slightly (1.05x factor)
        this.driftCorrectionFactor = 1.05;
      } else {
        // Local is leading -> slow down slightly (0.95x factor)
        this.driftCorrectionFactor = 0.95;
      }
      this.applyEffectivePlaybackRate();
    }
    // Band 3: Major drift (> 1500ms) -> hard seek
    else {
      this.executeProgrammaticSeek(targetPosition, PlaybackChangeSource.SYNC);
    }

    this.publishStats();
  }

  private setupVideoListeners(): void {
    if (!this.video) return;

    // User initiated Play
    this.video.addEventListener('play', () => {
      if (this.programmaticPlayCount > 0) {
        this.programmaticPlayCount--;
        if (this.programmaticPlayCount === 0 && this.programmaticSeekCount === 0 && this.programmaticPauseCount === 0) {
          this.changeSource = PlaybackChangeSource.USER;
        }
      } else if (this.changeSource === PlaybackChangeSource.USER && this.video) {
        this.wsClient.sendPlay(this.video.currentTime);
      }
      this.publishStats();
    });

    // User initiated Pause
    this.video.addEventListener('pause', () => {
      if (this.programmaticPauseCount > 0) {
        this.programmaticPauseCount--;
        if (this.programmaticPlayCount === 0 && this.programmaticSeekCount === 0 && this.programmaticPauseCount === 0) {
          this.changeSource = PlaybackChangeSource.USER;
        }
      } else if (this.changeSource === PlaybackChangeSource.USER && this.video) {
        this.wsClient.sendPause(this.video.currentTime);
      }
      this.publishStats();
    });

    // Seeking handlers
    this.video.addEventListener('seeking', () => {
      if (this.programmaticSeekCount > 0) {
        // Programmatic seek in progress; do not mark as user seeking
      } else if (this.changeSource === PlaybackChangeSource.USER) {
        this.isUserSeeking = true;
      }
    });

    this.video.addEventListener('seeked', () => {
      this.lastSeekTime = Date.now();
      if (this.programmaticSeekCount > 0) {
        this.programmaticSeekCount--;
        if (this.programmaticSeekCount === 0) {
          this.changeSource = PlaybackChangeSource.USER;
        }
        // Programmatic seek completed: DO NOT send seek over websocket
      } else if (this.changeSource === PlaybackChangeSource.USER && this.video) {
        this.isUserSeeking = false;
        this.wsClient.sendSeek(this.video.currentTime);
      }
      this.publishStats();
    });

    // Local video metadata loaded
    this.video.addEventListener('loadedmetadata', () => {
      if (this.currentRoomState) {
        this.synchronizeToState(this.currentRoomState, true);
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
      if (this.currentRoomState?.isPlaying && this.video?.paused) {
        this.executeProgrammaticPlay();
      }
      this.publishStats();
    });

    this.video.addEventListener('loadeddata', () => {
      if (this.currentRoomState?.isPlaying && this.video?.paused) {
        this.executeProgrammaticPlay();
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
