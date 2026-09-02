/**
 * Shared domain types for Smart Media Downloader.
 *
 * These types define the contract between:
 *   - content scripts (detection)
 *   - provider adapters (media resolution)
 *   - the download engine / queue (background)
 *   - UI surfaces (popup, options)
 */

// ---------------------------------------------------------------------------
// Media detection & adapters
// ---------------------------------------------------------------------------

export type MediaKind = 'video' | 'audio' | 'unknown';

/** Information about a media resource found on a page. */
export interface MediaInfo {
  /** Stable id for this media within the page context. */
  id: string;
  /** Absolute URL of the media resource (or best candidate). */
  url: string;
  /** URL of the page where the media was detected. */
  pageUrl: string;
  title: string;
  sourceDomain: string;
  kind: MediaKind;
  thumbnailUrl?: string;
  durationSeconds?: number;
  /**
   * True when the resource appears protected (DRM/EME, encrypted segments,
   * authenticated-only endpoints). Protected media is never downloaded;
   * the UI shows an informative message instead.
   */
  isProtected: boolean;
  /** Human-readable reasons why the media is considered protected. */
  protectionReasons: string[];
  /** Name of the adapter that produced this info. */
  adapterName: string;
}

/** A concrete, downloadable variant of a media resource. */
export interface MediaFormat {
  id: string;
  /** Display label, e.g. "1080p" or "Audio". */
  label: string;
  /** File container/extension, e.g. "mp4", "m4a". */
  container: string;
  /** Codec when known, e.g. "H.264", "AAC". */
  codec?: string;
  resolution?: {
    width: number;
    height: number;
    qualityLabel: string;
  };
  isAudioOnly: boolean;
  estimatedSizeBytes?: number;
  /** Whether this variant includes an audio track. */
  hasAudio: boolean;
  /**
   * Direct download URL when legitimately exposed, or null when the
   * adapter must resolve it on demand (getAuthorizedDownloadUrl).
   */
  downloadUrl: string | null;
  /** True when obtaining the URL requires explicit user authorization. */
  requiresAuthorization: boolean;
}

// ---------------------------------------------------------------------------
// Subtitles
// ---------------------------------------------------------------------------

export type SubtitleFormat = 'srt' | 'vtt' | 'txt';

/** A subtitle track officially exposed by the page or provider. */
export interface SubtitleTrack {
  id: string;
  /** BCP-47-ish language code, e.g. "en", "ar", "fr". */
  language: string;
  /** Display label, e.g. "English". */
  languageLabel: string;
  /** Absolute URL of the subtitle resource. */
  url: string;
  format: SubtitleFormat;
}

// ---------------------------------------------------------------------------
// Download engine & queue
// ---------------------------------------------------------------------------

export type DownloadTaskState =
  | 'queued'
  | 'active'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type ChunkStatus = 'pending' | 'active' | 'done' | 'failed';

/** Byte-range state for one chunk of a multi-connection download. */
export interface ChunkState {
  index: number;
  /** Inclusive start byte. */
  startByte: number;
  /** Inclusive end byte. */
  endByte: number;
  bytesDownloaded: number;
  status: ChunkStatus;
  retries: number;
  lastError?: string;
}

/** A tracked download job persisted in IndexedDB. */
export interface DownloadTask {
  id: string;
  url: string;
  filename: string;
  /** Relative subfolder (snapshot of settings at enqueue time). */
  folder?: string;
  totalBytes?: number;
  /** Whether the server advertised Accept-Ranges: bytes. */
  acceptsRanges: boolean;
  state: DownloadTaskState;
  /** Requested parallel connections (1/2/4/8/16). */
  connections: number;
  chunks: ChunkState[];
  bytesDownloaded: number;
  /** Instantaneous speed in bytes/sec (smoothed). */
  speedBps: number;
  averageSpeedBps: number;
  startedAt?: number;
  completedAt?: number;
  /** Human-readable error message for failed tasks. */
  error?: string;
  retryCount: number;
  /** Subtitle languages selected alongside this media. */
  subtitleLanguages: string[];
  subtitleFormat: SubtitleFormat;
  createdAt: number;
}

/** Statistics block the popup renders for an active task. */
export interface DownloadProgress {
  taskId: string;
  state: DownloadTaskState;
  bytesDownloaded: number;
  totalBytes?: number;
  percent: number;
  speedBps: number;
  averageSpeedBps: number;
  etaSeconds?: number;
  activeConnections: number;
  chunkProgress: Array<{
    index: number;
    percent: number;
    status: ChunkStatus;
  }>;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export type QualityPreference = 'ask' | 'highest' | '1080p' | '720p' | 'smallest';

export interface AppSettings {
  /** Relative subfolder inside the user's default Downloads directory. */
  downloadFolder: string;
  maxSimultaneousDownloads: number;
  /** Default parallel connections for range-capable servers (1/2/4/8/16). */
  defaultConnections: number;
  /** Start downloads immediately when created from the popup. */
  autoStart: boolean;
  overwriteExisting: boolean;
  qualityPreference: QualityPreference;
  preferredSubtitleLanguage: string;
  preferredSubtitleFormat: SubtitleFormat;
  autoDownloadSubtitles: boolean;
  detailedLogging: boolean;
  retryFailed: boolean;
  maxRetries: number;
  /** Split size in MB used when dividing a file into chunks. */
  chunkSizeMB: number;
  connectionTimeoutSeconds: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  downloadFolder: 'SmartMediaDownloader',
  maxSimultaneousDownloads: 2,
  defaultConnections: 8,
  autoStart: true,
  overwriteExisting: false,
  qualityPreference: 'ask',
  preferredSubtitleLanguage: 'en',
  preferredSubtitleFormat: 'srt',
  autoDownloadSubtitles: false,
  detailedLogging: false,
  retryFailed: true,
  maxRetries: 3,
  chunkSizeMB: 8,
  connectionTimeoutSeconds: 30,
};

// ---------------------------------------------------------------------------
// Runtime messaging protocol
// ---------------------------------------------------------------------------

/** Message: content script -> background, media found on the page. */
export interface PageMediaDetectedMessage {
  type: 'PAGE_MEDIA_DETECTED';
  payload: {
    pageUrl: string;
    media: MediaInfo[];
    subtitleTracks: SubtitleTrack[];
    detectedEme: boolean;
  };
}

/** Message: popup -> background, request a fresh scan of the active tab. */
export interface RescanRequestMessage {
  type: 'RESCAN_ACTIVE_TAB';
}

/** Message: any UI -> background, liveness check. */
export interface PingMessage {
  type: 'PING';
}

/** Message: UI -> background, create a download task. */
export interface EnqueueDownloadMessage {
  type: 'ENQUEUE_DOWNLOAD';
  payload: {
    media: MediaInfo;
    format: MediaFormat;
    connections: number;
    subtitleLanguages: string[];
    subtitleFormat: SubtitleFormat;
  };
}

/** Message: UI -> background, task control. */
export interface TaskControlMessage {
  type: 'TASK_CONTROL';
  payload: {
    taskId: string;
    action: 'pause' | 'resume' | 'cancel' | 'retry' | 'remove';
  };
}

/** Message: UI -> background, reorder the queue. */
export interface ReorderQueueMessage {
  type: 'REORDER_QUEUE';
  payload: {
    /** Task ids in their new order (queued tasks only). */
    orderedIds: string[];
  };
}

/** Message: UI -> background, request full queue snapshot. */
export interface GetQueueMessage {
  type: 'GET_QUEUE';
}

/** Message: UI -> background, update a single settings field. */
export interface UpdateSettingsMessage {
  type: 'UPDATE_SETTINGS';
  payload: Partial<AppSettings>;
}

export type RuntimeMessage =
  | PageMediaDetectedMessage
  | RescanRequestMessage
  | PingMessage
  | EnqueueDownloadMessage
  | TaskControlMessage
  | ReorderQueueMessage
  | GetQueueMessage
  | UpdateSettingsMessage;

/** Message: background -> UI, queue state broadcast. */
export interface QueueUpdatedMessage {
  type: 'QUEUE_UPDATED';
  payload: {
    tasks: DownloadTask[];
  };
}

/** Message: background -> UI, per-task progress tick. */
export interface ProgressUpdateMessage {
  type: 'PROGRESS_UPDATE';
  payload: DownloadProgress;
}

export type BackgroundBroadcast = QueueUpdatedMessage | ProgressUpdateMessage;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Machine-readable failure categories mapped to human-readable copy in UI. */
export type DownloadErrorKind =
  | 'network-interrupted'
  | 'timeout'
  | 'http-403'
  | 'http-404'
  | 'http-429'
  | 'expired-url'
  | 'missing-content-length'
  | 'range-not-supported'
  | 'chunk-failed'
  | 'disk-error'
  | 'cancelled'
  | 'unknown';

export interface DownloadError {
  kind: DownloadErrorKind;
  message: string;
  /** HTTP status when the failure came from a response. */
  statusCode?: number;
  /** Suggested delay before an automatic retry (ms). */
  retryAfterMs?: number;
  retryable: boolean;
}
