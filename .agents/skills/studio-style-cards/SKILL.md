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

- Optional StyleCard.imageSettings stores model/sampler/steps/guidance/cfgRescale/varietyPlus. Advanced details starts collapsed below style. imageCapabilities.cardImageSettings selects only these fields; applyCardImageSettings never overwrites dimensions/count/seed. Editor/copy/avatar/card export/backup preserve it; invalid import fails before writing.
- imageCapabilities owns per-model sampler options and V4.5-only V+. V5 requests omit skip_cfg_above_sigma; V4.5 uses 58/null. Legacy unsupported samplers resolve to Euler Ancestral. Metadata import preserves V+.
- Reverse-image design preserves the exact selected linked vision model parameters, including reasoning and output limits.
- db.state/saveDraft/commitBatch externalize large Vibe encodings to transaction-owned Blob assets using chatbar-vibe-asset references. loadHistoryCompact reads cursors and excludes raw requests from resident UI objects while retaining them on disk. Full backups retain blobs and validate references. Do not delete these assets merely because a history image is deleted.
- tests/advanced-generation.ts adds model-parameter, advanced profile, V+, legacy-history migration, idempotence and backup tests to test-style-negatives.mjs.
