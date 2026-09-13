import React from 'react';
import { SyncStatus } from '../types';
import { Loader2 } from 'lucide-react';

interface Props {
  status: SyncStatus;
  driftMs?: number;
}

export const SyncStatusBadge: React.FC<Props> = ({ status }) => {
  switch (status) {
    case 'SYNCED':
      return (
        <span className="inline-flex items-center gap-1 sm:gap-1.5 text-[11px] sm:text-xs text-neutral-300 font-medium px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-md bg-white/[0.04] border border-white/[0.06] whitespace-nowrap flex-shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          <span>Synced</span>
        </span>
      );

    case 'SYNCHRONIZING':
      return (
        <span className="inline-flex items-center gap-1 sm:gap-1.5 text-[11px] sm:text-xs text-neutral-400 font-medium px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-md bg-white/[0.04] border border-white/[0.06] whitespace-nowrap flex-shrink-0">
          <Loader2 className="w-3 h-3 animate-spin text-neutral-400" />
          <span>Syncing</span>
        </span>
      );

    case 'BUFFERING':
      return (
        <span className="inline-flex items-center gap-1 sm:gap-1.5 text-[11px] sm:text-xs text-neutral-400 font-medium px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-md bg-white/[0.04] border border-white/[0.06] whitespace-nowrap flex-shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
          <span>Buffering</span>
        </span>
      );

    case 'DISCONNECTED':
    default:
      return (
        <span className="inline-flex items-center gap-1 sm:gap-1.5 text-[11px] sm:text-xs text-neutral-500 font-medium px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-md bg-white/[0.02] border border-white/[0.04] whitespace-nowrap flex-shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-neutral-600" />
          <span>Disconnected</span>
        </span>
      );
  }
};
