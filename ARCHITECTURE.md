# Architecture

## Module map

```text
┌────────────────────────────────── extension pages ──────────────────────────┐
│  popup/ (React)                       options/ (React)              │
│   ├─ hooks/use-tab-media.ts            └─ options-page.tsx           │
│   ├─ hooks/use-queue.ts                   (chrome.storage wrapper)   │
│   ├─ components/* (media card, quality,                              │
│   │   subtitles, queue view, notice)                                 │
│   └─ app.tsx ──── runtime messages ───►                              │
└──────────────────────────────────┬──────────────────────────────────┘
                                   │ chrome.runtime messaging
┌──────────────────────────────────▼──────────────────────────────────┐
│                    background/service-worker.ts (MV3)                │
│  ├─ messaging.ts        typed router (request/response)              │
│  ├─ download-manager.ts gatekeeping + task creation                  │
│  └─ queue-manager.ts    state machine + concurrency + broadcasts     │
│         │                                                           │
│  ┌──────▼───────────────────────────────────────────────┐           │
│  │ downloads/                                            │           │
│  │  ├─ engine-logic.ts    PURE: chunk plan, backoff, ETA │           │
│  │  ├─ download-engine.ts fetch worker pool, ranges      │           │
│  │  └─ merge-manager.ts   blob assembly + chrome.downloads│          │
│  └───────────────────────────────────────────────────────┘          │
│  ┌───────────────────────────────────────────────────────┐          │
│  │ adapters/ (provider abstraction)                       │          │
│  │  ├─ provider-adapter-interface.ts (contract)           │          │
│  │  ├─ registry.ts (routing)                              │          │
│  │  ├─ direct-media-adapter.ts (plain file URLs)          │          │
│  │  └─ internet-archive-adapter.ts (documented API +      │          │
│  │      official /download/ endpoints; restricted items   │          │
│  │      flagged protected)                                │          │
│  └───────────────────────────────────────────────────────┘          │
│  ┌───────────────────────────────────────────────────────┐          │
│  │ subtitles/ (track download + vtt→srt + language utils) │          │
│  └───────────────────────────────────────────────────────┘          │
│  storage/indexed-db.ts — tasks + chunk blobs (persistent)           │
└─────────────────────────────────────────────────────────────────────┘
                                   ▲
│ content/content-script.ts ───────┘  passive DOM detection, EME signal
(bundled as self-contained IIFE; MV3 content scripts cannot be ES modules)
```

## Data flow (download)

1. **Detect** — content script scans the DOM on load (and on popup request via `GET_MEDIA`), producing `MediaInfo[]` + `SubtitleTrack[]`. EME usage ⇒ `isProtected: true` with reasons.
2. **Resolve** — popup asks the adapter registry for formats (`getAvailableFormats`); for direct files this is a HEAD probe (Content-Length, Accept-Ranges). When DOM detection finds nothing, the popup additionally routes the **page URL** itself through the registry, so page-level adapters (e.g. Internet Archive item pages) can resolve media.
3. **Authorize** — on Download click, the popup requests per-origin host permission (user gesture) and sends `ENQUEUE_DOWNLOAD`.
4. **Gate & plan** — background re-validates URL + protection flag, probes the URL, plans byte-range chunks (`planChunks`) or marks single-stream fallback.
5. **Persist** — the task (with chunk states) is written to IndexedDB **before** activation.
6. **Run** — queue manager starts tasks while `active < maxSimultaneous`; the engine runs a worker pool over chunks; each completed chunk is stored as a Blob in IndexedDB.
7. **Merge** — chunk blobs are assembled into one Blob (file-backed references, not RAM) and handed to `chrome.downloads` via an object URL.
8. **Broadcast** — `QUEUE_UPDATED` (full snapshot) and throttled `PROGRESS_UPDATE` (500 ms) messages keep any open UI in sync.

## MV3 service worker lifecycle strategy

- The worker is **event-driven and mortal**; no correctness depends on memory state.
- Authoritative state lives in IndexedDB (`tasks` store) and Blob-per-chunk data (`chunks` store).
- On every worker start, tasks stuck in `active` without a live run are re-queued (`requeueOrphanedActiveTasks`); completed chunks survive, partial chunks restart.
- Live runs are tracked in a module-level `Map<taskId, AbortController>` that also registers itself on `globalThis.__smdActiveRuns` so the orphan detector can distinguish "running" from "killed mid-run".
- Progress broadcasts double as keep-alive signals while a download is active; even if Chrome kills the worker anyway, resume is automatic on next wake.

## IndexedDB schema (DB `smd`, v1)

| Store | Key | Value |
|---|---|---|
| `tasks` | `id` | full `DownloadTask` (url, chunk states, counters, timestamps) |
| `chunks` | `` `${taskId}:${index}` `` | `{ key, blob }` — one completed byte-range per record |

Settings live separately in `chrome.storage.local` under `settings` (merged over `DEFAULT_SETTINGS` on read, so upgrades never break old installs).

## Testing strategy

Pure logic is isolated in `engine-logic.ts`, `validation.ts`, `vtt-to-srt.ts`, and `language-selector.ts` with zero Chrome-API dependencies, so the critical download math (chunk splitting, backoff/jitter, `Retry-After`, speed EMA, ETA), security validation (URL/filename), and subtitle conversion are covered by fast Vitest suites (44 tests).
