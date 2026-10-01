import {
  inflateMetadata,
  MAX_METADATA_BYTES,
  readAlphaMetadata,
} from "./stealthAlpha";
import { strFromU8 } from "fflate";
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
import { MODELS, type StudioDraft } from "./types";
import { activeCharacters } from "./promptPolicy";
export async function pngMetadata(
  blob: Blob,
): Promise<Record<string, unknown>> {
  if (!blob.size || blob.size > 100 * 1024 * 1024)
    throw Error("图片为空或超过 100 MB");
  const result: Record<string, unknown> = {};
  const bytes = await bytesOf(blob);
  const png =
    bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71;
  if (png) {
    try {
      for (const c of parsePng(bytes)) {
        if (!["tEXt", "zTXt", "iTXt"].includes(c.type)) continue;
        try {
          if (c.data.length > MAX_METADATA_BYTES) throw Error("PNG 元数据过大");
          const zero = c.data.indexOf(0);
          if (zero < 0) continue;
          const key = new TextDecoder("latin1").decode(
            c.data.subarray(0, zero),
          );
          let payload = c.data.subarray(zero + 1);
          if (c.type === "zTXt") {
            if (c.data[zero + 1] !== 0) throw Error("PNG 压缩方式无效");
            payload = await inflateMetadata(
              c.data.subarray(zero + 2),
              "deflate",
            );
          } else if (c.type === "iTXt") {
            const flag = c.data[zero + 1];
            if ((flag !== 0 && flag !== 1) || c.data[zero + 2] !== 0)
              throw Error("PNG 文本头无效");
            let start = zero + 3;
            for (let i = 0; i < 2; i++) {
              const end = c.data.indexOf(0, start);
              if (end < 0) throw Error("PNG 文本头截断");
              start = end + 1;
            }
            payload = flag
              ? await inflateMetadata(c.data.subarray(start), "deflate")
              : c.data.subarray(start);
          }
          const text = strFromU8(payload);
          try {
            result[key] = JSON.parse(text);
          } catch {
            result[key] = text;
          }
        } catch (error) {
          console.warn("Invalid PNG text metadata", error);
        }
      }
    } catch (error) {
      console.warn("Cannot read PNG file metadata", error);
    }
  }
  if (validNovelAiMetadata(result)) return result;
  if (png && bytes.length >= 24) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(16) * view.getUint32(20) > 12_582_912)
      throw Error("图片尺寸过大，无法读取元数据");
  }
  try {
    const text = await readAlphaMetadata(blob);
    if (text) {
      const alpha = JSON.parse(text);
      if (alpha && typeof alpha === "object" && !Array.isArray(alpha)) {
        if (typeof alpha.Comment === "string")
          alpha.Comment = JSON.parse(alpha.Comment);
        if (validNovelAiMetadata(alpha)) {
          console.info("Reading alpha-channel metadata");
          return alpha; // Keep sources separate; never attach stale file recipe/Source.
        }
      }
    }
  } catch (error) {
    console.warn("Cannot read alpha-channel metadata", error);
  }
  return result;
}

function validNovelAiMetadata(metadata: Record<string, unknown>) {
  const c = metadata.Comment as any;
  return (
    c &&
    typeof c === "object" &&
    !Array.isArray(c) &&
    (typeof c.prompt === "string" ||
      typeof c.v4_prompt?.caption?.base_caption === "string")
  );
}

export type CharacterImportMode = "off" | "replace" | "append";
export type MetadataSections = {
  style?: boolean;
  guidance?: boolean;
  positive: boolean;
  negative: boolean;
  characters: CharacterImportMode;
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
  if (sections.characters !== "off" && Array.isArray(positive?.char_captions)) {
    const importedCharacters = positive.char_captions.map(
      (c: any, i: number) => ({
        id: crypto.randomUUID(),
        prompt: String(c.char_caption || ""),
        negative: String(negative?.char_captions?.[i]?.char_caption || ""),
        center: c.centers?.[0] || { x: 0.5, y: 0.5 },
      }),
    );
    next.characters =
      sections.characters === "append"
        ? [...next.characters, ...importedCharacters]
        : importedCharacters;
    const targetModel = sections.parameters ? model : d.model;
    if (activeCharacters(next).length > MODELS[targetModel].roles)
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
