import { useEffect, useMemo, useState } from 'react';
import type { MediaFormat, MediaInfo, SubtitleFormat, SubtitleTrack } from '../types';
import { findAdapter } from '../adapters/registry';
import { originPatternsFor } from '../utils/validation';
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
  const { media, subtitleTracks, loading, supportedTab, tabUrl, rescan } = useTabMedia();
  const { tasks, progress } = useQueue();

  const [formats, setFormats] = useState<MediaFormat[]>([]);
  const [formatsLoading, setFormatsLoading] = useState(false);
  const [selectedFormatId, setSelectedFormatId] = useState<string | null>(null);
  const [subtitleLanguages, setSubtitleLanguages] = useState<string[]>([]);
  const [subtitleFormat, setSubtitleFormat] = useState<SubtitleFormat>('srt');
  const [connections, setConnections] = useState<number>(8);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pageMedia, setPageMedia] = useState<MediaInfo | null>(null);
  const [adapterTracks, setAdapterTracks] = useState<SubtitleTrack[]>([]);

  const primary = media[0];
  // Page-level adapter fallback: when the page itself is handled by an
  // adapter (e.g. archive.org item pages) but exposes no DOM media, the
  // adapter resolves media from the page URL.
  const activeMedia: MediaInfo | null = primary ?? pageMedia;
  const protectedMedia = activeMedia?.isProtected ?? false;
  const allSubtitleTracks = useMemo(
    () => [...subtitleTracks, ...adapterTracks],
    [subtitleTracks, adapterTracks],
  );

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

  // Page-level adapter resolution (runs only when DOM detection found nothing).
  useEffect(() => {
    let alive = true;
    setPageMedia(null);
    setAdapterTracks([]);
    if (primary || loading || !supportedTab) return;
    if (!tabUrl) return;
    const adapter = findAdapter(tabUrl);
    if (!adapter || !adapter.canHandle(tabUrl)) return;
    setFormatsLoading(true);
    void (async () => {
      try {
        const info = await adapter.getMediaInfo(tabUrl);
        if (!alive) return;
        setPageMedia(info);
        if (info.isProtected) return; // notice path — no formats/subtitles offered
        const list = await adapter.getAvailableFormats(info);
        if (!alive) return;
        setFormats(list);
        setSelectedFormatId(list[0]?.id ?? null);
        if (adapter.getSubtitleTracks) {
          const tracks = await adapter.getSubtitleTracks(info);
          if (alive) setAdapterTracks(tracks);
        }
      } catch (err) {
        if (alive) {
          setError(
            `Could not resolve this page's media: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      } finally {
        if (alive) setFormatsLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [primary, loading, supportedTab, tabUrl]);

  const startDownload = (): void => {
    if (!activeMedia || !selectedFormat || busy) return;
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        // Host permission must be requested from a user gesture (popup).
        // Wildcard-subdomain origins are included so CDN/datnode redirect
        // targets (e.g. archive.org → dn*.ca.archive.org) stay authorized.
        const origins = originPatternsFor(selectedFormat.downloadUrl ?? activeMedia.url);
        if (origins.length === 0) {
          setError('The media URL is invalid or unsupported.');
          return;
        }
        const granted = await chrome.permissions.contains({ origins });
        if (!granted) {
          const ok = await chrome.permissions.request({ origins });
          if (!ok) {
            setError('Site access is required to download this file.');
            return;
          }
        }
        await chrome.runtime.sendMessage({
          type: 'ENQUEUE_DOWNLOAD',
          payload: {
            media: activeMedia,
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

      {supportedTab && !loading && !activeMedia && (
        <p className="px-4 py-6 text-center text-xs text-slate-500">
          No directly-exposed media found on this page.
        </p>
      )}

      {activeMedia && (
        <>
          <MediaCard media={activeMedia} />
          {protectedMedia ? (
            <ProtectedNotice media={activeMedia} />
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
                tracks={allSubtitleTracks}
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
