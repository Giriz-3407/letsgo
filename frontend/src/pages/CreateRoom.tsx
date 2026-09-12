import React, { useState, useEffect } from 'react';
import { ControlMode, VideoMetadata } from '../types';
import { api, SessionStatus } from '../api/client';
import { DriveFilePickerModal } from '../components/DriveFilePickerModal';
import { ArrowLeft, Film, Shield, Users, Cloud, Check, Loader2 } from 'lucide-react';

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
    // Load session status and pre-select default sample video if available
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
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center items-center px-4 py-8">
      <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <button
            onClick={() => onNavigate('home')}
            className="text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1.5 transition"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back</span>
          </button>
          <h2 className="text-base font-bold text-slate-100">Create Watch Room</h2>
          <div className="w-8" />
        </div>

        {error && (
          <div className="p-3 bg-rose-950/50 border border-rose-800/80 rounded-xl text-rose-300 text-xs">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5 text-xs">
          {/* Host Display Name */}
          <div className="space-y-1.5">
            <label className="text-slate-300 font-medium block">Your Display Name</label>
            <input
              type="text"
              required
              value={hostDisplayName}
              onChange={(e) => setHostDisplayName(e.target.value)}
              className="w-full py-2.5 px-3 bg-slate-950 border border-slate-800 focus:border-blue-500 rounded-xl text-slate-100 outline-none transition"
            />
          </div>

          {/* Video Selection */}
          <div className="space-y-1.5">
            <label className="text-slate-300 font-medium block">Video to Watch</label>
            <div
              onClick={() => setIsPickerOpen(true)}
              className="flex items-center justify-between p-3 rounded-xl bg-slate-950 border border-slate-800 hover:border-slate-700 cursor-pointer transition group"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-blue-950 border border-blue-800/60 flex items-center justify-center text-blue-400">
                  <Film className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="font-semibold text-slate-200">
                    {selectedVideo ? selectedVideo.name : 'No video selected'}
                  </h4>
                  <span className="text-[11px] text-slate-500">
                    {selectedVideo
                      ? `${selectedVideo.provider.toUpperCase()} • ${
                          selectedVideo.size ? `${(selectedVideo.size / (1024 * 1024)).toFixed(1)} MB` : 'Stream'
                        }`
                      : 'Click to choose media or connect Google Drive'}
                  </span>
                </div>
              </div>

              <span className="text-[11px] text-blue-400 group-hover:underline font-medium">
                Change
              </span>
            </div>
          </div>

          {/* Playback Control Mode */}
          <div className="space-y-2">
            <label className="text-slate-300 font-medium block">Who Can Control Playback?</label>
            <div className="grid grid-cols-2 gap-2.5">
              <label
                className={`p-3 rounded-xl border flex flex-col items-center gap-1.5 cursor-pointer transition ${
                  controlMode === 'HOST_ONLY'
                    ? 'bg-blue-950/50 border-blue-600 text-blue-200 shadow-sm'
                    : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700'
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
                <Shield className="w-4 h-4 text-blue-400" />
                <span className="font-semibold text-xs">Host Only</span>
                <span className="text-[10px] text-slate-500 text-center">
                  Only you can play, pause, or seek
                </span>
              </label>

              <label
                className={`p-3 rounded-xl border flex flex-col items-center gap-1.5 cursor-pointer transition ${
                  controlMode === 'EVERYONE'
                    ? 'bg-blue-950/50 border-blue-600 text-blue-200 shadow-sm'
                    : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700'
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
                <Users className="w-4 h-4 text-emerald-400" />
                <span className="font-semibold text-xs">Everyone</span>
                <span className="text-[10px] text-slate-500 text-center">
                  Any viewer can control player
                </span>
              </label>
            </div>
          </div>

          {/* Pause on Buffer Setting */}
          <div className="flex items-center justify-between p-3 rounded-xl bg-slate-950 border border-slate-800">
            <div>
              <span className="text-slate-200 font-medium block">Pause on Buffering</span>
              <span className="text-[11px] text-slate-500">
                Pause the room if any participant is buffering (Default: Off)
              </span>
            </div>
            <input
              type="checkbox"
              checked={pauseOnBuffer}
              onChange={(e) => setPauseOnBuffer(e.target.checked)}
              className="w-4 h-4 rounded text-blue-600 bg-slate-950 border-slate-700 focus:ring-blue-600 cursor-pointer"
            />
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold transition flex items-center justify-center gap-2 shadow-lg shadow-blue-950"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Creating Room...</span>
              </>
            ) : (
              <span>Launch Watch Room</span>
            )}
          </button>
        </form>
      </div>

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
