# Platform Control Edge Boundary

The Platform Owner control plane is clinic-neutral and does not use a clinic tenant membership or a Render-side Supabase service-role credential. Privileged platform data access is delegated to the protected `relife-platform-control` Supabase Edge Function over the existing server-to-server lock-key boundary.

The browser never receives the lock key or Supabase administrative credentials. Platform Owner session authorization remains in the Next.js server before any Edge call.
