import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { UploadTask, PersistedUploadMetadata } from '../types';
import { r2UploadManager } from '../utils/r2UploadManager';
import { getAllIncompleteUploads, removeUpload } from '../utils/indexedDb';
import { api } from '../api/client';

interface UploadContextType {
  tasks: UploadTask[];
  incompleteUploads: PersistedUploadMetadata[];
  isR2ModalOpen: boolean;
  adminToken: string | null;
  hasActiveUploads: boolean;
  openR2Modal: () => void;
  closeR2Modal: () => void;
  startUpload: (file: File) => Promise<string>;
  resumeUpload: (uploadId: string, file: File) => Promise<string>;
  abortUpload: (taskIdOrUploadId: string) => Promise<void>;
  discardIncompleteUpload: (uploadId: string, objectKey?: string) => Promise<void>;
  refreshIncompleteUploads: () => Promise<void>;
  setAdminToken: (token: string | null) => void;
}

const UploadContext = createContext<UploadContextType | null>(null);

export const UploadProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [tasks, setTasks] = useState<UploadTask[]>([]);
  const [incompleteUploads, setIncompleteUploads] = useState<PersistedUploadMetadata[]>([]);
  const [isR2ModalOpen, setIsR2ModalOpen] = useState(false);
  const [adminToken, setAdminTokenState] = useState<string | null>(() => api.getR2AdminToken());

  const refreshIncompleteUploads = useCallback(async () => {
    try {
      const list = await getAllIncompleteUploads();
      setIncompleteUploads(list);
    } catch (err) {
      console.warn('Failed loading incomplete uploads:', err);
    }
  }, []);

  useEffect(() => {
    refreshIncompleteUploads();

    const unsubscribe = r2UploadManager.subscribe((updatedTask) => {
      setTasks((prev) => {
        const idx = prev.findIndex((t) => t.id === updatedTask.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = updatedTask;
          return next;
        }
        return [...prev, updatedTask];
      });

      if (updatedTask.status === 'completed' || updatedTask.status === 'aborted') {
        refreshIncompleteUploads();
      }
    });

    return () => unsubscribe();
  }, [refreshIncompleteUploads]);

  const setAdminToken = useCallback((token: string | null) => {
    api.setR2AdminToken(token);
    setAdminTokenState(token);
  }, []);

  const openR2Modal = useCallback(() => setIsR2ModalOpen(true), []);
  const closeR2Modal = useCallback(() => setIsR2ModalOpen(false), []);

  const startUpload = useCallback(async (file: File) => {
    return await r2UploadManager.startUpload(file);
  }, []);

  const resumeUpload = useCallback(async (uploadId: string, file: File) => {
    return await r2UploadManager.resumeUpload(uploadId, file);
  }, []);

  const abortUpload = useCallback(async (taskIdOrUploadId: string) => {
    await r2UploadManager.abortUpload(taskIdOrUploadId);
    await refreshIncompleteUploads();
  }, [refreshIncompleteUploads]);

  const discardIncompleteUpload = useCallback(
    async (uploadId: string, objectKey?: string) => {
      try {
        await api.abortR2Upload(uploadId, objectKey);
      } catch (err) {
        console.warn('Server-side abort failed, cleaning local DB:', err);
      }
      await removeUpload(uploadId);
      await refreshIncompleteUploads();
    },
    [refreshIncompleteUploads]
  );

  const hasActiveUploads = tasks.some(
    (t) => t.status === 'uploading' || t.status === 'initiating' || t.status === 'completing'
  );

  return (
    <UploadContext.Provider
      value={{
        tasks,
        incompleteUploads,
        isR2ModalOpen,
        adminToken,
        hasActiveUploads,
        openR2Modal,
        closeR2Modal,
        startUpload,
        resumeUpload,
        abortUpload,
        discardIncompleteUpload,
        refreshIncompleteUploads,
        setAdminToken,
      }}
    >
      {children}
    </UploadContext.Provider>
  );
};

export function useUploadContext(): UploadContextType {
  const ctx = useContext(UploadContext);
  if (!ctx) {
    throw new Error('useUploadContext must be used within an UploadProvider');
  }
  return ctx;
}
