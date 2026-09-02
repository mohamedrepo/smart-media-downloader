import type { MediaInfo } from '../../types';
import { formatDuration } from '../../utils/format';

/** Header card: thumbnail, title, source, duration. */
export function MediaCard({ media }: { media: MediaInfo }): React.ReactElement {
  return (
    <div className="flex gap-3 border-b border-slate-800 p-4">
      <div className="h-16 w-28 shrink-0 overflow-hidden rounded bg-slate-800">
        {media.thumbnailUrl ? (
          <img
            src={media.thumbnailUrl}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xl text-slate-600">
            {media.kind === 'audio' ? '♪' : media.kind === 'video' ? '▶' : '◦'}
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-sm font-semibold text-slate-100" title={media.title}>
          {media.title}
        </h2>
        <p className="mt-0.5 truncate text-xs text-slate-400">
          {media.sourceDomain}
        </p>
        <p className="mt-1 text-[11px] text-slate-500">
          {media.kind === 'unknown' ? 'Media file' : media.kind}
          {media.durationSeconds ? ` · ${formatDuration(media.durationSeconds)}` : ''}
          {` · via ${media.adapterName}`}
        </p>
      </div>
    </div>
  );
}
