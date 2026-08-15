# Render same-origin fix

The app runs behind Render's reverse proxy. In that deployment, `request.nextUrl.host` can represent the internal Node host rather than the public browser host.

Write routes must use the shared proxy-aware origin guard in `lib/webauthnRequest.ts` instead of comparing the browser `Origin` header directly with `request.nextUrl.host`.

WebAuthn routes keep a stricter rule: an explicit trusted `Origin` header is required.

Staff enrollment links are generated from `webauthnConfig().origin`, so production links use the configured public app origin rather than an internal request URL.
