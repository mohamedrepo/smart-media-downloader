/**
 * Multi-connection download engine for authorized direct files.
 *
 * Protocol:
 *  1. Probe the URL (HEAD, falling back to a 1-byte ranged GET) to learn
 *     Content-Length, Accept-Ranges, and Content-Type.
 *  2. If the server supports byte ranges, split the file into chunks and
 *     download them concurrently (worker-pool over the chunk list).
 *     Each completed chunk is persisted to IndexedDB as a file-backed Blob.
 *  3. If ranges are unsupported, stream the whole body once as a single
 *     blob-backed download (still never fully held in RAM).
 *
 * Concurrency is bounded by the connection count. Failed chunks retry with
 * exponential backoff up to the task's max retries. All state changes are
 * reported through callbacks so the queue manager can persist them — the
 * engine itself holds no authoritative state, which is what makes the task
 * resumable after the MV3 service worker is killed and restarted.
 */

import type { ChunkState, DownloadTask } from '../types';
import { putChunkBlob } from '../storage/indexed-db';
import { Logger } from '../utils/logger';
import { toDownloadError } from './engine-logic';

const log = new Logger('engine');

export interface ProbeOutcome {
  totalBytes?: number;
  acceptsRanges: boolean;
  contentType?: string;
  /** Use single-stream fallback instead of range chunking. */
  useFallback: boolean;
}

export interface EngineOptions {
  /** Per-request timeout in milliseconds. */
  timeoutMs: number;
  /** Max retries per chunk before the task fails. */
  maxRetries: number;
}

export interface EngineCallbacks {
  onChunkUpdate: (chunk: ChunkState) => Promise<void> | void;
  onProgress: (bytesDelta: number) => void;
  onError: (message: string, retryable: boolean) => Promise<void> | void;
}

interface FetchChunkArgs {
  url: string;
  chunk: ChunkState;
  timeoutMs: number;
  maxRetries: number;
  signal: AbortSignal;
  onProgress: EngineCallbacks['onProgress'];
}

/**
 * Probe a URL with HEAD; when HEAD is rejected (some CDNs 403/405 it),
 * fall back to a 1-byte ranged GET which also reveals Accept-Ranges.
 */
export async function probeUrl(url: string, timeoutMs: number): Promise<ProbeOutcome> {
  const head = await probeOnce(url, timeoutMs, 'HEAD');
  if (head.ok) return head.outcome;
  const rangedGet = await probeOnce(url, timeoutMs, 'GET', 'bytes=0-0');
  if (rangedGet.ok) {
    const outcome = rangedGet.outcome;
    // A 206 response to bytes=0-0 proves range support; a 200 means the
    // server ignored the Range header → no range support.
    if (rangedGet.status === 206) outcome.acceptsRanges = true;
    else outcome.acceptsRanges = false;
    return outcome;
  }
  throw new Error(head.errorMessage ?? rangedGet.errorMessage ?? 'Unable to reach the media URL.');
}

async function probeOnce(
  url: string,
  timeoutMs: number,
  method: 'HEAD' | 'GET',
  range?: string,
): Promise<{ ok: boolean; status?: number; errorMessage?: string; outcome: ProbeOutcome }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = {};
    if (range) headers.Range = range;
    const res = await fetch(url, { method, headers, signal: controller.signal });
    const acceptsRangesHeader = res.headers.get('Accept-Ranges') ?? '';
    const contentLengthHeader = res.headers.get('Content-Length');
    const contentRange = res.headers.get('Content-Range');
    let totalBytes: number | undefined;
    if (method === 'GET' && range && res.status === 206 && contentRange) {
      const m = /bytes \d+-\d+\/(\d+)/.exec(contentRange);
      if (m) totalBytes = Number(m[1]);
    } else if (contentLengthHeader !== null) {
      totalBytes = Number(contentLengthHeader);
      if (!Number.isFinite(totalBytes) || totalBytes < 0) totalBytes = undefined;
    }
    return {
      ok: true,
      status: res.status,
      outcome: {
        totalBytes,
        acceptsRanges: acceptsRangesHeader.toLowerCase().includes('bytes'),
        contentType: res.headers.get('Content-Type') ?? undefined,
        useFallback: false,
      },
    };
  } catch (err) {
    return {
      ok: false,
      errorMessage: err instanceof Error ? err.message : String(err),
      outcome: { acceptsRanges: false, useFallback: false },
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Download one byte range with retries and per-chunk progress.
 * Returns when the full chunk is persisted to IndexedDB.
 */
export async function downloadChunk(args: FetchChunkArgs): Promise<void> {
  const { url, chunk, timeoutMs, maxRetries, signal, onProgress } = args;
  let attempt = 0;
  // Chunks already partially downloaded in a previous session cannot be
  // resumed byte-precisely (partial bytes aren't persisted), so the whole
  // chunk restarts. Completed chunks never re-enter the queue.
  for (;;) {
    attempt++;
    try {
      const end = chunk.endByte;
      const start = chunk.startByte;
      const controller = new AbortController();
      const onAbort = (): void => controller.abort();
      signal.addEventListener('abort', onAbort, { once: true });
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(url, {
          headers: { Range: `bytes=${start}-${end}` },
          signal: controller.signal,
        });
        if (!res.ok && res.status !== 206) {
          const err = toDownloadError(res.status, res.headers.get('Retry-After'));
          throw new EngineError(err.message, err.retryable, err.statusCode);
        }
        if (!res.body) throw new EngineError('Empty response body.', true);
        const blob = await readBodyWithProgress(res, chunk, onProgress);
        await putChunkBlob(extractTaskId(chunk), chunk.index, blob);
        return;
      } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
      }
    } catch (err) {
      if (signal.aborted) throw err; // cancellation — propagate
      const retryable = !(err instanceof EngineError) || err.retryable;
      if (!retryable || attempt > maxRetries) {
        throw err instanceof Error ? err : new Error(String(err));
      }
      const delay = backoffDelay(attempt);
      log.warn(`chunk ${chunk.index} failed (attempt ${attempt}), retrying in ${delay}ms`, err);
      await sleep(delay, signal);
    }
  }
}

/** EngineError marks retryability explicitly. */
export class EngineError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'EngineError';
  }
}

async function readBodyWithProgress(
  res: Response,
  chunk: ChunkState,
  onProgress: EngineCallbacks['onProgress'],
): Promise<Blob> {
  const reader = res.body!.getReader();
  const parts: BlobPart[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      parts.push(value as unknown as BlobPart);
      received += value.byteLength;
      chunk.bytesDownloaded = received;
      onProgress(value.byteLength);
    }
  }
  const expected = chunk.endByte - chunk.startByte + 1;
  if (expected > 0 && received !== expected) {
    throw new EngineError(
      `Incomplete chunk: received ${received} of ${expected} bytes.`,
      true,
    );
  }
  return new Blob(parts);
}

function extractTaskId(chunk: ChunkState): string {
  // Task id is attached by the engine via the chunks' parent task; we pass
  // it through a WeakMap side-channel instead of polluting ChunkState.
  const id = chunkTaskIds.get(chunk);
  if (!id) throw new Error('chunk is not bound to a task');
  return id;
}

const chunkTaskIds = new WeakMap<ChunkState, string>();

export function bindChunkToTask(chunk: ChunkState, taskId: string): void {
  chunkTaskIds.set(chunk, taskId);
}

function backoffDelay(attempt: number): number {
  const base = Math.min(60_000, 1000 * 2 ** (attempt - 1));
  return Math.round(base * (0.8 + 0.4 * Math.random()));
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Run all pending/failed-restartable chunks of a task with a bounded worker
 * pool, then resolve. Rejects if any chunk exhausts its retries.
 */
export async function runTaskChunks(
  task: DownloadTask,
  callbacks: EngineCallbacks,
  signal: AbortSignal,
  options: EngineOptions,
): Promise<void> {
  const retryableChunks = task.chunks.filter(
    (c) => c.status === 'pending' || c.status === 'failed',
  );
  for (const c of retryableChunks) bindChunkToTask(c, task.id);

  let nextIndex = 0;
  const workerCount = Math.min(task.connections, retryableChunks.length);
  const workers: Promise<void>[] = [];

  const worker = async (): Promise<void> => {
    for (;;) {
      const chunk = retryableChunks[nextIndex++];
      if (!chunk) return;
      chunk.status = 'active';
      await callbacks.onChunkUpdate(chunk);
      try {
        await downloadChunk({
          url: task.url,
          chunk,
          timeoutMs: options.timeoutMs,
          maxRetries: options.maxRetries,
          signal,
          onProgress: callbacks.onProgress,
        });
        chunk.status = 'done';
        chunk.bytesDownloaded = chunk.endByte - chunk.startByte + 1;
        await callbacks.onChunkUpdate(chunk);
      } catch (err) {
        if (signal.aborted) return;
        chunk.status = 'failed';
        chunk.lastError = err instanceof Error ? err.message : String(err);
        await callbacks.onChunkUpdate(chunk);
        await callbacks.onError(chunk.lastError, true);
        throw err;
      }
    }
  };

  for (let i = 0; i < workerCount; i++) {
    workers.push(worker());
  }
  await Promise.all(workers);
}
