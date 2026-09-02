/** Human-readable formatting helpers shared by popup and options UI. */

/** "350 MB" style byte formatting (binary units, as download managers do). */
export function formatBytes(bytes?: number): string {
  if (bytes === undefined || !Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/** Speed: "8.5 MB/s". */
export function formatSpeed(bytesPerSec?: number): string {
  if (bytesPerSec === undefined || !Number.isFinite(bytesPerSec) || bytesPerSec <= 0) {
    return '—';
  }
  return `${formatBytes(bytesPerSec)}/s`;
}

/** "01:23:45" / "23:45" / "0:45" style duration. */
export function formatDuration(seconds?: number): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return '—';
  const s = Math.floor(seconds % 60);
  const m = Math.floor((seconds / 60) % 60);
  const h = Math.floor(seconds / 3600);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** ETA in "00:31" / "12:05" / "3:04:10" style. */
export function formatEta(seconds?: number): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return '—';
  return formatDuration(Math.ceil(seconds));
}

/** Quality label ordering for UI presentation (best first). */
const QUALITY_ORDER = ['2160p', '1440p', '1080p', '720p', '480p', '360p'];

export function qualityRank(label: string): number {
  const idx = QUALITY_ORDER.indexOf(label);
  if (idx >= 0) return idx;
  return label.toLowerCase().includes('audio') ? QUALITY_ORDER.length : -1;
}
