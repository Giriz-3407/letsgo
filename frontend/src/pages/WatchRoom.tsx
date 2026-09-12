import React, { useState, useEffect, useMemo, useRef } from 'react';
import { RoomState, VideoMetadata, ControlMode, SyncStatus } from '../types';
import { ClockSynchronizer } from '../sync/ClockSynchronizer';
import { WebSocketRoomClient } from '../sync/WebSocketRoomClient';
import { PlaybackSynchronizer, SyncStats } from '../sync/PlaybackSynchronizer';
import { VideoPlayer } from '../components/VideoPlayer';
import { ParticipantList } from '../components/ParticipantList';
import { RoomControls } from '../components/RoomControls';
import { SyncStatusBadge } from '../components/SyncStatusBadge';
import { DebugPanel } from '../components/DebugPanel';
import { DriveFilePickerModal } from '../components/DriveFilePickerModal';
import { api } from '../api/client';
import {
  Play,
  ArrowLeft,
  Share2,
  Copy,
  Check,
  Activity,
  Film,
  Crown,
  Info,
  Loader2,
} from 'lucide-react';

interface Props {
  roomId: string;
  onNavigate: (page: string, params?: Record<string, string>) => void;
}

export const WatchRoom: React.FC<Props> = ({ roomId, onNavigate }) => {
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [syncStats, setSyncStats] = useState<SyncStats | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('SYNCHRONIZING');
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Stored participant identity
  const currentUserId = useMemo(() => {
    // Check if host ID was saved on room creation
    const savedHost = localStorage.getItem(`wt_host_${roomId}`);
    if (savedHost) return savedHost;

    // Otherwise retrieve or generate persistent participant ID
    let pid = localStorage.getItem('wt_participant_id');
    if (!pid) {
      pid = `viewer_${Math.random().toString(36).substring(2, 9)}`;
      localStorage.setItem('wt_participant_id', pid);
    }
    return pid;
  }, [roomId]);

  const displayName = useMemo(() => {
    return localStorage.getItem('wt_display_name') || 'Viewer';
  }, []);

  // Instantiate synchronizers
  const clockSync = useMemo(() => new ClockSynchronizer(), []);
  const wsClient = useMemo(
    () => new WebSocketRoomClient(roomId, currentUserId, displayName),
    [roomId, currentUserId, displayName]
  );
  const synchronizer = useMemo(
    () => new PlaybackSynchronizer(wsClient, clockSync),
    [wsClient, clockSync]
  );

  const isHost = roomState?.hostId === currentUserId;
  const canControl = isHost || roomState?.controlMode === 'EVERYONE';

  useEffect(() => {
    // Setup WebSocket event listeners
    const unsubs: (() => void)[] = [];

    unsubs.push(
      wsClient.on('STATUS_CHANGE', ({ connected }) => {
        setSyncStatus(connected ? 'SYNCED' : 'DISCONNECTED');
      })
    );

    unsubs.push(
      wsClient.on('TIME_SYNC_REPLY', (msg) => {
        clockSync.handleSyncReply(msg.t1, msg.serverTime);
      })
    );

    unsubs.push(
      wsClient.on('ROOM_STATE', (state: any) => {
        setRoomState(state);
        synchronizer.updateRoomState(state);
      })
    );

    unsubs.push(
      wsClient.on('PLAY', (msg) => {
        setRoomState((prev) => {
          if (!prev) return prev;
          const updated = {
            ...prev,
            isPlaying: true,
            position: msg.position,
            lastStateChangeServerTime: msg.serverTime,
          };
          synchronizer.synchronizeToState(updated);
          return updated;
        });
      })
    );

    unsubs.push(
      wsClient.on('PAUSE', (msg) => {
        setRoomState((prev) => {
          if (!prev) return prev;
          const updated = {
            ...prev,
            isPlaying: false,
            position: msg.position,
            lastStateChangeServerTime: msg.serverTime,
          };
          synchronizer.synchronizeToState(updated);
          return updated;
        });
      })
    );

    unsubs.push(
      wsClient.on('SEEK', (msg) => {
        setRoomState((prev) => {
          if (!prev) return prev;
          const updated = {
            ...prev,
            isPlaying: msg.isPlaying !== undefined ? msg.isPlaying : prev.isPlaying,
            position: msg.position,
            lastStateChangeServerTime: msg.serverTime,
          };
          synchronizer.synchronizeToState(updated, true);
          return updated;
        });
      })
    );

    unsubs.push(
      wsClient.on('PARTICIPANT_JOINED', (msg) => {
        setRoomState((prev) => {
          if (!prev) return prev;
          const existingIdx = prev.participants.findIndex((p) => p.id === msg.participant.id);
          let newParticipants = [...prev.participants];
          if (existingIdx >= 0) {
            newParticipants[existingIdx] = msg.participant;
          } else {
            newParticipants.push(msg.participant);
          }
          return { ...prev, participants: newParticipants };
        });
      })
    );

    unsubs.push(
      wsClient.on('PARTICIPANT_LEFT', (msg) => {
        setRoomState((prev) => {
          if (!prev) return prev;
          const newParticipants = prev.participants.map((p) =>
            p.id === msg.participantId ? { ...p, connected: false } : p
          );
          return { ...prev, participants: newParticipants };
        });
      })
    );

    unsubs.push(
      wsClient.on('HOST_CHANGED', (msg) => {
        setRoomState((prev) => {
          if (!prev) return prev;
          const newParticipants = prev.participants.map((p) => ({
            ...p,
            isHost: p.id === msg.hostId,
          }));
          return { ...prev, hostId: msg.hostId, participants: newParticipants };
        });
      })
    );

    unsubs.push(
      wsClient.on('VIDEO_CHANGED', (msg) => {
        setRoomState((prev) => {
          if (!prev) return prev;
          const updated = {
            ...prev,
            video: msg.video,
            position: 0,
            isPlaying: false,
          };
          synchronizer.updateRoomState(updated);
          return updated;
        });
      })
    );

    unsubs.push(
      wsClient.on('SETTINGS_CHANGED', (msg) => {
        setRoomState((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            controlMode: msg.controlMode,
            pauseOnBuffer: msg.pauseOnBuffer,
          };
        });
      })
    );

    unsubs.push(
      wsClient.on('ERROR', (msg) => {
        console.warn('[Room Error]', msg.message);
      })
    );

    // Subscribe to real-time stats
    const unsubStats = synchronizer.onStats((stats) => {
      setSyncStats(stats);
      setSyncStatus(stats.syncStatus);
    });

    // Connect to WebSocket
    wsClient.connect();

    return () => {
      unsubs.forEach((fn) => fn());
      unsubStats();
      wsClient.disconnect();
      synchronizer.detachVideo();
    };
  }, [wsClient, clockSync, synchronizer]);

  const copyRoomLink = () => {
    navigator.clipboard.writeText(window.location.href).then(() => {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    });
  };

  const handleUpdateSettings = async (mode: ControlMode, pauseOnBuf: boolean) => {
    if (!isHost) return;
    try {
      await api.setRoomSettings(roomId, currentUserId, mode, pauseOnBuf);
    } catch (err: any) {
      setError(err.message || 'Failed to update settings');
    }
  };

  const handleSelectVideo = async (video: VideoMetadata) => {
    if (!isHost) return;
    try {
      await api.setRoomVideo(roomId, video.id, currentUserId);
    } catch (err: any) {
      setError(err.message || 'Failed to change video');
    }
  };

  const handleLeave = () => {
    onNavigate('home');
  };

  if (!roomState && !error) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-4 gap-3">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
        <span className="text-sm text-slate-400">Entering Watch Room {roomId}...</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Top Navbar */}
      <header className="border-b border-slate-800/80 bg-slate-950/80 backdrop-blur px-6 py-3.5 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={handleLeave}
              className="p-1.5 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded-lg transition"
              title="Leave Room"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-2">
              <span className="font-bold text-sm tracking-tight text-slate-100">WatchTogether</span>
              <span className="text-slate-600">/</span>
              <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg bg-slate-900 border border-slate-800 font-mono text-xs font-semibold text-blue-400">
                <span>Room: {roomId}</span>
                <button
                  onClick={copyRoomLink}
                  title="Copy room link"
                  className="hover:text-blue-300 ml-1"
                >
                  {copiedLink ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                </button>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Real-time Sync Status Pill */}
            <SyncStatusBadge status={syncStatus} driftMs={syncStats?.driftMs} />

            {/* Diagnostics Toggle */}
            <button
              onClick={() => setShowDiagnostics((prev) => !prev)}
              className={`p-1.5 rounded-lg border text-xs flex items-center gap-1.5 transition ${
                showDiagnostics
                  ? 'bg-blue-950 border-blue-700 text-blue-300'
                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
              title="Toggle Dev Diagnostics"
            >
              <Activity className="w-4 h-4" />
              <span className="hidden sm:inline">Diagnostics</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Layout */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 flex-1 w-full grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Video Player & Debug Info */}
        <div className="lg:col-span-2 space-y-4">
          <VideoPlayer
            video={roomState?.video || null}
            synchronizer={synchronizer}
            canControl={canControl}
            onOpenPicker={() => setIsPickerOpen(true)}
          />

          {/* Video Title & Meta Bar */}
          {roomState?.video && (
            <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-3.5 flex items-center justify-between text-xs">
              <div className="flex items-center gap-2.5">
                <Film className="w-4 h-4 text-blue-400" />
                <span className="font-semibold text-slate-200">{roomState.video.name}</span>
                <span className="text-slate-500">&bull;</span>
                <span className="text-slate-400 uppercase text-[10px] tracking-wider px-1.5 py-0.5 bg-slate-800 rounded">
                  {roomState.video.provider}
                </span>
              </div>

              {roomState.video.size && (
                <span className="text-slate-400 text-[11px]">
                  {(roomState.video.size / (1024 * 1024)).toFixed(1)} MB
                </span>
              )}
            </div>
          )}

          {/* Diagnostics Panel */}
          {showDiagnostics && (
            <DebugPanel
              stats={syncStats}
              synchronizer={synchronizer}
              videoElement={document.querySelector('video')}
            />
          )}
        </div>

        {/* Right 1 Col: Controls & Participant List */}
        <div className="space-y-4 flex flex-col">
          <RoomControls
            isHost={isHost}
            controlMode={roomState?.controlMode || 'HOST_ONLY'}
            pauseOnBuffer={roomState?.pauseOnBuffer || false}
            onUpdateSettings={handleUpdateSettings}
            onOpenVideoPicker={() => setIsPickerOpen(true)}
            onLeaveRoom={handleLeave}
          />

          <div className="flex-1 min-h-[250px]">
            <ParticipantList
              participants={roomState?.participants || []}
              currentUserId={currentUserId}
              roomId={roomId}
            />
          </div>
        </div>
      </main>

      {/* Video Picker Modal */}
      <DriveFilePickerModal
        isOpen={isPickerOpen}
        onClose={() => setIsPickerOpen(false)}
        currentVideoId={roomState?.video?.id}
        onSelectVideo={handleSelectVideo}
      />
    </div>
  );
};
