---
name: studio-style-cards
description: Maintain web style-card negative prompts, application, clear behavior, persistence and transfer.
---

- `domain/stylePolicy.ts` owns apply/clear precedence: card.negative trimmed, otherwise settings.defaultNegative. `StudioDraft.appliedStyleCardId` remembers the last explicitly applied card; never infer it from style text or rewrite saved drafts on entry.
- `Styles.tsx` library and `Studio.tsx` picker both apply style and base negative through one undoable edit. Clear removes style/base/extra/roles and restores the currently selected card negative, preserving settings/guidance/card ID. Missing/deleted cards use the settings default. No separate negative-reset control.
- `StyleCard.negative` is optional for legacy IndexedDB/cards/backups. Editor, copy, avatar preview, single-card transfer and full backup preserve it; invalid imported field types fail before writing.
- New drafts use saved settings.defaultNegative. Existing negative fields, including intentionally empty ones, remain unchanged on reload.
- `tools/import_android.py` includes preset negatives. `reference/studio-negative-parity.json` records the scoped Android source/resource hashes; do not refresh unrelated prompts or rewrite baseline evidence for a partial sync.
- New prompt surfaces reuse PromptEditor/PromptText; see studio-prompt-assistance.
- Offline regression: `tools/test-style-negatives.mjs`, with synthetic fixtures and external requests blocked.
