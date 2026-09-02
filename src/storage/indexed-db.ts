/**
 * IndexedDB persistence for download tasks and chunk blobs.
 *
 * Why IndexedDB (and not chrome.storage.local):
 *  - chrome.storage has small per-item quotas and is meant for settings,
 *    not multi-hundred-MB binary chunks.
 *  - IndexedDB stores Blob values efficiently (file-backed in Chrome), so
 *    completed chunks do NOT consume service-worker memory.
 *  - MV3 service workers can be killed at any time; every task's chunk
 *    state and completed chunk data must survive that. On wake, the queue
 *    manager resumes tasks purely from what is persisted here.
 *
 * Schema (DB "smd", version 1):
 *  - tasks: keyPath "id"        → DownloadTask records
 *  - chunks: keyPath "key"      → { key: `${taskId}:${index}`, blob }
 */

import type { ChunkState, DownloadTask } from '../types';

const DB_NAME = 'smd';
const DB_VERSION = 1;
const TASKS_STORE = 'tasks';
const CHUNKS_STORE = 'chunks';

let dbPromise: Promise<IDBDatabase> | null = null;

/** Open (and upgrade) the database. Cached singleton per SW lifetime. */
export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(TASKS_STORE)) {
        db.createObjectStore(TASKS_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(CHUNKS_STORE)) {
        db.createObjectStore(CHUNKS_STORE, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
  });
  return dbPromise;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  const tx = db.transaction(storeName, mode);
  return requestToPromise(fn(tx.objectStore(storeName)));
}

// --- Tasks -----------------------------------------------------------------

export async function getAllTasks(): Promise<DownloadTask[]> {
  const tasks = await withStore(TASKS_STORE, 'readonly', (s) => s.getAll());
  return (tasks as DownloadTask[]).sort((a, b) => a.createdAt - b.createdAt);
}

export async function getTask(id: string): Promise<DownloadTask | undefined> {
  const task = await withStore(TASKS_STORE, 'readonly', (s) => s.get(id));
  return task as DownloadTask | undefined;
}

export async function putTask(task: DownloadTask): Promise<void> {
  await withStore(TASKS_STORE, 'readwrite', (s) => s.put(task));
}

export async function deleteTaskRecord(id: string): Promise<void> {
  await withStore(TASKS_STORE, 'readwrite', (s) => s.delete(id));
}

// --- Chunk blobs -----------------------------------------------------------

export async function putChunkBlob(
  taskId: string,
  index: number,
  blob: Blob,
): Promise<void> {
  const key = `${taskId}:${index}`;
  await withStore(CHUNKS_STORE, 'readwrite', (s) => s.put({ key, blob }));
}

export async function getChunkBlob(
  taskId: string,
  index: number,
): Promise<Blob | undefined> {
  const key = `${taskId}:${index}`;
  const record = (await withStore(CHUNKS_STORE, 'readonly', (s) => s.get(key))) as
    | { key: string; blob: Blob }
    | undefined;
  return record?.blob;
}

export async function deleteChunkBlobs(
  taskId: string,
  chunkCount: number,
): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(CHUNKS_STORE, 'readwrite');
  const store = tx.objectStore(CHUNKS_STORE);
  for (let i = 0; i < chunkCount; i++) {
    store.delete(`${taskId}:${i}`);
  }
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB tx failed'));
  });
}

// --- Maintenance -----------------------------------------------------------

/**
 * Recover tasks whose state says "active" but whose run was lost when the
 * service worker was killed (no in-flight controller). Called on SW startup:
 * such tasks are moved back to "queued" so the queue resumes them, keeping
 * their downloaded chunk bytes.
 */
export async function requeueOrphanedActiveTasks(
  tasks: DownloadTask[],
): Promise<void> {
  for (const task of tasks) {
    if (task.state !== 'active') continue;
    const hasLiveRun = (globalThis as {
      __smdActiveRuns?: Map<string, unknown>;
    }).__smdActiveRuns?.has(task.id);
    if (!hasLiveRun) {
      task.state = 'queued';
      // Chunks marked "active" at kill time are restartable from their
      // bytesDownloaded offset only if we track partial data; partial chunk
      // bytes are NOT persisted (only complete chunks), so reset active
      // chunks to pending.
      task.chunks = task.chunks.map(
        (chunk: ChunkState): ChunkState =>
          chunk.status === 'active'
            ? { ...chunk, status: 'pending', bytesDownloaded: 0 }
            : chunk,
      );
      await putTask(task);
    }
  }
}
