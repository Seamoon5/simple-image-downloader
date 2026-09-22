# Simple Image Downloader (Chrome Extension)

A lightweight Chrome extension that finds all images on your current page — or across **every open tab** — and lets you filter, preview, and batch-download them into a folder of your choice.

Built for speed: the gallery appears instantly, thumbnails load lazily, and image sizes are measured in the background so the popup never waits.

---

## Features

- **Current tab scan** — grabs `<img>` tags, `srcset`/`data-srcset` candidates, `<picture>` sources, CSS background images, and direct image links.
- **Search all open tabs** — one click scans every tab in the current window and merges results without duplicates.
- **Live size probing** — known sizes arrive instantly from the page; missing ones are measured in the background (2s timeout each, 6 at a time, 8-per-batch updates) and fill in on the fly.
- **Filters** — minimum width / height, "only from links", and saved filter settings (Chrome `storage`).
- **Lazy thumbnails** — gallery images load only as you scroll (`loading="lazy"`, `decoding="async"`), so heavy pages stay instant.
- **🌙 / ☀️ Dark & Light mode** — theme toggle in the header, remembered between sessions.
- **Batch download** — with a custom folder name; Chrome creates the folder automatically.
- **Selection survives re-renders** — unchecking an image stays un-checked when sizes fill in or filters re-apply.

---

## How to Install & Test

1. Open Chrome and go to `chrome://extensions`.
2. Turn on **Developer mode** (top-right corner).
3. Click **Load unpacked** (top-left corner).
4. Select this folder (`Image_Pro_4_images - mobile friendly`).
5. Open a page full of images, click the extension icon:
   - **Download Selected Images** — batch-downloads every checked image.
   - **Search Images in All Open Tabs** — scans every tab in the window.
   - **Apply Filters** — hide images below a minimum size and/or keep only direct image links.

---

## Version History

### Version 1.1 (2026-09-22)
- **Big speedup**: the popup now shows the grid instantly. Sizes come from the page's already-loaded images instead of re-downloading every file.
- Background size probing for unknown images (2s timeout, 6 parallel, batched updates) with live size badges that fill in as they're measured.
- Lazy-loading thumbnails so heavy pages don't stall.
- New **dark / light mode** toggle (saved between sessions).
- Fixed: filter settings now persist correctly (added missing `storage` permission).
- Broken images fall back to the extension icon locally instead of an internet placeholder.
- Checkbox selections survive filter re-renders and in-place size updates.

### Version 1.0 (2025-07-23)
- Initial release as "Image Pro / Simple Image Downloader".
- Scan current tab: `<img>`, `srcset`, `<picture>`, CSS backgrounds, direct image links.
- Min width/height filters, "only from links" option, select/deselect all.
- Multi-tab search via background service worker (deduplicates across tabs).
- Download into an optional named folder.

---

## Project Structure

```
│  manifest.json   # Chrome Manifest V3 config
│  background.js   # Multi-tab scan orchestration (service worker)
│  content.js      # In-page image collection + background size probing
│  popup.html      # Popup UI (light/dark theme via CSS variables)
│  popup.js        # Popup logic: gallery, filters, downloads, theme
└─ icons/          # icon16 / icon48 / icon128
```