# ChatBar Studio

Independent browser application migrated from ChatBar Android. Read docs/HANDOFF.md and docs/PARITY.md before modifying migration behavior.

- Browser calls user-selected APIs directly. Never add a server proxy, shared API key, telemetry, or upload of user data.
- Keep all model-facing text in src/domain/prompts.ts and imported data/prompts.json. Preserve Android prompt wording unless explicitly authorized.
- Style cards contain only management metadata, style text, and one avatar. Applying a card must not overwrite scene, negative, roles, parameters or references.
- Persistence and generation must be transactional. Never automatically retry ambiguous paid requests. HTTP 429 retries alone are permitted.
- Do not execute automated tests or paid requests without explicit user authorization. Type checking and production builds are authorized.
- Do not read bundled presets in behavior tests; use independent inline fixtures.
- No Android edits. Keep migration evidence accurate; never mark parity complete from compilation alone.
- For web releases, use `.agents/skills/studio-web-release/SKILL.md`; this independent project does not use Android APK release automation.
