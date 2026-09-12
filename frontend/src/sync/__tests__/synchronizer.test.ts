import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Polyfill window for Node environment
if (typeof window === 'undefined') {
  (globalThis as any).window = globalThis;
}

import { ClockSynchronizer } from '../ClockSynchronizer.ts';
import { PlaybackSynchronizer } from '../PlaybackSynchronizer.ts';
import { WebSocketRoomClient } from '../WebSocketRoomClient.ts';
import { RoomState, PlaybackChangeSource } from '../../types/index.ts';

// Mock MockHTMLVideoElement implementing needed HTMLVideoElement properties
class MockVideoElement {
  private _currentTime: number = 0;
  public duration: number = 7200; // 2 hours
  public paused: boolean = true;
  public playbackRate: number = 1.0;
  public readyState: number = 4; // HAVE_ENOUGH_DATA
  public buffered = {
    length: 1,
    start: (_i: number) => 0,
    end: (_i: number) => 100,
  };
  public src: string = '';

  public get currentTime(): number {
    return this._currentTime;
  }

  public set currentTime(val: number) {
    this._currentTime = val;
    this.dispatchEvent('seeking');
    this.dispatchEvent('seeked');
  }

  private listeners: Map<string, Set<() => void>> = new Map();

  public addEventListener(event: string, cb: () => void): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(cb);
  }

  public removeEventListener(event: string, cb: () => void): void {
    this.listeners.get(event)?.delete(cb);
  }

  public dispatchEvent(event: string): void {
    const cbs = this.listeners.get(event);
    if (cbs) {
      cbs.forEach((cb) => cb());
    }
  }

  public play(): Promise<void> {
    this.paused = false;
    this.dispatchEvent('play');
    this.dispatchEvent('playing');
    return Promise.resolve();
  }

  public pause(): void {
    this.paused = true;
    this.dispatchEvent('pause');
  }

  public seek(target: number): void {
    this.currentTime = target;
  }

  public load(): void {
    this.dispatchEvent('load');
  }

  public removeAttribute(attr: string): void {
    if (attr === 'src') {
      this.src = '';
    }
  }
}

// Mock WebSocketRoomClient
class MockWebSocketRoomClient {
  public sentMessages: any[] = [];
  private listeners: Map<string, Set<(msg: any) => void>> = new Map();

  public isConnected(): boolean {
    return true;
  }

  public send(data: any): void {
    this.sentMessages.push(data);
  }

  public sendPlay(position: number): void {
    this.send({ type: 'PLAY', position });
  }

  public sendPause(position?: number): void {
    this.send({ type: 'PAUSE', position });
  }

  public sendSeek(position: number): void {
    this.send({ type: 'SEEK', position });
  }

  public sendPlaybackRate(rate: number): void {
    this.send({ type: 'PLAYBACK_RATE', rate });
  }

  public sendBuffering(isBuffering: boolean, position?: number): void {
    this.send({ type: 'BUFFERING', isBuffering, position });
  }

  public on(type: string, handler: (msg: any) => void): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(handler);
    return () => this.listeners.get(type)?.delete(handler);
  }

  public trigger(type: string, msg: any): void {
    this.listeners.get(type)?.forEach((fn) => fn(msg));
  }
}

describe('WatchTogether Local-File Playback & Synchronization Test Suite', () => {
  let wsClient: MockWebSocketRoomClient;
  let clockSync: ClockSynchronizer;
  let synchronizer: PlaybackSynchronizer;
  let mockVideo: MockVideoElement;

  beforeEach(() => {
    wsClient = new MockWebSocketRoomClient();
    clockSync = new ClockSynchronizer();
    synchronizer = new PlaybackSynchronizer(wsClient as any, clockSync);
    mockVideo = new MockVideoElement();
  });

  test('A: One user selects a local MP4 and plays it', async () => {
    // User selects file -> object URL attached -> video attached to synchronizer
    mockVideo.src = 'blob:http://localhost:5173/local-sample-uuid';
    synchronizer.attachVideo(mockVideo as any);

    assert.equal(mockVideo.paused, true);
    assert.equal(mockVideo.currentTime, 0);

    // User plays video locally
    synchronizer.setChangeSource(PlaybackChangeSource.USER);
    await mockVideo.play();

    // Verify PLAY message was sent to WebSocket authoritative room server
    const playMsg = wsClient.sentMessages.find((m) => m.type === 'PLAY');
    assert.ok(playMsg, 'PLAY message should have been sent to WS');
    assert.equal(playMsg.position, 0);
  });

  test('B: Two users join the same room and each selects their own copy of the same movie', () => {
    const wsClient2 = new MockWebSocketRoomClient();
    const clockSync2 = new ClockSynchronizer();
    const synchronizer2 = new PlaybackSynchronizer(wsClient2 as any, clockSync2);
    const mockVideo2 = new MockVideoElement();

    // Host selects local file
    mockVideo.src = 'blob:http://localhost:5173/alice-movie';
    synchronizer.attachVideo(mockVideo as any);

    // Participant selects local file
    mockVideo2.src = 'blob:http://localhost:5173/bob-movie';
    synchronizer2.attachVideo(mockVideo2 as any);

    assert.equal(mockVideo.src, 'blob:http://localhost:5173/alice-movie');
    assert.equal(mockVideo2.src, 'blob:http://localhost:5173/bob-movie');
    assert.equal(mockVideo.currentTime, 0);
    assert.equal(mockVideo2.currentTime, 0);
  });

  test('C: Host PLAY starts both clients', async () => {
    const wsClientBob = new MockWebSocketRoomClient();
    const clockSyncBob = new ClockSynchronizer();
    const syncBob = new PlaybackSynchronizer(wsClientBob as any, clockSyncBob);
    const videoBob = new MockVideoElement();

    synchronizer.attachVideo(mockVideo as any);
    syncBob.attachVideo(videoBob as any);

    // Initial paused state
    const initialState: RoomState = {
      roomId: 'ROOM1',
      hostId: 'alice',
      isPlaying: false,
      position: 0,
      lastStateChangeServerTime: Date.now(),
      controlMode: 'HOST_ONLY',
      pauseOnBuffer: false,
      participants: [],
      serverTime: Date.now(),
      video: null,
    };
    synchronizer.updateRoomState(initialState);
    syncBob.updateRoomState(initialState);

    // Alice clicks play
    synchronizer.setChangeSource(PlaybackChangeSource.USER);
    await mockVideo.play();
    assert.equal(mockVideo.paused, false);

    // Server broadcasts authoritative PLAY
    const playState: RoomState = {
      ...initialState,
      isPlaying: true,
      position: 0,
      lastStateChangeServerTime: Date.now(),
    };
    synchronizer.synchronizeToState(playState);
    syncBob.synchronizeToState(playState);

    assert.equal(mockVideo.paused, false, 'Host video should be playing');
    assert.equal(videoBob.paused, false, 'Participant video should be playing');
  });

  test('D: Host PAUSE pauses both clients', () => {
    const wsClientBob = new MockWebSocketRoomClient();
    const clockSyncBob = new ClockSynchronizer();
    const syncBob = new PlaybackSynchronizer(wsClientBob as any, clockSyncBob);
    const videoBob = new MockVideoElement();

    synchronizer.attachVideo(mockVideo as any);
    syncBob.attachVideo(videoBob as any);

    // Both currently playing
    mockVideo.paused = false;
    videoBob.paused = false;

    // Alice pauses
    synchronizer.setChangeSource(PlaybackChangeSource.USER);
    mockVideo.pause();

    const pauseMsg = wsClient.sentMessages.find((m) => m.type === 'PAUSE');
    assert.ok(pauseMsg, 'Host pause sends PAUSE to server');

    // Server broadcasts authoritative PAUSE
    const pausedState: RoomState = {
      roomId: 'ROOM1',
      hostId: 'alice',
      isPlaying: false,
      position: 25.5,
      lastStateChangeServerTime: Date.now(),
      controlMode: 'HOST_ONLY',
      pauseOnBuffer: false,
      participants: [],
      serverTime: Date.now(),
      video: null,
    };

    synchronizer.synchronizeToState(pausedState);
    syncBob.synchronizeToState(pausedState);

    assert.equal(mockVideo.paused, true);
    assert.equal(videoBob.paused, true);
    assert.equal(mockVideo.currentTime, 25.5);
    assert.equal(videoBob.currentTime, 25.5);
  });

  test('E: Host manually seeks far forward - both clients seek to the same position without echo loop', () => {
    const wsClientBob = new MockWebSocketRoomClient();
    const clockSyncBob = new ClockSynchronizer();
    const syncBob = new PlaybackSynchronizer(wsClientBob as any, clockSyncBob);
    const videoBob = new MockVideoElement();

    synchronizer.attachVideo(mockVideo as any);
    syncBob.attachVideo(videoBob as any);

    const initialState: RoomState = {
      roomId: 'ROOM1',
      hostId: 'alice',
      isPlaying: false,
      position: 10.0,
      lastStateChangeServerTime: Date.now(),
      controlMode: 'HOST_ONLY',
      pauseOnBuffer: false,
      participants: [],
      serverTime: Date.now(),
      video: null,
    };
    synchronizer.updateRoomState(initialState);
    syncBob.updateRoomState(initialState);

    // Host seeks far forward to 500s via requestSeek
    synchronizer.requestSeek(500.0);

    const seekMsg = wsClient.sentMessages.find((m) => m.type === 'SEEK');
    assert.ok(seekMsg, 'SEEK sent to server');
    assert.equal(seekMsg.position, 500.0);

    // Server broadcasts authoritative SEEK to all clients
    const soughtState: RoomState = {
      ...initialState,
      position: 500.0,
      lastStateChangeServerTime: Date.now(),
    };

    synchronizer.synchronizeToState(soughtState, true);
    syncBob.synchronizeToState(soughtState, true);

    assert.equal(mockVideo.currentTime, 500.0);
    assert.equal(videoBob.currentTime, 500.0);

    // Verify NO echo SEEK was sent by Bob or Alice after programmatic seek completed
    const bobSeekMessages = wsClientBob.sentMessages.filter((m) => m.type === 'SEEK');
    assert.equal(bobSeekMessages.length, 0, 'Bob should NOT send echo SEEK message');
  });

  test('F: Host manually seeks far backward - both clients seek correctly', () => {
    const wsClientBob = new MockWebSocketRoomClient();
    const clockSyncBob = new ClockSynchronizer();
    const syncBob = new PlaybackSynchronizer(wsClientBob as any, clockSyncBob);
    const videoBob = new MockVideoElement();

    mockVideo.currentTime = 500.0;
    videoBob.currentTime = 500.0;

    synchronizer.attachVideo(mockVideo as any);
    syncBob.attachVideo(videoBob as any);

    const initialState: RoomState = {
      roomId: 'ROOM1',
      hostId: 'alice',
      isPlaying: false,
      position: 500.0,
      lastStateChangeServerTime: Date.now(),
      controlMode: 'HOST_ONLY',
      pauseOnBuffer: false,
      participants: [],
      serverTime: Date.now(),
      video: null,
    };
    synchronizer.updateRoomState(initialState);
    syncBob.updateRoomState(initialState);

    // Host seeks far backward to 30s
    synchronizer.requestSeek(30.0);

    const seekMsg = wsClient.sentMessages.find((m) => m.type === 'SEEK' && m.position === 30.0);
    assert.ok(seekMsg, 'Backward SEEK sent');

    const soughtState: RoomState = {
      ...initialState,
      position: 30.0,
      lastStateChangeServerTime: Date.now(),
    };
    synchronizer.synchronizeToState(soughtState, true);
    syncBob.synchronizeToState(soughtState, true);

    assert.equal(mockVideo.currentTime, 30.0);
    assert.equal(videoBob.currentTime, 30.0);
  });

  test('G: Host presses +10 - all clients advance 10 seconds via synchronized SEEK', () => {
    const wsClientBob = new MockWebSocketRoomClient();
    const clockSyncBob = new ClockSynchronizer();
    const syncBob = new PlaybackSynchronizer(wsClientBob as any, clockSyncBob);
    const videoBob = new MockVideoElement();

    mockVideo.currentTime = 40.0;
    videoBob.currentTime = 40.0;

    synchronizer.attachVideo(mockVideo as any);
    syncBob.attachVideo(videoBob as any);

    // Host presses +10: currentTime (40) + 10 = 50
    const target = mockVideo.currentTime + 10;
    synchronizer.requestSeek(target);

    const seekMsg = wsClient.sentMessages.find((m) => m.type === 'SEEK' && m.position === 50.0);
    assert.ok(seekMsg, 'Synchronized SEEK for +10 sent');

    const updatedState: RoomState = {
      roomId: 'ROOM1',
      hostId: 'alice',
      isPlaying: false,
      position: 50.0,
      lastStateChangeServerTime: Date.now(),
      controlMode: 'HOST_ONLY',
      pauseOnBuffer: false,
      participants: [],
      serverTime: Date.now(),
      video: null,
    };
    synchronizer.synchronizeToState(updatedState, true);
    syncBob.synchronizeToState(updatedState, true);

    assert.equal(mockVideo.currentTime, 50.0);
    assert.equal(videoBob.currentTime, 50.0);
  });

  test('H: Host presses -10 - all clients rewind 10 seconds via synchronized SEEK', () => {
    const wsClientBob = new MockWebSocketRoomClient();
    const clockSyncBob = new ClockSynchronizer();
    const syncBob = new PlaybackSynchronizer(wsClientBob as any, clockSyncBob);
    const videoBob = new MockVideoElement();

    mockVideo.currentTime = 50.0;
    videoBob.currentTime = 50.0;

    synchronizer.attachVideo(mockVideo as any);
    syncBob.attachVideo(videoBob as any);

    // Host presses -10: currentTime (50) - 10 = 40
    const target = Math.max(0, mockVideo.currentTime - 10);
    synchronizer.requestSeek(target);

    const seekMsg = wsClient.sentMessages.find((m) => m.type === 'SEEK' && m.position === 40.0);
    assert.ok(seekMsg, 'Synchronized SEEK for -10 sent');

    const updatedState: RoomState = {
      roomId: 'ROOM1',
      hostId: 'alice',
      isPlaying: false,
      position: 40.0,
      lastStateChangeServerTime: Date.now(),
      controlMode: 'HOST_ONLY',
      pauseOnBuffer: false,
      participants: [],
      serverTime: Date.now(),
      video: null,
    };
    synchronizer.synchronizeToState(updatedState, true);
    syncBob.synchronizeToState(updatedState, true);

    assert.equal(mockVideo.currentTime, 40.0);
    assert.equal(videoBob.currentTime, 40.0);
  });

  test('I: Host changes playback speed - user speed preserved separately from drift correction', () => {
    synchronizer.attachVideo(mockVideo as any);

    // Set user playback speed to 1.5x
    synchronizer.requestPlaybackRate(1.5);
    assert.equal(synchronizer.getUserPlaybackRate(), 1.5);
    assert.equal(mockVideo.playbackRate, 1.5);

    // Verify PLAYBACK_RATE was sent to WebSocket
    const rateMsg = wsClient.sentMessages.find((m) => m.type === 'PLAYBACK_RATE');
    assert.ok(rateMsg);
    assert.equal(rateMsg.rate, 1.5);

    // Simulate minor lagging drift -> drift factor becomes 1.05
    // Effective rate should be 1.5 * 1.05 = 1.575
    const now = Date.now();
    const roomState: RoomState = {
      roomId: 'ROOM1',
      hostId: 'alice',
      isPlaying: true,
      position: 100.0,
      playbackRate: 1.5,
      lastStateChangeServerTime: now - 10000, // 10s elapsed
      controlMode: 'HOST_ONLY',
      pauseOnBuffer: false,
      participants: [],
      serverTime: now,
      video: null,
    };
    synchronizer.updateRoomState(roomState);

    // Simulate local video lagging by 0.5s (Band 2: 150ms - 1500ms)
    const authoritativePos = synchronizer.calculateAuthoritativePosition();
    mockVideo.currentTime = authoritativePos - 0.5;

    // Simulate post-seek stabilization past (advance lastSeekTime)
    (synchronizer as any).lastSeekTime = now - 2000;
    synchronizer.checkAndCorrectDrift();

    // Effective playback rate should have micro-stepped up without overwriting user rate
    assert.equal(synchronizer.getUserPlaybackRate(), 1.5, 'User playback rate must remain 1.5');
    assert.ok(
      Math.abs(mockVideo.playbackRate - 1.5 * 1.05) < 0.001,
      'Effective rate should be 1.5 * 1.05'
    );

    // When drift returns to imperceptible (<150ms), effective rate returns to 1.5
    mockVideo.currentTime = authoritativePos;
    synchronizer.checkAndCorrectDrift();
    assert.equal(synchronizer.getUserPlaybackRate(), 1.5);
    assert.equal(mockVideo.playbackRate, 1.5);
  });

  test('J: Join an already-playing room - client applies authoritative position upon local video load', () => {
    const now = Date.now();
    // Room has been playing for 60s at 1.0x starting from position 20s -> authoritative position = 80s
    const activeRoomState: RoomState = {
      roomId: 'ACTIVE_ROOM',
      hostId: 'alice',
      isPlaying: true,
      position: 20.0,
      playbackRate: 1.0,
      lastStateChangeServerTime: now - 60000,
      controlMode: 'HOST_ONLY',
      pauseOnBuffer: false,
      participants: [],
      serverTime: now,
      video: null,
    };

    // Client receives ROOM_STATE before attaching/loading local video file
    synchronizer.updateRoomState(activeRoomState);

    // New participant now selects local file and attaches video
    mockVideo.readyState = 0; // Not loaded yet
    mockVideo.currentTime = 0;
    mockVideo.paused = true;
    synchronizer.attachVideo(mockVideo as any);

    // Video metadata loads
    mockVideo.readyState = 4;
    mockVideo.dispatchEvent('loadedmetadata');
    mockVideo.dispatchEvent('canplay');

    // Authoritative position at current time should be >= 80s
    assert.ok(mockVideo.currentTime >= 80.0, `Current time should be >= 80, got ${mockVideo.currentTime}`);
    assert.equal(mockVideo.paused, false, 'Video should start playing synchronously');
  });

  test('K: Deliberately create playback drift - hard seek when drift > 1.5s', () => {
    const now = Date.now();
    const playingState: RoomState = {
      roomId: 'ROOM1',
      hostId: 'alice',
      isPlaying: true,
      position: 100.0,
      playbackRate: 1.0,
      lastStateChangeServerTime: now,
      controlMode: 'HOST_ONLY',
      pauseOnBuffer: false,
      participants: [],
      serverTime: now,
      video: null,
    };

    synchronizer.attachVideo(mockVideo as any);
    synchronizer.updateRoomState(playingState);

    // Inject huge drift: video is at 10.0s while authoritative is at 100.0s
    mockVideo.currentTime = 10.0;
    // Set lastSeekTime after setting currentTime so stabilization window does not block drift check
    (synchronizer as any).lastSeekTime = now - 2000;
    synchronizer.checkAndCorrectDrift();

    // Major drift (>1.5s) must trigger programmatic hard seek to authoritative position
    assert.ok(
      Math.abs(mockVideo.currentTime - 100.0) < 0.1,
      `Hard seek should jump to 100.0s, was ${mockVideo.currentTime}`
    );
  });

  test('L & M: Verify no video bytes sent to FastAPI and no SEEK -> SEEK echo feedback loops', () => {
    synchronizer.attachVideo(mockVideo as any);

    const roomState: RoomState = {
      roomId: 'ROOM1',
      hostId: 'alice',
      isPlaying: false,
      position: 0,
      lastStateChangeServerTime: Date.now(),
      controlMode: 'HOST_ONLY',
      pauseOnBuffer: false,
      participants: [],
      serverTime: Date.now(),
      video: null,
    };
    synchronizer.updateRoomState(roomState);

    // Clear sent messages
    wsClient.sentMessages = [];

    // Receive remote SEEK command
    const remoteSeekState: RoomState = {
      ...roomState,
      position: 120.0,
      lastStateChangeServerTime: Date.now(),
    };
    synchronizer.synchronizeToState(remoteSeekState, true);

    // M: Ensure NO echo SEEK message was sent
    const echoSeeks = wsClient.sentMessages.filter((m) => m.type === 'SEEK');
    assert.equal(echoSeeks.length, 0, 'Programmatic seek MUST NOT trigger echo SEEK');

    // L: Ensure no video bytes, files, or buffers in any WebSocket messages
    wsClient.sentMessages.forEach((msg) => {
      assert.ok(!msg.file, 'No File object should be in messages');
      assert.ok(!msg.data, 'No video bytes should be in messages');
      assert.ok(!msg.buffer, 'No buffer should be in messages');
    });
  });

  test('ClockSynchronizer: Discard out-of-order and stale TIME_SYNC_REPLY', () => {
    const clock = new ClockSynchronizer();

    // Ping 1 sent at t1 = 1000
    clock.handleSyncReply(1000, 5000, 1020);
    const offsetAfterPing1 = clock.getOffset();

    // Ping 2 sent at t1 = 2000
    clock.handleSyncReply(2000, 6000, 2020);
    const offsetAfterPing2 = clock.getOffset();

    // Ping 0 (stale / out-of-order ping from t1 = 500 arrives late)
    clock.handleSyncReply(500, 999999, 2100);
    // Offset must NOT change because t1 < lastHandledT1
    assert.equal(clock.getOffset(), offsetAfterPing2, 'Stale ping must be discarded');
  });
});
