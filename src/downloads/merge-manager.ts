/**
 * Merge manager — assembles completed chunks into a single file and hands
 * it to the browser's download system.
 *
 * Memory strategy: chunk blobs live in IndexedDB (file-backed). The final
 * Blob is constructed from per-chunk Blob *references* loaded one at a
 * time, so the browser never materializes the whole file in RAM. The
 * resulting object URL is then downloaded via chrome.downloads, which
 * streams from Chrome's blob storage to disk.
 */

import type { DownloadTask } from '../types';
import { getChunkBlob } from '../storage/indexed-db';
import { Logger } from '../utils/logger';

const log = new Logger('merge');

export interface MergeResult {
  /** chrome.downloads downloadId, when the handoff succeeded. */
  downloadId?: number;
}

/**
 * Assemble chunks in order and start a browser download.
 * Chunks must all be in status "done" and the task must have chunk data.
 */
export async function mergeAndDownload(
  task: DownloadTask,
  overwriteExisting: boolean,
): Promise<MergeResult> {
  if (task.chunks.length === 0) {
    throw new Error('Task has no chunks to merge.');
  }
  const parts: Blob[] = [];
  for (const chunk of task.chunks) {
    const blob = await getChunkBlob(task.id, chunk.index);
    if (!blob) {
      throw new Error(`Missing chunk data for chunk ${chunk.index}.`);
    }
    parts.push(blob);
  }
  const finalBlob = new Blob(parts, { type: 'application/octet-stream' });
  const blobUrl = URL.createObjectURL(finalBlob);
  try {
    const downloadId = await chrome.downloads.download({
      url: blobUrl,
      filename: joinDownloadFolder(task),
      conflictAction: overwriteExisting ? 'overwrite' : 'uniquify',
    });
    log.info('download started', task.filename, 'id', downloadId);
    // The blob URL must stay alive until the download completes; cleanup
    // is scheduled via the downloads.onChanged listener (see
    // watch-download.ts). As a safety net, revoke after 10 minutes.
    setTimeout(() => URL.revokeObjectURL(blobUrl), 10 * 60 * 1000);
    return { downloadId };
  } catch (err) {
    URL.revokeObjectURL(blobUrl);
    throw new Error(
      `Could not hand the file to the browser downloader: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

/** Single-stream (no Range support) download path. */
export async function streamAndDownload(
  task: DownloadTask,
  overwriteExisting: boolean,
): Promise<MergeResult> {
  const res = await fetch(task.url);
  if (!res.ok) throw new Error(`HTTP ${res.status} while fetching the file.`);
  if (!res.body) throw new Error('Empty response body.');
  const blob = await res.blob(); // streamed & file-backed by the browser
  const blobUrl = URL.createObjectURL(blob);
  try {
    const downloadId = await chrome.downloads.download({
      url: blobUrl,
      filename: joinDownloadFolder(task),
      conflictAction: overwriteExisting ? 'overwrite' : 'uniquify',
    });
    setTimeout(() => URL.revokeObjectURL(blobUrl), 10 * 60 * 1000);
    return { downloadId };
  } catch (err) {
    URL.revokeObjectURL(blobUrl);
    throw new Error(
      `Could not hand the file to the browser downloader: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

function joinDownloadFolder(task: DownloadTask): string {
  const folder = task.folder?.replace(/^[\\/]+|[\\/]+$/g, '') ?? '';
  const name = task.filename;
  return folder ? `${folder}/${name}` : name;
}
