/**
 * Pure download-engine logic: URL probing results, chunk planning,
 * retry backoff, and speed estimation.
 *
 * Kept free of I/O and Chrome APIs so it is fully unit-testable
 * (see tests/engine-logic.test.ts).
 */

import type { ChunkState, DownloadError } from '../types';

/** Result of probing a media URL before downloading. */
export interface ProbeResult {
  totalBytes?: number;
  /** Server advertised Accept-Ranges: bytes. */
  acceptsRanges: boolean;
  contentType?: string;
  /** Retry-After value from a 429 response, in ms, when present. */
  retryAfterMs?: number;
}

const CONNECTION_CHOICES = [1, 2, 4, 8, 16] as const;
export type ConnectionCount = (typeof CONNECTION_CHOICES)[number];

export function isConnectionCount(n: number): n is ConnectionCount {
  return (CONNECTION_CHOICES as readonly number[]).includes(n);
}

export function clampConnections(n: number): ConnectionCount {
  const nearest = CONNECTION_CHOICES.reduce((best, c) =>
    Math.abs(c - n) < Math.abs(best - n) ? c : best,
  );
  return nearest;
}

/**
 * Plan byte-range chunks for a file.
 *
 * Spec-faithful behavior: a non-empty file is split into exactly
 * `connections` near-equal contiguous ranges (the IDM-style model — with
 * the default 8 connections, a 500 MB file becomes 8 × ~62.5 MB chunks).
 *
 * `chunkSizeMB` acts as a minimum-granularity guard: tiny files are never
 * shredded into pointlessly small pieces. If the file is too small for
 * every connection to get at least chunkSizeMB of work, the chunk count
 * is reduced (but never below 1). Empty files produce one zero-length
 * chunk.
 */
export function planChunks(
  totalBytes: number,
  connections: number,
  chunkSizeMB: number,
): ChunkState[] {
  if (!Number.isFinite(totalBytes) || totalBytes < 0) {
    throw new Error(`invalid totalBytes: ${totalBytes}`);
  }
  const conns = clampConnections(connections);
  const minChunkBytes = Math.max(1, Math.round(chunkSizeMB * 1024 * 1024));
  if (totalBytes === 0) {
    return [makeChunk(0, 0, 0)];
  }
  const granularityLimit = Math.max(1, Math.floor(totalBytes / minChunkBytes));
  const count = Math.max(1, Math.min(conns, granularityLimit));
  const baseSize = Math.floor(totalBytes / count);
  const remainder = totalBytes % count;
  const chunks: ChunkState[] = [];
  let cursor = 0;
  for (let i = 0; i < count; i++) {
    const size = baseSize + (i < remainder ? 1 : 0);
    chunks.push(makeChunk(i, cursor, cursor + size - 1));
    cursor += size;
  }
  return chunks;
}

function makeChunk(index: number, startByte: number, endByte: number): ChunkState {
  return {
    index,
    startByte,
    endByte,
    bytesDownloaded: 0,
    status: 'pending',
    retries: 0,
  };
}

/** Total bytes covered by a chunk plan. */
export function planTotalBytes(chunks: ChunkState[]): number {
  return chunks.reduce((sum, c) => sum + (c.endByte - c.startByte + 1), 0);
}

/**
 * Exponential backoff with jitter for chunk/task retries.
 * attempt starts at 1. Base 1s, doubling, capped at 60s, ±20% jitter.
 */
export function nextRetryDelayMs(attempt: number, random = Math.random): number {
  const base = Math.min(60_000, 1000 * 2 ** Math.max(0, attempt - 1));
  const jitter = 0.8 + 0.4 * random();
  return Math.round(base * jitter);
}

/** Parse a Retry-After header (seconds or HTTP-date) into ms. */
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    return Math.max(0, Number(trimmed) * 1000);
  }
  const date = Date.parse(trimmed);
  if (!Number.isNaN(date)) {
    return Math.max(0, date - now);
  }
  return undefined;
}

/** Map an HTTP status / failure to a structured download error. */
export function toDownloadError(
  status: number | undefined,
  retryAfterHeader?: string | null,
): DownloadError {
  const retryAfterMs = parseRetryAfter(retryAfterHeader);
  switch (status) {
    case 403:
      return {
        kind: 'http-403',
        message: 'The server refused access to this file (HTTP 403). The link may require authorization or may not be downloadable.',
        statusCode: 403,
        retryable: false,
        retryAfterMs,
      };
    case 404:
      return {
        kind: 'http-404',
        message: 'The file was not found (HTTP 404). The link may have expired.',
        statusCode: 404,
        retryable: false,
        retryAfterMs,
      };
    case 429:
      return {
        kind: 'http-429',
        message: 'The server is rate-limiting downloads (HTTP 429). Retrying automatically…',
        statusCode: 429,
        retryable: true,
        retryAfterMs,
      };
    default:
      return {
        kind: 'unknown',
        message: `The server returned an unexpected response${status ? ` (HTTP ${status})` : ''}.`,
        statusCode: status,
        retryable: status === undefined || status >= 500,
        retryAfterMs,
      };
  }
}

/**
 * Smoothed speed estimate (exponential moving average) in bytes/sec.
 * alpha=0.3 balances responsiveness vs jitter.
 */
export function smoothSpeed(
  previousBps: number,
  bytesSinceLastTick: number,
  msSinceLastTick: number,
  alpha = 0.3,
): number {
  if (msSinceLastTick <= 0) return previousBps;
  const instant = (bytesSinceLastTick * 1000) / msSinceLastTick;
  if (previousBps === 0) return instant;
  return previousBps * (1 - alpha) + instant * alpha;
}

/** ETA seconds from remaining bytes and current speed. */
export function etaSeconds(
  remainingBytes: number,
  speedBps: number,
): number | undefined {
  if (speedBps <= 0) return undefined;
  return remainingBytes / speedBps;
}
