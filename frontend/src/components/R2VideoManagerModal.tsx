import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  X,
  Film,
  Upload,
  Cloud,
  RefreshCw,
  AlertCircle,
  Loader2,
  Search,
  Trash2,
  Lock,
  ArrowRight,
  RotateCcw,
  CheckCircle2,
} from 'lucide-react';
import { R2VideoItem, AppMediaSource, PersistedUploadMetadata } from '../types';
import { api } from '../api/client';
import { useUploadContext } from '../context/UploadContext';

interface R2VideoManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectVideo?: (source: AppMediaSource) => void;
}

export const R2VideoManagerModal: React.FC<R2VideoManagerModalProps> = ({
  isOpen,
  onClose,
  onSelectVideo,
}) => {
  const {
    tasks,
    incompleteUploads,
    startUpload,
    resumeUpload,
    abortUpload,
    discardIncompleteUpload,
    refreshIncompleteUploads,
    adminToken,
    setAdminToken,
  } = useUploadContext();

  const [activeTab, setActiveTab] = useState<'browse' | 'upload'>('browse');
  const [r2Videos, setR2Videos] = useState<R2VideoItem[]>([]);
  const [isLoadingVideos, setIsLoadingVideos] = useState(false);
  const [videoListError, setVideoListError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [loadingPlayKey, setLoadingPlayKey] = useState<string | null>(null);

  // Admin Auth Dialog state
  const [isAdminDialogOpen, setIsAdminDialogOpen] = useState(false);
  const [adminPasswordInput, setAdminPasswordInput] = useState('');
  const [adminAuthError, setAdminAuthError] = useState<string | null>(null);
  const [isVerifyingAdmin, setIsVerifyingAdmin] = useState(false);
  const [pendingActionAfterAuth, setPendingActionAfterAuth] = useState<(() => void) | null>(null);

  // Delete confirmation state
  const [videoToDelete, setVideoToDelete] = useState<R2VideoItem | null>(null);
  const [isDeletingVideo, setIsDeletingVideo] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Resume file picker
  const [resumingUploadId, setResumingUploadId] = useState<string | null>(null);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const resumeFileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadFileInputRef = useRef<HTMLInputElement | null>(null);

  // Drag and drop state
  const [isDragging, setIsDragging] = useState(false);

  const fetchVideos = useCallback(async () => {
    setIsLoadingVideos(true);
    setVideoListError(null);
    try {
      const items = await api.listR2Videos();
      setR2Videos(items);
    } catch (err: any) {
      setVideoListError(err.message || 'Failed to list videos from Cloudflare R2');
    } finally {
      setIsLoadingVideos(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchVideos();
      refreshIncompleteUploads();
    }
  }, [isOpen, fetchVideos, refreshIncompleteUploads]);

  // When an upload completes, refresh the video list automatically
  useEffect(() => {
    const hasCompletedRecently = tasks.some((t) => t.status === 'completed');
    if (hasCompletedRecently) {
      fetchVideos();
    }
  }, [tasks, fetchVideos]);

  if (!isOpen) return null;

  // Prompt admin password helper
  const requireAdminAuth = (onSuccess: () => void) => {
    if (adminToken) {
      onSuccess();
    } else {
      setPendingActionAfterAuth(() => onSuccess);
      setAdminAuthError(null);
      setAdminPasswordInput('');
      setIsAdminDialogOpen(true);
    }
  };

  const handleAdminVerifySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminPasswordInput.trim()) return;

    setIsVerifyingAdmin(true);
    setAdminAuthError(null);
    try {
      const res = await api.verifyR2Admin(adminPasswordInput);
      setAdminToken(res.token);
      setIsAdminDialogOpen(false);
      setAdminPasswordInput('');

      // Execute queued action
      if (pendingActionAfterAuth) {
        pendingActionAfterAuth();
        setPendingActionAfterAuth(null);
      }
    } catch (err: any) {
      setAdminAuthError(err.message || 'Incorrect password or authentication error');
    } finally {
      setIsVerifyingAdmin(false);
    }
  };

  // Video selection for playback
  const handleSelectVideo = async (item: R2VideoItem) => {
    setLoadingPlayKey(item.key);
    try {
      const res = await api.getR2PlayUrl(item.key);
      const source: AppMediaSource = {
        type: 'r2',
        title: item.name,
        src: res.url,
        r2Key: item.key,
        size: item.size,
      };
      onSelectVideo?.(source);
      onClose();
    } catch (err: any) {
      setVideoListError(err.message || 'Failed to generate presigned playback URL');
    } finally {
      setLoadingPlayKey(null);
    }
  };

  // Delete flow
  const confirmDelete = (item: R2VideoItem) => {
    setVideoToDelete(item);
    setDeleteError(null);
  };

  const executeDelete = async () => {
    if (!videoToDelete) return;

    requireAdminAuth(async () => {
      setIsDeletingVideo(true);
      setDeleteError(null);
      try {
        await api.deleteR2Video(videoToDelete.key);
        setVideoToDelete(null);
        await fetchVideos();
      } catch (err: any) {
        setDeleteError(err.message || 'Failed to delete video');
      } finally {
        setIsDeletingVideo(false);
      }
    });
  };

  // Upload trigger
  const handleFilesSelected = (files: FileList | null) => {
    if (!files || files.length === 0) return;

    const fileList = Array.from(files);
    requireAdminAuth(() => {
      fileList.forEach((file) => {
        startUpload(file).catch((err) => {
          console.error('Failed to start upload:', err);
        });
      });
      setActiveTab('upload');
    });
  };

  // Resume trigger
  const promptResume = (uploadId: string) => {
    setResumingUploadId(uploadId);
    setResumeError(null);
    if (resumeFileInputRef.current) {
      resumeFileInputRef.current.value = '';
      resumeFileInputRef.current.click();
    }
  };

  const handleResumeFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !resumingUploadId) return;

    requireAdminAuth(async () => {
      try {
        await resumeUpload(resumingUploadId, file);
        setResumingUploadId(null);
        setActiveTab('upload');
      } catch (err: any) {
        setResumeError(err.message || 'Failed to resume upload');
      }
    });
  };

  const filteredVideos = r2Videos.filter(
    (v) =>
      v.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      v.key.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[#111115] border border-white/10 rounded-2xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden text-left">
        {/* Modal Header */}
        <div className="p-4 sm:p-5 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400">
              <Cloud className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold text-neutral-100">Cloudflare R2 Media</h3>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-neutral-400">
                  letsgo-backend
                </span>
              </div>
              <p className="text-xs text-neutral-400">Stream and manage videos stored in R2</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-neutral-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
            title="Close modal (Uploads continue in background)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Bar */}
        <div className="flex items-center justify-between px-4 sm:px-5 border-b border-white/10 bg-white/[0.02]">
          <div className="flex gap-4">
            <button
              onClick={() => setActiveTab('browse')}
              className={`py-3 text-xs font-medium border-b-2 transition-colors flex items-center gap-2 ${
                activeTab === 'browse'
                  ? 'border-sky-400 text-sky-400'
                  : 'border-transparent text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <Film className="w-4 h-4" />
              Videos ({r2Videos.length})
            </button>
            <button
              onClick={() => setActiveTab('upload')}
              className={`py-3 text-xs font-medium border-b-2 transition-colors flex items-center gap-2 ${
                activeTab === 'upload'
                  ? 'border-sky-400 text-sky-400'
                  : 'border-transparent text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <Upload className="w-4 h-4" />
              Upload Manager
              {tasks.filter((t) => t.status === 'uploading').length > 0 && (
                <span className="w-2 h-2 rounded-full bg-sky-400 animate-pulse" />
              )}
            </button>
          </div>

          <button
            onClick={fetchVideos}
            disabled={isLoadingVideos}
            className="p-1.5 text-neutral-400 hover:text-white rounded hover:bg-white/5 transition-colors disabled:opacity-50"
            title="Refresh videos list"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoadingVideos ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Hidden File Inputs */}
        <input
          ref={uploadFileInputRef}
          type="file"
          multiple
          accept=".mp4,.webm,.mov,.mkv"
          className="hidden"
          onChange={(e) => handleFilesSelected(e.target.files)}
        />
        <input
          ref={resumeFileInputRef}
          type="file"
          accept=".mp4,.webm,.mov,.mkv"
          className="hidden"
          onChange={handleResumeFileSelected}
        />

        {/* Incomplete Uploads Alert Banner */}
        {incompleteUploads.length > 0 && (
          <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2.5 flex items-center justify-between text-xs text-amber-200">
            <div className="flex items-center gap-2 min-w-0 pr-2">
              <RotateCcw className="w-4 h-4 text-amber-400 flex-shrink-0" />
              <span className="truncate">
                Found {incompleteUploads.length} incomplete upload(s). You can resume or discard.
              </span>
            </div>
            <button
              onClick={() => setActiveTab('upload')}
              className="text-[11px] underline font-medium hover:text-white flex-shrink-0"
            >
              View in Uploads
            </button>
          </div>
        )}

        {/* Tab 1: Browse Videos */}
        {activeTab === 'browse' && (
          <div className="flex flex-col flex-1 overflow-hidden">
            {/* Search Box */}
            <div className="p-3 sm:px-5 sm:py-3 border-b border-white/5 bg-white/[0.01]">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-neutral-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search videos in R2 bucket..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-white/[0.04] border border-white/10 rounded-lg pl-8 pr-3 py-1.5 text-xs text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-sky-500/50"
                />
              </div>
            </div>

            {/* Videos List */}
            <div className="p-3 sm:p-5 overflow-y-auto flex-1 space-y-2">
              {isLoadingVideos ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3 text-neutral-400">
                  <Loader2 className="w-6 h-6 animate-spin text-sky-400" />
                  <span className="text-xs">Loading videos from R2...</span>
                </div>
              ) : videoListError ? (
                <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-300 text-xs flex flex-col items-center gap-2 text-center">
                  <AlertCircle className="w-5 h-5 text-red-400" />
                  <span>{videoListError}</span>
                  <button
                    onClick={fetchVideos}
                    className="mt-1 px-3 py-1 bg-red-500/20 hover:bg-red-500/30 rounded text-[11px] font-medium text-red-200 transition-colors"
                  >
                    Retry
                  </button>
                </div>
              ) : filteredVideos.length === 0 ? (
                <div className="text-center py-12 text-xs text-neutral-500">
                  {searchQuery ? 'No matching videos found.' : 'No video objects found in R2 bucket.'}
                </div>
              ) : (
                filteredVideos.map((item) => (
                  <div
                    key={item.key}
                    className="group flex items-center justify-between p-3 rounded-xl bg-white/[0.02] hover:bg-white/[0.06] border border-white/[0.06] hover:border-white/[0.12] transition-colors"
                  >
                    <button
                      onClick={() => handleSelectVideo(item)}
                      disabled={loadingPlayKey === item.key}
                      className="flex items-center gap-3 min-w-0 flex-1 text-left"
                    >
                      <div className="w-8 h-8 rounded-lg bg-neutral-800 flex items-center justify-center text-neutral-400 group-hover:text-white transition-colors flex-shrink-0">
                        <Film className="w-4 h-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium text-neutral-200 truncate group-hover:text-white">
                          {item.name}
                        </div>
                        <div className="text-[10px] text-neutral-500 font-mono mt-0.5">
                          {(item.size / (1024 * 1024)).toFixed(1)} MB &bull; {item.mimeType}
                        </div>
                      </div>
                    </button>

                    <div className="flex items-center gap-2 pl-3">
                      {loadingPlayKey === item.key ? (
                        <Loader2 className="w-4 h-4 animate-spin text-sky-400" />
                      ) : (
                        <button
                          onClick={() => handleSelectVideo(item)}
                          className="px-2.5 py-1 text-[11px] font-medium rounded-md bg-sky-500/10 hover:bg-sky-500/20 text-sky-300 hover:text-sky-200 border border-sky-500/20 transition-colors"
                        >
                          Play &rarr;
                        </button>
                      )}

                      <button
                        onClick={() => confirmDelete(item)}
                        className="p-1.5 text-neutral-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors"
                        title="Delete video"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Tab 2: Upload Manager */}
        {activeTab === 'upload' && (
          <div className="p-4 sm:p-5 overflow-y-auto flex-1 space-y-4">
            {/* Drag & Drop Zone */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                handleFilesSelected(e.dataTransfer.files);
              }}
              onClick={() => uploadFileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-6 sm:p-8 text-center cursor-pointer transition-all ${
                isDragging
                  ? 'border-sky-400 bg-sky-500/10'
                  : 'border-white/10 hover:border-white/20 bg-white/[0.01] hover:bg-white/[0.03]'
              }`}
            >
              <div className="w-12 h-12 rounded-2xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400 mx-auto mb-3">
                <Upload className="w-6 h-6" />
              </div>
              <h4 className="text-sm font-medium text-neutral-200 mb-1">
                Drag and drop your video files here
              </h4>
              <p className="text-xs text-neutral-500 mb-3">
                Supports MP4, WebM, MOV, and MKV up to 100 GB via chunked multipart upload
              </p>
              <button
                type="button"
                className="px-4 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-black text-xs font-semibold shadow-md transition-colors"
              >
                Choose Video File
              </button>
            </div>

            {/* Incomplete Uploads from Previous Sessions */}
            {incompleteUploads.length > 0 && (
              <div className="space-y-2">
                <h5 className="text-xs font-semibold text-amber-300 uppercase tracking-wider flex items-center gap-1.5">
                  <RotateCcw className="w-3.5 h-3.5" /> Resumable Incomplete Uploads
                </h5>
                {incompleteUploads.map((incomplete) => {
                  const uploadedMb = (
                    incomplete.completedParts.reduce((acc, p) => acc + p.size, 0) /
                    (1024 * 1024)
                  ).toFixed(1);
                  const totalMb = (incomplete.fileSize / (1024 * 1024)).toFixed(1);

                  return (
                    <div
                      key={incomplete.uploadId}
                      className="p-3.5 rounded-xl bg-amber-500/5 border border-amber-500/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div>
                        <div className="text-xs font-medium text-neutral-200">{incomplete.filename}</div>
                        <div className="text-[11px] text-neutral-400 font-mono mt-0.5">
                          {uploadedMb} / {totalMb} MB &bull; {incomplete.completedParts.length} of{' '}
                          {incomplete.totalParts} parts finished
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => promptResume(incomplete.uploadId)}
                          className="px-3 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 text-xs font-medium rounded-lg border border-amber-500/30 transition-colors"
                        >
                          Select File to Resume
                        </button>
                        <button
                          onClick={() => discardIncompleteUpload(incomplete.uploadId, incomplete.objectKey)}
                          className="p-1.5 text-neutral-400 hover:text-rose-400 rounded-lg hover:bg-white/5 transition-colors"
                          title="Discard & Abort Upload"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
                {resumeError && (
                  <div className="p-2.5 bg-rose-500/10 border border-rose-500/20 rounded-lg text-xs text-rose-300">
                    {resumeError}
                  </div>
                )}
              </div>
            )}

            {/* Active and Completed Tasks */}
            {tasks.length > 0 && (
              <div className="space-y-2">
                <h5 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">
                  Active Tasks
                </h5>
                {tasks.map((task) => {
                  const isUploading =
                    task.status === 'uploading' ||
                    task.status === 'initiating' ||
                    task.status === 'completing';
                  const isDone = task.status === 'completed';
                  const isError = task.status === 'error';
                  const isAborted = task.status === 'aborted';

                  const uploadedMb = (task.progress.uploadedBytes / (1024 * 1024)).toFixed(1);
                  const totalMb = (task.progress.totalBytes / (1024 * 1024)).toFixed(1);
                  const speedMb = (task.progress.speedBytesPerSec / (1024 * 1024)).toFixed(1);

                  return (
                    <div
                      key={task.id}
                      className="p-3.5 rounded-xl bg-white/[0.03] border border-white/10 space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0">
                          {isUploading ? (
                            <Loader2 className="w-4 h-4 text-sky-400 animate-spin flex-shrink-0" />
                          ) : isDone ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                          ) : isError ? (
                            <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
                          ) : (
                            <X className="w-4 h-4 text-neutral-500 flex-shrink-0" />
                          )}
                          <span className="text-xs font-medium text-neutral-200 truncate">
                            {task.filename}
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          <span
                            className={`text-[10px] font-mono px-2 py-0.5 rounded capitalize ${
                              isDone
                                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                : isError
                                ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                                : isAborted
                                ? 'bg-neutral-800 text-neutral-400'
                                : 'bg-sky-500/10 text-sky-400 border border-sky-500/20'
                            }`}
                          >
                            {task.status}
                          </span>
                          {isUploading && (
                            <button
                              onClick={() => abortUpload(task.id)}
                              className="px-2 py-0.5 text-[10px] text-neutral-400 hover:text-rose-400 rounded hover:bg-rose-500/10 transition-colors"
                            >
                              Cancel
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Progress Bar */}
                      <div className="w-full bg-white/5 rounded-full h-2 overflow-hidden">
                        <div
                          className={`h-full transition-all duration-300 rounded-full ${
                            isDone
                              ? 'bg-emerald-500'
                              : isError
                              ? 'bg-rose-500'
                              : isAborted
                              ? 'bg-neutral-600'
                              : 'bg-sky-400'
                          }`}
                          style={{ width: `${task.progress.percentage}%` }}
                        />
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-neutral-400 font-mono">
                        <span>{task.progress.percentage}%</span>
                        <span>
                          {uploadedMb} / {totalMb} MB
                        </span>
                        {isUploading && task.progress.speedBytesPerSec > 0 && (
                          <span>{speedMb} MB/s</span>
                        )}
                        {task.progress.totalParts > 1 && (
                          <span>
                            Part {task.progress.currentPart} of {task.progress.totalParts}
                          </span>
                        )}
                      </div>

                      {task.error && (
                        <div className="text-[11px] text-rose-400">{task.error}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Modal Footer */}
        <div className="p-3 sm:px-5 border-t border-white/10 bg-white/[0.01] flex items-center justify-between text-xs text-neutral-500">
          <span>You can safely close this window; active uploads continue in the background.</span>
          <button
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-neutral-300 hover:text-white transition-colors"
          >
            Close
          </button>
        </div>
      </div>

      {/* Admin Password Prompt Dialog */}
      {isAdminDialogOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-[#141418] border border-white/15 rounded-2xl w-full max-w-sm p-5 shadow-2xl text-left">
            <div className="flex items-center gap-2.5 text-neutral-200 mb-2">
              <div className="w-8 h-8 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400">
                <Lock className="w-4 h-4" />
              </div>
              <h4 className="text-sm font-semibold">Admin Authorization Required</h4>
            </div>
            <p className="text-xs text-neutral-400 mb-4">
              Enter the backend R2 admin password to authorize this action.
            </p>

            <form onSubmit={handleAdminVerifySubmit} className="space-y-3">
              <input
                type="password"
                autoFocus
                placeholder="Admin password (e.g. admin123)"
                value={adminPasswordInput}
                onChange={(e) => setAdminPasswordInput(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-neutral-200 focus:outline-none focus:border-sky-500/50"
              />

              {adminAuthError && (
                <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                  <span>{adminAuthError}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsAdminDialogOpen(false);
                    setPendingActionAfterAuth(null);
                  }}
                  className="px-3 py-1.5 rounded-lg text-xs text-neutral-400 hover:text-neutral-200 hover:bg-white/5 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isVerifyingAdmin || !adminPasswordInput.trim()}
                  className="px-4 py-1.5 rounded-lg text-xs font-medium bg-sky-500 hover:bg-sky-400 text-black flex items-center gap-1.5 transition-colors disabled:opacity-50"
                >
                  {isVerifyingAdmin && <Loader2 className="w-3 h-3 animate-spin" />}
                  Authorize
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {videoToDelete && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-[#141418] border border-white/15 rounded-2xl w-full max-w-sm p-5 shadow-2xl text-left">
            <div className="flex items-center gap-2.5 text-rose-400 mb-2">
              <div className="w-8 h-8 rounded-lg bg-rose-500/10 border border-rose-500/20 flex items-center justify-center">
                <Trash2 className="w-4 h-4" />
              </div>
              <h4 className="text-sm font-semibold text-neutral-200">Delete Video from R2</h4>
            </div>
            <p className="text-xs text-neutral-300 mb-2">
              Are you sure you want to permanently delete:
            </p>
            <div className="p-2.5 rounded-lg bg-white/5 border border-white/10 font-mono text-[11px] text-sky-300 truncate mb-3">
              {videoToDelete.name}
            </div>
            <p className="text-[11px] text-neutral-400 mb-4">
              This will permanently remove the object from the Cloudflare R2 bucket. This action cannot be undone.
            </p>

            {deleteError && (
              <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs mb-3 flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                <span>{deleteError}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setVideoToDelete(null)}
                className="px-3 py-1.5 rounded-lg text-xs text-neutral-400 hover:text-neutral-200 hover:bg-white/5 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={executeDelete}
                disabled={isDeletingVideo}
                className="px-4 py-1.5 rounded-lg text-xs font-medium bg-rose-500 hover:bg-rose-400 text-white flex items-center gap-1.5 transition-colors disabled:opacity-50"
              >
                {isDeletingVideo && <Loader2 className="w-3 h-3 animate-spin" />}
                Delete Video
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
