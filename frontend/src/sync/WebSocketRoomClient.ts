import { InboundMessage, ControlMode } from '../types';

export type MessageHandler = (message: InboundMessage) => void;

export class WebSocketRoomClient {
  private ws: WebSocket | null = null;
  private roomId: string;
  private participantId: string;
  private displayName: string;
  private listeners: Map<string, Set<MessageHandler>> = new Map();
  private reconnectTimeout: number | null = null;
  private pingInterval: number | null = null;
  private reconnectAttempt: number = 0;
  private shouldReconnect: boolean = true;
  private isConnecting: boolean = false;

  constructor(roomId: string, participantId: string, displayName: string) {
    this.roomId = roomId;
    this.participantId = participantId;
    this.displayName = displayName;
  }

  public connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.isConnecting = true;
    this.shouldReconnect = true;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws/rooms/${this.roomId}?participant_id=${encodeURIComponent(
      this.participantId
    )}&display_name=${encodeURIComponent(this.displayName)}`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.isConnecting = false;
        this.reconnectAttempt = 0;
        this.emit('STATUS_CHANGE', { connected: true });
        this.startTimeSyncPing();
      };

      this.ws.onmessage = (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data) as InboundMessage;
          this.emit(data.type, data);
        } catch (err) {
          console.error('[WS] Failed to parse message', err);
        }
      };

      this.ws.onclose = (event) => {
        this.isConnecting = false;
        this.stopTimeSyncPing();
        this.emit('STATUS_CHANGE', { connected: false, code: event.code, reason: event.reason });
        if (this.shouldReconnect && event.code !== 4004 && event.code !== 4001) {
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = (err) => {
        console.warn('[WS] Socket error', err);
      };
    } catch (err) {
      this.isConnecting = false;
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempt), 8000);
    this.reconnectAttempt++;
    this.reconnectTimeout = window.setTimeout(() => {
      this.connect();
    }, delay);
  }

  private startTimeSyncPing(): void {
    this.stopTimeSyncPing();
    // Immediate initial sync
    this.send({ type: 'TIME_SYNC', t1: Date.now() });

    // Periodic sync every 10 seconds
    this.pingInterval = window.setInterval(() => {
      if (this.isConnected()) {
        this.send({ type: 'TIME_SYNC', t1: Date.now() });
      }
    }, 10000);
  }

  private stopTimeSyncPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  public isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  public send(data: any): void {
    if (this.isConnected()) {
      this.ws!.send(JSON.stringify(data));
    }
  }

  public sendPlay(position: number): void {
    this.send({ type: 'PLAY', position, clientTime: Date.now() });
  }

  public sendPause(position?: number): void {
    this.send({ type: 'PAUSE', position });
  }

  public sendSeek(position: number): void {
    this.send({ type: 'SEEK', position });
  }

  public sendBuffering(isBuffering: boolean, position?: number): void {
    this.send({ type: 'BUFFERING', isBuffering, position });
  }

  public sendSyncRequest(): void {
    this.send({ type: 'SYNC_REQUEST' });
  }

  public sendChangeSettings(controlMode?: ControlMode, pauseOnBuffer?: boolean): void {
    this.send({ type: 'CHANGE_SETTINGS', controlMode, pauseOnBuffer });
  }

  public on(type: string, handler: MessageHandler): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(handler);
    return () => this.off(type, handler);
  }

  public off(type: string, handler: MessageHandler): void {
    const handlers = this.listeners.get(type);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.listeners.delete(type);
      }
    }
  }

  private emit(type: string, data: any): void {
    const handlers = this.listeners.get(type);
    if (handlers) {
      handlers.forEach((fn) => {
        try {
          fn(data);
        } catch (e) {
          console.error(`[WS] Error in handler for ${type}`, e);
        }
      });
    }
  }

  public disconnect(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.stopTimeSyncPing();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.listeners.clear();
  }
}
