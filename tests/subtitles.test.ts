import { describe, expect, it } from 'vitest';
import {
  msToSrtTime,
  parseVtt,
  vttToSrt,
} from '../src/subtitles/vtt-to-srt';
import {
  dedupeTracks,
  languageLabel,
  selectTracks,
  sortTracksForDisplay,
} from '../src/subtitles/language-selector';
import type { SubtitleTrack } from '../src/types';

const SAMPLE_VTT = `WEBVTT

NOTE This is a comment block
spanning multiple lines.

1
00:00:01.000 --> 00:00:04.000
Hello world!

2
00:00:05.500 --> 00:00:07.250
Second cue with <i>italics</i> and
a second line.

00:01:02.100 --> 00:01:05.900
No id line here.

SHORT
00:30.000 --> 01:00.000
Minutes-only timestamp.
`;

describe('parseVtt', () => {
  it('parses cues, skipping NOTE blocks and the header', () => {
    const cues = parseVtt(SAMPLE_VTT);
    expect(cues).toHaveLength(4);
    expect(cues[0]).toEqual({ startMs: 1000, endMs: 4000, text: 'Hello world!' });
  });

  it('handles minutes-only timestamps and missing ids', () => {
    const cues = parseVtt(SAMPLE_VTT);
    expect(cues[2]).toEqual({ startMs: 62_100, endMs: 65_900, text: 'No id line here.' });
    expect(cues[3]).toEqual({ startMs: 30_000, endMs: 60_000, text: 'Minutes-only timestamp.' });
  });

  it('strips inline tags but keeps the text', () => {
    const cues = parseVtt(SAMPLE_VTT);
    expect(cues[1]!.text).toBe('Second cue with italics and\na second line.');
  });

  it('returns [] for empty input', () => {
    expect(parseVtt('')).toEqual([]);
    expect(parseVtt('WEBVTT\n')).toEqual([]);
  });
});

describe('vttToSrt', () => {
  it('converts timestamps to comma form and numbers cues', () => {
    const srt = vttToSrt(SAMPLE_VTT);
    expect(srt).toContain('1\n00:00:01,000 --> 00:00:04,000\nHello world!');
    expect(srt).toContain('2\n00:00:05,500 --> 00:00:07,250');
    expect(srt).toContain('4\n00:00:30,000 --> 00:01:00,000');
  });

  it('drops markup from output', () => {
    const srt = vttToSrt(SAMPLE_VTT);
    expect(srt).not.toContain('<i>');
    expect(srt).toContain('Second cue with italics');
  });

  it('produces empty output for an empty VTT', () => {
    expect(vttToSrt('WEBVTT\n')).toBe('');
  });
});

describe('msToSrtTime', () => {
  it('formats hours, minutes, seconds, millis', () => {
    expect(msToSrtTime(0)).toBe('00:00:00,000');
    expect(msToSrtTime(3_723_456)).toBe('01:02:03,456');
    expect(msToSrtTime(86_399_999)).toBe('23:59:59,999');
  });
});

const TRACKS: SubtitleTrack[] = [
  { id: 'a', language: 'fr', languageLabel: '', url: 'https://x/fr.vtt', format: 'vtt' },
  { id: 'b', language: 'en', languageLabel: '', url: 'https://x/en.vtt', format: 'vtt' },
  { id: 'c', language: 'ar', languageLabel: 'العربية', url: 'https://x/ar.vtt', format: 'vtt' },
  { id: 'd', language: 'en', languageLabel: 'English (dup)', url: 'https://x/en2.vtt', format: 'vtt' },
];

describe('language-selector', () => {
  it('labels known languages and keeps page-provided labels', () => {
    expect(languageLabel('en')).toBe('English');
    expect(languageLabel('fr', 'Français')).toBe('Français');
    expect(languageLabel('xx')).toBe('xx');
  });

  it('dedupes by language keeping the first', () => {
    expect(dedupeTracks(TRACKS)).toHaveLength(3);
    expect(dedupeTracks(TRACKS).find((t) => t.language === 'en')?.id).toBe('b');
  });

  it('sorts alphabetically for display', () => {
    const sorted = sortTracksForDisplay(dedupeTracks(TRACKS));
    expect(sorted.map((t) => t.language)).toEqual(['ar', 'en', 'fr']);
  });

  it('selects requested languages in display order', () => {
    const selected = selectTracks(TRACKS, ['fr', 'en']);
    expect(selected.map((t) => t.language)).toEqual(['en', 'fr']);
  });
});
