import React, { useState, useEffect } from 'react';
import { VideoMetadata } from '../types';
import { api, SessionStatus } from '../api/client';
import { openGoogleDrivePicker } from '../utils/googlePicker';
import { X, Film, Upload, Cloud, RefreshCw, Check, AlertCircle, FolderOpen, Loader2 } from 'lucide-react';

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
  const [session, setSession] = useState<SessionStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [isOpeningPicker, setIsOpeningPicker] = useState(false);
  const [importingVideoName, setImportingVideoName] = useState<string | null>(null);
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
    } catch (err: any) {
      setError(err.message || 'Failed to load media');
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
    } catch (err: any) {
      setError('Failed to disconnect Google account');
    }
  };

  const handleOpenGooglePicker = async () => {
    setError(null);
    setIsOpeningPicker(true);
    try {
      // 1. Fetch valid access token & configuration from backend session
      const pickerConfig = await api.getGooglePickerConfig();

      const apiKey = pickerConfig.apiKey || (import.meta as any).env?.VITE_GOOGLE_API_KEY;
      const appId = pickerConfig.appId || (import.meta as any).env?.VITE_GOOGLE_APP_ID;

      // 2. Launch Google Picker dialog
      const selectedFile = await openGoogleDrivePicker({
        accessToken: pickerConfig.accessToken,
        apiKey: apiKey || undefined,
        appId: appId || undefined,
        title: 'Select a video to WatchTogether',
      });

      // 3. User closed or cancelled picker
      if (!selectedFile) {
        setIsOpeningPicker(false);
        return;
      }

      // 4. Pass selected file ID into existing backend storage flow
      setIsOpeningPicker(false);
      setImportingVideoName(selectedFile.name);

      const imported = await api.importDriveVideo(selectedFile.id);
      onSelectVideo(imported);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to select or import video from Google Drive');
    } finally {
      setIsOpeningPicker(false);
      setImportingVideoName(null);
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm select-none">
      <div className="bg-[#111114] border border-white/[0.08] rounded-2xl w-full max-w-xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-white/[0.08]">
          <h2 className="text-sm font-semibold tracking-tight text-neutral-100">
            Choose a video
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 text-neutral-400 hover:text-neutral-100 hover:bg-white/[0.05] rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Minimal Tab Switcher */}
        <div className="flex px-6 pt-3 pb-2 gap-2 border-b border-white/[0.08] bg-[#0c0c0f]">
          <button
            onClick={() => setActiveTab('local')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              activeTab === 'local'
                ? 'bg-white text-black'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            Local ({localVideos.length})
          </button>

          <button
            onClick={() => setActiveTab('drive')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${
              activeTab === 'drive'
                ? 'bg-white text-black'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <span>Google Drive</span>
            {session?.driveConnected && (
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            )}
          </button>

          <button
            onClick={() => setActiveTab('upload')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              activeTab === 'upload'
                ? 'bg-white text-black'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            Upload
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 flex-1 overflow-y-auto space-y-3">
          {error && (
            <div className="flex items-center gap-2 p-3 bg-rose-950/40 border border-rose-900/50 rounded-lg text-rose-300 text-xs">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* TAB 1: LOCAL MEDIA */}
          {activeTab === 'local' && (
            <div>
              {loading ? (
                <div className="py-16 flex flex-col justify-center items-center text-neutral-500 gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-neutral-400" />
                  <span className="text-xs">Loading media library...</span>
                </div>
              ) : localVideos.length === 0 ? (
                <div className="text-center py-16 text-neutral-500 text-xs">
                  No local videos found.
                </div>
              ) : (
                <div className="divide-y divide-white/[0.06]">
                  {localVideos.map((vid) => {
                    const isSelected = vid.id === currentVideoId;
                    return (
                      <div
                        key={vid.id}
                        className="py-3.5 flex items-center justify-between group"
                      >
                        <div className="min-w-0 pr-4">
                          <h4 className="text-xs font-medium text-neutral-200 truncate group-hover:text-white transition-colors">
                            {vid.name}
                          </h4>
                          <span className="text-[11px] text-neutral-500 block mt-0.5">
                            {vid.provider.toUpperCase()} &bull; {vid.size ? `${(vid.size / (1024 * 1024)).toFixed(1)} MB` : 'Stream'}
                          </span>
                        </div>

                        <button
                          onClick={() => {
                            onSelectVideo(vid);
                            onClose();
                          }}
                          className={`h-8 px-3.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 flex-shrink-0 ${
                            isSelected
                              ? 'bg-white/[0.1] text-white border border-white/20'
                              : 'bg-white/[0.05] hover:bg-white text-neutral-300 hover:text-black border border-white/[0.08]'
                          }`}
                        >
                          {isSelected && <Check className="w-3.5 h-3.5" />}
                          <span>{isSelected ? 'Selected' : 'Select'}</span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: GOOGLE DRIVE (OFFICIAL GOOGLE PICKER) */}
          {activeTab === 'drive' && (
            <div>
              {!session?.driveConnected ? (
                <div className="text-center py-12 px-4 space-y-4">
                  <div className="w-10 h-10 rounded-full bg-white/[0.04] border border-white/[0.08] mx-auto flex items-center justify-center text-neutral-400">
                    <Cloud className="w-4 h-4" />
                  </div>
                  <div className="max-w-xs mx-auto">
                    <h4 className="text-xs font-medium text-neutral-200">Connect Google Drive</h4>
                    <p className="text-[11px] text-neutral-500 mt-1 leading-relaxed">
                      Connect your Google Drive account to select movies and video files directly using Google's official Drive Picker.
                    </p>
                  </div>
                  <button
                    onClick={handleConnectDrive}
                    className="h-9 px-4 bg-white hover:bg-neutral-200 text-black rounded-lg text-xs font-medium transition-colors inline-flex items-center gap-2"
                  >
                    <span>Authorize with Google</span>
                  </button>
                </div>
              ) : importingVideoName ? (
                <div className="text-center py-16 px-4 space-y-3">
                  <Loader2 className="w-6 h-6 animate-spin text-white mx-auto" />
                  <div>
                    <h4 className="text-xs font-medium text-neutral-200">Importing video from Google Drive</h4>
                    <p className="text-[11px] text-neutral-400 mt-1 max-w-sm mx-auto truncate">
                      {importingVideoName}
                    </p>
                    <span className="text-[10px] text-neutral-500 block mt-2">
                      Preparing low-latency range-request video stream...
                    </span>
                  </div>
                </div>
              ) : (
                <div className="space-y-4 py-2">
                  <div className="flex items-center justify-between pb-3 border-b border-white/[0.08]">
                    <span className="text-[11px] text-neutral-400 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                      Google Drive connected
                    </span>
                    <button
                      onClick={handleDisconnectDrive}
                      className="text-[11px] text-neutral-500 hover:text-neutral-300 transition-colors"
                    >
                      Disconnect
                    </button>
                  </div>

                  <div className="p-6 rounded-xl border border-white/[0.08] bg-white/[0.02] text-center space-y-4">
                    <div className="w-12 h-12 rounded-2xl bg-white/[0.04] border border-white/[0.08] mx-auto flex items-center justify-center text-neutral-300">
                      <FolderOpen className="w-5 h-5" />
                    </div>

                    <div className="max-w-sm mx-auto">
                      <h4 className="text-xs font-semibold text-neutral-100">
                        Official Google Drive Picker
                      </h4>
                      <p className="text-[11px] text-neutral-400 mt-1 leading-relaxed">
                        Browse folders, navigate your Drive hierarchy, search files, and select any video to watch in synchronized playback.
                      </p>
                    </div>

                    <button
                      disabled={isOpeningPicker}
                      onClick={handleOpenGooglePicker}
                      className="h-10 px-5 bg-white hover:bg-neutral-200 disabled:opacity-50 text-black rounded-lg text-xs font-medium transition-colors inline-flex items-center gap-2 shadow-sm"
                    >
                      {isOpeningPicker ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-black" />
                          <span>Opening Google Picker...</span>
                        </>
                      ) : (
                        <>
                          <Cloud className="w-3.5 h-3.5" />
                          <span>Choose from Google Drive</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: UPLOAD */}
          {activeTab === 'upload' && (
            <div className="py-4">
              <label className="border border-dashed border-white/10 hover:border-white/30 rounded-xl p-8 flex flex-col items-center justify-center cursor-pointer bg-white/[0.02] hover:bg-white/[0.04] transition-colors group">
                <Upload className="w-6 h-6 text-neutral-500 group-hover:text-neutral-300 transition-colors mb-2" />
                <span className="text-xs font-medium text-neutral-200">
                  {uploading ? 'Uploading media...' : 'Select MP4 or WebM video'}
                </span>
                <span className="text-[11px] text-neutral-500 mt-1">Recommended: MP4 (H.264 / AAC)</span>
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

