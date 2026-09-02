/**
 * DirectMediaAdapter — handles directly downloadable media files.
 *
 * Scope: ordinary http(s) resources whose URLs point at a media file
 * (.mp4/.webm/.mp3/...), i.e. files the browser itself could download
 * with a plain link. These are by definition authorized: the site is
 * serving the bytes to unauthenticated browser requests.
 *
 * It performs a single metadata probe (HEAD with ranged-GET fallback) and
 * exposes exactly one format variant — the file as served. It never
 * follows authenticated endpoints, signed-URL regeneration schemes, or
 * anything requiring session reconstruction.
 */

import type { MediaFormat, MediaInfo, MediaKind, SubtitleTrack } from '../types';
import { probeUrl } from '../downloads/download-engine';
import {
  extensionFromUrl,
  isDirectMediaUrl,
  validateMediaUrl,
} from '../utils/validation';
import type { MediaProviderAdapter } from './provider-adapter-interface';
import type { ProbeSummary } from './types';

const AUDIO_EXTENSIONS = new Set(['mp3', 'm4a', 'aac', 'wav', 'ogg', 'oga', 'opus', 'flac']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'm4v', 'webm', 'mov', 'mkv', 'avi', 'ogv']);

export class DirectMediaAdapter implements MediaProviderAdapter {
  readonly name = 'DirectMediaAdapter';

  canHandle(url: string): boolean {
    return isDirectMediaUrl(url);
  }

  async getMediaInfo(url: string): Promise<MediaInfo> {
    const safeUrl = validateMediaUrl(url);
    if (!safeUrl) throw new Error('Invalid or unsafe media URL.');
    const probe = await probeUrl(safeUrl, 30_000);
    const filename = decodeURIComponent(
      new URL(safeUrl).pathname.split('/').pop() ?? 'media',
    );
    const kind = guessKind(safeUrl);
    return {
      id: `direct-${safeUrl}`,
      url: safeUrl,
      pageUrl: safeUrl,
      title: stripExtension(filename),
      sourceDomain: new URL(safeUrl).hostname,
      kind,
      isProtected: false,
      protectionReasons: [],
      adapterName: this.name,
    };
  }

  async getAvailableFormats(mediaInfo: MediaInfo): Promise<MediaFormat[]> {
    const probe: ProbeSummary = {
      acceptsRanges: false,
    };
    try {
      const full = await probeUrl(mediaInfo.url, 30_000);
      probe.totalBytes = full.totalBytes;
      probe.contentType = full.contentType;
      probe.acceptsRanges = full.acceptsRanges;
    } catch {
      // Probe failure only hides the size estimate; the file itself may
      // still download via the browser's own downloader.
    }
    const ext = extensionFromUrl(mediaInfo.url) ?? 'mp4';
    const isAudio = AUDIO_EXTENSIONS.has(ext);
    return [
      {
        id: `${this.name}:original`,
        label: isAudio ? 'Audio (original)' : 'Original quality',
        container: ext,
        isAudioOnly: isAudio,
        estimatedSizeBytes: probe.totalBytes,
        hasAudio: true,
        // Direct files are already authorized and directly addressable.
        downloadUrl: mediaInfo.url,
        requiresAuthorization: false,
      },
    ];
  }

  async getSubtitleTracks(): Promise<SubtitleTrack[]> {
    // Direct files carry no subtitle tracks; page-exposed <track> elements
    // are collected by the content script and passed through separately.
    return [];
  }

  async getAuthorizedDownloadUrl(format: MediaFormat): Promise<string | null> {
    // The direct URL is itself the authorized mechanism.
    return format.downloadUrl;
  }
}

function guessKind(url: string): MediaKind {
  const ext = extensionFromUrl(url);
  if (ext && AUDIO_EXTENSIONS.has(ext)) return 'audio';
  if (ext && VIDEO_EXTENSIONS.has(ext)) return 'video';
  return 'unknown';
}

function stripExtension(name: string): string {
  return name.replace(/\.[a-z0-9]{1,5}$/i, '') || name;
}
