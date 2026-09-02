import type { MediaInfo } from '../../types';

/**
 * The compliance notice shown instead of download controls when media is
 * protected or has no authorized download mechanism. No bypass options
 * are ever offered.
 */
export function ProtectedNotice({ media }: { media: MediaInfo }): React.ReactElement {
  return (
    <div className="space-y-3 border-b border-slate-800 bg-amber-950/40 p-4">
      <p className="text-xs leading-relaxed text-amber-200">
        This media cannot be downloaded by this extension because it is
        protected or does not expose an authorized download mechanism.
      </p>
      <p className="text-xs leading-relaxed text-amber-200/80">
        Please use the platform's official download or offline viewing
        options where available.
      </p>
      {media.protectionReasons.length > 0 && (
        <ul className="space-y-1 border-t border-amber-900/60 pt-2">
          {media.protectionReasons.map((reason) => (
            <li key={reason} className="text-[11px] text-amber-300/70">
              • {reason}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
