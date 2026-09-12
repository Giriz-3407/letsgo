import React, { useState } from 'react';
import { Film, Users, Play, Sparkles, ArrowRight, ShieldCheck, Zap, HardDrive } from 'lucide-react';

interface Props {
  onNavigate: (page: string, params?: Record<string, string>) => void;
}

export const Home: React.FC<Props> = ({ onNavigate }) => {
  const [roomCode, setRoomCode] = useState('');
  const [displayName, setDisplayName] = useState('');

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
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between">
      {/* Navbar */}
      <header className="border-b border-slate-800/80 bg-slate-950/80 backdrop-blur sticky top-0 z-10 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white shadow-md shadow-blue-600/30">
              <Play className="w-4 h-4 fill-white ml-0.5" />
            </div>
            <span className="font-bold text-lg tracking-tight bg-gradient-to-r from-white via-slate-200 to-blue-400 bg-clip-text text-transparent">
              WatchTogether
            </span>
          </div>
          <span className="text-xs px-2.5 py-1 rounded-full bg-blue-950/60 border border-blue-800/60 text-blue-300 font-medium">
            Decoupled Sync Architecture
          </span>
        </div>
      </header>

      {/* Hero Section */}
      <main className="max-w-5xl mx-auto px-6 py-12 flex-1 flex flex-col justify-center">
        <div className="text-center max-w-2xl mx-auto space-y-4 mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-950/60 border border-blue-800/60 text-blue-300 text-xs font-medium">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Near-Zero Latency Playback Synchronization</span>
          </div>
          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-white leading-tight">
            Watch movies together, <br />
            <span className="text-blue-500">perfectly in sync.</span>
          </h1>
          <p className="text-slate-400 text-sm sm:text-base">
            Video bytes stream directly from Cloud Storage/CDN with HTTP Range requests.
            Playback commands fly over lightweight WebSockets with server-authoritative timestamps.
          </p>
        </div>

        {/* Action Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl mx-auto w-full">
          {/* Create Room Card */}
          <div className="bg-slate-900/80 border border-slate-800 hover:border-slate-700 rounded-2xl p-6 flex flex-col justify-between shadow-xl transition">
            <div className="space-y-2">
              <div className="w-10 h-10 rounded-xl bg-blue-950/80 border border-blue-800/60 flex items-center justify-center text-blue-400 mb-3">
                <Film className="w-5 h-5" />
              </div>
              <h3 className="text-base font-semibold text-slate-100">Host a Watch Room</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Start a private room, pick a movie from local storage or connect your Google Drive, and invite
                friends.
              </p>
            </div>
            <button
              onClick={() => onNavigate('create')}
              className="mt-6 w-full py-3 px-4 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold transition flex items-center justify-center gap-2 shadow-lg shadow-blue-950"
            >
              <span>Create Watch Room</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>

          {/* Join Room Card */}
          <div className="bg-slate-900/80 border border-slate-800 hover:border-slate-700 rounded-2xl p-6 flex flex-col justify-between shadow-xl transition">
            <div className="space-y-2">
              <div className="w-10 h-10 rounded-xl bg-purple-950/80 border border-purple-800/60 flex items-center justify-center text-purple-400 mb-3">
                <Users className="w-5 h-5" />
              </div>
              <h3 className="text-base font-semibold text-slate-100">Join Existing Room</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Enter the 6-character room code shared by the host to jump directly into the synchronous stream.
              </p>
            </div>

            <form onSubmit={handleJoin} className="mt-6 space-y-3">
              <div className="space-y-2">
                <input
                  type="text"
                  placeholder="Your Name (Optional)"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full py-2 px-3 bg-slate-950/80 border border-slate-800 focus:border-blue-500 rounded-xl text-xs text-slate-200 outline-none transition"
                />
                <input
                  type="text"
                  maxLength={6}
                  placeholder="Room Code (e.g. AB7X9K)"
                  value={roomCode}
                  onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                  className="w-full py-2.5 px-3 bg-slate-950/80 border border-slate-800 focus:border-purple-500 rounded-xl text-sm font-mono text-center tracking-widest uppercase text-slate-100 outline-none transition"
                />
              </div>
              <button
                type="submit"
                disabled={!roomCode.trim()}
                className="w-full py-2.5 px-4 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white rounded-xl text-xs font-semibold transition flex items-center justify-center gap-2 shadow-lg shadow-purple-950"
              >
                <span>Enter Room</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>
          </div>
        </div>

        {/* Architecture Badges */}
        <div className="mt-14 pt-8 border-t border-slate-800/60 grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-3xl mx-auto text-center">
          <div className="flex flex-col items-center space-y-1">
            <HardDrive className="w-5 h-5 text-blue-400 mb-1" />
            <h4 className="text-xs font-semibold text-slate-200">Decoupled Video Path</h4>
            <p className="text-[11px] text-slate-500">No backend video bottleneck. Browser loads via HTTP Range requests.</p>
          </div>

          <div className="flex flex-col items-center space-y-1">
            <Zap className="w-5 h-5 text-amber-400 mb-1" />
            <h4 className="text-xs font-semibold text-slate-200">Sub-100ms WebSocket Sync</h4>
            <p className="text-[11px] text-slate-500">Authoritative server clock and automatic tempo drift compensation.</p>
          </div>

          <div className="flex flex-col items-center space-y-1">
            <ShieldCheck className="w-5 h-5 text-emerald-400 mb-1" />
            <h4 className="text-xs font-semibold text-slate-200">Secure OAuth 2.0</h4>
            <p className="text-[11px] text-slate-500">Drive credentials are never exposed or sent to room participants.</p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 py-4 text-center text-xs text-slate-600">
        WatchTogether Prototype &bull; Technical Architecture MVP
      </footer>
    </div>
  );
};
