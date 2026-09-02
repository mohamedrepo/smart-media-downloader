/**
 * URL and filename validation.
 *
 * Security posture:
 *  - Only http/https URLs are accepted; javascript:, data:, file:, blob:,
 *    and custom schemes are rejected outright (CSP-safe, no code execution).
 *  - URLs carrying embedded credentials (user:pass@host) are rejected.
 *  - Loopback/private-network hosts are rejected for background fetches to
 *    avoid SSRF-style requests; user-visible page URLs from content scripts
 *    are additionally checked against the page origin by the caller.
 *  - Filenames are sanitized against path traversal, control characters,
 *    Windows-reserved names, and excessive length.
 */

const MEDIA_EXTENSIONS = new Set([
  'mp4', 'm4v', 'webm', 'mov', 'mkv', 'avi', 'ogv',
  'mp3', 'm4a', 'aac', 'wav', 'ogg', 'oga', 'opus', 'flac',
]);

const WINDOWS_RESERVED = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
]);

/** IPv4 private/loopback/link-local ranges (dotted-quad only). */
function isPrivateIPv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const octets = [m[1], m[2], m[3], m[4]].map(Number) as [
    number, number, number, number,
  ];
  if (octets.some((o) => o > 255)) return true; // malformed, treat as unsafe
  const [a, b] = octets;
  if (a === 10 || a === 127) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 0) return true;
  return false;
}

/**
 * Validate a URL for background fetching.
 * Returns the normalized URL string, or null when unsafe.
 */
export function validateMediaUrl(raw: string): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 8192) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username !== '' || url.password !== '') return null;
  const host = url.hostname.toLowerCase();
  if (host === '' || host === 'localhost' || host.endsWith('.localhost')) {
    return null;
  }
  if (host.endsWith('.local') || host.endsWith('.internal')) return null;
  if (isPrivateIPv4(host)) return null;
  // IPv6 literals: only global addresses are hard to classify here, so
  // bracketed literals are rejected conservatively.
  if (host.startsWith('[')) return null;
  return url.toString();
}

/** Extract a lowercase extension from a URL path, if any. */
export function extensionFromUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    const match = /\.([a-z0-9]{1,5})$/i.exec(url.pathname);
    return match ? match[1]!.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** Whether the URL points at a recognized direct media file. */
export function isDirectMediaUrl(raw: string): boolean {
  const ext = extensionFromUrl(raw);
  return ext !== null && MEDIA_EXTENSIONS.has(ext);
}

/**
 * Sanitize an arbitrary string into a safe cross-platform filename.
 * - strips path separators and traversal sequences
 * - removes control characters and Windows-illegal characters
 * - avoids Windows-reserved device names
 * - trims trailing dots/spaces (Windows requirement)
 * - caps length at 180 characters (room for .en.srt suffixes)
 */
export function sanitizeFilename(raw: string, fallback = 'media-file'): string {
  let name = String(raw ?? '');
  // Strip path components and traversal
  name = name.replace(/(?:\.\.|\/|\\)+/g, ' ');
  // Remove control characters and Windows-illegal characters
  // eslint-disable-next-line no-control-regex
  name = name.replace(/[\u0000-\u001f<>:"|?*\u007f]/g, '');
  // Collapse whitespace
  name = name.replace(/\s+/g, ' ').trim();
  // Trim leading/trailing dots and spaces
  name = name.replace(/^[.\s]+|[.\s]+$/g, '');
  if (name.length > 180) name = name.slice(0, 180).trimEnd();
  if (name === '') return fallback;
  // Avoid reserved device names (case-insensitive, with or without extension)
  const base = name.split('.')[0]!.toUpperCase();
  if (WINDOWS_RESERVED.has(base)) name = `_${name}`;
  return name;
}

/**
 * Build a subtitle filename like "Video Title.en.srt".
 * @param title   sanitized media title
 * @param language BCP-47-ish language code (sanitized)
 * @param format  subtitle container
 */
export function subtitleFilename(
  title: string,
  language: string,
  format: 'srt' | 'vtt' | 'txt',
): string {
  const safeLang = sanitizeFilename(language, 'und').replace(/\s+/g, '');
  return `${sanitizeFilename(title)}.${safeLang}.${format}`;
}
