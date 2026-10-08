---
name: studio-reverse-prompt
description: Maintain image-tool reverse Prompt recognition, editable scene confirmation, language-mode routing and candidate application.
---

# Reverse Prompt

- `src/ui/Tools.tsx` owns scene text, candidate, target snapshot and abort controller. Recognition finishes before user review; nonblank confirmation starts a separate design operation. Editing invalidates the candidate; source replacement clears both scene and candidate.
- `src/domain/design.ts`: `recognizeReverseScene` uses the selected multimodal model or linked vision model with its own parameters. It returns scene text without catalog research. `designTurn` requires confirmed scene text for reverse turns, skips original-image handling, replans queries from the corrected text and uses it as final design evidence.
- Follow `settings.naturalLanguage`: enabled targets V5 and skips Tag postprocessing; disabled uses the current draft model. Applying the candidate switches to its captured target and preserves style, negatives, generation settings and references.
- Ordinary AI design image attachments retain the automatic pipeline. Shared prompt text stays in `src/domain/prompts.ts` and imported prompt constants.
- Regression: `tools/test-reverse-confirmation.mjs` uses synthetic images, model responses and catalog messages; `tools/test-prompt-assistance.mjs` stubs both recognition and design and explicitly confirms the scene.
