# Installation & Build

## Prerequisites

- Node.js 18+ (developed on Node 22)
- Google Chrome 110 or newer

## Build from source

```powershell
cd smart-media-downloader
npm install          # installs React, Vite, Tailwind, TypeScript, Vitest (~170 packages)
npm run build        # type-checks, builds popup/options/service worker, then the content script
```

The ready-to-load extension is emitted to `dist/`.

## Load into Chrome (Load unpacked)

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select the `smart-media-downloader/dist` folder.
4. Pin the extension to the toolbar.

## First use

1. Open any page with a directly-linked media file (e.g. an `.mp4` URL on the page).
2. Click the extension icon — detected media appears with its details.
3. Pick connections (1/2/4/8/16) and optional subtitles, then click **Download**.
4. Chrome will ask for permission to access that one site — allow it. The permission is requested per-site, only when you download something.

## Verify the build

```powershell
npm run typecheck    # TypeScript, strict mode
npm test             # 44 unit tests (engine math, validation, subtitles)
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Could not establish connection" in popup | The page was opened before the extension loaded — reload the tab (content script attaches at `document_idle`). |
| No media detected | The page has no directly-exposed media (protected players are intentionally not supported). Try the **Rescan** button. |
| Permission prompt never appears | Permission prompts must originate from a user gesture — click the Download button again inside the popup. |
| Downloads stuck in "Waiting…" | The queue honors **Maximum simultaneous downloads** (Settings → Downloads, default 2). |
| Icons missing in `dist/` | Run `npm run icons` and rebuild. |

## Uninstall

Remove the extension from `chrome://extensions`. Downloaded files and settings live in your normal Downloads folder and the extension profile respectively; the extension stores chunk temp data only in its own IndexedDB, which Chrome deletes on removal.
