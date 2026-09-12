import React, { useState, useEffect } from 'react';
import { VideoMetadata } from '../types';
import { api, SessionStatus } from '../api/client';
import { X, Film, Upload, Cloud, RefreshCw, Check, HardDrive, AlertCircle } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSelectVideo: (video: VideoMetadata) => void;
  currentVideoId?: string;
}

export const DriveFilePickerModal: React.FC<Props> = ({
  isOpen,
  onClose,
  onSelectVideo,
  currentVideoId,
}) => {
  const [activeTab, setActiveTab] = useState<'local' | 'drive' | 'upload'>('local');
  const [localVideos, setLocalVideos] = useState<VideoMetadata[]>([]);
  const [driveVideos, setDriveVideos] = useState<VideoMetadata[]>([]);
  const [session, setSession] = useState<SessionStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadInitialData();
    }
  }, [isOpen]);

  const loadInitialData = async () => {
    setError(null);
    setLoading(true);
    try {
      const [vids, sess] = await Promise.all([api.listVideos(), api.getSessionStatus()]);
      setLocalVideos(vids);
      setSession(sess);

      if (sess.driveConnected) {
        loadDriveVideos();
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load media');
    } finally {
      setLoading(false);
    }
  };

  const loadDriveVideos = async () => {
    try {
      setLoading(true);
      const dVids = await api.listDriveVideos();
      setDriveVideos(dVids);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch Google Drive videos');
    } finally {
      setLoading(false);
    }
  };

  const handleConnectDrive = async () => {
    try {
      const authUrl = await api.getGoogleOAuthUrl(window.location.pathname);
      window.location.href = authUrl;
    } catch (err: any) {
      setError(err.message || 'Failed to initiate Google OAuth');
    }
  };

  const handleDisconnectDrive = async () => {
    try {
      await api.disconnectGoogle();
      setSession((prev) => (prev ? { ...prev, driveConnected: false } : null));
      setDriveVideos([]);
    } catch (err: any) {
      setError('Failed to disconnect Google account');
    }
  };

  const handleSelectDriveVideo = async (file: VideoMetadata) => {
    try {
      setImportingId(file.id);
      setError(null);
      // Import into application storage for optimal range-request streaming
      const imported = await api.importDriveVideo(file.id);
      onSelectVideo(imported);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to import video from Google Drive');
    } finally {
      setImportingId(null);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setUploading(true);
      setError(null);
      const uploaded = await api.uploadVideo(file);
      setLocalVideos((prev) => [uploaded, ...prev]);
      onSelectVideo(uploaded);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <Film className="w-5 h-5 text-blue-400" />
            <h2 className="text-base font-semibold text-slate-100">Select Movie or Video</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-800 bg-slate-950/50 px-5 pt-2 gap-2">
          <button
            onClick={() => setActiveTab('local')}
            className={`flex items-center gap-2 pb-2.5 px-3 text-xs font-medium border-b-2 transition ${
              activeTab === 'local'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <HardDrive className="w-4 h-4" />
            Available Media ({localVideos.length})
          </button>

          <button
            onClick={() => setActiveTab('drive')}
            className={`flex items-center gap-2 pb-2.5 px-3 text-xs font-medium border-b-2 transition ${
              activeTab === 'drive'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Cloud className="w-4 h-4" />
            Google Drive {session?.driveConnected && `(${driveVideos.length})`}
          </button>

          <button
            onClick={() => setActiveTab('upload')}
            className={`flex items-center gap-2 pb-2.5 px-3 text-xs font-medium border-b-2 transition ${
              activeTab === 'upload'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Upload className="w-4 h-4" />
            Upload File
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 flex-1 overflow-y-auto space-y-4">
          {error && (
            <div className="flex items-center gap-2 p-3 bg-rose-950/50 border border-rose-800/80 rounded-xl text-rose-300 text-xs">
              <AlertCircle className="w-4 h-4 flex-shrink-0 text-rose-400" />
              <span>{error}</span>
            </div>
          )}

          {/* TAB 1: LOCAL / SAMPLE MEDIA */}
          {activeTab === 'local' && (
            <div className="space-y-3">
              <p className="text-xs text-slate-400">
                Pick a bundled demo video or media already placed in the server's storage directory.
              </p>

              {loading ? (
                <div className="py-12 flex justify-center items-center text-slate-500 gap-2">
                  <RefreshCw className="w-5 h-5 animate-spin text-blue-400" />
                  <span className="text-xs">Loading media files...</span>
                </div>
              ) : localVideos.length === 0 ? (
                <div className="text-center py-10 text-slate-500 text-xs">No media files available.</div>
              ) : (
                <div className="grid grid-cols-1 gap-2.5">
                  {localVideos.map((vid) => {
                    const isSelected = vid.id === currentVideoId;
                    return (
                      <div
                        key={vid.id}
                        onClick={() => {
                          onSelectVideo(vid);
                          onClose();
                        }}
                        className={`flex items-center justify-between p-3.5 rounded-xl border cursor-pointer transition ${
                          isSelected
                            ? 'bg-blue-950/40 border-blue-600/70 shadow-sm'
                            : 'bg-slate-950/40 border-slate-800 hover:border-slate-700 hover:bg-slate-800/50'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-lg bg-blue-950/80 border border-blue-800/50 flex items-center justify-center text-blue-400">
                            <Film className="w-5 h-5" />
                          </div>
                          <div>
                            <h4 className="text-xs font-semibold text-slate-200">{vid.name}</h4>
                            <span className="text-[11px] text-slate-400">
                              {vid.size ? `${(vid.size / (1024 * 1024)).toFixed(1)} MB` : 'Local Video'}
                            </span>
                          </div>
                        </div>

                        {isSelected && (
                          <span className="flex items-center gap-1 text-xs text-blue-400 font-medium">
                            <Check className="w-4 h-4" /> Selected
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: GOOGLE DRIVE */}
          {activeTab === 'drive' && (
            <div className="space-y-4">
              {!session?.driveConnected ? (
                <div className="text-center py-10 px-4 bg-slate-950/40 rounded-2xl border border-slate-800 space-y-4">
                  <div className="w-12 h-12 rounded-2xl bg-blue-950/60 border border-blue-800/60 mx-auto flex items-center justify-center text-blue-400">
                    <Cloud className="w-6 h-6" />
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-slate-200">Connect Google Drive</h4>
                    <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
                      Choose video files directly from your personal Drive. OAuth tokens are kept securely on
                      the server and are never exposed to other viewers.
                    </p>
                  </div>
                  <button
                    onClick={handleConnectDrive}
                    className="py-2.5 px-5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold transition inline-flex items-center gap-2 shadow-lg shadow-blue-950"
                  >
                    <Cloud className="w-4 h-4" />
                    <span>Authorize with Google</span>
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between bg-emerald-950/30 border border-emerald-800/50 p-3 rounded-xl">
                    <div className="flex items-center gap-2 text-xs text-emerald-300">
                      <Check className="w-4 h-4 text-emerald-400" />
                      <span>Google Drive connected</span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={loadDriveVideos}
                        className="p-1.5 hover:bg-emerald-900/40 text-emerald-400 rounded transition"
                        title="Refresh file list"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={handleDisconnectDrive}
                        className="text-[11px] text-slate-400 hover:text-slate-200 underline"
                      >
                        Disconnect
                      </button>
                    </div>
                  </div>

                  {loading ? (
                    <div className="py-12 flex justify-center items-center text-slate-500 gap-2">
                      <RefreshCw className="w-5 h-5 animate-spin text-blue-400" />
                      <span className="text-xs">Fetching Drive files...</span>
                    </div>
                  ) : driveVideos.length === 0 ? (
                    <div className="text-center py-8 text-slate-500 text-xs">
                      No video files found in your Google Drive.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-2.5 max-h-64 overflow-y-auto">
                      {driveVideos.map((f) => (
                        <div
                          key={f.id}
                          className="flex items-center justify-between p-3 rounded-xl bg-slate-950/40 border border-slate-800 hover:border-slate-700 transition"
                        >
                          <div className="flex items-center gap-3">
                            <Film className="w-5 h-5 text-blue-400" />
                            <div>
                              <h5 className="text-xs font-medium text-slate-200">{f.name}</h5>
                              <span className="text-[10px] text-slate-400">
                                {f.size ? `${(f.size / (1024 * 1024)).toFixed(1)} MB` : 'Cloud Video'}
                              </span>
                            </div>
                          </div>

                          <button
                            disabled={importingId === f.id}
                            onClick={() => handleSelectDriveVideo(f)}
                            className="py-1.5 px-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-xs font-medium transition flex items-center gap-1.5"
                          >
                            {importingId === f.id ? (
                              <>
                                <RefreshCw className="w-3 h-3 animate-spin" />
                                <span>Importing...</span>
                              </>
                            ) : (
                              <span>Use in Room</span>
                            )}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: UPLOAD */}
          {activeTab === 'upload' && (
            <div className="space-y-4">
              <label className="border-2 border-dashed border-slate-800 hover:border-blue-500/60 rounded-2xl p-8 flex flex-col items-center justify-center cursor-pointer bg-slate-950/40 hover:bg-slate-950/80 transition group">
                <Upload className="w-8 h-8 text-slate-500 group-hover:text-blue-400 transition mb-2" />
                <span className="text-xs font-medium text-slate-300">
                  {uploading ? 'Uploading media file...' : 'Click to select an MP4 or WebM video'}
                </span>
                <span className="text-[11px] text-slate-500 mt-1">Recommended format: MP4 (H.264 / AAC)</span>
                <input
                  type="file"
                  accept="video/mp4,video/webm,video/mkv"
                  disabled={uploading}
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
