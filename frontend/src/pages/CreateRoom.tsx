import React, { useState, useEffect } from 'react';
import { ControlMode, VideoMetadata } from '../types';
import { api, SessionStatus } from '../api/client';
import { DriveFilePickerModal } from '../components/DriveFilePickerModal';
import { ArrowLeft, Film, Loader2 } from 'lucide-react';

interface Props {
  onNavigate: (page: string, params?: Record<string, string>) => void;
}

export const CreateRoom: React.FC<Props> = ({ onNavigate }) => {
  const [hostDisplayName, setHostDisplayName] = useState(
    localStorage.getItem('wt_display_name') || 'Host'
  );
  const [controlMode, setControlMode] = useState<ControlMode>('HOST_ONLY');
  const [pauseOnBuffer, setPauseOnBuffer] = useState(false);
  const [selectedVideo, setSelectedVideo] = useState<VideoMetadata | null>(null);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [session, setSession] = useState<SessionStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getSessionStatus()
      .then((s) => setSession(s))
      .catch(console.warn);

    api.listVideos()
      .then((vids) => {
        if (vids.length > 0 && !selectedVideo) {
          setSelectedVideo(vids[0]);
        }
      })
      .catch(console.warn);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      localStorage.setItem('wt_display_name', hostDisplayName);
      const res = await api.createRoom({
        hostDisplayName,
        controlMode,
        videoId: selectedVideo?.id,
        pauseOnBuffer,
      });

      // Save host ID to local storage for host authorization
      localStorage.setItem(`wt_host_${res.roomId}`, res.hostId);
      onNavigate('room', { roomId: res.roomId });
    } catch (err: any) {
      setError(err.message || 'Failed to create watch room');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#09090b] text-neutral-100 flex flex-col justify-between px-6 py-8 selection:bg-neutral-800 selection:text-neutral-100">
      {/* Top Bar */}
      <header className="max-w-xl mx-auto w-full flex items-center justify-between">
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

      {/* Main Setup View */}
      <main className="max-w-lg mx-auto w-full my-auto py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-100">
            Create a room
          </h1>
          <p className="text-xs text-neutral-400 mt-1">
            Configure your session and choose a movie to watch.
          </p>
        </div>

        {error && (
          <div className="mb-6 p-3 bg-rose-950/40 border border-rose-900/50 rounded-lg text-rose-300 text-xs">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Section: Video to Watch */}
          <div className="space-y-2">
            <label className="text-[11px] font-medium text-neutral-400 block uppercase tracking-wide">
              Choose something to watch
            </label>
            <div
              onClick={() => setIsPickerOpen(true)}
              className="group flex items-center justify-between p-3.5 rounded-lg bg-[#111114] border border-white/[0.08] hover:border-white/20 cursor-pointer transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0 pr-2">
                <div className="w-8 h-8 rounded-md bg-white/[0.04] border border-white/[0.08] flex items-center justify-center text-neutral-400 flex-shrink-0">
                  <Film className="w-4 h-4" />
                </div>
                <div className="min-w-0 truncate">
                  <h4 className="font-medium text-xs text-neutral-200 truncate group-hover:text-white transition-colors">
                    {selectedVideo ? selectedVideo.name : 'No video selected'}
                  </h4>
                  <span className="text-[11px] text-neutral-500 block">
                    {selectedVideo
                      ? `${selectedVideo.provider.toUpperCase()} &bull; ${
                          selectedVideo.size ? `${(selectedVideo.size / (1024 * 1024)).toFixed(1)} MB` : 'Stream'
                        }`
                      : 'Click to select media or connect Google Drive'}
                  </span>
                </div>
              </div>

              <span className="text-xs text-neutral-400 group-hover:text-white font-medium transition-colors flex-shrink-0">
                Change
              </span>
            </div>
          </div>

          {/* Divider */}
          <div className="border-t border-white/[0.06]" />

          {/* Section: Your Name */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-neutral-400 block uppercase tracking-wide">
              Your name
            </label>
            <input
              type="text"
              required
              value={hostDisplayName}
              onChange={(e) => setHostDisplayName(e.target.value)}
              className="w-full h-11 px-3.5 bg-[#121215] border border-white/[0.08] focus:border-white/30 rounded-lg text-xs text-neutral-100 placeholder:text-neutral-600 outline-none transition-colors"
            />
          </div>

          {/* Divider */}
          <div className="border-t border-white/[0.06]" />

          {/* Section: Playback Control Mode */}
          <div className="space-y-2">
            <label className="text-[11px] font-medium text-neutral-400 block uppercase tracking-wide">
              Playback permissions
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label
                className={`p-3 rounded-lg border flex flex-col gap-1 cursor-pointer transition-colors ${
                  controlMode === 'HOST_ONLY'
                    ? 'bg-white/[0.08] border-white/30 text-white'
                    : 'bg-[#111114] border-white/[0.08] text-neutral-400 hover:border-white/15'
                }`}
              >
                <input
                  type="radio"
                  name="controlMode"
                  value="HOST_ONLY"
                  checked={controlMode === 'HOST_ONLY'}
                  onChange={() => setControlMode('HOST_ONLY')}
                  className="hidden"
                />
                <span className="font-medium text-xs text-neutral-200">Host only</span>
                <span className="text-[11px] text-neutral-500 leading-tight">
                  Only you can play, pause, or seek
                </span>
              </label>

              <label
                className={`p-3 rounded-lg border flex flex-col gap-1 cursor-pointer transition-colors ${
                  controlMode === 'EVERYONE'
                    ? 'bg-white/[0.08] border-white/30 text-white'
                    : 'bg-[#111114] border-white/[0.08] text-neutral-400 hover:border-white/15'
                }`}
              >
                <input
                  type="radio"
                  name="controlMode"
                  value="EVERYONE"
                  checked={controlMode === 'EVERYONE'}
                  onChange={() => setControlMode('EVERYONE')}
                  className="hidden"
                />
                <span className="font-medium text-xs text-neutral-200">Everyone</span>
                <span className="text-[11px] text-neutral-500 leading-tight">
                  Any viewer can control player
                </span>
              </label>
            </div>
          </div>

          {/* Divider */}
          <div className="border-t border-white/[0.06]" />

          {/* Section: Buffering Behavior */}
          <div className="flex items-center justify-between py-1">
            <div className="space-y-0.5">
              <span className="text-xs font-medium text-neutral-200 block">Pause on buffering</span>
              <span className="text-[11px] text-neutral-500 block">
                Pause the room if any participant is buffering
              </span>
            </div>
            <input
              type="checkbox"
              checked={pauseOnBuffer}
              onChange={(e) => setPauseOnBuffer(e.target.checked)}
              className="w-4 h-4 rounded accent-white bg-[#121215] border-white/20 cursor-pointer"
            />
          </div>

          {/* Submit Action */}
          <div className="pt-4">
            <button
              type="submit"
              disabled={loading}
              className="w-full h-11 bg-white hover:bg-neutral-200 disabled:opacity-40 disabled:hover:bg-white text-black rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-black" />
                  <span>Creating room...</span>
                </>
              ) : (
                <span>Create room</span>
              )}
            </button>
          </div>
        </form>
      </main>

      {/* Footer */}
      <footer className="text-center text-[11px] text-neutral-600">
        WatchTogether
      </footer>

      {/* Video Picker Modal */}
      <DriveFilePickerModal
        isOpen={isPickerOpen}
        onClose={() => setIsPickerOpen(false)}
        currentVideoId={selectedVideo?.id}
        onSelectVideo={(vid) => setSelectedVideo(vid)}
      />
    </div>
  );
};

