/**
 * WebVTT → SRT converter (local, lossless text transform).
 *
 * Only transforms subtitles the user already has legitimate access to;
 * nothing here fetches, decrypts, or reconstructs protected content.
 *
 * Supported VTT features:
 *  - WEBVTT header, NOTE blocks, STYLE/REGION blocks (skipped)
 *  - cue identifiers (optional lines before timestamps)
 *  - "HH:MM:SS.mmm" and "MM:SS.mmm" timestamps → "HH:MM:SS,mmm"
 *  - inline tags: <i>, <b>, <u>, <c.class>, <v Name>, and inline
 *    timestamps <00:00:01.000> are stripped to plain text (SRT has no
 *    portable equivalent)
 *  - cue text lines preserved verbatim (minus tags)
 */

export interface VttCue {
  startMs: number;
  endMs: number;
  text: string;
}

/** Parse a WebVTT document into cues. Malformed cues are skipped. */
export function parseVtt(vtt: string): VttCue[] {
  const lines = vtt.replace(/\r\n?/g, '\n').split('\n');
  const cues: VttCue[] = [];
  let i = 0;

  // Header: first non-empty line must start with WEBVTT; skip until blank.
  if (lines[0]?.trim().startsWith('WEBVTT')) {
    i = 1;
    while (i < lines.length && lines[i]!.trim() !== '') i++;
  }

  while (i < lines.length) {
    const line = lines[i]!.trim();

    if (line === '' || line.startsWith('NOTE') || line.startsWith('STYLE') || line.startsWith('REGION')) {
      // Skip this block entirely (through the next blank line).
      if (line !== '') {
        while (i < lines.length && lines[i]!.trim() !== '') i++;
      }
      i++;
      continue;
    }

    // Cue: optional id line, then the timing line.
    let timingLine = line;
    if (!line.includes('-->')) {
      i++;
      timingLine = lines[i]?.trim() ?? '';
    }
    const timing = parseTimingLine(timingLine);
    if (!timing) {
      i++;
      continue;
    }
    i++;
    const textLines: string[] = [];
    while (i < lines.length && lines[i]!.trim() !== '') {
      textLines.push(lines[i]!);
      i++;
    }
    if (textLines.length > 0) {
      cues.push({
        startMs: timing.startMs,
        endMs: timing.endMs,
        text: cleanText(textLines.join('\n')),
      });
    }
    // consume the blank line
    i++;
  }
  return cues;
}

/** Convert a WebVTT document to an SRT document. */
export function vttToSrt(vtt: string): string {
  const cues = parseVtt(vtt);
  return cues
    .map((cue, index) => {
      const start = msToSrtTime(cue.startMs);
      const end = msToSrtTime(cue.endMs);
      return `${index + 1}\n${start} --> ${end}\n${cue.text}`;
    })
    .join('\n\n')
    .concat(cues.length > 0 ? '\n' : '');
}

const TIMING_RE =
  /^(\d{1,2}:)?(\d{1,2}):(\d{2})[.,](\d{3})\s*-->\s*(\d{1,2}:)?(\d{1,2}):(\d{2})[.,](\d{3})/;

function parseTimingLine(line: string): { startMs: number; endMs: number } | null {
  const m = TIMING_RE.exec(line.trim());
  if (!m) return null;
  const [, h1, m1, s1, ms1, h2, m2, s2, ms2] = m as unknown as [
    string, string | undefined, string, string, string,
    string | undefined, string, string, string,
  ];
  return {
    startMs: toMs(h1, m1!, s1, ms1),
    endMs: toMs(h2, m2!, s2, ms2),
  };
}

function toMs(
  hours: string | undefined,
  minutes: string,
  seconds: string,
  millis: string,
): number {
  const h = hours ? Number(hours.replace(':', '')) : 0;
  return h * 3_600_000 + Number(minutes) * 60_000 + Number(seconds) * 1000 + Number(millis);
}

/** "HH:MM:SS,mmm" from milliseconds. */
export function msToSrtTime(ms: number): string {
  const clamped = Math.max(0, Math.floor(ms));
  const h = Math.floor(clamped / 3_600_000);
  const m = Math.floor((clamped % 3_600_000) / 60_000);
  const s = Math.floor((clamped % 60_000) / 1000);
  const rest = clamped % 1000;
  const pad = (n: number, w = 2): string => String(n).padStart(w, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(rest, 3)}`;
}

/** Strip VTT inline markup to plain text. */
function cleanText(text: string): string {
  return text
    .replace(/<[^>]*>/g, '') // all inline tags: <i>, <v Name>, <00:00:01.000>, <c.cls>…
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/^[ \t]+|[ \t]+$/gm, '') // trim each line
    .replace(/\n{3,}/g, '\n\n');
}
