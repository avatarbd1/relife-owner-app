# PR verification scope

Risk: HIGH because the UX writes tenant configuration and feature flags.

Authority changes: no business writer cutover; a new canonical feature-flag writer is added for Owner selection of already-entitled modules.

Production touched: no.

Migration added: no.

Required checks: PR impact gate, lint, full tests, production build, TypeScript compilation, and owner self-service boundary regression tests.
