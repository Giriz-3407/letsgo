import { PersistedUploadMetadata, PersistedUploadPart } from '../types';

const DB_NAME = 'WatchTogetherR2UploadsDB';
const DB_VERSION = 1;
const STORE_NAME = 'uploads';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB is not available'));
      return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'uploadId' });
        store.createIndex('filename', 'filename', { unique: false });
        store.createIndex('status', 'status', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// LocalStorage fallback in case IndexedDB is restricted or disabled
const LOCALSTORAGE_KEY = 'wt_r2_incomplete_uploads_v1';

function getLocalStorageFallback(): Record<string, PersistedUploadMetadata> {
  try {
    const raw = localStorage.getItem(LOCALSTORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveLocalStorageFallback(data: Record<string, PersistedUploadMetadata>): void {
  try {
    localStorage.setItem(LOCALSTORAGE_KEY, JSON.stringify(data));
  } catch {
    // Ignore quota errors
  }
}

export async function saveUpload(meta: PersistedUploadMetadata): Promise<void> {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(meta);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    const fallback = getLocalStorageFallback();
    fallback[meta.uploadId] = meta;
    saveLocalStorageFallback(fallback);
  }
}

export async function getUpload(uploadId: string): Promise<PersistedUploadMetadata | null> {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(uploadId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    const fallback = getLocalStorageFallback();
    return fallback[uploadId] || null;
  }
}

export async function getAllIncompleteUploads(): Promise<PersistedUploadMetadata[]> {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const results: PersistedUploadMetadata[] = req.result || [];
        resolve(results.filter((item) => item.status === 'uploading' || item.status === 'paused'));
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    const fallback = getLocalStorageFallback();
    return Object.values(fallback).filter(
      (item) => item.status === 'uploading' || item.status === 'paused'
    );
  }
}

export async function addCompletedPart(
  uploadId: string,
  part: PersistedUploadPart
): Promise<void> {
  const meta = await getUpload(uploadId);
  if (!meta) return;

  const existingIdx = meta.completedParts.findIndex((p) => p.partNumber === part.partNumber);
  if (existingIdx >= 0) {
    meta.completedParts[existingIdx] = part;
  } else {
    meta.completedParts.push(part);
  }
  meta.updatedAt = Date.now();
  await saveUpload(meta);
}

export async function markUploadStatus(
  uploadId: string,
  status: 'uploading' | 'completed' | 'aborted' | 'paused'
): Promise<void> {
  const meta = await getUpload(uploadId);
  if (!meta) return;
  meta.status = status;
  meta.updatedAt = Date.now();
  await saveUpload(meta);
}

export async function removeUpload(uploadId: string): Promise<void> {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(uploadId);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    const fallback = getLocalStorageFallback();
    delete fallback[uploadId];
    saveLocalStorageFallback(fallback);
  }
}
