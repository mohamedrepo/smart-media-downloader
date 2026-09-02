import { describe, expect, it } from 'vitest';
import {
  clampConnections,
  etaSeconds,
  nextRetryDelayMs,
  parseRetryAfter,
  planChunks,
  planTotalBytes,
  smoothSpeed,
  toDownloadError,
} from '../src/downloads/engine-logic';

describe('planChunks', () => {
  it('splits a 500 MB file into 8 near-equal ranges (default 8 connections)', () => {
    const total = 500 * 1024 * 1024;
    const chunks = planChunks(total, 8, 8);
    expect(chunks).toHaveLength(8);
    expect(planTotalBytes(chunks)).toBe(total);
    expect(chunks[0]!.startByte).toBe(0);
    expect(chunks[7]!.endByte).toBe(total - 1);
    // Contiguity: each chunk starts right after the previous one ends
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i]!.startByte).toBe(chunks[i - 1]!.endByte + 1);
    }
  });

  it('distributes remainder bytes across early chunks', () => {
    // 10 bytes over 4 connections, 1-byte minimum granularity → 4 chunks
    const chunks = planChunks(10, 4, 1 / (1024 * 1024));
    expect(chunks).toHaveLength(4);
    expect(planTotalBytes(chunks)).toBe(10);
    const sizes = chunks.map((c) => c.endByte - c.startByte + 1);
    expect(sizes).toEqual([3, 3, 2, 2]);
  });

  it('reduces chunk count for files smaller than the chunk-size granularity', () => {
    // 40 MB with 8 connections and 8 MB minimum granularity → 5 chunks
    const total = 40 * 1024 * 1024;
    const chunks = planChunks(total, 8, 8);
    expect(chunks).toHaveLength(5);
    expect(planTotalBytes(chunks)).toBe(total);
  });

  it('produces a single zero-length chunk for empty files', () => {
    const chunks = planChunks(0, 8, 8);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ startByte: 0, endByte: 0, status: 'pending' });
  });

  it('never produces more chunks than connections', () => {
    const chunks = planChunks(1000, 2, 1 / (1024 * 1024));
    expect(chunks.length).toBeLessThanOrEqual(2);
  });
});

describe('clampConnections', () => {
  it('snaps to the nearest allowed connection count', () => {
    expect(clampConnections(7)).toBe(8);
    expect(clampConnections(3)).toBe(2);
    expect(clampConnections(100)).toBe(16);
    expect(clampConnections(0)).toBe(1);
  });
});

describe('nextRetryDelayMs', () => {
  it('doubles exponentially and is capped at 60s', () => {
    expect(nextRetryDelayMs(1, () => 0.5)).toBe(1000);
    expect(nextRetryDelayMs(2, () => 0.5)).toBe(2000);
    expect(nextRetryDelayMs(3, () => 0.5)).toBe(4000);
    expect(nextRetryDelayMs(10, () => 0.5)).toBe(60_000);
  });

  it('applies ±20% jitter within bounds', () => {
    const d = nextRetryDelayMs(1, () => 0); // jitter 0.8
    expect(d).toBe(800);
    const d2 = nextRetryDelayMs(1, () => 1); // jitter 1.2
    expect(d2).toBe(1200);
  });
});

describe('parseRetryAfter', () => {
  it('parses delay-seconds', () => {
    expect(parseRetryAfter('30')).toBe(30_000);
    expect(parseRetryAfter('0')).toBe(0);
  });

  it('parses HTTP-date into a positive duration', () => {
    const now = Date.now();
    const result = parseRetryAfter(new Date(now + 10_000).toUTCString(), now);
    // toUTCString() truncates milliseconds, so allow sub-second drift.
    expect(result).toBeGreaterThan(9_000);
    expect(result).toBeLessThanOrEqual(10_000);
  });

  it('returns undefined for missing or garbage values', () => {
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter('soon')).toBeUndefined();
  });
});

describe('toDownloadError', () => {
  it('maps known statuses with correct retryability', () => {
    expect(toDownloadError(403).kind).toBe('http-403');
    expect(toDownloadError(403).retryable).toBe(false);
    expect(toDownloadError(404).kind).toBe('http-404');
    expect(toDownloadError(429).retryable).toBe(true);
    expect(toDownloadError(429, '5').retryAfterMs).toBe(5000);
    expect(toDownloadError(503).retryable).toBe(true);
    expect(toDownloadError(200).retryable).toBe(false);
  });
});

describe('smoothSpeed', () => {
  it('seeds with the instant speed on first tick', () => {
    // 1500 bytes in 500ms → 3000 B/s
    expect(smoothSpeed(0, 1500, 500)).toBe(3000);
  });

  it('converges toward the instant speed (EMA alpha=0.3)', () => {
    const next = smoothSpeed(3000, 1500, 500); // instant 3000
    expect(next).toBe(3000);
    const slowed = smoothSpeed(3000, 0, 500); // instant 0
    expect(slowed).toBe(2100); // 3000*0.7
  });

  it('ignores zero elapsed time', () => {
    expect(smoothSpeed(1234, 100, 0)).toBe(1234);
  });
});

describe('etaSeconds', () => {
  it('computes remaining time', () => {
    expect(etaSeconds(10_000, 2_000)).toBe(5);
  });
  it('is undefined at zero speed', () => {
    expect(etaSeconds(10_000, 0)).toBeUndefined();
  });
});
