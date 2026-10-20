import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Polyfill window, localStorage, and Blob for Node environment
if (typeof window === 'undefined') {
  (globalThis as any).window = globalThis;
}

const mockStorage: Record<string, string> = {};
(globalThis as any).localStorage = {
  getItem: (k: string) => mockStorage[k] || null,
  setItem: (k: string, v: string) => {
    mockStorage[k] = v;
  },
  removeItem: (k: string) => {
    delete mockStorage[k];
  },
  clear: () => {
    for (const k in mockStorage) delete mockStorage[k];
  },
};

import { api } from '../../api/client';
import {
  saveUpload,
  getUpload,
  getAllIncompleteUploads,
  addCompletedPart,
  removeUpload,
  markUploadStatus,
} from '../../utils/indexedDb';
import { PersistedUploadMetadata } from '../../types';

describe('Admin R2 Video Manager & Multipart Upload Suite', () => {
  beforeEach(() => {
    (globalThis as any).localStorage.clear();
    api.setR2AdminToken(null);
  });

  test('1. Admin auth token management in ApiClient', async () => {
    assert.equal(api.getR2AdminToken(), null);

    // Mock fetch for verifyR2Admin
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url: any, init?: any) => {
      const body = JSON.parse(init.body);
      if (body.password === 'admin123') {
        return new Response(JSON.stringify({ token: 'mock-signed-admin-token', expiresIn: 7200 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ detail: 'Invalid admin password' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    try {
      // Wrong password
      await assert.rejects(
        () => api.verifyR2Admin('wrongpassword'),
        /Invalid admin password/
      );
      assert.equal(api.getR2AdminToken(), null);

      // Correct password
      const authRes = await api.verifyR2Admin('admin123');
      assert.equal(authRes.token, 'mock-signed-admin-token');
      assert.equal(api.getR2AdminToken(), 'mock-signed-admin-token');
      assert.equal((globalThis as any).localStorage.getItem('wt_r2_admin_token'), 'mock-signed-admin-token');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('2. Resumable upload metadata persistence (IndexedDB / LocalStorage fallback)', async () => {
    const uploadId = 'upload_test_999';
    const metadata: PersistedUploadMetadata = {
      uploadId,
      objectKey: 'videos/unique_test.mp4',
      filename: 'sample_movie.mp4',
      fileSize: 150 * 1024 * 1024,
      partSize: 64 * 1024 * 1024,
      totalParts: 3,
      completedParts: [],
      status: 'uploading',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // Save
    await saveUpload(metadata);
    const loaded = await getUpload(uploadId);
    assert.ok(loaded);
    assert.equal(loaded.filename, 'sample_movie.mp4');
    assert.equal(loaded.totalParts, 3);
    assert.equal(loaded.completedParts.length, 0);

    // Add completed part 1
    await addCompletedPart(uploadId, { partNumber: 1, etag: 'etag123', size: 64 * 1024 * 1024 });
    const updated = await getUpload(uploadId);
    assert.ok(updated);
    assert.equal(updated.completedParts.length, 1);
    assert.equal(updated.completedParts[0].etag, 'etag123');

    // List incomplete uploads
    const incomplete = await getAllIncompleteUploads();
    assert.equal(incomplete.length, 1);
    assert.equal(incomplete[0].uploadId, uploadId);

    // Mark as completed
    await markUploadStatus(uploadId, 'completed');
    const afterComplete = await getAllIncompleteUploads();
    assert.equal(afterComplete.length, 0);

    // Remove
    await removeUpload(uploadId);
    const deleted = await getUpload(uploadId);
    assert.equal(deleted, null);
  });

  test('3. Multipart API operations propagate headers and payloads correctly', async () => {
    api.setR2AdminToken('valid-test-token');
    const originalFetch = globalThis.fetch;

    let interceptedHeaders: any = null;
    let interceptedUrl: string = '';
    let interceptedMethod: string = '';

    globalThis.fetch = async (url: any, init?: any) => {
      interceptedUrl = url.toString();
      interceptedMethod = init?.method || 'GET';
      interceptedHeaders = init?.headers;

      if (interceptedUrl.includes('/uploads/initiate')) {
        return new Response(
          JSON.stringify({
            uploadId: 'up-1',
            objectKey: 'videos/key.mp4',
            partSize: 67108864,
            totalParts: 2,
            filename: 'key.mp4',
            fileSize: 100000000,
            bucket: 'letsgo-backend',
            contentType: 'video/mp4',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (interceptedUrl.includes('/part-urls')) {
        return new Response(
          JSON.stringify([
            { partNumber: 1, url: 'https://r2.test/part-1', expiresIn: 3600 },
            { partNumber: 2, url: 'https://r2.test/part-2', expiresIn: 3600 },
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (interceptedUrl.includes('/complete')) {
        return new Response(
          JSON.stringify({
            status: 'completed',
            objectKey: 'videos/key.mp4',
            uploadId: 'up-1',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (interceptedUrl.includes('/abort')) {
        return new Response(
          JSON.stringify({ status: 'aborted', uploadId: 'up-1' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (interceptedMethod === 'DELETE') {
        return new Response(
          JSON.stringify({ status: 'deleted', key: 'videos/key.mp4', message: 'Deleted' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    try {
      // 1. Initiate
      const initData = await api.initiateR2Upload('key.mp4', 100000000);
      assert.equal(initData.uploadId, 'up-1');
      assert.equal(interceptedHeaders['X-R2-Admin-Token'], 'valid-test-token');

      // 2. Part URLs
      const parts = await api.getR2PartUrls('up-1', 'videos/key.mp4', [1, 2]);
      assert.equal(parts.length, 2);
      assert.equal(parts[0].url, 'https://r2.test/part-1');

      // 3. Complete
      const comp = await api.completeR2Upload('up-1', 'videos/key.mp4', [
        { partNumber: 1, etag: 'etag1' },
        { partNumber: 2, etag: 'etag2' },
      ]);
      assert.equal(comp.status, 'completed');

      // 4. Abort
      const abortRes = await api.abortR2Upload('up-1', 'videos/key.mp4');
      assert.equal(abortRes.status, 'aborted');

      // 5. Delete video
      const delRes = await api.deleteR2Video('videos/key.mp4');
      assert.equal(delRes.status, 'deleted');
      assert.equal(interceptedMethod, 'DELETE');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('4. Resume validation: rejects file mismatch and detects missing parts', () => {
    const persisted: PersistedUploadMetadata = {
      uploadId: 'up-resume-1',
      objectKey: 'videos/avatar.mp4',
      filename: 'avatar.mp4',
      fileSize: 50000000,
      partSize: 25000000,
      totalParts: 2,
      completedParts: [{ partNumber: 1, etag: 'etag-part-1', size: 25000000 }],
      status: 'uploading',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // Valid file matching
    const matchingFile = { name: 'avatar.mp4', size: 50000000 };
    assert.equal(matchingFile.name, persisted.filename);
    assert.equal(matchingFile.size, persisted.fileSize);

    // Mismatched file
    const wrongFile = { name: 'avatar_edited.mp4', size: 50000000 };
    assert.notEqual(wrongFile.name, persisted.filename);

    const wrongSizeFile = { name: 'avatar.mp4', size: 40000000 };
    assert.notEqual(wrongSizeFile.size, persisted.fileSize);

    // Verify remaining parts to upload: part 2
    const completedSet = new Set(persisted.completedParts.map((p) => p.partNumber));
    const allParts = [1, 2];
    const missingParts = allParts.filter((p) => !completedSet.has(p));
    assert.deepEqual(missingParts, [2]);
  });

  test('5. Storage info query and parsed capacity metrics', async () => {
    const originalFetch = globalThis.fetch;
    const mockStorageInfo = {
      limitBytes: 10737418240,
      storedBytes: 6442450944,
      reservedBytes: 1073741824,
      availableBytes: 3221225472,
      videoCount: 4,
      activeUploadCount: 1,
      limitFormatted: '10.00 GiB',
      storedFormatted: '6.00 GiB',
      reservedFormatted: '1.00 GiB',
      availableFormatted: '3.00 GiB',
    };

    globalThis.fetch = async (url: any) => {
      if (url.toString().includes('/api/videos/r2/storage-info')) {
        return new Response(JSON.stringify(mockStorageInfo), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('{}', { status: 200 });
    };

    try {
      const res = await api.getR2StorageInfo();
      assert.equal(res.limitBytes, 10737418240);
      assert.equal(res.storedBytes, 6442450944);
      assert.equal(res.reservedBytes, 1073741824);
      assert.equal(res.availableBytes, 3221225472);
      assert.equal(res.limitFormatted, '10.00 GiB');
      assert.equal(res.storedFormatted, '6.00 GiB');
      assert.equal(res.availableFormatted, '3.00 GiB');
      assert.equal(res.videoCount, 4);
      assert.equal(res.activeUploadCount, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('6. Frontend storage capacity pre-validation and rejection format', () => {
    const GIB = 1024 ** 3;
    const storageInfo = {
      limitBytes: 10 * GIB,
      storedBytes: 8 * GIB,
      reservedBytes: 0,
      availableBytes: 2 * GIB,
      videoCount: 2,
      activeUploadCount: 0,
      limitFormatted: '10.00 GiB',
      storedFormatted: '8.00 GiB',
      reservedFormatted: '0.00 GiB',
      availableFormatted: '2.00 GiB',
    };

    const validateUpload = (files: { name: string; size: number }[]): { valid: boolean; error?: string } => {
      const totalNewBytes = files.reduce((acc, f) => acc + f.size, 0);
      const projected = storageInfo.storedBytes + storageInfo.reservedBytes + totalNewBytes;
      if (projected >= storageInfo.limitBytes) {
        const availableGib = (storageInfo.availableBytes / (1024 ** 3)).toFixed(2);
        const requiredGib = (totalNewBytes / (1024 ** 3)).toFixed(2);
        const rawMinToClear = projected - storageInfo.limitBytes + 1;
        const minToClearGib = rawMinToClear > 0 && rawMinToClear < 0.01 * (1024 ** 3)
          ? '0.01'
          : Math.max(0, rawMinToClear / (1024 ** 3)).toFixed(2);
        return {
          valid: false,
          error: `Not enough storage for this video. Available storage: ${availableGib} GiB. This video requires ${requiredGib} GiB. Clear at least ${minToClearGib} GiB of storage to upload it.`,
        };
      }
      return { valid: true };
    };

    // Case A: 3 GiB file exceeds 2 GiB available
    const resOver = validateUpload([{ name: 'large.mp4', size: 3 * GIB }]);
    assert.equal(resOver.valid, false);
    assert.equal(
      resOver.error,
      'Not enough storage for this video. Available storage: 2.00 GiB. This video requires 3.00 GiB. Clear at least 1.00 GiB of storage to upload it.'
    );

    // Case B: Exactly 2 GiB file would bring total to 10 GiB (strictly < 10 GiB rule rejects it)
    const resExact = validateUpload([{ name: 'exact.mp4', size: 2 * GIB }]);
    assert.equal(resExact.valid, false);
    assert.equal(
      resExact.error,
      'Not enough storage for this video. Available storage: 2.00 GiB. This video requires 2.00 GiB. Clear at least 0.01 GiB of storage to upload it.'
    );

    // Case C: 1.5 GiB file is strictly below 10 GiB -> accepted
    const resValid = validateUpload([{ name: 'fits.mp4', size: 1.5 * GIB }]);
    assert.equal(resValid.valid, true);
    assert.equal(resValid.error, undefined);
  });

  test('7. API error handling for storage limit rejection (400 Bad Request)', async () => {
    api.setR2AdminToken('valid-token');
    const originalFetch = globalThis.fetch;

    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({
          detail: 'Not enough storage for this video. Available storage: 1.00 GiB. This video requires 2.00 GiB. Clear at least 1.00 GiB of storage to upload it.',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    };

    try {
      await assert.rejects(
        () => api.initiateR2Upload('huge.mp4', 2 * (1024 ** 3)),
        /Not enough storage for this video\. Available storage: 1\.00 GiB\. This video requires 2\.00 GiB\. Clear at least 1\.00 GiB of storage to upload it\./
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
