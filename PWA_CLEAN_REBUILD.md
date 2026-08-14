# Clean PWA rebuild

This branch rebuilds the Owner App PWA layer without changing dashboard or data logic.

- Single Next.js `app/manifest.ts` source
- Explicit app id and root scope
- Root-scoped service worker with stale-cache cleanup
- Service worker registration bypasses HTTP cache
- `/pwa-check` diagnostics page
- Existing 192px, 512px and Apple touch icons retained
