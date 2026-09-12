import React from 'react';
import { SyncStatus } from '../types';
import { CheckCircle2, RefreshCw, AlertTriangle, WifiOff } from 'lucide-react';

interface Props {
  status: SyncStatus;
  driftMs?: number;
}

export const SyncStatusBadge: React.FC<Props> = ({ status, driftMs }) => {
  switch (status) {
    case 'SYNCED':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-950/80 text-emerald-400 border border-emerald-800/60 shadow-sm shadow-emerald-950">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          <span>Synced</span>
          {driftMs !== undefined && (
            <span className="text-emerald-500/80 text-[10px]">({Math.abs(driftMs)}ms)</span>
          )}
        </span>
      );

    case 'SYNCHRONIZING':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-950/80 text-amber-300 border border-amber-800/60 animate-pulse shadow-sm shadow-amber-950">
          <RefreshCw className="w-3 h-3 animate-spin text-amber-400" />
          <span>Synchronizing...</span>
        </span>
      );

    case 'BUFFERING':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-rose-950/80 text-rose-300 border border-rose-800/60 shadow-sm shadow-rose-950">
          <AlertTriangle className="w-3 h-3 text-rose-400 animate-bounce" />
          <span>Buffering...</span>
        </span>
      );

    case 'DISCONNECTED':
    default:
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-900 text-slate-400 border border-slate-700">
          <WifiOff className="w-3 h-3 text-slate-400" />
          <span>Disconnected</span>
        </span>
      );
  }
};
