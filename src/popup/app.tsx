import { useEffect, useMemo, useState } from 'react';
import type { MediaFormat, SubtitleFormat } from '../types';
import { findAdapter } from '../adapters/registry';
import { useQueue } from './hooks/use-queue';
import { useTabMedia } from './hooks/use-tab-media';
import { MediaCard } from './components/media-card';
import { ProtectedNotice } from './components/protected-notice';
import { QualityList } from './components/quality-list';
import { SubtitlePicker } from './components/subtitle-picker';
import { QueueView } from './components/queue-view';

const CONNECTION_CHOICES = [1, 2, 4, 8, 16] as const;

/**
 * Popup: observes the background queue and controls downloads. All real
 * download work lives in the service worker — closing this popup never
 * interrupts an active download.
 */
export default function App(): React.ReactElement {
  const { media, subtitleTracks, loading, supportedTab, rescan } = useTabMedia();
  const { tasks, progress } = useQueue();

  const [formats, setFormats] = useState<MediaFormat[]>([]);
  const [formatsLoading, setFormatsLoading] = useState(false);
  const [selectedFormatId, setSelectedFormatId] = useState<string | null>(null);
  const [subtitleLanguages, setSubtitleLanguages] = useState<string[]>([]);
  const [subtitleFormat, setSubtitleFormat] = useState<SubtitleFormat>('srt');
  const [connections, setConnections] = useState<number>(8);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const primary = media[0];
  const protectedMedia = primary?.isProtected ?? false;

  // Resolve available formats through the adapter system.
  useEffect(() => {
    setFormats([]);
    setSelectedFormatId(null);
    setError(null);
    if (!primary) return;
    if (primary.isProtected) return;
    const adapter = findAdapter(primary.url);
    if (!adapter) {
      setError('No supported authorized source adapter for this media.');
      return;
    }
    let alive = true;
    setFormatsLoading(true);
    void adapter
      .getAvailableFormats(primary)
      .then((list) => {
        if (!alive) return;
        setFormats(list);
        setSelectedFormatId(list[0]?.id ?? null);
      })
      .catch((err: unknown) => {
        if (alive) {
          setError(
            `Could not read media details: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      })
      .finally(() => {
        if (alive) setFormatsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [primary]);

  const selectedFormat = useMemo(
    () => formats.find((f) => f.id === selectedFormatId) ?? null,
    [formats, selectedFormatId],
  );

  const startDownload = (): void => {
    if (!primary || !selectedFormat || busy) return;
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        // Host permission must be requested from a user gesture (popup).
        const origin = originPattern(selectedFormat.downloadUrl ?? primary.url);
        const granted = await chrome.permissions.contains({ origins: [origin] });
        if (!granted) {
          const ok = await chrome.permissions.request({ origins: [origin] });
          if (!ok) {
            setError('Site access is required to download this file.');
            return;
          }
        }
        await chrome.runtime.sendMessage({
          type: 'ENQUEUE_DOWNLOAD',
          payload: {
            media: primary,
            format: selectedFormat,
            connections,
            subtitleLanguages,
            subtitleFormat,
          },
        });
        setSubtitleLanguages([]);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    })();
  };

  const controlTask = (taskId: string, action: 'pause' | 'resume' | 'cancel' | 'retry' | 'remove'): void => {
    void chrome.runtime
      .sendMessage({ type: 'TASK_CONTROL', payload: { taskId, action } })
      .catch(() => undefined);
  };

  const version = chrome.runtime.getManifest().version;

  return (
    <div className="min-h-[200px] bg-slate-900 text-slate-100">
      <header className="flex items-center gap-2 border-b border-slate-700 px-4 py-3">
        <div className="flex h-7 w-7 items-center justify-center rounded bg-accent text-sm font-bold">
          ↓
        </div>
        <div className="flex-1">
          <h1 className="text-sm font-semibold">Smart Media Downloader</h1>
          <p className="text-[11px] text-slate-400">v{version}</p>
        </div>
        <button
          type="button"
          onClick={rescan}
          className="rounded bg-surface-raised px-2 py-1 text-[10px] text-slate-300 hover:bg-surface-overlay"
        >
          Rescan
        </button>
      </header>

      {!supportedTab && !loading && (
        <p className="px-4 py-6 text-center text-xs text-slate-500">
          Open a regular web page to detect media.
        </p>
      )}

      {supportedTab && loading && (
        <p className="px-4 py-6 text-center text-xs text-slate-500">Scanning page…</p>
      )}

      {supportedTab && !loading && !primary && (
        <p className="px-4 py-6 text-center text-xs text-slate-500">
          No directly-exposed media found on this page.
        </p>
      )}

      {primary && (
        <>
          <MediaCard media={primary} />
          {protectedMedia ? (
            <ProtectedNotice media={primary} />
          ) : (
            <>
              <div className="p-4">
                <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  Quality
                </h3>
                {formatsLoading ? (
                  <p className="text-xs text-slate-500">Reading media details…</p>
                ) : formats.length > 0 ? (
                  <QualityList
                    formats={formats}
                    selectedId={selectedFormatId}
                    onSelect={(f) => setSelectedFormatId(f.id)}
                  />
                ) : (
                  <p className="text-xs text-slate-500">
                    {error ?? 'No downloadable variant available.'}
                  </p>
                )}
                <div className="mt-3 flex items-center gap-2 text-xs text-slate-400">
                  <label htmlFor="connections">Connections</label>
                  <select
                    id="connections"
                    value={connections}
                    onChange={(e) => setConnections(Number(e.target.value))}
                    className="rounded bg-surface-raised px-2 py-1 text-xs text-slate-200"
                  >
                    {CONNECTION_CHOICES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <span className="text-[10px] text-slate-500">
                    (used when the server supports byte ranges)
                  </span>
                </div>
                <button
                  type="button"
                  onClick={startDownload}
                  disabled={!selectedFormat || busy}
                  className="mt-3 w-full rounded bg-accent-strong py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy ? 'Starting…' : 'Download'}
                </button>
                {error && (
                  <p className="mt-2 text-[11px] leading-snug text-red-300">{error}</p>
                )}
              </div>
              <SubtitlePicker
                tracks={subtitleTracks}
                selected={subtitleLanguages}
                onToggle={(lang) =>
                  setSubtitleLanguages((prev) =>
                    prev.includes(lang) ? prev.filter((l) => l !== lang) : [...prev, lang],
                  )
                }
                format={subtitleFormat}
                onFormatChange={setSubtitleFormat}
              />
            </>
          )}
        </>
      )}

      <QueueView tasks={tasks} progress={progress} onControl={controlTask} />

      <footer className="border-t border-slate-800 px-4 py-2 text-center text-[10px] text-slate-500">
        Only authorized, directly-exposed media is downloadable. DRM-protected
        content is never touched.
      </footer>
    </div>
  );
}

function originPattern(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}/*`;
  } catch {
    return '*://*/*';
  }
}
