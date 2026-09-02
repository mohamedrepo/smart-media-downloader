/**
 * Content script — passive media detection (first pass).
 *
 * Runs at document_idle on http(s) pages. It ONLY reads the public DOM:
 * <video>, <audio>, <source>, <track>, and media-file anchors. It never
 * intercepts protected streams, never touches EME beyond recording that
 * the page uses it (a protection signal), and never sends anything
 * anywhere except to this extension's own background worker.
 *
 * Bundled as a self-contained IIFE (see vite.content.config.ts) because
 * MV3 content scripts cannot be ES modules.
 */

import type { MediaInfo, MediaKind, SubtitleTrack } from '../types';
import { isDirectMediaUrl } from '../utils/validation';

interface DetectionResult {
  media: MediaInfo[];
  subtitleTracks: SubtitleTrack[];
  detectedEme: boolean;
}

/** Absolute-ize a resource URL against the page location. */
function absoluteUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    return new URL(raw, document.baseURI).toString();
  } catch {
    return null;
  }
}

function guessKind(url: string, tag: string): MediaKind {
  if (tag === 'audio') return 'audio';
  if (tag === 'video') return 'video';
  // Fall back to extension heuristics for <a> links
  const lower = url.toLowerCase();
  if (/\.(mp3|m4a|aac|wav|ogg|oga|opus|flac)(\?|#|$)/.test(lower)) {
    return 'audio';
  }
  if (/\.(mp4|m4v|webm|mov|mkv|avi|ogv)(\?|#|$)/.test(lower)) {
    return 'video';
  }
  return 'unknown';
}

function collectFromMediaTags(): MediaInfo[] {
  const results = new Map<string, MediaInfo>();
  const nodes = document.querySelectorAll('video, audio, source');
  nodes.forEach((node) => {
    const el = node as HTMLVideoElement | HTMLAudioElement | HTMLSourceElement;
    const tag = el.tagName.toLowerCase();
    const url = absoluteUrl(el.getAttribute('src'));
    if (!url) return;
    // Two accepted cases:
    //  - http(s) src: a directly-addressable resource candidate.
    //  - blob: src: an MSE (MediaSource Extensions) player — the media is
    //    assembled in-memory from segmented streams. These are NOT exposed
    //    as downloadable files; they are reported (as protected) so the UI
    //    can explain why, instead of pretending the page has no media.
    //  Other schemes (mediastream:, data:) are ignored entirely.
    const isHttp = url.startsWith('http://') || url.startsWith('https://');
    const isBlob = url.startsWith('blob:');
    if (!isHttp && !isBlob) return;
    const kind = guessKind(isHttp ? url : '', tag);
    const id = `dom-${results.size}-${url}`;
    if (results.has(url)) return;
    // Duration/poster live on the owning <video>/<audio> element.
    const owner =
      tag === 'source'
        ? (el.closest('video, audio') as HTMLVideoElement | HTMLAudioElement | null)
        : (el as HTMLVideoElement | HTMLAudioElement);
    const durationSeconds =
      owner && Number.isFinite(owner.duration) && owner.duration > 0
        ? owner.duration
        : undefined;
    const thumbnailUrl =
      owner && owner.tagName === 'VIDEO'
        ? absoluteUrl((owner as HTMLVideoElement).poster) ?? undefined
        : undefined;
    results.set(url, {
      id,
      url: isHttp ? url : '',
      pageUrl: location.href,
      title:
        document.title ||
        el.getAttribute('title') ||
        (isHttp ? decodeURIComponent(url.split('/').pop() ?? 'media') : 'Streaming video'),
      sourceDomain: location.hostname,
      kind,
      thumbnailUrl,
      durationSeconds,
      isProtected: !isHttp,
      protectionReasons: isHttp
        ? []
        : [
            'This page plays media through a segmented streaming player (MediaSource Extensions) and does not expose a downloadable file.',
          ],
      adapterName: 'DirectMediaAdapter',
    });
  });
  return [...results.values()];
}

function collectFromAnchors(): MediaInfo[] {
  const results: MediaInfo[] = [];
  document.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((a) => {
    const url = absoluteUrl(a.getAttribute('href'));
    if (!url || !isDirectMediaUrl(url)) return;
    results.push({
      id: `link-${results.length}-${url}`,
      url,
      pageUrl: location.href,
      title: a.textContent?.trim() || decodeURIComponent(url.split('/').pop() ?? 'media'),
      sourceDomain: location.hostname,
      kind: guessKind(url, 'a'),
      isProtected: false,
      protectionReasons: [],
      adapterName: 'DirectMediaAdapter',
    });
  });
  return results;
}

function collectSubtitleTracks(): SubtitleTrack[] {
  const tracks: SubtitleTrack[] = [];
  document.querySelectorAll<HTMLTrackElement>('track[kind="subtitles"], track[kind="captions"]').forEach(
    (track, i) => {
      const url = absoluteUrl(track.getAttribute('src'));
      if (!url) return;
      const format = /\.vtt(\?|#|$)/i.test(url)
        ? 'vtt'
        : /\.srt(\?|#|$)/i.test(url)
          ? 'srt'
          : 'vtt';
      tracks.push({
        id: `track-${i}-${url}`,
        language: track.srclang || 'und',
        languageLabel: track.label || track.srclang || 'Unknown',
        url,
        format,
      });
    },
  );
  return tracks;
}

/**
 * Protection signal: detect whether the page ACTUALLY uses Encrypted Media
 * Extensions — not merely whether the EME API exists (it exists in every
 * Chrome tab; treating API availability as usage caused false positives on
 * pages with plain unprotected <video> elements).
 *
 * Passive signals used (no interaction with keys or streams):
 *  1. 'encrypted' events on media elements — fired by the browser when the
 *     playback pipeline needs decryption. Listened in capture phase on the
 *     document so page-world events are observed.
 *  2. Best-effort read of element.mediaKeys (non-null only when a CDM
 *     session was actually established).
 */
let emeUsed = false;
try {
  document.addEventListener(
    'encrypted',
    () => {
      emeUsed = true;
    },
    true,
  );
} catch {
  // Listener registration cannot realistically fail; kept for symmetry.
}

function elementHasMediaKeys(): boolean {
  try {
    return [...document.querySelectorAll('video, audio')].some((el) => {
      const keys = (el as HTMLMediaElement).mediaKeys;
      return keys !== undefined && keys !== null;
    });
  } catch {
    return false;
  }
}

function detect(): DetectionResult {
  // Tag-collected media comes from <video>/<audio>/<source>; link-collected
  // media are ordinary <a href> links to direct files — the latter can never
  // be EME-protected (they are plain HTTP resources).
  const tagged = collectFromMediaTags();
  const linked = collectFromAnchors();
  const eme = emeUsed || elementHasMediaKeys();
  if (eme) {
    for (const m of tagged) {
      m.isProtected = true;
      m.protectionReasons.push(
        'This page plays protected media using Encrypted Media Extensions (DRM).',
      );
    }
  }
  // Show downloadable candidates first.
  const media = [...tagged, ...linked].sort(
    (a, b) => Number(a.isProtected) - Number(b.isProtected),
  );
  return { media, subtitleTracks: collectSubtitleTracks(), detectedEme: eme };
}

function report(): void {
  try {
    const result = detect();
    void chrome.runtime.sendMessage({
      type: 'PAGE_MEDIA_DETECTED',
      payload: {
        pageUrl: location.href,
        media: result.media,
        subtitleTracks: result.subtitleTracks,
        detectedEme: result.detectedEme,
      },
    });
  } catch {
    // Extension context invalidated (e.g. reload) — safe to ignore.
  }
}

if (document.readyState === 'complete' || document.readyState === 'interactive') {
  report();
} else {
  window.addEventListener('DOMContentLoaded', report, { once: true });
}

// Rescan support: the popup can request a fresh scan of the active tab,
// or fetch the latest detection snapshot directly.
chrome.runtime.onMessage.addListener(
  (message: unknown, _sender, sendResponse: (v?: unknown) => void): boolean => {
    if (typeof message !== 'object' || message === null) return false;
    const type = (message as { type?: string }).type;
    if (type === 'RESCAN') {
      report();
      sendResponse({ ok: true });
      return false;
    }
    if (type === 'GET_MEDIA') {
      sendResponse(detect());
      return false;
    }
    return false;
  },
);
