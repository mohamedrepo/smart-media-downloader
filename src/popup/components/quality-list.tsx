import type { MediaFormat } from '../../types';
import { formatBytes } from '../../utils/format';

export interface QualityRow {
  quality: string;
  container: string;
  codec?: string;
  size?: string;
  audio: boolean;
}

/**
 * Quality table: only variants legitimately exposed by the source are
 * listed. Direct files typically expose exactly one (the original).
 */
export function QualityList({
  formats,
  selectedId,
  onSelect,
}: {
  formats: MediaFormat[];
  selectedId: string | null;
  onSelect: (format: MediaFormat) => void;
}): React.ReactElement {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between px-1 text-[10px] uppercase tracking-wide text-slate-500">
        <span>Quality | Format | Size</span>
        <span>Audio</span>
      </div>
      {formats.map((format) => {
        const selected = format.id === selectedId;
        return (
          <button
            key={format.id}
            type="button"
            onClick={() => onSelect(format)}
            className={
              'flex w-full items-center justify-between rounded px-3 py-2 text-left text-xs transition-colors ' +
              (selected
                ? 'bg-accent-strong/30 text-slate-100 ring-1 ring-accent'
                : 'bg-surface-raised text-slate-300 hover:bg-surface-overlay')
            }
          >
            <span className="flex items-baseline gap-2">
              <span className="font-semibold">{format.label}</span>
              <span className="uppercase text-slate-400">{format.container}</span>
              {format.codec && (
                <span className="text-slate-500">{format.codec}</span>
              )}
              <span className="text-slate-400">
                {format.estimatedSizeBytes ? formatBytes(format.estimatedSizeBytes) : ''}
              </span>
            </span>
            <span
              className={
                format.isAudioOnly
                  ? 'text-slate-500'
                  : 'text-emerald-400'
              }
              title={format.isAudioOnly ? 'Audio-only file' : 'Includes audio track'}
            >
              {format.isAudioOnly ? 'audio only' : '♪ ✓'}
            </span>
          </button>
        );
      })}
    </div>
  );
}
