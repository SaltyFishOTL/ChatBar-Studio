import type { Recipe } from "./types";
export type HistoryImage = { recipe: Recipe; asset: string; seed: number };
export function historyImages(recipes: Recipe[]): HistoryImage[] {
  return [...recipes]
    .sort((a, b) => b.createdAt - a.createdAt)
    .flatMap((recipe) => recipe.images.map((i) => ({ recipe, ...i })));
}
const normalize = (s: string) =>
  s.replace(/-?\d*\.?\d*::/g, "").replace(/[^\p{L}\p{N}]/gu, "");
function distance(a: string, b: string) {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const next = [i + 1];
    for (let j = 0; j < b.length; j++)
      next[j + 1] = Math.min(
        next[j] + 1,
        prev[j + 1] + 1,
        prev[j] + (a[i] === b[j] ? 0 : 1),
      );
    prev = next;
  }
  return prev[b.length];
}
function fields(r: Recipe, type: string) {
  const d = r.draft;
  const content = [
    d.base,
    d.extra,
    d.negative,
    ...d.characters.flatMap((c) => [c.prompt, c.negative]),
  ];
  return (
    type === "STYLE"
      ? [d.style]
      : type === "BASE"
        ? [d.base]
        : type === "CONTENT"
          ? content
          : [d.style, ...content]
  ).map(normalize);
}
export function groupHistory(images: HistoryImage[], type: string) {
  const groups: { id: string; title: string; items: HistoryImage[] }[] = [];
  for (const image of images) {
    const date = new Date(image.recipe.createdAt);
    if (["DAY", "MONTH", "YEAR"].includes(type)) {
      const title =
        type === "YEAR"
          ? String(date.getFullYear())
          : type === "MONTH"
            ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
            : date.toLocaleDateString();
      const found = groups.find((g) => g.title === title);
      if (found) found.items.push(image);
      else groups.push({ id: image.asset, title, items: [image] });
      continue;
    }
    const candidate = fields(image.recipe, type);
    const found = groups.find((g) => {
      const base = fields(g.items[0].recipe, type);
      if (base.length !== candidate.length) return false;
      const total = base.reduce(
          (n, s, i) => n + Math.max(s.length, candidate[i].length),
          0,
        ),
        diff = base.reduce((n, s, i) => n + distance(s, candidate[i]), 0);
      return total === 0 || diff / total < 0.15;
    });
    if (found) found.items.push(image);
    else
      groups.push({
        id: image.asset,
        title:
          image.recipe.draft.base.slice(0, 45) ||
          image.recipe.draft.style.slice(0, 45) ||
          "未命名",
        items: [image],
      });
  }
  return groups;
}
