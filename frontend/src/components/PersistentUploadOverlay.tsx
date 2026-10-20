import React from 'react';
import { useUploadContext } from '../context/UploadContext';
import { Cloud, Loader2, CheckCircle2, AlertCircle, X, Maximize2 } from 'lucide-react';

export const PersistentUploadOverlay: React.FC = () => {
  const { tasks, isR2ModalOpen, openR2Modal, abortUpload } = useUploadContext();

  // If the modal is already open, do not render duplicate overlay
  if (isR2ModalOpen) return null;

  // Filter tasks that are actively uploading, completing, or recently completed/errored
  const relevantTasks = tasks.filter(
    (t) =>
      t.status === 'uploading' ||
      t.status === 'initiating' ||
      t.status === 'completing' ||
      t.status === 'error'
  );

  if (relevantTasks.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-40 max-w-sm w-full space-y-2 pointer-events-auto animate-in slide-in-from-bottom-3 duration-200">
      {relevantTasks.map((task) => {
        const isUploading =
          task.status === 'uploading' ||
          task.status === 'initiating' ||
          task.status === 'completing';
        const isError = task.status === 'error';

        const speedMb = (task.progress.speedBytesPerSec / (1024 * 1024)).toFixed(1);
        const uploadedMb = (task.progress.uploadedBytes / (1024 * 1024)).toFixed(1);
        const totalMb = (task.progress.totalBytes / (1024 * 1024)).toFixed(1);

        return (
          <div
            key={task.id}
            className="bg-[#121216] border border-white/15 rounded-xl shadow-2xl p-3.5 text-neutral-200 backdrop-blur-md"
          >
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-2 min-w-0">
                {isUploading ? (
                  <Loader2 className="w-4 h-4 text-sky-400 animate-spin flex-shrink-0" />
                ) : isError ? (
                  <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                )}
                <span className="text-xs font-medium truncate text-neutral-200" title={task.filename}>
                  {task.filename}
                </span>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button
                  onClick={openR2Modal}
                  className="p-1 hover:bg-white/10 rounded text-neutral-400 hover:text-white transition-colors"
                  title="Expand Upload Manager"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                </button>
                {isUploading && (
                  <button
                    onClick={() => abortUpload(task.id)}
                    className="p-1 hover:bg-rose-500/20 rounded text-neutral-400 hover:text-rose-300 transition-colors"
                    title="Cancel Upload"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Progress Bar */}
            <div className="w-full bg-white/10 rounded-full h-1.5 overflow-hidden mb-1.5">
              <div
                className={`h-full transition-all duration-300 rounded-full ${
                  isError ? 'bg-rose-500' : 'bg-sky-400'
                }`}
                style={{ width: `${task.progress.percentage}%` }}
              />
            </div>

            {/* Stats row */}
            <div className="flex items-center justify-between text-[11px] text-neutral-400 font-mono">
              <span>{task.progress.percentage}%</span>
              <span>
                {uploadedMb} / {totalMb} MB
              </span>
              {isUploading && task.progress.speedBytesPerSec > 0 && <span>{speedMb} MB/s</span>}
            </div>

            {task.error && (
              <div className="mt-1.5 text-[11px] text-rose-400 line-clamp-1">{task.error}</div>
            )}
          </div>
        );
      })}
    </div>
  );
};
