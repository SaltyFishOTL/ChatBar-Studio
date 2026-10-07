import { openDB, type DBSchema } from "idb";
import type {
  Asset,
  DesignConversation,
  Recipe,
  Settings,
  StudioDraft,
  StyleCard,
  Task,
} from "../domain/types";
interface Schema extends DBSchema {
  state: { key: string; value: unknown };
  assets: { key: string; value: Asset };
  cards: { key: string; value: StyleCard };
  history: { key: string; value: Recipe };
  conversations: { key: string; value: DesignConversation };
  cache: { key: string; value: unknown };
}
export const db = openDB<Schema>("chatbar-studio", 1, {
  upgrade(d) {
    for (const name of [
      "state",
      "assets",
      "cards",
      "history",
      "conversations",
      "cache",
    ] as const)
      d.createObjectStore(name);
  },
});
export const changes = new EventTarget();
const channel =
  typeof BroadcastChannel !== "undefined"
    ? new BroadcastChannel("chatbar-studio-data")
    : null;
channel?.addEventListener("message", () =>
  changes.dispatchEvent(new Event("change")),
);
export function changed() {
  changes.dispatchEvent(new Event("change"));
  channel?.postMessage("change");
}
export async function state<T>(key: string): Promise<T | undefined> {
  if (key === "draft" || key === "historyApplyUndo") {
    const tx = (await db).transaction(["state", "assets"], "readwrite");
    const draft = (await tx.objectStore("state").get(key)) as
      StudioDraft | undefined;
    if (draft) {
      await compactDraftPayloads(draft, tx.objectStore("assets"));
      await tx.objectStore("state").put(draft, key);
    }
    await tx.done;
    return draft as T | undefined;
  }
  return (await db).get("state", key) as Promise<T | undefined>;
}
export async function saveState(key: string, value: unknown) {
  if (key === "historyApplyUndo") {
    const tx = (await db).transaction(["state", "assets"], "readwrite");
    const snapshot = structuredClone(value) as StudioDraft;
    await compactDraftPayloads(snapshot, tx.objectStore("assets"));
    await tx.objectStore("state").put(snapshot, key);
    await tx.done;
  } else await (await db).put("state", value, key);
  changed();
}
export async function saveDraft(draft: StudioDraft) {
  const tx = (await db).transaction(["state", "assets"], "readwrite");
  const snapshot = structuredClone(draft);
  await compactDraftPayloads(snapshot, tx.objectStore("assets"));
  await tx.objectStore("state").put(snapshot, "draft");
  await tx.done;
  changed();
}
export const VIBE_ASSET_PREFIX = "chatbar-vibe-asset:";
export async function compactDraftPayloads(
  draft: StudioDraft,
  assets: { put: (value: Asset, key: string) => Promise<unknown> },
) {
  for (const reference of draft.guidance.vibes) {
    const value = reference.encoding;
    if (!value || value.startsWith(VIBE_ASSET_PREFIX) || value.length < 4096)
      continue;
    const id = crypto.randomUUID();
    await assets.put(
      {
        id,
        blob: new Blob([value], { type: "application/x-novelai-vibe" }),
        createdAt: Date.now(),
      },
      id,
    );
    reference.encoding = VIBE_ASSET_PREFIX + id;
  }
}
export async function resolveVibePayload(value: string): Promise<string> {
  return value.startsWith(VIBE_ASSET_PREFIX)
    ? (await assetBlob(value.slice(VIBE_ASSET_PREFIX.length))).text()
    : value;
}
// Cursor reads one legacy recipe at a time. Grouping retains exact text/folds; raw requests stay on disk.
export async function loadHistoryCompact(): Promise<Recipe[]> {
  const tx = (await db).transaction(["history", "assets"], "readwrite"),
    items: Recipe[] = [];
  let cursor = await tx.objectStore("history").openCursor();
  while (cursor) {
    const recipe = cursor.value;
    const old = recipe.draft.guidance.vibes.map((v) => v.encoding);
    await compactDraftPayloads(recipe.draft, tx.objectStore("assets"));
    if (recipe.draft.guidance.vibes.some((v, i) => v.encoding !== old[i]))
      await cursor.update(recipe);
    items.push({ ...recipe, request: {} });
    cursor = await cursor.continue();
  }
  await tx.done;
  return items;
}
export async function saveSettings(settings: Settings) {
  await saveState("settings", settings);
}
export async function putAsset(blob: Blob): Promise<string> {
  const id = crypto.randomUUID();
  await (await db).put("assets", { id, blob, createdAt: Date.now() }, id);
  return id;
}
export async function saveToolResult(blob: Blob, source: string) {
  const id = crypto.randomUUID(),
    tx = (await db).transaction(["assets", "state"], "readwrite");
  await tx.objectStore("assets").put({ id, blob, createdAt: Date.now() }, id);
  const items = ((await tx.objectStore("state").get("toolResults")) || []) as {
    id: string;
    source: string;
    createdAt: number;
  }[];
  await tx
    .objectStore("state")
    .put([{ id, source, createdAt: Date.now() }, ...items], "toolResults");
  await tx.done;
  changed();
  return id;
}
export async function assetBlob(id: string): Promise<Blob> {
  if (id.startsWith("/data/")) {
    const r = await fetch(id);
    if (!r.ok) throw Error("资源读取失败");
    return r.blob();
  }
  const a = await (await db).get("assets", id);
  if (!a) throw Error("图片资源缺失");
  return a.blob;
}
export async function saveCard(card: StyleCard) {
  if (card.id.startsWith("preset:")) throw Error("预置卡请先复制");
  await (await db).put("cards", card, card.id);
  changed();
}
export async function replaceAvatar(
  id: string,
  blob: Blob,
  expectedPrompt: string,
) {
  const tx = (await db).transaction(["cards", "assets"], "readwrite");
  const card = await tx.objectStore("cards").get(id);
  if (!card || card.prompt !== expectedPrompt) {
    await tx.done;
    throw Error("卡片已删除或画风已修改，头像未替换");
  }
  const asset = crypto.randomUUID();
  await tx
    .objectStore("assets")
    .put({ id: asset, blob, createdAt: Date.now() }, asset);
  await tx
    .objectStore("cards")
    .put({ ...card, avatar: asset, updatedAt: Date.now() }, id);
  await tx.done;
  changed();
}
export async function deleteCard(id: string) {
  if (id.startsWith("preset:")) throw Error("不能删除预置卡");
  await (await db).delete("cards", id);
  changed();
}
/** Commit editor card and avatar together; never resurrect a deleted card. */
export async function saveEditedCard(
  card: StyleCard,
  avatar: Blob | null,
  expectedVersion: number | null,
) {
  if (card.id.startsWith("preset:")) throw Error("预置卡请先复制");
  const tx = (await db).transaction(["cards", "assets"], "readwrite");
  const current = await tx.objectStore("cards").get(card.id);
  if (
    expectedVersion === null
      ? !!current
      : !current || current.updatedAt !== expectedVersion
  ) {
    await tx.done;
    throw Error("卡片已删除或被其他页面修改，请重新打开编辑");
  }
  let asset = card.avatar;
  if (avatar) {
    asset = crypto.randomUUID();
    await tx
      .objectStore("assets")
      .put({ id: asset, blob: avatar, createdAt: Date.now() }, asset);
  }
  await tx
    .objectStore("cards")
    .put({ ...card, avatar: asset, updatedAt: Date.now() }, card.id);
  await tx.done;
  changed();
}
export async function commitBatch(recipe: Recipe, images: Blob[]) {
  if (images.length !== recipe.images.length) throw Error("批次图片数量不匹配");
  const tx = (await db).transaction(["history", "assets"], "readwrite");
  images.forEach((blob, i) =>
    tx
      .objectStore("assets")
      .put(
        { id: recipe.images[i].asset, blob, createdAt: recipe.createdAt },
        recipe.images[i].asset,
      ),
  );
  await compactDraftPayloads(recipe.draft, tx.objectStore("assets"));
  await tx.objectStore("history").put(recipe, recipe.id);
  await tx.done;
  changed();
}
export async function deleteHistoryAssets(selected: Set<string>) {
  if (!selected.size) return 0;
  const tx = (await db).transaction("history", "readwrite");
  let count = 0;
  let cursor = await tx.store.openCursor();
  while (cursor) {
    const r = cursor.value,
      images = r.images.filter((i) => !selected.has(i.asset));
    if (images.length !== r.images.length) {
      count += r.images.length - images.length;
      if (images.length) await cursor.update({ ...r, images });
      else await cursor.delete();
    }
    cursor = await cursor.continue();
  }
  await tx.done;
  if (count) changed(); // Drafts/undo can still reference these assets. Only explicit cleanup owns deletion.
  return count;
}
export async function saveConversation(c: DesignConversation) {
  const tx = (await db).transaction(["state", "conversations"], "readwrite");
  await tx.objectStore("conversations").put(c, c.id);
  await tx.objectStore("state").put(c.id, "currentConversation");
  const all = (await tx.objectStore("conversations").getAll()).sort(
    (a, b) => b.updatedAt - a.updatedAt,
  );
  for (const old of all.filter((x) => x.id !== c.id).slice(100))
    await tx.objectStore("conversations").delete(old.id);
  await tx.done;
  changed();
}
export async function withGenerationLock<T>(
  kind: string,
  action: () => Promise<T>,
): Promise<T> {
  if (!navigator.locks)
    throw Error("当前浏览器不支持跨标签页任务锁，请使用新版浏览器");
  return navigator.locks.request(
    "chatbar-studio-generation",
    { ifAvailable: true },
    async (lock) => {
      if (!lock) throw Error("另一个标签页正在生成，请等待或停止该任务");
      const task: Task = {
        id: crypto.randomUUID(),
        kind,
        status: "running",
        startedAt: Date.now(),
      };
      await saveState("task", task);
      try {
        const result = await action();
        await saveState("task", null);
        return result;
      } catch (error) {
        try {
          await saveState("task", { ...task, status: "interrupted" });
        } catch {}
        throw error;
      }
    },
  );
}
export async function interruptedTask(): Promise<Task | null> {
  const task = await state<Task>("task");
  if (!task) return null;
  if (!navigator.locks) return task;
  return navigator.locks.request(
    "chatbar-studio-generation",
    { ifAvailable: true },
    async (lock) => (lock ? { ...task, status: "interrupted" } : null),
  );
}
