import { validCardImageSettings } from "../domain/imageCapabilities";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { db, changed, assetBlob, VIBE_ASSET_PREFIX } from "./db";
import { base64, bytesOf, fromBase64 } from "../domain/images";
import { validateManifest } from "./validation";
import type {
  Asset,
  StyleCard,
  StudioDraft,
  Settings,
  Recipe,
  DesignConversation,
} from "../domain/types";
const allowedState = [
  "draft",
  "settings",
  "currentConversation",
  "historyApplyUndo",
  "toolResults",
];
export async function exportBackup() {
  const d = await db,
    tx = d.transaction(
      ["state", "cards", "history", "conversations", "assets"],
      "readonly",
    );
  const [keys, states, cards, history, conversations, assets] =
    await Promise.all([
      tx.objectStore("state").getAllKeys(),
      tx.objectStore("state").getAll(),
      tx.objectStore("cards").getAll(),
      tx.objectStore("history").getAll(),
      tx.objectStore("conversations").getAll(),
      tx.objectStore("assets").getAll(),
    ]);
  await tx.done;
  const files: Record<string, Uint8Array> = {};
  const state = Object.fromEntries(
    keys
      .map((k, i) => [k, states[i]])
      .filter(([k]) => allowedState.includes(String(k))),
  );
  const list = [];
  for (const a of assets) {
    const data = await bytesOf(a.blob);
    files[`images/${a.id}`] = data;
    list.push({
      id: a.id,
      type: a.blob.type,
      createdAt: a.createdAt,
      bytes: data.length,
      sha256: await hash(data),
    });
  }
  files["manifest.json"] = strToU8(
    JSON.stringify({
      format: "chatbar-studio-backup",
      version: 1,
      createdAt: Date.now(),
      state,
      cards,
      history,
      conversations,
      assets: list,
    }),
  );
  return new Blob([new Uint8Array(zipSync(files, { level: 0 }))], {
    type: "application/zip",
  });
}
async function hash(b: Uint8Array) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(b))),
  )
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
export type StagedBackup = {
  state: Record<string, unknown>;
  cards: StyleCard[];
  history: Recipe[];
  conversations: DesignConversation[];
  assets: Asset[];
};
function object(v: unknown): v is Record<string, any> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function validCard(c: any) {
  return (
    object(c) &&
    ["id", "name", "prompt", "avatar"].every((k) => typeof c[k] === "string") &&
    (c.negative === undefined || typeof c.negative === "string") &&
    validCardImageSettings(c.imageSettings) &&
    !c.id.startsWith("preset:") &&
    Number.isFinite(c.createdAt) &&
    Number.isFinite(c.updatedAt)
  );
}
export async function stageBackup(file: File): Promise<StagedBackup> {
  if (file.size > 1024 * 1024 * 512)
    throw Error("备份超过 512 MiB，请拆分导出图片后再备份");
  let expanded = 0;
  const files = unzipSync(await bytesOf(file), {
    filter: (f) => {
      expanded += f.originalSize;
      if (expanded > 1024 * 1024 * 1024) throw Error("备份解压后超过 1 GiB");
      if (f.name.includes("..") || f.name.startsWith("/"))
        throw Error("备份路径无效");
      return true;
    },
  });
  if (!files["manifest.json"]) throw Error("缺少备份清单");
  const m = JSON.parse(strFromU8(files["manifest.json"]));
  if (m.format !== "chatbar-studio-backup" || m.version !== 1)
    throw Error("不支持的备份格式");
  if (
    !object(m.state) ||
    ![m.cards, m.history, m.conversations, m.assets].every(Array.isArray)
  )
    throw Error("备份结构无效");
  if (Object.keys(m.state).some((k) => !allowedState.includes(k)))
    throw Error("备份包含不支持的状态");
  if (!m.cards.every(validCard)) throw Error("画风卡数据无效");
  validateManifest(m);
  const assets: Asset[] = [],
    ids = new Set<string>();
  for (const a of m.assets) {
    if (!object(a) || typeof a.id !== "string" || ids.has(a.id))
      throw Error("图片标识无效或重复");
    const bytes = files["images/" + a.id];
    if (!bytes || bytes.length !== a.bytes || (await hash(bytes)) !== a.sha256)
      throw Error("备份图片缺失或校验失败");
    ids.add(a.id);
    assets.push({
      id: a.id,
      blob: new Blob([new Uint8Array(bytes)], { type: a.type }),
      createdAt: a.createdAt,
    });
  }
  const ref = (id: unknown) => {
    if (
      id &&
      (typeof id !== "string" ||
        (!/^\/data\/style-previews\/[^/\\]+\.(?:webp|png|jpg)$/u.test(id) &&
          !ids.has(id)))
    )
      throw Error("备份存在缺失的图片引用");
  };
  const draft = (v: any) => {
    if (
      !object(v) ||
      !["V4_5_FULL", "V5_FULL"].includes(v.model) ||
      !Array.isArray(v.characters) ||
      !object(v.perModel) ||
      !object(v.guidance) ||
      !["style", "base", "extra", "negative"].every(
        (k) => typeof v[k] === "string",
      )
    )
      throw Error("草稿结构无效");
    for (const model of ["V4_5_FULL", "V5_FULL"]) {
      const s = v.perModel[model];
      if (
        !object(s) ||
        ![
          "width",
          "height",
          "steps",
          "guidance",
          "cfgRescale",
          "count",
          "seed",
        ].every((k) => Number.isFinite(s[k]))
      )
        throw Error("生成参数损坏");
    }
    for (const c of v.characters)
      if (
        !object(c) ||
        typeof c.id !== "string" ||
        typeof c.prompt !== "string" ||
        typeof c.negative !== "string" ||
        !object(c.center)
      )
        throw Error("角色提示词损坏");
    ref(v.guidance.base);
    ref(v.guidance.mask);
    ref(v.guidance.precise);
    if (!Array.isArray(v.guidance.vibes)) throw Error("Vibe 数据无效");
    v.guidance.vibes.forEach((v: any) => {
      ref(v.asset);
      if (v.encoding?.startsWith(VIBE_ASSET_PREFIX))
        ref(v.encoding.slice(VIBE_ASSET_PREFIX.length));
    });
  };
  if (m.state.draft) draft(m.state.draft);
  if (m.state.historyApplyUndo) draft(m.state.historyApplyUndo);
  const settings = m.state.settings;
  if (
    settings &&
    (!object(settings) ||
      !Array.isArray(settings.models) ||
      typeof settings.defaultNegative !== "string" ||
      typeof settings.novelAiUrl !== "string")
  )
    throw Error("设置数据无效");
  for (const c of m.cards) ref(c.avatar);
  if (m.state.toolResults)
    for (const r of m.state.toolResults) {
      ref(r.id);
      ref(r.source);
    }
  for (const h of m.history) {
    if (!object(h) || typeof h.id !== "string" || !Array.isArray(h.images))
      throw Error("历史数据无效");
    draft(h.draft);
    h.images.forEach((v: any) => {
      ref(v.asset);
      if (!Number.isInteger(v.seed)) throw Error("历史 Seed 无效");
    });
  }
  for (const c of m.conversations) {
    if (
      !object(c) ||
      typeof c.id !== "string" ||
      !Array.isArray(c.turns) ||
      !Array.isArray(c.references)
    )
      throw Error("设计对话无效");
    for (const t of c.turns) {
      if (!object(t) || typeof t.text !== "string") throw Error("设计轮次无效");
      ref(t.image);
    }
  }
  return { ...m, assets };
}
export async function restoreBackup(staged: StagedBackup) {
  if (!navigator.locks) throw Error("浏览器不支持任务锁");
  await navigator.locks.request(
    "chatbar-studio-generation",
    { ifAvailable: true },
    async (lock) => {
      if (!lock) throw Error("请先停止所有标签页的生图任务");
      const tx = (await db).transaction(
        ["state", "cards", "history", "conversations", "assets", "cache"],
        "readwrite",
      );
      for (const s of [
        "cards",
        "history",
        "conversations",
        "assets",
        "cache",
      ] as const)
        await tx.objectStore(s).clear();
      for (const k of allowedState) await tx.objectStore("state").delete(k);
      await tx.objectStore("state").delete("task");
      for (const [k, v] of Object.entries(staged.state))
        await tx.objectStore("state").put(v, k);
      for (const s of ["cards", "history", "conversations", "assets"] as const)
        for (const v of staged[s])
          await tx.objectStore(s).put(v as never, v.id);
      await tx.done;
      changed();
    },
  );
}
export async function exportCard(card: StyleCard) {
  return new Blob(
    [
      JSON.stringify(
        {
          format: "chatbar-style-card",
          version: 1,
          card: {
            name: card.name,
            prompt: card.prompt,
            negative: card.negative || "",
            imageSettings: card.imageSettings,
          },
          avatar: card.avatar
            ? {
                mime: (await assetBlob(card.avatar)).type,
                data: base64(await bytesOf(await assetBlob(card.avatar))),
              }
            : null,
        },
        null,
        2,
      ),
    ],
    { type: "application/json" },
  );
}
export async function importCard(file: File) {
  const v = JSON.parse(await file.text());
  if (
    !validCardImageSettings(v.card?.imageSettings) ||
    v.format !== "chatbar-style-card" ||
    v.version !== 1 ||
    typeof v.card?.name !== "string" ||
    typeof v.card?.prompt !== "string" ||
    (v.card.negative !== undefined && typeof v.card.negative !== "string")
  )
    throw Error("不是有效的画风卡");
  const id = crypto.randomUUID(),
    now = Date.now(),
    tx = (await db).transaction(["cards", "assets"], "readwrite");
  let avatar = "";
  if (v.avatar) {
    avatar = crypto.randomUUID();
    await tx.objectStore("assets").put(
      {
        id: avatar,
        blob: new Blob([new Uint8Array(fromBase64(v.avatar.data))], {
          type: v.avatar.mime,
        }),
        createdAt: now,
      },
      avatar,
    );
  }
  await tx.objectStore("cards").put(
    {
      id,
      name: v.card.name,
      prompt: v.card.prompt,
      negative: v.card.negative || "",
      imageSettings: v.card.imageSettings,
      avatar,
      createdAt: now,
      updatedAt: now,
    },
    id,
  );
  await tx.done;
  changed();
}
