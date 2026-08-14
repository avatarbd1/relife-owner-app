# Clean PWA rebuild

This branch rebuilds the Owner App PWA layer without changing dashboard/data logic.

- Explicit static `/manifest.webmanifest`
- Explicit app id and root scope
- Root-scoped service worker with cache cleanup
- Service worker update bypasses HTTP cache
- `/pwa-check` diagnostics page
- Existing 192/512 icons retained
