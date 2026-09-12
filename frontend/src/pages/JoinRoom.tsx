import React, { useState } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';

interface Props {
  onNavigate: (page: string, params?: Record<string, string>) => void;
}

export const JoinRoom: React.FC<Props> = ({ onNavigate }) => {
  const [roomCode, setRoomCode] = useState('');
  const [displayName, setDisplayName] = useState(
    localStorage.getItem('wt_display_name') || ''
  );

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomCode.trim()) return;
    const cleanCode = roomCode.trim().toUpperCase();
    if (displayName.trim()) {
      localStorage.setItem('wt_display_name', displayName.trim());
    }
    onNavigate('room', { roomId: cleanCode });
  };

  return (
    <div className="min-h-screen bg-[#09090b] text-neutral-100 flex flex-col justify-between px-6 py-8 selection:bg-neutral-800 selection:text-neutral-100">
      {/* Top Bar */}
      <header className="max-w-4xl mx-auto w-full flex items-center justify-between">
        <button
          onClick={() => onNavigate('home')}
          className="group inline-flex items-center gap-2 text-xs font-medium text-neutral-400 hover:text-neutral-100 transition-colors py-1.5"
        >
          <ArrowLeft className="w-3.5 h-3.5 transition-transform group-hover:-translate-x-0.5" />
          <span>Back</span>
        </button>

        <span
          onClick={() => onNavigate('home')}
          className="text-sm font-medium tracking-tight text-neutral-300 hover:text-white cursor-pointer transition-colors"
        >
          WatchTogether
        </span>

        <div className="w-12" />
      </header>

      {/* Main Centered Form */}
      <main className="max-w-sm mx-auto w-full my-auto py-12">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-100 mb-2">
            Join a room
          </h1>
          <p className="text-xs text-neutral-400 leading-relaxed">
            Enter the 6-character room code to join the synchronized session.
          </p>
        </div>

        <form onSubmit={handleJoin} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-neutral-400 block tracking-wide uppercase">
              Room Code
            </label>
            <input
              type="text"
              required
              maxLength={6}
              placeholder="e.g. AB7X9K"
              value={roomCode}
              autoFocus
              onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
              className="w-full h-11 px-3.5 bg-[#121215] border border-white/[0.08] focus:border-white/30 rounded-lg text-sm font-mono tracking-widest text-center text-neutral-100 placeholder:text-neutral-600 outline-none transition-colors"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-neutral-400 block tracking-wide uppercase">
              Your Name <span className="text-neutral-500 normal-case font-normal">(optional)</span>
            </label>
            <input
              type="text"
              placeholder="Viewer"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full h-11 px-3.5 bg-[#121215] border border-white/[0.08] focus:border-white/30 rounded-lg text-xs text-neutral-100 placeholder:text-neutral-600 outline-none transition-colors"
            />
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={!roomCode.trim()}
              className="w-full h-11 bg-white hover:bg-neutral-200 disabled:opacity-30 disabled:hover:bg-white text-black rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-2"
            >
              <span>Enter room</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </form>
      </main>

      {/* Footer */}
      <footer className="text-center text-[11px] text-neutral-600">
        WatchTogether
      </footer>
    </div>
  );
};
