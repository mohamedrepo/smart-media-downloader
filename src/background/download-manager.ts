/**
 * Download manager — turns an ENQUEUE_DOWNLOAD request into a persisted,
 * planned task and hands it to the queue.
 *
 * Gatekeeping (compliance-critical):
 *  - URL must pass validateMediaUrl (http/https only, no credentials,
 *    no private/loopback hosts).
 *  - The media must NOT be flagged protected. Protected media is refused
 *    here; the popup never offers download actions for it anyway.
 *  - Origin permission: the extension requests <all_urls> as an OPTIONAL
 *    host permission. chrome.permissions.contains() is checked before
 *    probing; if missing, a clear error asks the user to grant access
 *    (requested from the popup on user gesture).
 */

import type { AppSettings, DownloadTask, MediaFormat, MediaInfo } from '../types';
import { probeUrl } from '../downloads/download-engine';
import {
  originPatternsFor,
  sanitizeFilename,
  subtitleFilename,
  validateMediaUrl,
} from '../utils/validation';
import { loadSettings } from '../utils/storage';
import { Logger } from '../utils/logger';
import type { QueueManager } from './queue-manager';

const log = new Logger('dl-manager');

export class AccessDeniedError extends Error {}
export class ProtectedMediaError extends Error {}
export class InvalidUrlError extends Error {}

export class DownloadManager {
  constructor(private readonly queue: QueueManager) {}

  async createFromEnqueue(
    media: MediaInfo,
    format: MediaFormat,
    connections: number,
    subtitleLanguages: string[],
    subtitleFormat: DownloadTask['subtitleFormat'],
  ): Promise<DownloadTask> {
    if (media.isProtected) {
      throw new ProtectedMediaError(
        'This media is protected and cannot be downloaded by this extension.',
      );
    }
    const url = validateMediaUrl(format.downloadUrl ?? media.url);
    if (!url) {
      throw new InvalidUrlError(
        'The media URL is missing, invalid, or not publicly accessible.',
      );
    }
    const origins = originPatternsFor(url);
    if (origins.length === 0) {
      throw new InvalidUrlError(
        'The media URL is missing, invalid, or not publicly accessible.',
      );
    }
    const granted = await chrome.permissions.contains({ origins });
    if (!granted) {
      throw new AccessDeniedError(
        'Access to this site has not been granted. Click the download button again and allow the permission prompt.',
      );
    }

    const settings: AppSettings = await loadSettings();
    log.info('probing', url);
    const probe = await probeUrl(url, settings.connectionTimeoutSeconds * 1000);
    const acceptsRanges = probe.acceptsRanges && probe.totalBytes !== undefined;

    const filename = sanitizeFilename(media.title) + extFor(format, url);
    const subtitles = subtitleLanguages.map((lang) =>
      subtitleFilename(media.title, lang, subtitleFormat),
    );
    void subtitles; // subtitle downloads are orchestrated by the subtitle manager

    return this.queue.enqueue({
      url,
      filename,
      folder: settings.downloadFolder,
      totalBytes: probe.totalBytes,
      acceptsRanges,
      connections: acceptsRanges ? connections : 1,
      chunkSizeMB: settings.chunkSizeMB,
      maxRetries: settings.retryFailed ? settings.maxRetries : 0,
      timeoutMs: settings.connectionTimeoutSeconds * 1000,
      subtitleLanguages,
      subtitleFormat,
    });
  }
}

function extFor(format: MediaFormat, url: string): string {
  if (format.container) return `.${format.container.toLowerCase()}`;
  const fromUrl = /\.[a-z0-9]{1,5}$/i.exec(new URL(url).pathname);
  return fromUrl ? fromUrl[0].toLowerCase() : '';
}
