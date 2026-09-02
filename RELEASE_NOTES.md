# Smart Media Downloader v1.0.0

Chrome Extension (Manifest V3) for downloading **authorized, directly-exposed** media files with an IDM-style multi-connection engine and subtitle support.

> This extension **never bypasses DRM, encryption, authentication, or platform restrictions**. Protected or non-exposed media (e.g. YouTube's segmented streaming player) is detected and explained — never touched.

## Install

1. Download `SmartMediaDownloader-v1.0.0-dist.zip` below and unzip it.
2. Open `chrome://extensions`, enable **Developer mode**.
3. Click **Load unpacked** and select the unzipped folder.
4. Pin the extension and open any page with a directly-linked media file.

Full details: [INSTALL.md](INSTALL.md).

## Features

- **Multi-connection download engine** — 1/2/4/8/16 connections, byte-range splitting, per-chunk retry with exponential backoff, automatic fallback when a server doesn't support `Range`
- **Live progress UI** — overall %, current/average speed, ETA, and one progress bar per connection
- **Persistent download queue** — pause / resume / cancel / retry / remove / reorder; survives popup closure and service-worker restarts (IndexedDB-backed)
- **Subtitles** — officially exposed tracks, multi-language selection, SRT / VTT / TXT output, local WebVTT→SRT conversion
- **Quality table** — format, codec, estimated size, and audio availability for legitimately exposed variants
- **Full settings page** — downloads, quality preference, subtitles, advanced (retries, chunk size, timeouts)

## Compliance model

- Detects EME (DRM) usage and MSE-only players; shows an informative notice instead of offering downloads
- Per-site host permissions requested **only on user gesture**
- Strict URL and filename validation; minimal permissions (each justified in the README)

## For developers

```bash
npm install
npm run build   # type-check + production build to dist/
npm test        # 44 unit tests (Vitest)
```

**Requirements:** Google Chrome 110+
