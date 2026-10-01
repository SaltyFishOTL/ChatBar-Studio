import { unzlibSync, strFromU8 } from "fflate";
import {
  bytesOf,
  parsePng,
  encodePng,
  textChunk,
  fromBase64,
  normalizeImage,
} from "./images";
import { putAsset } from "../data/db";
import { stripImageMetadata } from "./imagePrivacy";
import type { StudioDraft } from "./types";
export async function pngMetadata(
  blob: Blob,
): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  for (const c of parsePng(await bytesOf(blob))) {
    if (!["tEXt", "zTXt", "iTXt"].includes(c.type)) continue;
    const zero = c.data.indexOf(0);
    if (zero < 0) continue;
    const key = new TextDecoder("latin1").decode(c.data.subarray(0, zero));
    let text = "";
    if (c.type === "tEXt") text = strFromU8(c.data.subarray(zero + 1));
    else if (c.type === "zTXt")
      text = strFromU8(unzlibSync(c.data.subarray(zero + 2)));
    else {
      const compressed = c.data[zero + 1] === 1;
      let start = c.data.indexOf(0, zero + 3) + 1;
      start = c.data.indexOf(0, start) + 1;
      const b = c.data.subarray(start);
      text = strFromU8(compressed ? unzlibSync(b) : b);
    }
    try {
      result[key] = JSON.parse(text);
    } catch {
      result[key] = text;
    }
  }
  return result;
}
export type MetadataSections = {
  style?: boolean;
  guidance?: boolean;
  positive: boolean;
  negative: boolean;
  characters: boolean;
  parameters: boolean;
  seed: boolean;
};
export function applyMetadata(
  d: StudioDraft,
  metadata: Record<string, unknown>,
  sections: MetadataSections,
) {
  const v = metadata.Comment as any;
  if (!v || typeof v !== "object")
    throw Error("图片没有 NovelAI Comment 元数据");
  const next = structuredClone(d);
  const own = metadata.ChatBarStudio as any;
  if (sections.style) {
    if (!own || typeof own.style !== "string")
      throw Error("此图片没有独立画风分段");
    next.style = own.style;
  }
  const source = String(metadata.Source || "");
  const model = /v5|5-full/i.test(source)
    ? "V5_FULL"
    : /4\.5|4-5/i.test(source)
      ? "V4_5_FULL"
      : d.model;
  const positive = v.v4_prompt?.caption;
  const negative = v.v4_negative_prompt?.caption;
  if (sections.positive) {
    next.base = String(
      own?.base ??
        positive?.base_caption ??
        v.prompt ??
        metadata.Description ??
        "",
    );
    next.extra = typeof own?.extra === "string" ? own.extra : "";
  }
  if (sections.negative)
    next.negative = String(
      negative?.base_caption ?? v.uc ?? v.negative_prompt ?? "",
    );
  if (sections.characters && Array.isArray(positive?.char_captions)) {
    next.characters = positive.char_captions.map((c: any, i: number) => ({
      id: crypto.randomUUID(),
      prompt: String(c.char_caption || ""),
      negative: String(negative?.char_captions?.[i]?.char_caption || ""),
      center: c.centers?.[0] || { x: 0.5, y: 0.5 },
    }));
    if (next.characters.length > (model === "V5_FULL" ? 22 : 6))
      throw Error("元数据角色数量超出模型上限");
  }
  if (sections.parameters) {
    next.model = model;
    const s = next.perModel[model];
    for (const [field, key] of [
      ["width", "width"],
      ["height", "height"],
      ["steps", "steps"],
      ["guidance", "scale"],
      ["cfgRescale", "cfg_rescale"],
    ] as const)
      if (Number.isFinite(Number(v[key]))) s[field] = Number(v[key]);
    if (typeof v.sampler === "string") s.sampler = v.sampler;
    s.useCoords = !!(v.use_coords || v.v4_prompt?.use_coords);
  }
  if (sections.seed && Number.isInteger(v.seed)) {
    next.perModel[next.model].seed = v.seed;
    next.perModel[next.model].seedMode = "FIXED";
  }
  return next;
}
export async function importMetadata(
  d: StudioDraft,
  metadata: Record<string, unknown>,
  sections: MetadataSections,
) {
  const next = applyMetadata(d, metadata, sections);
  if (!sections.guidance) return next;
  const p = metadata.Comment as any,
    g = next.guidance;
  const asset = async (value: unknown) => {
    if (typeof value !== "string" || !value || value.length > 100 * 1024 * 1024)
      throw Error("元数据中的参考图片无效");
    return putAsset(
      await normalizeImage(
        new Blob([new Uint8Array(fromBase64(value))], { type: "image/png" }),
      ),
    );
  };
  if (p.image) {
    g.base = await asset(p.image);
    g.mask = p.mask ? await asset(p.mask) : "";
    g.action = p.mask ? "infill" : "img2img";
    delete g.focus;
  }
  for (const [field, key] of [
    ["strength", "strength"],
    ["noise", "noise"],
    ["inpaintStrength", "inpaintImg2ImgStrength"],
  ] as const)
    if (typeof p[key] === "number" && p[key] >= 0 && p[key] <= 1)
      g[field] = p[key];
  if (
    Array.isArray(p.director_reference_images) &&
    p.director_reference_images[0]
  ) {
    g.precise = await asset(p.director_reference_images[0]);
    g.referenceMode = "precise";
    const type = p.director_reference_descriptions?.[0]?.caption?.base_caption;
    if (["character", "style", "character&style"].includes(type))
      g.preciseType = type;
    g.preciseStrength = p.director_reference_strength_values?.[0] ?? 1;
    g.fidelity = 1 - (p.director_reference_secondary_strength_values?.[0] ?? 0);
  }
  if (
    Array.isArray(p.reference_image_multiple) &&
    p.reference_image_multiple.length
  ) {
    if (p.reference_image_multiple.length > 16)
      throw Error("元数据 Vibe 数量超限");
    g.vibes = p.reference_image_multiple.map((encoding: unknown, i: number) => {
      if (typeof encoding !== "string" || !encoding)
        throw Error("元数据 Vibe 编码无效");
      return {
        asset: "",
        encoding,
        strength: p.reference_strength_multiple?.[i] ?? 0.6,
        information: p.reference_information_extracted_multiple?.[i] ?? 1,
      };
    });
    g.referenceMode = "vibe";
    g.normalizeVibeStrengths = false;
  }
  return next;
}
export async function attachRecipe(blob: Blob, d: StudioDraft, seed: number) {
  const chunks = parsePng(await bytesOf(blob));
  const recipe = {
    style: d.style,
    base: d.base,
    extra: d.extra,
    negative: d.negative,
    characters: d.characters,
    model: d.model,
    settings: { ...d.perModel[d.model], seed },
  };
  return encodePng([
    ...chunks.filter((c) => c.type !== "IEND"),
    textChunk("ChatBarStudio", JSON.stringify(recipe)),
    { type: "IEND", data: new Uint8Array() },
  ]);
}
export async function stripMetadata(blob: Blob) {
  return stripImageMetadata(blob);
}
