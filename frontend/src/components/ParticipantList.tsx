import React, { useState } from 'react';
import { Participant } from '../types';
import { Users, Crown, Copy, Check, AlertCircle } from 'lucide-react';

interface Props {
  participants: Participant[];
  currentUserId: string;
  roomId: string;
}

export const ParticipantList: React.FC<Props> = ({ participants, currentUserId, roomId }) => {
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
    <div className="bg-slate-900/80 backdrop-blur border border-slate-800 rounded-xl p-4 flex flex-col h-full shadow-lg">
      <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-3">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-blue-400" />
          <h3 className="text-sm font-semibold text-slate-200">Room Participants</h3>
        </div>
        <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-medium">
          {connectedCount} online
        </span>
      </div>

      <div className="flex-1 overflow-y-auto space-y-2 pr-1">
        {participants.map((p) => {
          const isYou = p.id === currentUserId;
          return (
            <div
              key={p.id}
              className={`flex items-center justify-between p-2.5 rounded-lg border transition ${
                isYou
                  ? 'bg-blue-950/30 border-blue-800/40 text-blue-200'
                  : 'bg-slate-950/40 border-slate-800/60 text-slate-300'
              } ${!p.connected ? 'opacity-50' : ''}`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span
                  className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    p.connected ? 'bg-emerald-500 shadow-sm shadow-emerald-500/50' : 'bg-slate-600'
                  }`}
                />
                <span className="text-xs font-medium truncate">
                  {p.displayName} {isYou && <span className="text-slate-500 text-[10px]">(You)</span>}
                </span>
              </div>

              <div className="flex items-center gap-1.5 flex-shrink-0">
                {p.isBuffering && p.connected && (
                  <span className="flex items-center gap-1 text-[10px] text-rose-400 bg-rose-950/60 border border-rose-800 px-1.5 py-0.5 rounded animate-pulse">
                    <AlertCircle className="w-2.5 h-2.5" />
                    Buffering
                  </span>
                )}
                {p.isHost && (
                  <span className="flex items-center gap-1 text-[10px] text-amber-400 bg-amber-950/50 border border-amber-800/60 px-1.5 py-0.5 rounded font-medium">
                    <Crown className="w-3 h-3 text-amber-400 fill-amber-400/30" />
                    Host
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="pt-3 border-t border-slate-800 mt-3">
        <button
          onClick={copyRoomLink}
          className="w-full py-2 px-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-medium transition flex items-center justify-center gap-2 shadow-sm"
        >
          {copied ? <Check className="w-4 h-4 text-emerald-300" /> : <Copy className="w-4 h-4" />}
          <span>{copied ? 'Link Copied to Clipboard!' : 'Copy Room Invite Link'}</span>
        </button>
      </div>
    </div>
  );
};
