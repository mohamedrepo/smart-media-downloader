/**
 * Language selector helpers — pure logic for presenting subtitle languages.
 */

import type { SubtitleTrack } from '../types';

/** Common BCP-47-ish codes → display names (UI fallback when the page
 *  doesn't provide labels). Extend as needed. */
const LANGUAGE_LABELS: Record<string, string> = {
  en: 'English',
  ar: 'Arabic',
  fr: 'French',
  es: 'Spanish',
  de: 'German',
  it: 'Italian',
  pt: 'Portuguese',
  ru: 'Russian',
  zh: 'Chinese',
  ja: 'Japanese',
  ko: 'Korean',
  hi: 'Hindi',
  tr: 'Turkish',
  fa: 'Persian',
  id: 'Indonesian',
  nl: 'Dutch',
  pl: 'Polish',
  sv: 'Swedish',
  he: 'Hebrew',
  und: 'Unknown',
};

export function languageLabel(code: string, fallback?: string): string {
  if (fallback && fallback.trim() !== '') return fallback;
  const base = code.toLowerCase().split('-')[0] ?? code;
  return LANGUAGE_LABELS[base] ?? code;
}

/** Deduplicate tracks by language, preferring the first occurrence. */
export function dedupeTracks(tracks: SubtitleTrack[]): SubtitleTrack[] {
  const seen = new Set<string>();
  return tracks.filter((t) => {
    if (seen.has(t.language)) return false;
    seen.add(t.language);
    return true;
  });
}

/** Sort deterministically by language code (stable across locales).
 *  "und" (unknown) sorts last. */
export function sortTracksForDisplay(tracks: SubtitleTrack[]): SubtitleTrack[] {
  return [...tracks].sort((a, b) => {
    if (a.language === 'und') return 1;
    if (b.language === 'und') return -1;
    return a.language.localeCompare(b.language);
  });
}

/** Tracks the user has selected, deduplicated, in a stable display order. */
export function selectTracks(
  tracks: SubtitleTrack[],
  selectedLanguages: string[],
): SubtitleTrack[] {
  const set = new Set(selectedLanguages);
  return sortTracksForDisplay(dedupeTracks(tracks)).filter((t) =>
    set.has(t.language),
  );
}
