import React from 'react';
import { SyncStats, PlaybackSynchronizer } from '../sync/PlaybackSynchronizer';
import { PlaybackChangeSource } from '../types';
import { Terminal, RefreshCw } from 'lucide-react';

interface Props {
  stats: SyncStats | null;
  synchronizer: PlaybackSynchronizer | null;
  videoElement: HTMLVideoElement | null;
}

export const DebugPanel: React.FC<Props> = ({ stats, synchronizer, videoElement }) => {
  if (!stats) return null;

  const injectDrift = (seconds: number) => {
    if (!videoElement || !synchronizer) return;
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
    <div className="bg-[#0e0e12] border border-white/[0.08] rounded-xl p-4 text-xs font-mono space-y-4 select-none">
      <div className="flex items-center justify-between pb-2 border-b border-white/[0.08]">
        <div className="flex items-center gap-2 text-neutral-300 font-sans font-medium text-xs">
          <Terminal className="w-3.5 h-3.5 text-neutral-400" />
          <span>Playback Diagnostics</span>
        </div>
        <span className="text-[10px] text-neutral-500 uppercase tracking-widest font-mono">
          Dev Console
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <div className="bg-white/[0.02] p-2.5 rounded-lg border border-white/[0.04]">
          <span className="text-neutral-500 text-[10px] block mb-0.5">Authoritative Pos</span>
          <span className="text-neutral-100 font-medium text-xs">
            {stats.authoritativePosition.toFixed(3)}s
          </span>
        </div>

        <div className="bg-white/[0.02] p-2.5 rounded-lg border border-white/[0.04]">
          <span className="text-neutral-500 text-[10px] block mb-0.5">Local Player Pos</span>
          <span className="text-neutral-100 font-medium text-xs">
            {stats.localPosition.toFixed(3)}s
          </span>
        </div>

        <div className="bg-white/[0.02] p-2.5 rounded-lg border border-white/[0.04]">
          <span className="text-neutral-500 text-[10px] block mb-0.5">Playback Drift</span>
          <span className="text-neutral-100 font-medium text-xs">
            {stats.driftMs > 0 ? `+${stats.driftMs}` : stats.driftMs} ms
          </span>
        </div>

        <div className="bg-white/[0.02] p-2.5 rounded-lg border border-white/[0.04]">
          <span className="text-neutral-500 text-[10px] block mb-0.5">WebSocket RTT</span>
          <span className="text-neutral-100 font-medium text-xs">
            {stats.rttMs} ms
          </span>
        </div>

        <div className="bg-white/[0.02] p-2.5 rounded-lg border border-white/[0.04]">
          <span className="text-neutral-500 text-[10px] block mb-0.5">Clock Offset (NTP)</span>
          <span className="text-neutral-100 font-medium text-xs">
            {stats.clockOffsetMs > 0 ? `+${stats.clockOffsetMs}` : stats.clockOffsetMs} ms
          </span>
        </div>

        <div className="bg-white/[0.02] p-2.5 rounded-lg border border-white/[0.04]">
          <span className="text-neutral-500 text-[10px] block mb-0.5">Playback Rate</span>
          <span className="text-neutral-100 font-medium text-xs">
            {stats.playbackRate.toFixed(2)}x
          </span>
        </div>
      </div>

      <div className="bg-white/[0.02] p-2 rounded-lg border border-white/[0.04] flex items-center justify-between text-[11px]">
        <span className="text-neutral-500">Buffered Ahead:</span>
        <span className="text-neutral-300">
          {stats.bufferedUntil.toFixed(1)}s ({stats.bufferPercent}%)
        </span>
      </div>

      <div className="pt-2 border-t border-white/[0.08] space-y-2 font-sans">
        <span className="text-[11px] text-neutral-500 block">Simulate Sync Drift:</span>
        <div className="flex gap-2">
          <button
            onClick={() => injectDrift(-2)}
            className="flex-1 h-8 px-2 bg-white/[0.04] hover:bg-white/[0.08] text-neutral-300 rounded text-xs font-mono transition-colors border border-white/[0.06]"
          >
            -2s Drift
          </button>
          <button
            onClick={() => injectDrift(2)}
            className="flex-1 h-8 px-2 bg-white/[0.04] hover:bg-white/[0.08] text-neutral-300 rounded text-xs font-mono transition-colors border border-white/[0.06]"
          >
            +2s Drift
          </button>
          <button
            onClick={forceSync}
            className="h-8 px-3 bg-white hover:bg-neutral-200 text-black rounded text-xs font-medium transition-colors flex items-center gap-1.5"
          >
            <RefreshCw className="w-3 h-3" />
            <span>Force sync</span>
          </button>
        </div>
      </div>
    </div>
  );
};

