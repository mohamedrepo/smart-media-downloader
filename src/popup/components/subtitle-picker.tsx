import { useMemo, useState } from 'react';
import type { SubtitleFormat, SubtitleTrack } from '../../types';
import { dedupeTracks, languageLabel, sortTracksForDisplay } from '../../subtitles/language-selector';

/**
 * Subtitle language picker: checkboxes per officially-exposed track plus
 * the SRT/VTT output format radio. Languages with no exposed tracks are
 * never offered — nothing is fetched from anywhere else.
 */
export function SubtitlePicker({
  tracks,
  selected,
  onToggle,
  format,
  onFormatChange,
}: {
  tracks: SubtitleTrack[];
  selected: string[];
  onToggle: (language: string) => void;
  format: SubtitleFormat;
  onFormatChange: (format: SubtitleFormat) => void;
}): React.ReactElement | null {
  const unique = useMemo(() => sortTracksForDisplay(dedupeTracks(tracks)), [tracks]);
  const [expanded, setExpanded] = useState(false);

  if (unique.length === 0) return null;

  return (
    <div className="border-t border-slate-800 p-4">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-400"
      >
        <span>Subtitles ({selected.length} selected)</span>
        <span>{expanded ? '▾' : '▸'}</span>
      </button>
      {expanded && (
        <div className="mt-3 space-y-2">
          {unique.map((track) => {
            const checked = selected.includes(track.language);
            return (
              <label
                key={track.id}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs text-slate-300 hover:bg-surface-raised"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(track.language)}
                  className="h-3.5 w-3.5 accent-blue-500"
                />
                <span>{languageLabel(track.language, track.languageLabel)}</span>
                <span className="ml-auto text-[10px] uppercase text-slate-500">
                  {track.format}
                </span>
              </label>
            );
          })}
          <div className="flex items-center gap-4 border-t border-slate-800 pt-2 text-xs text-slate-400">
            Format:
            {(['srt', 'vtt'] as SubtitleFormat[]).map((f) => (
              <label key={f} className="flex cursor-pointer items-center gap-1">
                <input
                  type="radio"
                  name="subtitle-format"
                  checked={format === f}
                  onChange={() => onFormatChange(f)}
                  className="accent-blue-500"
                />
                {f.toUpperCase()}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
