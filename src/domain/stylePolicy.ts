import type { StudioDraft, StyleCard } from "./types";

export function styleNegative(
  card: StyleCard | undefined,
  defaultNegative: string,
): string {
  return card?.negative?.trim() || defaultNegative.trim();
}

export function applyStyleCard(
  draft: StudioDraft,
  card: StyleCard,
  defaultNegative: string,
): StudioDraft {
  return {
    ...draft,
    style: card.prompt,
    negative: styleNegative(card, defaultNegative),
    appliedStyleCardId: card.id,
  };
}

export function clearStudioPrompts(
  draft: StudioDraft,
  cards: StyleCard[],
  defaultNegative: string,
): StudioDraft {
  const card = cards.find((item) => item.id === draft.appliedStyleCardId);
  return {
    ...draft,
    style: "",
    base: "",
    extra: "",
    characters: [],
    negative: styleNegative(card, defaultNegative),
  };
}
