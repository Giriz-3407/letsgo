import React, { useState } from 'react';
import { Participant } from '../types';
import { Copy, Check, Shield } from 'lucide-react';

interface Props {
  participants: Participant[];
  currentUserId: string;
  roomId: string;
}

export const ParticipantList: React.FC<Props> = ({ participants, currentUserId }) => {
  const [copied, setCopied] = useState(false);

  const copyRoomLink = () => {
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const connectedCount = participants.filter((p) => p.connected).length;

  return (
    <div className="flex flex-col h-full space-y-4">
      <div className="flex items-center justify-between pb-2 border-b border-white/[0.08]">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold tracking-wide uppercase text-neutral-400">
            Watching now
          </h3>
        </div>
        <span className="text-[11px] text-neutral-500 font-mono">
          {connectedCount} online
        </span>
      </div>

      <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
        {participants.map((p) => {
          const isYou = p.id === currentUserId;
          const initials = (p.displayName || 'V').substring(0, 2).toUpperCase();

          return (
            <div
              key={p.id}
              className={`flex items-center justify-between py-2 px-2.5 rounded-lg transition-colors ${
                isYou ? 'bg-white/[0.04]' : 'hover:bg-white/[0.02]'
              } ${!p.connected ? 'opacity-40' : ''}`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                {/* Minimalist Avatar */}
                <div className="relative w-6 h-6 rounded-full bg-neutral-800 border border-white/[0.08] flex items-center justify-center text-[10px] font-medium text-neutral-300 flex-shrink-0">
                  {initials}
                  <span
                    className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-[#09090b] ${
                      p.connected ? 'bg-emerald-400' : 'bg-neutral-600'
                    }`}
                  />
                </div>

                <span className="text-xs text-neutral-200 truncate">
                  {p.displayName}{' '}
                  {isYou && <span className="text-neutral-500 text-[10px] ml-1">(You)</span>}
                </span>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                {p.isBuffering && p.connected && (
                  <span className="text-[10px] text-neutral-400 font-mono">
                    Buffering...
                  </span>
                )}
                {p.isHost && (
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-white/[0.06] text-neutral-300 border border-white/[0.08]">
                    Host
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="pt-2 border-t border-white/[0.08]">
        <button
          onClick={copyRoomLink}
          className="w-full h-9 px-3 bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] text-neutral-200 hover:text-white rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-2"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-neutral-300" /> : <Copy className="w-3.5 h-3.5" />}
          <span>{copied ? 'Link copied' : 'Copy invite link'}</span>
        </button>
      </div>
    </div>
  );
};

