import React from 'react';
import { SyncStats, PlaybackSynchronizer } from '../sync/PlaybackSynchronizer';
import { PlaybackChangeSource } from '../types';
import { Activity, Gauge, Wifi, Zap } from 'lucide-react';

interface Props {
  stats: SyncStats | null;
  synchronizer: PlaybackSynchronizer | null;
  videoElement: HTMLVideoElement | null;
}

export const DebugPanel: React.FC<Props> = ({ stats, synchronizer, videoElement }) => {
  if (!stats) return null;

  const injectDrift = (seconds: number) => {
    if (!videoElement || !synchronizer) return;
    // Inject artificial drift without notifying server to test auto-correction
    synchronizer.setChangeSource(PlaybackChangeSource.SYNC);
    videoElement.currentTime = Math.max(0, videoElement.currentTime + seconds);
    setTimeout(() => {
      synchronizer.setChangeSource(PlaybackChangeSource.USER);
    }, 60);
  };

  const forceSync = () => {
    if (synchronizer && stats) {
      const authPos = synchronizer.calculateAuthoritativePosition();
      if (videoElement) {
        synchronizer.setChangeSource(PlaybackChangeSource.SYNC);
        videoElement.currentTime = authPos;
        setTimeout(() => {
          synchronizer.setChangeSource(PlaybackChangeSource.USER);
        }, 60);
      }
    }
  };

  return (
    <div className="bg-slate-900/95 backdrop-blur border border-slate-800 rounded-xl p-4 shadow-xl text-xs space-y-3 font-mono">
      <div className="flex items-center justify-between pb-2 border-b border-slate-800">
        <div className="flex items-center gap-2 text-slate-200 font-semibold font-sans">
          <Activity className="w-4 h-4 text-blue-400" />
          <span>Sync & Latency Diagnostics</span>
        </div>
        <span className="px-2 py-0.5 rounded text-[10px] bg-blue-950 text-blue-300 border border-blue-800">
          Dev Mode
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/80">
          <span className="text-slate-400 block mb-1">Authoritative Room Pos</span>
          <span className="text-blue-400 font-bold text-sm">
            {stats.authoritativePosition.toFixed(3)}s
          </span>
        </div>

        <div className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/80">
          <span className="text-slate-400 block mb-1">Local Player Pos</span>
          <span className="text-slate-100 font-bold text-sm">
            {stats.localPosition.toFixed(3)}s
          </span>
        </div>

        <div className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/80">
          <span className="text-slate-400 block mb-1">Playback Drift</span>
          <span
            className={`font-bold text-sm ${
              Math.abs(stats.driftMs) < 150
                ? 'text-emerald-400'
                : Math.abs(stats.driftMs) < 1500
                ? 'text-amber-400'
                : 'text-rose-400'
            }`}
          >
            {stats.driftMs > 0 ? `+${stats.driftMs}` : stats.driftMs} ms
          </span>
          <span className="text-[10px] text-slate-500 block">
            {Math.abs(stats.driftMs) < 150 ? 'Deadband (OK)' : Math.abs(stats.driftMs) < 1500 ? 'Ramping tempo' : 'Hard seek'}
          </span>
        </div>

        <div className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/80">
          <span className="text-slate-400 block mb-1">WebSocket RTT</span>
          <span className="text-slate-100 font-bold text-sm flex items-center gap-1">
            <Wifi className="w-3 h-3 text-emerald-400" />
            {stats.rttMs} ms
          </span>
        </div>

        <div className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/80">
          <span className="text-slate-400 block mb-1">Clock Offset (NTP)</span>
          <span className="text-slate-100 font-bold text-sm">
            {stats.clockOffsetMs > 0 ? `+${stats.clockOffsetMs}` : stats.clockOffsetMs} ms
          </span>
        </div>

        <div className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/80">
          <span className="text-slate-400 block mb-1">Active Playback Rate</span>
          <span
            className={`font-bold text-sm flex items-center gap-1 ${
              stats.playbackRate === 1.0 ? 'text-slate-200' : 'text-cyan-400'
            }`}
          >
            <Gauge className="w-3 h-3 text-cyan-400" />
            {stats.playbackRate.toFixed(2)}x
          </span>
        </div>
      </div>

      <div className="bg-slate-950/60 p-2 rounded-lg border border-slate-800/80 flex items-center justify-between text-[11px]">
        <span className="text-slate-400">Media Buffered:</span>
        <span className="text-slate-200">
          {stats.bufferedUntil.toFixed(1)}s ({stats.bufferPercent}%)
        </span>
      </div>

      <div className="pt-2 border-t border-slate-800 space-y-1.5 font-sans">
        <span className="text-[11px] text-slate-400 block">Simulate Latency / Drift:</span>
        <div className="flex gap-2">
          <button
            onClick={() => injectDrift(-2)}
            className="flex-1 py-1.5 px-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-xs font-mono transition"
          >
            -2s Drift
          </button>
          <button
            onClick={() => injectDrift(2)}
            className="flex-1 py-1.5 px-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-xs font-mono transition"
          >
            +2s Drift
          </button>
          <button
            onClick={forceSync}
            className="py-1.5 px-3 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-medium transition flex items-center gap-1"
          >
            <Zap className="w-3 h-3" />
            Force Sync
          </button>
        </div>
      </div>
    </div>
  );
};
