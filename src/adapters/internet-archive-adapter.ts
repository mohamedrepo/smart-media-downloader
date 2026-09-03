/**
 * InternetArchiveAdapter — archive.org items via their documented public API.
 *
 * Authorization basis:
 *  - https://archive.org/metadata/{id} is a public, documented API
 *    (https://archive.org/developers/metadata-schema.html).
 *  - https://archive.org/download/{id}/{file} is the platform's OWN download
 *    endpoint, surfaced to every user through the "DOWNLOAD OPTIONS" section
 *    on item pages. Downloading public items is explicitly supported by the
 *    platform.
 *  - Items flagged `access-restricted-item` (controlled digital lending) are
 *    reported as PROTECTED: only lending-streaming is authorized there, and
 *    this adapter refuses to provide download URLs for them.
 *
 * No private APIs, no signature handling, no circumvention anywhere.
 */

import type {
  MediaFormat,
  MediaInfo,
  MediaKind,
  SubtitleFormat,
  SubtitleTrack,
} from '../types';
import { languageLabel } from '../subtitles/language-selector';
import type { MediaProviderAdapter } from './provider-adapter-interface';
import { Logger } from '../utils/logger';

const log = new Logger('ia-adapter');

const IDENTIFIER_PATH_RE = /^\/(?:details|download|metadata|embed)\/([^/?#]+)/;

const VIDEO_EXTENSIONS = new Set([
  'mp4', 'm4v', 'webm', 'mov', 'mkv', 'avi', 'mpg', 'mpeg', 'ogv',
]);
const AUDIO_EXTENSIONS = new Set([
  'mp3', 'm4a', 'aac', 'wav', 'ogg', 'oga', 'opus', 'flac',
]);
const SUBTITLE_EXTENSIONS = new Set(['vtt', 'srt']);

const METADATA_TIMEOUT_MS = 15_000;
const MAX_FORMATS = 25;
/** Best-effort cache so one popup open does not fetch metadata 3 times. */
const METADATA_CACHE_TTL_MS = 60_000;
const metadataCache = new Map<string, { data: IaMetadata; at: number }>();

/** Minimal shape of one entry in the metadata API `files` array. */
export interface IaFile {
  name: string;
  size?: string | number;
  format?: string;
  length?: string;
}

/** Minimal shape of the metadata API response. */
export interface IaMetadata {
  is_dark?: boolean;
  metadata?: {
    identifier?: string;
    title?: string | string[];
    'access-restricted-item'?: boolean | string | number;
    licenseurl?: string;
  };
  files?: IaFile[];
}

/** Extract the item identifier from any archive.org item URL, else null. */
export function extractIdentifier(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    if (
      parsed.hostname !== 'archive.org' &&
      !parsed.hostname.endsWith('.archive.org')
    ) {
      return null;
    }
    const match = IDENTIFIER_PATH_RE.exec(parsed.pathname);
    return match ? decodeURIComponent(match[1]!) : null;
  } catch {
    return null;
  }
}

function extensionOf(name: string): string {
  const base = name.split('/').pop() ?? name;
  const match = /\.([a-z0-9]{1,5})$/i.exec(base);
  return match ? match[1]!.toLowerCase() : '';
}

/** Whether the file is a media file the adapter can offer. */
export function isMediaFile(name: string): boolean {
  const ext = extensionOf(name);
  return VIDEO_EXTENSIONS.has(ext) || AUDIO_EXTENSIONS.has(ext);
}

/**
 * Parse archive.org `length` values: plain seconds ("3696.22") or
 * colon-formatted ("1:02:03", "02:03"). Returns undefined when absent/invalid.
 */
export function parseIaLength(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  const trimmed = String(raw).trim();
  if (trimmed === '') return undefined;
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const value = Number(trimmed);
    return Number.isFinite(value) && value >= 0 ? value : undefined;
  }
  const parts = trimmed.split(':');
  if (parts.length < 2 || parts.length > 3) return undefined;
  if (parts.some((p) => !/^\d{1,2}$/.test(p))) return undefined;
  const [s, m, h] = parts.reverse().map(Number) as [number, number, number?];
  const seconds = s + m * 60 + (h ?? 0) * 3600;
  return Number.isFinite(seconds) ? seconds : undefined;
}

function fileUrl(identifier: string, name: string): string {
  // File names routinely contain spaces/unicode; encode per path segment.
  const encodedName = name
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `https://archive.org/download/${encodeURIComponent(identifier)}/${encodedName}`;
}

/**
 * Map metadata `files` entries into download formats (pure, testable).
 * Non-media files (XML metadata, thumbnails, text) are skipped; results are
 * sorted largest-first and capped so huge items stay usable.
 */
export function mapFilesToFormats(
  files: IaFile[],
  identifier: string,
): MediaFormat[] {
  const mediaFiles = files
    .filter((file) => isMediaFile(file.name))
    .sort((a, b) => toSize(b) - toSize(a))
    .slice(0, MAX_FORMATS);
  return mediaFiles.map((file) => {
    const ext = extensionOf(file.name);
    return {
      id: `ia:${identifier}:${file.name}`,
      label: file.format?.trim() || ext.toUpperCase(),
      container: ext,
      isAudioOnly: AUDIO_EXTENSIONS.has(ext),
      estimatedSizeBytes: sizeOrUndefined(file),
      hasAudio: true,
      downloadUrl: fileUrl(identifier, file.name),
      requiresAuthorization: false,
    } satisfies MediaFormat;
  });
}

function sizeOrUndefined(file: IaFile): number | undefined {
  const value = Number(file.size);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/** Extract officially exposed subtitle/caption files as tracks (pure).
 *  Caption files are detected by extension OR by their archive.org format
 *  field ("SubRip", "Web Video Text Tracks") — real-world names vary
 *  ("{id}.asr.srt", "{name}_master.intros.asr.vtt"). */
export function extractSubtitleTracksFromFiles(
  files: IaFile[],
  identifier: string,
): SubtitleTrack[] {
  const CAPTION_FORMATS = new Set(['SubRip', 'Web Video Text Tracks']);
  const tracks: SubtitleTrack[] = [];
  for (const file of files) {
    const ext = extensionOf(file.name);
    const byExtension = SUBTITLE_EXTENSIONS.has(ext);
    const byFormat =
      file.format !== undefined && CAPTION_FORMATS.has(file.format.trim());
    if (!byExtension && !byFormat) continue;
    const container: SubtitleFormat =
      ext === 'srt' || file.format?.trim() === 'SubRip' ? 'srt' : 'vtt';
    const base = (file.name.split('/').pop() ?? file.name).replace(
      /\.[a-z0-9]{1,5}$/i,
      '',
    );
    // Common patterns: "Movie.en.vtt" → "en"; "{id}.asr.srt" → "asr" is
    // automatic-speech-recognition, NOT a language code → "und".
    const langMatch = /\.([a-z]{2,3}(?:-[A-Za-z0-9]{1,8})*)$/.exec(base);
    let language = langMatch ? langMatch[1]!.toLowerCase() : 'und';
    if (language === 'asr') language = 'und';
    tracks.push({
      id: `ia-sub:${identifier}:${file.name}`,
      language,
      languageLabel: file.format?.trim() || languageLabel(language),
      url: fileUrl(identifier, file.name),
      format: container,
    });
  }
  return tracks;
}

function toSize(file: IaFile): number {
  const value = Number(file.size);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function titleFrom(metadata: IaMetadata['metadata'], identifier: string): string {
  const raw = metadata?.title;
  if (typeof raw === 'string' && raw.trim() !== '') return raw.trim();
  if (Array.isArray(raw)) {
    const first = raw.find((entry) => typeof entry === 'string' && entry.trim() !== '');
    if (first) return first.trim();
  }
  return identifier;
}

function isRestricted(metadata: IaMetadata['metadata']): boolean {
  const flag = metadata?.['access-restricted-item'];
  return flag === true || flag === 'true' || flag === 1 || flag === '1';
}

async function fetchMetadata(identifier: string): Promise<IaMetadata> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), METADATA_TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://archive.org/metadata/${encodeURIComponent(identifier)}`,
      { signal: controller.signal },
    );
    if (!res.ok) {
      throw new Error(`archive.org metadata API returned HTTP ${res.status}.`);
    }
    const data = (await res.json()) as IaMetadata;
    // Nonexistent identifiers can return HTTP 200 with an empty object, and
    // "dark" items return an alternate shape without metadata/files
    // (verified live). Both must surface as a clear not-available error.
    if (
      data === null ||
      typeof data !== 'object' ||
      data.is_dark === true ||
      (data.metadata === undefined && data.files === undefined)
    ) {
      throw new Error(
        'This archive.org item does not exist or is not available (it may be dark, removed, or the identifier is wrong).',
      );
    }
    metadataCache.set(identifier, { data, at: Date.now() });
    return data;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('The archive.org metadata request timed out.');
    }
    throw err instanceof Error
      ? err
      : new Error('Could not reach the archive.org metadata API.');
  } finally {
    clearTimeout(timer);
  }
}

function kindFromFiles(files: IaFile[]): MediaKind {
  let kind: MediaKind = 'unknown';
  for (const file of files) {
    if (!isMediaFile(file.name)) continue;
    const ext = extensionOf(file.name);
    if (VIDEO_EXTENSIONS.has(ext)) return 'video';
    if (AUDIO_EXTENSIONS.has(ext)) kind = 'audio';
  }
  return kind;
}

/**
 * Adapter for archive.org item pages and direct item URLs.
 * Registered ahead of DirectMediaAdapter (which remains the generic
 * fallback for plain file URLs).
 */
export class InternetArchiveAdapter implements MediaProviderAdapter {
  readonly name = 'InternetArchiveAdapter';

  canHandle(url: string): boolean {
    return extractIdentifier(url) !== null;
  }

  async getMediaInfo(url: string): Promise<MediaInfo> {
    const identifier = extractIdentifier(url);
    if (!identifier) throw new Error('Not an archive.org item URL.');
    log.info('fetching metadata for', identifier);
    const data = await fetchMetadata(identifier);
    const metadata = data.metadata;
    const files = data.files ?? [];
    const restricted = isRestricted(metadata);
    const kind = kindFromFiles(files);
    const durations = files
      .filter((file) => isMediaFile(file.name))
      .map((file) => parseIaLength(file.length))
      .filter((value): value is number => value !== undefined);
    const durationSeconds =
      durations.length > 0 ? Math.max(...durations) : undefined;
    return {
      id: `ia:${identifier}`,
      url,
      pageUrl: url,
      title: titleFrom(metadata, identifier),
      sourceDomain: 'archive.org',
      kind,
      thumbnailUrl: `https://archive.org/services/img/${encodeURIComponent(identifier)}`,
      durationSeconds,
      isProtected: restricted,
      protectionReasons: restricted
        ? [
            'This item is access-restricted on archive.org (controlled digital lending). Only borrowing/streaming is authorized; no download is offered by the platform.',
          ]
        : [],
      adapterName: this.name,
    };
  }

  async getAvailableFormats(mediaInfo: MediaInfo): Promise<MediaFormat[]> {
    const identifier = extractIdentifier(mediaInfo.url);
    if (!identifier) return [];
    const data = await fetchMetadata(identifier);
    if (isRestricted(data.metadata)) return []; // protected — UI shows the notice
    return mapFilesToFormats(data.files ?? [], identifier);
  }

  async getSubtitleTracks(mediaInfo: MediaInfo): Promise<SubtitleTrack[]> {
    const identifier = extractIdentifier(mediaInfo.url);
    if (!identifier) return [];
    const data = await fetchMetadata(identifier);
    if (isRestricted(data.metadata)) return [];
    return extractSubtitleTracksFromFiles(data.files ?? [], identifier);
  }

  async getAuthorizedDownloadUrl(format: MediaFormat): Promise<string | null> {
    // The /download/ endpoint IS the platform's authorized mechanism.
    return format.downloadUrl;
  }
}
