# Smart Media Downloader

A Chrome Extension (Manifest V3) for downloading media **only** from sources where downloading is authorized, technically supported, and legally permitted — with an IDM-style multi-connection engine and subtitle support.

**This extension never bypasses DRM, encryption, authentication, access controls, or website security mechanisms.** When media is protected or not exposed as an authorized downloadable resource, it displays an informative message instead of attempting a download.

## What it can download

| Media type | Supported | Why |
|---|---|---|
| Direct media files (`.mp4`, `.webm`, `.mov`, `.mkv`, `.mp3`, `.m4a`, …) | ✅ | The site serves the file to the browser as an ordinary HTTP(S) resource — by definition authorized for direct retrieval. |
| Page-exposed subtitle tracks (`<track>` elements) | ✅ | Officially exposed to the browser; WebVTT → SRT conversion is done locally. |
| MSE/segmented streaming players (YouTube, most modern players — `blob:` video sources) | ❌ | No file is exposed; streams are assembled in-memory from segments. The popup explains this instead of offering a download. Extracting stream URLs would mean circumventing platform restrictions. |
| Platform/DRM-protected streams (Widevine/EME, encrypted HLS/DASH) | ❌ | Never. The extension detects EME usage and shows a notice instead. |
| Content behind authentication or access controls | ❌ | Never. |

The architecture is adapter-based (`MediaProviderAdapter`), so sources with **documented, explicitly authorized download mechanisms** can be added as new adapters without touching the engine.

## Features

- **Multi-connection download engine** — probes `Accept-Ranges`/`Content-Length`, splits the file into byte ranges, downloads them concurrently (1/2/4/8/16 connections, default 8), retries failed chunks with exponential backoff, and resumes after browser restarts. Falls back to a single stream when a server doesn't support `Range`.
- **Per-connection progress UI** — overall %, current/average speed, ETA, downloaded/total bytes, and an individual progress bar per connection.
- **Download queue** — add / pause / resume / cancel / retry / remove / reorder, with a configurable maximum of simultaneous downloads. Fully persisted in IndexedDB; downloads continue when the popup is closed.
- **Subtitle manager** — lists officially exposed tracks, multi-language selection, SRT / VTT / TXT output, local WebVTT→SRT conversion, `Video Title.en.srt`-style naming.
- **Quality table** — only legitimately available variants are shown, with format, codec, estimated size, and audio availability.
- **Robust error handling** — human-readable messages for network interruption, timeouts, HTTP 403/404/429 (with `Retry-After` support), expired URLs, missing `Content-Length`, no-Range servers, failed chunks, and cancellation.
- **Modern UI** — React + Tailwind popup and options page (dark theme).

## Permissions — and why each one exists

| Permission | Justification |
|---|---|
| `downloads` | Hands the assembled file to Chrome's downloader (`chrome.downloads.download`), which streams to disk and shows progress in the download shelf. |
| `storage` | Persists user settings (`chrome.storage.local`). |
| `tabs` | Queries the **active tab** to offer the popup a rescan/detection snapshot of the page you are viewing. No browsing history is read or stored. |
| `notifications` | Optional surface for download completion/failure notices (never used for anything else). |
| `optional_host_permissions: http://*/*, https://*/*` | Requested **per-origin, on user action**: when you click Download for a media file, the extension asks for access to that site only. Nothing is fetched from sites you never download from. |

The content script is passive: it reads the public DOM (`<video>`, `<audio>`, `<source>`, `<track>`, media-file links), records whether the page uses Encrypted Media Extensions (a protection signal), and sends the result only to this extension's own background worker. It does not modify pages, does not intercept keystrokes, and does not talk to any third-party server.

## Compliance model

1. **Detection** — passive DOM scan finds directly-exposed media and `<track>` subtitles; EME usage marks the page as protected.
2. **Gating** — protected media is refused at the manager level (`ProtectedMediaError`), the popup never offers controls, and the UI shows: *"This media cannot be downloaded by this extension because it is protected or does not expose an authorized download mechanism…"*
3. **Access control** — URLs are validated (http/https only, no credentials, no loopback/private-network targets), and origin permissions are requested per-site on user gesture.
4. **Adapters** — new sources are supported only via adapters implementing the `MediaProviderAdapter` contract, which documents the "authorized mechanisms only" rule in code.

## Quick start

```powershell
npm install
npm run build
```

Then in Chrome: `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select the `dist/` folder.

See [INSTALL.md](INSTALL.md) for details and [ARCHITECTURE.md](ARCHITECTURE.md) for how it works inside.

## Development

```powershell
npm run dev          # build main bundle in watch mode (popup, options, service worker)
npm run dev:content  # build the content script in watch mode
npm run typecheck    # tsc --noEmit
npm test             # vitest run (44 assertions across 3 suites)
npm run build        # typecheck + full production build
npm run icons        # regenerate PNG icons (no dependencies)
```

## Known limitations

- Quality variants beyond "original" (1080p/720p/…) exist only when a source adapter exposes them; direct files have exactly one variant — the file as served. No quality transmuxing/decryption is performed.
- Partial chunk bytes are not persisted; a paused/killed chunk restarts that chunk (completed chunks are always kept).
- Multi-connection mode requires the server to support `Accept-Ranges: bytes`; otherwise the engine automatically uses a single stream.
