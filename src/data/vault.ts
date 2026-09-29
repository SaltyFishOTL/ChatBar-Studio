import { db, state, changed } from "./db";

// Local-only state, deliberately excluded from backup.allowedState.
const storageKey = "credentials";
const keys = new Map<string, string>();
let revision = 0;
let latestLoad = 0;

export async function loadKeys() {
  const started = revision;
  const load = ++latestLoad;
  const stored = await state<Record<string, string>>(storageKey);
  if (
    stored &&
    (typeof stored !== "object" ||
      Array.isArray(stored) ||
      Object.values(stored).some((value) => typeof value !== "string"))
  )
    throw Error("本机 Key 数据损坏，请在设置中清除后重新填写");
  if (revision !== started || load !== latestLoad) return;
  keys.clear();
  for (const [id, value] of Object.entries(stored || {})) keys.set(id, value);
}

export const getKey = (id: string) => keys.get(id) || "";

export async function setKey(id: string, value: string) {
  const next = value.trim();
  try {
    const tx = (await db).transaction("state", "readwrite");
    const stored = (await tx.store.get(storageKey)) as
      Record<string, string> | undefined;
    const entries = new Map(Object.entries(stored || {}));
    if (next) entries.set(id, next);
    else entries.delete(id);
    await tx.store.put(Object.fromEntries(entries), storageKey);
    await tx.done;
    revision++;
    if (next) keys.set(id, next);
    else keys.delete(id);
    changed();
  } catch {
    throw Error("Key 未能保存到本机，请检查浏览器存储空间或权限后重新填写");
  }
}

export async function forgetKeys() {
  const tx = (await db).transaction("state", "readwrite");
  await tx.store.delete(storageKey);
  await tx.store.delete("vault");
  await tx.done;
  revision++;
  keys.clear();
  changed();
}
