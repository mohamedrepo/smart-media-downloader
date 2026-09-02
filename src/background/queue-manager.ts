/**
 * Download queue manager.
 *
 * Owns the full task lifecycle: queued → active → completed/failed, with
 * pause/resume/cancel/retry/remove/reorder. Responsibilities:
 *
 *  - Persistence: every state change is written to IndexedDB BEFORE the
 *    broadcast, so a killed service worker never loses ground.
 *  - Concurrency: at most `maxSimultaneousDownloads` tasks run; the rest
 *    wait in "queued". Ticks are triggered on enqueue/finish/pause/etc.
 *  - Resume-after-kill: on startup, tasks stuck in "active" with no live
 *    run are re-queued; completed chunks are kept, partial chunks restart.
 *  - Broadcasts: QUEUE_UPDATED (full snapshot) and PROGRESS_UPDATE
 *    (throttled per-task ticks) are sent to all extension pages.
 *
 * The manager holds AbortControllers only for live runs; correctness never
 * depends on memory state.
 */

import type { DownloadProgress, DownloadTask } from '../types';
import {
  deleteChunkBlobs,
  deleteTaskRecord,
  getAllTasks,
  getTask,
  putTask,
  requeueOrphanedActiveTasks,
} from '../storage/indexed-db';
import { EngineError, probeUrl, runTaskChunks } from '../downloads/download-engine';
import { mergeAndDownload, streamAndDownload } from '../downloads/merge-manager';
import { planChunks, smoothSpeed } from '../downloads/engine-logic';
import { Logger } from '../utils/logger';
import type { AppSettings } from '../types';

const log = new Logger('queue');
const PROGRESS_BROADCAST_MS = 500;

export interface EnqueueSpec {
  url: string;
  filename: string;
  folder: string;
  totalBytes?: number;
  acceptsRanges: boolean;
  connections: number;
  chunkSizeMB: number;
  maxRetries: number;
  timeoutMs: number;
  subtitleLanguages: string[];
  subtitleFormat: DownloadTask['subtitleFormat'];
}

export class QueueManager {
  private running = new Map<string, AbortController>();
  private lastBroadcast = new Map<string, number>();
  private speedAccum = new Map<string, { bytes: number; since: number; speed: number }>();
  private maxSimultaneous = 2;
  private overwriteExisting = false;
  private started = false;

  async init(settings: AppSettings): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.applySettings(settings);
    const tasks = await getAllTasks();
    await requeueOrphanedActiveTasks(tasks);
    // Register live-run registry for the orphan detector (module-global so
    // requeueOrphanedActiveTasks can check it without circular imports).
    (globalThis as { __smdActiveRuns?: Map<string, AbortController> }).__smdActiveRuns =
      this.running;
    await this.tick();
    void this.broadcast();
  }

  applySettings(settings: AppSettings): void {
    this.maxSimultaneous = Math.max(1, Math.min(5, settings.maxSimultaneousDownloads));
    this.overwriteExisting = settings.overwriteExisting;
  }

  // --- Lifecycle ------------------------------------------------------------

  async enqueue(spec: EnqueueSpec): Promise<DownloadTask> {
    const chunks = spec.acceptsRanges
      ? planChunks(spec.totalBytes ?? 0, spec.connections, spec.chunkSizeMB)
      : [];
    const task: DownloadTask = {
      id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      url: spec.url,
      filename: spec.filename,
      folder: spec.folder,
      totalBytes: spec.totalBytes,
      acceptsRanges: spec.acceptsRanges,
      state: 'queued',
      connections: spec.connections,
      chunks,
      bytesDownloaded: 0,
      speedBps: 0,
      averageSpeedBps: 0,
      retryCount: 0,
      subtitleLanguages: spec.subtitleLanguages,
      subtitleFormat: spec.subtitleFormat,
      createdAt: Date.now(),
    };
    await putTask(task);
    log.info('enqueued', task.filename, `${spec.totalBytes ?? '?'} bytes`);
    void this.tick();
    void this.broadcast();
    return task;
  }

  async pause(taskId: string): Promise<void> {
    const task = await getTask(taskId);
    if (!task) return;
    if (task.state === 'queued') {
      task.state = 'paused';
      await putTask(task);
    } else if (task.state === 'active') {
      this.running.get(taskId)?.abort();
      // Chunk bookkeeping happens in runTask's finally block.
    }
    await this.broadcast();
  }

  async resume(taskId: string): Promise<void> {
    const task = await getTask(taskId);
    if (!task || task.state !== 'paused') return;
    task.state = 'queued';
    // Active chunks were aborted mid-flight; their partial bytes are not
    // persisted, so they restart.
    task.chunks = task.chunks.map((c) =>
      c.status === 'active' ? { ...c, status: 'pending', bytesDownloaded: 0 } : c,
    );
    await putTask(task);
    void this.tick();
    await this.broadcast();
  }

  async cancel(taskId: string): Promise<void> {
    const task = await getTask(taskId);
    if (!task) return;
    this.running.get(taskId)?.abort();
    task.state = 'cancelled';
    task.error = undefined;
    await putTask(task);
    await this.cleanupChunkData(task);
    await this.broadcast();
  }

  async retry(taskId: string): Promise<void> {
    const task = await getTask(taskId);
    if (!task || (task.state !== 'failed' && task.state !== 'cancelled')) return;
    task.state = 'queued';
    task.error = undefined;
    task.chunks = task.chunks.map((c) =>
      c.status === 'failed' || c.status === 'active'
        ? { ...c, status: 'pending', bytesDownloaded: 0 }
        : c,
    );
    await putTask(task);
    void this.tick();
    await this.broadcast();
  }

  async remove(taskId: string): Promise<void> {
    const task = await getTask(taskId);
    if (!task) return;
    if (task.state === 'active') this.running.get(taskId)?.abort();
    await deleteTaskRecord(taskId);
    await this.cleanupChunkData(task);
    await this.broadcast();
  }

  async reorder(orderedIds: string[]): Promise<void> {
    const tasks = await getAllTasks();
    const queued = tasks.filter((t) => t.state === 'queued');
    const position = new Map(orderedIds.map((id, i) => [id, i]));
    queued.sort(
      (a, b) => (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0),
    );
    let base = Date.now();
    for (const t of queued) {
      t.createdAt = base++;
      await putTask(t);
    }
    await this.broadcast();
  }

  /** Start queued tasks while capacity remains. */
  async tick(): Promise<void> {
    const tasks = await getAllTasks();
    const activeCount = [...this.running.keys()].length;
    let capacity = this.maxSimultaneous - activeCount;
    if (capacity <= 0) return;
    const queued = tasks
      .filter((t) => t.state === 'queued')
      .sort((a, b) => a.createdAt - b.createdAt);
    for (const task of queued) {
      if (capacity <= 0) break;
      capacity--;
      void this.run(task.id).catch((err) =>
        log.error(`run ${task.id} crashed`, err),
      );
    }
  }

  // --- Runner ---------------------------------------------------------------

  private async run(taskId: string): Promise<void> {
    const task = await getTask(taskId);
    if (!task || task.state !== 'queued') return;
    const controller = new AbortController();
    this.running.set(taskId, controller);
    task.state = 'active';
    task.startedAt = Date.now();
    await putTask(task);
    await this.broadcast();

    const accum = { bytes: 0, since: Date.now(), speed: 0 };
    this.speedAccum.set(taskId, accum);
    const progressTimer = setInterval(() => {
      void this.broadcastProgress(taskId, accum);
    }, PROGRESS_BROADCAST_MS);

    try {
      if (!task.acceptsRanges) {
        // Single-stream fallback (no Range support / unknown size).
        await streamAndDownload(task, this.overwriteExisting);
        task.bytesDownloaded = task.totalBytes ?? 0;
      } else {
        await runTaskChunks(
          task,
          {
            onChunkUpdate: (chunk) =>
              this.persistChunk(taskId, chunk),
            onProgress: (delta) => {
              task.bytesDownloaded += delta;
              accum.bytes += delta;
            },
            onError: (message, retryable) => {
              if (!retryable) log.warn(`task ${taskId}: ${message}`);
            },
          },
          controller.signal,
          { timeoutMs: 30_000, maxRetries: 3 },
        );
        // All chunks done → assemble and hand to browser.
        await mergeAndDownload(task, this.overwriteExisting);
      }
      task.state = 'completed';
      task.completedAt = Date.now();
      task.speedBps = 0;
      await putTask(task);
      await this.cleanupChunkData(task);
      log.info('completed', task.filename);
    } catch (err) {
      if (controller.signal.aborted) {
        // Pause or cancel: state was already written by the caller; only
        // reset in-flight chunks.
        const fresh = await getTask(taskId);
        if (fresh && fresh.state === 'active') {
          fresh.state = 'paused';
          fresh.chunks = fresh.chunks.map((c) =>
            c.status === 'active'
              ? { ...c, status: 'pending', bytesDownloaded: 0 }
              : c,
          );
          await putTask(fresh);
        }
      } else {
        task.state = 'failed';
        task.error =
          err instanceof Error
            ? err.message
            : 'The download failed for an unknown reason.';
        task.chunks = task.chunks.map((c) =>
          c.status === 'active' ? { ...c, status: 'pending', bytesDownloaded: 0 } : c,
        );
        await putTask(task);
        log.error('failed', task.filename, task.error);
      }
    } finally {
      clearInterval(progressTimer);
      this.running.delete(taskId);
      this.speedAccum.delete(taskId);
      this.lastBroadcast.delete(taskId);
      await this.broadcast();
      void this.tick();
    }
  }

  private async persistChunk(
    taskId: string,
    chunk: DownloadTask['chunks'][number],
  ): Promise<void> {
    const task = await getTask(taskId);
    if (!task) return;
    const idx = task.chunks.findIndex((c) => c.index === chunk.index);
    if (idx >= 0) {
      task.chunks[idx] = chunk;
      // Persist byte-count snapshot for resumability. Completed chunk data
      // itself lives in the chunks store (already written by the engine).
      task.bytesDownloaded = task.chunks.reduce(
        (sum, c) =>
          sum + (c.status === 'done' ? c.endByte - c.startByte + 1 : c.bytesDownloaded),
        0,
      );
      await putTask(task);
    }
  }

  private async broadcastProgress(
    taskId: string,
    accum: { bytes: number; since: number; speed: number },
  ): Promise<void> {
    const task = await getTask(taskId);
    if (!task) return;
    const now = Date.now();
    const elapsed = now - accum.since;
    accum.speed = smoothSpeed(accum.speed, accum.bytes, elapsed);
    accum.bytes = 0;
    accum.since = now;
    task.speedBps = accum.speed;
    task.averageSpeedBps = task.startedAt
      ? task.bytesDownloaded / Math.max(1, (now - task.startedAt) / 1000)
      : 0;
    await putTask(task);
    const total = task.totalBytes ?? task.bytesDownloaded;
    const progress: DownloadProgress = {
      taskId,
      state: task.state,
      bytesDownloaded: task.bytesDownloaded,
      totalBytes: task.totalBytes,
      percent: total > 0 ? Math.min(100, (task.bytesDownloaded / total) * 100) : 0,
      speedBps: accum.speed,
      averageSpeedBps: task.averageSpeedBps,
      etaSeconds:
        accum.speed > 0 && task.totalBytes
          ? (task.totalBytes - task.bytesDownloaded) / accum.speed
          : undefined,
      activeConnections: task.chunks.filter((c) => c.status === 'active').length,
      chunkProgress: task.chunks.map((c) => ({
        index: c.index,
        status: c.status,
        percent:
          c.endByte >= c.startByte
            ? Math.min(
                100,
                (c.bytesDownloaded / (c.endByte - c.startByte + 1)) * 100,
              )
            : 100,
      })),
    };
    void chrome.runtime.sendMessage({
      type: 'PROGRESS_UPDATE',
      payload: progress,
    }).catch(() => {
      /* no receivers — fine */
    });
  }

  private async cleanupChunkData(task: DownloadTask): Promise<void> {
    try {
      await deleteChunkBlobs(task.id, task.chunks.length);
    } catch (err) {
      log.warn('chunk cleanup failed (non-fatal)', err);
    }
  }

  async snapshot(): Promise<DownloadTask[]> {
    return getAllTasks();
  }

  async broadcast(): Promise<void> {
    const tasks = await getAllTasks();
    try {
      await chrome.runtime.sendMessage({ type: 'QUEUE_UPDATED', payload: { tasks } });
    } catch {
      // No receivers (popup closed) — fine.
    }
  }
}

export { EngineError, probeUrl };
