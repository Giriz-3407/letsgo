import React, { useState, useEffect, useMemo } from 'react';
import { RoomState, ControlMode, SyncStatus } from '../types';
import { ClockSynchronizer } from '../sync/ClockSynchronizer';
import { WebSocketRoomClient } from '../sync/WebSocketRoomClient';
import { PlaybackSynchronizer, SyncStats } from '../sync/PlaybackSynchronizer';
import { VideoPlayer } from '../components/VideoPlayer';
import { ParticipantList } from '../components/ParticipantList';
import { RoomControls } from '../components/RoomControls';
import { SyncStatusBadge } from '../components/SyncStatusBadge';
import { DebugPanel } from '../components/DebugPanel';
import { api } from '../api/client';
import {
  ArrowLeft,
  Copy,
  Check,
  Sliders,
  Terminal,
  X,
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
  const [activeDrawer, setActiveDrawer] = useState<'participants' | 'settings' | 'diagnostics' | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // Stored participant identity
  const currentUserId = useMemo(() => {
    const savedHost = localStorage.getItem(`wt_host_${roomId}`);
    if (savedHost) return savedHost;

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
        setRoomState((prev) => {
          // Reject stale state update if an in-flight newer seek or play occurred
          if (
            prev?.lastStateChangeServerTime &&
            state.lastStateChangeServerTime &&
            state.lastStateChangeServerTime < prev.lastStateChangeServerTime
          ) {
            return prev;
          }
          synchronizer.updateRoomState(state);
          return state;
        });
      })
    );

    unsubs.push(
      wsClient.on('PLAY', (msg) => {
        setRoomState((prev) => {
          if (!prev) return prev;
          if (
            prev.lastStateChangeServerTime &&
            msg.serverTime &&
            msg.serverTime < prev.lastStateChangeServerTime
          ) {
            return prev;
          }
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
          if (
            prev.lastStateChangeServerTime &&
            msg.serverTime &&
            msg.serverTime < prev.lastStateChangeServerTime
          ) {
            return prev;
          }
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
          if (
            prev.lastStateChangeServerTime &&
            msg.serverTime &&
            msg.serverTime < prev.lastStateChangeServerTime
          ) {
            return prev;
          }
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
      wsClient.on('PLAYBACK_RATE', (msg) => {
        setRoomState((prev) => {
          if (!prev) return prev;
          if (
            prev.lastStateChangeServerTime &&
            msg.serverTime &&
            msg.serverTime < prev.lastStateChangeServerTime
          ) {
            return prev;
          }
          const updated = {
            ...prev,
            playbackRate: msg.rate,
            position: msg.position !== undefined ? msg.position : prev.position,
            lastStateChangeServerTime: msg.serverTime !== undefined ? msg.serverTime : prev.lastStateChangeServerTime,
          };
          synchronizer.setUserPlaybackRate(msg.rate);
          synchronizer.synchronizeToState(updated);
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

    const unsubStats = synchronizer.onStats((stats) => {
      setSyncStats(stats);
      setSyncStatus(stats.syncStatus);
    });

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

  const handleLeave = () => {
    onNavigate('home');
  };

  if (!roomState && !error) {
    return (
      <div className="min-h-screen bg-[#09090b] text-neutral-100 flex flex-col items-center justify-center p-6 gap-3">
        <Loader2 className="w-6 h-6 text-neutral-400 animate-spin" />
        <span className="text-xs text-neutral-400 font-medium">Entering Room {roomId}...</span>
      </div>
    );
  }

  const participants = roomState?.participants || [];
  const connectedParticipants = participants.filter((p) => p.connected);

  return (
    <div className="min-h-screen bg-[#09090b] text-neutral-100 flex flex-col justify-between selection:bg-neutral-800 selection:text-neutral-100">
      {/* Minimal Top Header */}
      <header className="px-6 py-4 border-b border-white/[0.06] bg-[#09090b] sticky top-0 z-30">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={handleLeave}
              className="p-1 text-neutral-400 hover:text-white rounded transition-colors"
              title="Leave Room"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>

            <span
              onClick={() => onNavigate('home')}
              className="text-xs font-semibold tracking-tight text-neutral-300 hover:text-white cursor-pointer transition-colors"
            >
              WatchTogether
            </span>

            <span className="text-neutral-700">/</span>

            <button
              onClick={copyRoomLink}
              title="Copy room invite link"
              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-mono text-neutral-300 hover:text-white hover:bg-white/[0.04] transition-colors"
            >
              <span>Room {roomId}</span>
              {copiedLink ? (
                <Check className="w-3 h-3 text-neutral-200" />
              ) : (
                <Copy className="w-3 h-3 text-neutral-500" />
              )}
            </button>
          </div>

          <div className="flex items-center gap-3">
            <SyncStatusBadge status={syncStatus} driftMs={syncStats?.driftMs} />

            <button
              onClick={() => setActiveDrawer((prev) => (prev === 'settings' ? null : 'settings'))}
              className={`p-1.5 rounded-lg border text-xs transition-colors flex items-center gap-1.5 ${
                activeDrawer === 'settings'
                  ? 'bg-white text-black border-white'
                  : 'bg-white/[0.03] border-white/[0.08] text-neutral-400 hover:text-neutral-200'
              }`}
              title="Room Controls & Settings"
            >
              <Sliders className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Settings</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Cinema Viewport */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 w-full flex-1 flex flex-col items-center">
        {/* Dominant Movie Player */}
        <div className="w-full max-w-5xl">
          <VideoPlayer
            synchronizer={synchronizer}
            canControl={canControl}
            playbackRate={roomState?.playbackRate ?? 1.0}
            onPlaybackRateChange={(rate) => {
              synchronizer.requestPlaybackRate(rate);
            }}
            selectedFileName={selectedFile?.name}
            onFileSelect={(file) => setSelectedFile(file)}
          />
        </div>

        {/* Clean Room Information Row Directly Below Video */}
        <div className="w-full max-w-5xl mt-6 flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-white/[0.06]">
          {/* Left: Movie title & details */}
          <div className="space-y-1.5 min-w-0 pr-4">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-medium text-neutral-100 truncate">
                {selectedFile ? selectedFile.name : (roomState?.video ? roomState.video.name : 'No video selected')}
              </h2>
            </div>

            <div className="flex items-center gap-2 text-xs text-neutral-500">
              {selectedFile ? (
                <>
                  <span>{(selectedFile.size / (1024 * 1024)).toFixed(1)} MB</span>
                  <span>&bull;</span>
                  <span className="uppercase tracking-wider text-[10px] text-emerald-400 font-mono">
                    Local Playback
                  </span>
                </>
              ) : (
                <span className="text-[11px] text-neutral-500">
                  Select your local copy of the movie to begin watching in sync
                </span>
              )}
            </div>
          </div>

          {/* Right: Watching with avatars & secondary drawers */}
          <div className="flex items-center gap-3 flex-wrap">
            {/* Watching with Avatars */}
            <button
              onClick={() => setActiveDrawer('participants')}
              className="flex items-center gap-2 py-1 px-2.5 rounded-lg bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.08] transition-colors"
            >
              <div className="flex -space-x-1.5 overflow-hidden">
                {connectedParticipants.slice(0, 3).map((p) => (
                  <div
                    key={p.id}
                    title={p.displayName}
                    className="w-5 h-5 rounded-full bg-neutral-800 border border-[#09090b] flex items-center justify-center text-[9px] font-medium text-neutral-300"
                  >
                    {(p.displayName || 'V')[0].toUpperCase()}
                  </div>
                ))}
              </div>

              <span className="text-xs text-neutral-300 font-medium">
                {connectedParticipants.length} watching
              </span>
            </button>

            {/* Diagnostics Quick Toggle */}
            <button
              onClick={() => setActiveDrawer((prev) => (prev === 'diagnostics' ? null : 'diagnostics'))}
              className={`p-2 rounded-lg border transition-colors ${
                activeDrawer === 'diagnostics'
                  ? 'bg-white text-black border-white'
                  : 'bg-white/[0.03] border-white/[0.08] text-neutral-400 hover:text-neutral-200'
              }`}
              title="Diagnostics & Drift Console"
            >
              <Terminal className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Inline Diagnostics Collapsible (if active) */}
        {activeDrawer === 'diagnostics' && (
          <div className="w-full max-w-5xl mt-4 animate-in fade-in duration-150">
            <DebugPanel
              stats={syncStats}
              synchronizer={synchronizer}
              videoElement={document.querySelector('video')}
            />
          </div>
        )}
      </main>

      {/* Slide-over Drawer for Participants or Settings */}
      {(activeDrawer === 'participants' || activeDrawer === 'settings') && (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/60 backdrop-blur-xs select-none">
          {/* Backdrop Click */}
          <div className="flex-1" onClick={() => setActiveDrawer(null)} />

          {/* Drawer Content */}
          <div className="w-full max-w-sm bg-[#111114] border-l border-white/[0.08] h-full flex flex-col p-6 shadow-2xl animate-in slide-in-from-right duration-200">
            <div className="flex items-center justify-between pb-4 border-b border-white/[0.08] mb-6">
              <span className="text-sm font-semibold tracking-tight text-neutral-100">
                {activeDrawer === 'participants' ? 'Room Participants' : 'Room Settings'}
              </span>
              <button
                onClick={() => setActiveDrawer(null)}
                className="p-1 text-neutral-400 hover:text-white rounded transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {activeDrawer === 'participants' ? (
                <ParticipantList
                  participants={participants}
                  currentUserId={currentUserId}
                  roomId={roomId}
                />
              ) : (
                <RoomControls
                  isHost={isHost}
                  controlMode={roomState?.controlMode || 'HOST_ONLY'}
                  pauseOnBuffer={roomState?.pauseOnBuffer || false}
                  onUpdateSettings={handleUpdateSettings}
                  onOpenVideoPicker={() => {
                    // Trigger the file picker input in video player
                    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement | null;
                    fileInput?.click();
                    setActiveDrawer(null);
                  }}
                  onLeaveRoom={handleLeave}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="py-4 text-center text-[11px] text-neutral-600 border-t border-white/[0.04]">
        WatchTogether
      </footer>
    </div>
  );
};
