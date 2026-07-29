# AGENTS.md

This repository publishes `@swap3d/sdk`.

## Rules

- Treat `swap3d/swap3d-openapi` as the public API source of truth.
- Run `npm run generate` after changing the pinned contract version.
- Do not hand-edit `src/generated/schema.ts`.
- Preserve Node.js 18 support and Fetch-compatible browser runtimes.
- Do not retry non-idempotent conversion submissions automatically.
- Keep API keys out of logs, errors, tests, and browser examples.
- Run `npm test` and `npm pack --dry-run` before release.
