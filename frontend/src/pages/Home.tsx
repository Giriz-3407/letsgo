import React, { useState } from 'react';
import { ArrowRight } from 'lucide-react';

interface Props {
  onNavigate: (page: string, params?: Record<string, string>) => void;
}

export const Home: React.FC<Props> = ({ onNavigate }) => {
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
      {/* Minimal Top Navigation */}
      <header className="max-w-5xl mx-auto w-full flex items-center justify-between">
        <span className="text-sm font-semibold tracking-tight text-neutral-100">
          WatchTogether
        </span>

        <nav className="flex items-center gap-6 text-xs">
          <button
            onClick={() => onNavigate('join')}
            className="text-neutral-400 hover:text-neutral-100 transition-colors"
          >
            Join room
          </button>
          <button
            onClick={() => onNavigate('create')}
            className="h-8 px-3.5 bg-white hover:bg-neutral-200 text-black font-medium rounded-lg transition-colors"
          >
            Create room
          </button>
        </nav>
      </header>

      {/* Clean Central Hero */}
      <main className="max-w-2xl mx-auto w-full my-auto text-center py-20">
        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-semibold tracking-tight text-neutral-100 leading-[1.15]">
          Watch movies together.
          <br />
          <span className="text-neutral-400 font-normal">Stay perfectly in sync.</span>
        </h1>

        <p className="mt-6 text-sm sm:text-base text-neutral-400 max-w-lg mx-auto leading-relaxed">
          Synchronized video playback for movie nights with friends. Connect your Google Drive or use local media.
        </p>

        {/* Primary and Secondary Hero Actions */}
        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3 max-w-sm mx-auto">
          <button
            onClick={() => onNavigate('create')}
            className="w-full sm:w-auto h-11 px-6 bg-white hover:bg-neutral-200 text-black font-medium text-xs rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            <span>Create a room</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={() => onNavigate('join')}
            className="w-full sm:w-auto h-11 px-6 bg-white/[0.04] hover:bg-white/[0.08] text-neutral-200 hover:text-white border border-white/[0.08] font-medium text-xs rounded-lg transition-colors flex items-center justify-center"
          >
            <span>Join a room</span>
          </button>
        </div>

        {/* Quiet Inline Quick-Join Option */}
        <div className="mt-14 pt-10 border-t border-white/[0.06] max-w-sm mx-auto">
          <form onSubmit={handleJoin} className="space-y-3 text-left">
            <span className="text-[11px] font-medium text-neutral-500 uppercase tracking-wider block text-center">
              Quick join with room code
            </span>
            <div className="flex gap-2">
              <input
                type="text"
                maxLength={6}
                placeholder="Code (e.g. AB7X9K)"
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                className="flex-1 h-10 px-3 bg-[#121215] border border-white/[0.08] focus:border-white/30 rounded-lg text-xs font-mono tracking-widest text-center text-neutral-100 placeholder:text-neutral-600 outline-none transition-colors"
              />
              <button
                type="submit"
                disabled={!roomCode.trim()}
                className="h-10 px-4 bg-white/[0.08] hover:bg-white text-neutral-300 hover:text-black disabled:opacity-30 disabled:hover:bg-white/[0.08] disabled:hover:text-neutral-300 border border-white/[0.08] rounded-lg text-xs font-medium transition-colors"
              >
                Join
              </button>
            </div>
          </form>
        </div>
      </main>

      {/* Clean Minimalist Footer */}
      <footer className="max-w-5xl mx-auto w-full pt-6 border-t border-white/[0.06] flex items-center justify-between text-[11px] text-neutral-500">
        <span>WatchTogether</span>
        <span>Minimalist Synchronized Video Playback</span>
      </footer>
    </div>
  );
};

