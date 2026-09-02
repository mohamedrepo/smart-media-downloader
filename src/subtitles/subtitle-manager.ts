/**
 * Subtitle manager — downloads and converts officially exposed subtitle
 * tracks. Tracks come exclusively from the page's own <track> elements or
 * provider APIs that expose subtitles to the user; this module never
 * discovers hidden or protected subtitle resources.
 */

import type { SubtitleFormat, SubtitleTrack } from '../types';
import { vttToSrt } from './vtt-to-srt';
import { sanitizeFilename, subtitleFilename } from '../utils/validation';
import { Logger } from '../utils/logger';

const log = new Logger('subtitles');

export interface SubtitleDownload {
  filename: string;
  blob: Blob;
  language: string;
}

/**
 * Download and (when requested) convert a single track.
 * @param title media title for filename generation
 */
export async function downloadSubtitleTrack(
  track: SubtitleTrack,
  targetFormat: SubtitleFormat,
  title: string,
): Promise<SubtitleDownload> {
  const res = await fetch(track.url);
  if (!res.ok) {
    throw new Error(
      `Could not fetch the ${track.languageLabel} subtitle (HTTP ${res.status}).`,
    );
  }
  let text = await res.text();
  let format: SubtitleFormat = track.format;

  // VTT → SRT conversion when the user wants SRT but the source is VTT.
  if (targetFormat === 'srt' && format === 'vtt') {
    text = vttToSrt(text);
    format = 'srt';
  } else if (targetFormat === 'txt' && format === 'vtt') {
    text = vttToPlainTranscript(text);
    format = 'txt';
  } else if (targetFormat === 'txt' && format === 'srt') {
    text = srtToPlainTranscript(text);
    format = 'txt';
  }
  // srt→vtt and srt→txt-from-vtt paths: SRT sources keep their format
  // unless the target is txt. VTT sources are always convertible.

  const effectiveFormat: SubtitleFormat = format;
  const filename = subtitleFilename(
    sanitizeFilename(title),
    track.language,
    effectiveFormat,
  );
  log.info('subtitle ready', filename);
  return {
    filename,
    blob: new Blob([text], { type: 'text/plain;charset=utf-8' }),
    language: track.language,
  };
}

/** Download a set of selected tracks; failures are isolated per track. */
export async function downloadSubtitleTracks(
  tracks: SubtitleTrack[],
  languages: string[],
  targetFormat: SubtitleFormat,
  title: string,
): Promise<{ downloads: SubtitleDownload[]; failures: string[] }> {
  const selected = tracks.filter((t) => languages.includes(t.language));
  const downloads: SubtitleDownload[] = [];
  const failures: string[] = [];
  for (const track of selected) {
    try {
      downloads.push(
        await downloadSubtitleTrack(track, targetFormat, title),
      );
    } catch (err) {
      failures.push(
        `${track.languageLabel}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return { downloads, failures };
}

/** Hand a converted subtitle to the browser downloader. */
export async function saveSubtitle(download: SubtitleDownload): Promise<void> {
  const url = URL.createObjectURL(download.blob);
  try {
    await chrome.downloads.download({
      url,
      filename: download.filename,
      conflictAction: 'uniquify',
    });
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err instanceof Error ? err : new Error(String(err));
  }
}

/** VTT → plain text transcript (one line per cue text line). */
export function vttToPlainTranscript(vtt: string): string {
  return vttToSrt(vtt)
    .split('\n')
    .filter((line) => !/^\d+$/.test(line.trim()))
    .filter((line) => !line.includes('-->'))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

/** SRT → plain text transcript. */
export function srtToPlainTranscript(srt: string): string {
  return srt
    .split('\n')
    .filter((line) => !/^\d+$/.test(line.trim()))
    .filter((line) => !line.includes('-->'))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}
