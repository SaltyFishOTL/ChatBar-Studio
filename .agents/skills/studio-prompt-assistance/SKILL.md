---
name: studio-prompt-assistance
description: Maintain web Studio prompt translations, read-only prompt views, generation cost display and token budget UI.
---

# Prompt assistance

- Editable source: `src/ui/components/PromptEditor.tsx`. Shared translation lifetime, debounce and stale-response guard: `usePromptTranslation.ts`; shared raw-text measured overlay: `PromptAnnotations.tsx`. Never put annotation characters in editable/copied/generated text.
- Read-only source: `PromptText.tsx` (`PromptText`, `PromptFields`). Used by Styles, Design results/attachments, Library, Preview recipe fields, Tools metadata/reverse candidates, Studio summaries and CharacterPositionEditor. Raw JSON remains separately expandable. Add new visible prompt surfaces through these components.
- All views use persisted `settings.translate`; default on for new settings or a missing preference; preserve an existing explicit false. App navigation, Studio heading and every PromptEditor header expose the same toggle. Editor headers show 开启/关闭; loading, no-match and failure states are visible, and failure has a retry action. Switching off clears annotations and cancels pending work.
- `data/catalog.ts` owns Worker RPC. `workers/catalog.worker.ts` resolves exact Danbooru Chinese first, then local dictionary; failed terms retain other successful translations through partial RPC and expose the error. Catalog failure permits dictionary lookup with visible warning. Do not silently treat failed queries as successful empty translations.
- Studio owns live counts from normalized outbound prompts. `PromptTokenBudget.tsx` displays linked positive/negative totals separately, V4.5 512 / V5 1471; warning at 85%, red above limit. Disabled roles are excluded upstream. Count failure is visible and never blocks generation; model changes cannot display old-model counts.
- `.generation-submit` holds the token bars directly above generate/stop. The generate button uses `estimateCost`, including quota/free and Vibe labels; fixed desktop/mobile bar must remain visible independently of prompt scrolling.
- Offline regression: `tools/test-prompt-assistance.mjs` uses synthetic SQL catalog/dictionary, tokenizer and design service fixtures. `STUDIO_PLAYWRIGHT_PATH` and `STUDIO_BROWSER_PATH` select local runtimes; optional `STUDIO_SCREENSHOT_PATH` exports a screenshot. Related checks: `test-studio-layout.mjs`, `test-characters.mjs`, `test-metadata-import.mjs`. Production tokenizer asset accuracy, paid APIs and other browsers are outside these UI tests.
