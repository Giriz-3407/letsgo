import { api } from '../api/client';
import {
  UploadTask,
  UploadProgress,
  PersistedUploadMetadata,
  PersistedUploadPart,
  R2PartETag,
} from '../types';
import {
  saveUpload,
  getUpload,
  addCompletedPart,
  removeUpload,
  markUploadStatus,
} from './indexedDb';
import { API_BASE_URL } from '../config';

const CONCURRENCY = 3;
const MAX_RETRIES = 3;

export type UploadEventCallback = (task: UploadTask) => void;

class R2UploadManager {
  private activeControllers: Map<string, AbortController> = new Map();
  private tasks: Map<string, UploadTask> = new Map();
  private subscribers: Set<UploadEventCallback> = new Set();
  private beforeUnloadRegistered = false;

  constructor() {
    this.setupUnloadListeners();
  }

  public subscribe(cb: UploadEventCallback): () => void {
    this.subscribers.add(cb);
    return () => this.subscribers.delete(cb);
  }

  private notify(task: UploadTask): void {
    this.tasks.set(task.id, { ...task });
    this.subscribers.forEach((cb) => {
      try {
        cb(task);
      } catch {
        // Ignore subscriber errors
      }
    });
    this.updateBeforeUnloadState();
  }

  public getTasks(): UploadTask[] {
    return Array.from(this.tasks.values());
  }

  public getTask(id: string): UploadTask | undefined {
    return this.tasks.get(id);
  }

  private setupUnloadListeners(): void {
    if (typeof window === 'undefined') return;

    window.addEventListener('beforeunload', (e: BeforeUnloadEvent) => {
      const hasActive = Array.from(this.tasks.values()).some((t) => t.status === 'uploading');
      if (hasActive) {
        e.preventDefault();
        e.returnValue = 'Upload in progress. Leaving may cancel or interrupt your upload.';
        return e.returnValue;
      }
    });

    // Best-effort cleanup on page closure using fetch keepalive or sendBeacon
    window.addEventListener('pagehide', () => {
      const activeTasks = Array.from(this.tasks.values()).filter((t) => t.status === 'uploading');
      const adminToken = api.getR2AdminToken();
      if (!adminToken) return;

      activeTasks.forEach((t) => {
        if (!t.uploadId || !t.objectKey) return;
        const abortUrl = `${API_BASE_URL}/api/videos/r2/uploads/${encodeURIComponent(t.uploadId)}/abort`;
        const payload = JSON.stringify({ objectKey: t.objectKey });

        try {
          if (navigator.sendBeacon) {
            const blob = new Blob([payload], { type: 'application/json' });
            navigator.sendBeacon(abortUrl, blob);
          } else {
            fetch(abortUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-R2-Admin-Token': adminToken,
              },
              body: payload,
              keepalive: true,
            }).catch(() => {});
          }
        } catch {
          // Best effort; no guarantee after unload
        }
      });
    });
  }

  private updateBeforeUnloadState(): void {
    // Window beforeunload checks live status in handler
  }

  public async startUpload(file: File): Promise<string> {
    const taskId = `task_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const controller = new AbortController();
    this.activeControllers.set(taskId, controller);

    const initialProgress: UploadProgress = {
      uploadedBytes: 0,
      totalBytes: file.size,
      percentage: 0,
      speedBytesPerSec: 0,
      currentPart: 0,
      totalParts: 0,
    };

    const task: UploadTask = {
      id: taskId,
      file,
      filename: file.name,
      fileSize: file.size,
      status: 'initiating',
      progress: initialProgress,
      createdAt: Date.now(),
    };

    this.notify(task);

    try {
      // 1. Initiate Multipart Upload with backend
      const initRes = await api.initiateR2Upload(file.name, file.size, file.type);
      task.uploadId = initRes.uploadId;
      task.objectKey = initRes.objectKey;
      task.partSize = initRes.partSize;
      task.totalParts = initRes.totalParts;
      task.progress.totalParts = initRes.totalParts;
      task.status = 'uploading';
      this.notify(task);

      // 2. Persist metadata to IndexedDB
      const persisted: PersistedUploadMetadata = {
        uploadId: initRes.uploadId,
        objectKey: initRes.objectKey,
        filename: file.name,
        fileSize: file.size,
        partSize: initRes.partSize,
        totalParts: initRes.totalParts,
        completedParts: [],
        status: 'uploading',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await saveUpload(persisted);

      // 3. Run chunk uploads
      await this.runChunkUploads(task, controller.signal, []);
    } catch (err: any) {
      if (controller.signal.aborted) {
        task.status = 'aborted';
        task.error = 'Upload was cancelled';
      } else {
        task.status = 'error';
        task.error = err.message || 'Upload failed';
      }
      this.notify(task);
    } finally {
      this.activeControllers.delete(taskId);
    }

    return taskId;
  }

  public async resumeUpload(uploadId: string, file: File): Promise<string> {
    const persisted = await getUpload(uploadId);
    if (!persisted) {
      throw new Error('Upload metadata not found in local database');
    }

    if (file.name !== persisted.filename || file.size !== persisted.fileSize) {
      throw new Error(
        `Selected file does not match incomplete upload. Expected: "${persisted.filename}" (${(persisted.fileSize / (1024 * 1024)).toFixed(1)} MB)`
      );
    }

    const taskId = `resume_${uploadId}`;
    const controller = new AbortController();
    this.activeControllers.set(taskId, controller);

    const completedPartNumbers = new Set(persisted.completedParts.map((p) => p.partNumber));
    const alreadyUploadedBytes = persisted.completedParts.reduce((acc, p) => acc + p.size, 0);

    const task: UploadTask = {
      id: taskId,
      uploadId,
      objectKey: persisted.objectKey,
      file,
      filename: file.name,
      fileSize: file.size,
      partSize: persisted.partSize,
      totalParts: persisted.totalParts,
      status: 'uploading',
      progress: {
        uploadedBytes: alreadyUploadedBytes,
        totalBytes: file.size,
        percentage: Math.round((alreadyUploadedBytes / file.size) * 100),
        speedBytesPerSec: 0,
        currentPart: completedPartNumbers.size,
        totalParts: persisted.totalParts,
      },
      createdAt: Date.now(),
    };

    this.notify(task);
    await markUploadStatus(uploadId, 'uploading');

    try {
      await this.runChunkUploads(task, controller.signal, persisted.completedParts);
    } catch (err: any) {
      if (controller.signal.aborted) {
        task.status = 'aborted';
        task.error = 'Upload was cancelled';
      } else {
        task.status = 'error';
        task.error = err.message || 'Resume failed';
      }
      this.notify(task);
    } finally {
      this.activeControllers.delete(taskId);
    }

    return taskId;
  }

  private async runChunkUploads(
    task: UploadTask,
    signal: AbortSignal,
    existingParts: PersistedUploadPart[]
  ): Promise<void> {
    const { uploadId, objectKey, file, partSize = 64 * 1024 * 1024, totalParts = 1 } = task;
    if (!uploadId || !objectKey) {
      throw new Error('Missing uploadId or objectKey');
    }

    const completedMap = new Map<number, PersistedUploadPart>();
    existingParts.forEach((p) => completedMap.set(p.partNumber, p));

    // Determine pending part numbers
    const pendingPartNumbers: number[] = [];
    for (let p = 1; p <= totalParts; p++) {
      if (!completedMap.has(p)) {
        pendingPartNumbers.push(p);
      }
    }

    // Pre-fetch presigned part URLs in batches
    const urlMap = new Map<number, string>();
    const fetchBatchUrls = async (partNums: number[]) => {
      if (partNums.length === 0) return;
      const partUrlItems = await api.getR2PartUrls(uploadId, objectKey, partNums);
      partUrlItems.forEach((item) => urlMap.set(item.partNumber, item.url));
    };

    await fetchBatchUrls(pendingPartNumbers);

    // Speed tracking
    let lastTrackTime = Date.now();
    let bytesSinceLastTrack = 0;

    const updateSpeed = (additionalBytes: number) => {
      bytesSinceLastTrack += additionalBytes;
      const now = Date.now();
      const elapsedSec = (now - lastTrackTime) / 1000;
      if (elapsedSec >= 0.5) {
        const speed = bytesSinceLastTrack / elapsedSec;
        task.progress.speedBytesPerSec = Math.round(speed);
        lastTrackTime = now;
        bytesSinceLastTrack = 0;
      }
    };

    // Worker pool for bounded concurrency
    let currentIdx = 0;
    const worker = async () => {
      while (currentIdx < pendingPartNumbers.length) {
        if (signal.aborted) {
          throw new Error('Upload aborted by user');
        }

        const partNum = pendingPartNumbers[currentIdx++];
        const start = (partNum - 1) * partSize;
        const end = Math.min(file.size, partNum * partSize);
        const chunk = file.slice(start, end);
        const chunkSize = end - start;

        const presignedUrl = urlMap.get(partNum);
        if (!presignedUrl) {
          throw new Error(`Missing presigned URL for part ${partNum}`);
        }

        const etag = await this.uploadPartWithRetry(
          presignedUrl,
          chunk,
          partNum,
          signal
        );

        const completedPart: PersistedUploadPart = {
          partNumber: partNum,
          etag,
          size: chunkSize,
        };
        completedMap.set(partNum, completedPart);
        await addCompletedPart(uploadId, completedPart);

        // Update progress
        updateSpeed(chunkSize);
        const totalUploaded = Array.from(completedMap.values()).reduce((acc, p) => acc + p.size, 0);
        task.progress.uploadedBytes = totalUploaded;
        task.progress.percentage = Math.min(100, Math.round((totalUploaded / file.size) * 100));
        task.progress.currentPart = completedMap.size;
        this.notify(task);
      }
    };

    const workers = [];
    const poolSize = Math.min(CONCURRENCY, pendingPartNumbers.length || 1);
    for (let i = 0; i < poolSize; i++) {
      workers.push(worker());
    }

    await Promise.all(workers);

    // 4. Complete multipart upload
    task.status = 'completing';
    this.notify(task);

    const orderedParts: R2PartETag[] = [];
    for (let p = 1; p <= totalParts; p++) {
      const part = completedMap.get(p);
      if (!part) {
        throw new Error(`Missing part ${p} before completion`);
      }
      orderedParts.push({ partNumber: p, etag: part.etag });
    }

    await api.completeR2Upload(uploadId, objectKey, orderedParts);
    await removeUpload(uploadId);

    task.status = 'completed';
    task.progress.percentage = 100;
    task.progress.uploadedBytes = file.size;
    task.progress.speedBytesPerSec = 0;
    this.notify(task);
  }

  private async uploadPartWithRetry(
    url: string,
    chunk: Blob,
    partNumber: number,
    signal: AbortSignal
  ): Promise<string> {
    let attempt = 0;
    while (attempt <= MAX_RETRIES) {
      if (signal.aborted) {
        throw new Error('Upload aborted by user');
      }

      try {
        const res = await fetch(url, {
          method: 'PUT',
          body: chunk,
          headers: {
            'Content-Type': 'application/octet-stream',
          },
          signal,
        });

        if (!res.ok) {
          throw new Error(`Part ${partNumber} upload returned HTTP ${res.status}`);
        }

        const rawEtag = res.headers.get('ETag') || res.headers.get('etag');
        if (!rawEtag) {
          // If ETag is null, check if Cloudflare R2 CORS exposes the ETag header
          throw new Error(
            `Part ${partNumber} uploaded but ETag response header was not exposed. Check R2 CORS ExposeHeaders.`
          );
        }

        return rawEtag.replace(/^"|"$/g, '').trim();
      } catch (err: any) {
        if (signal.aborted) {
          throw err;
        }

        attempt++;
        if (attempt > MAX_RETRIES) {
          throw new Error(
            `Failed uploading part ${partNumber} after ${MAX_RETRIES} retries: ${err.message}`
          );
        }

        // Exponential backoff
        const delay = Math.min(1000 * Math.pow(2, attempt) + Math.random() * 500, 8000);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw new Error(`Exhausted retries for part ${partNumber}`);
  }

  public async abortUpload(taskIdOrUploadId: string): Promise<void> {
    const controller = this.activeControllers.get(taskIdOrUploadId);
    if (controller) {
      controller.abort();
    }

    const task = this.tasks.get(taskIdOrUploadId);
    const uploadId = task?.uploadId || taskIdOrUploadId;
    const objectKey = task?.objectKey;

    if (uploadId) {
      try {
        await api.abortR2Upload(uploadId, objectKey);
      } catch (err) {
        console.warn('Failed server abort:', err);
      }
      await removeUpload(uploadId);
    }

    if (task) {
      task.status = 'aborted';
      task.error = 'Upload cancelled by user';
      this.notify(task);
    }
  }
}

export const r2UploadManager = new R2UploadManager();
