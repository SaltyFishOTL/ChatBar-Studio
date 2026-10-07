import { supportsVarietyPlus } from "../domain/imageCapabilities";
import type { Settings, StudioDraft } from "../domain/types";
import { getKey } from "../data/vault";
import { directFetch, endpoint, checkResponse, readLimited } from "./http";
import {
  base64,
  bytesOf,
  fromBase64,
  normalizeImage,
  preserveText,
  dimensions,
} from "../domain/images";
import { applyMetadata } from "../domain/metadata";
import {
  buildRequest,
  requestImages,
  type GenerationProgress,
} from "./novelai";
export function upscaleCost(w: number, h: number) {
  const p = w * h;
  return p <= 0 || p > 3145728
    ? null
    : p <= 1048576
      ? 1
      : p <= 1747627
        ? 2
        : p <= 2446678
          ? 3
          : 4;
}
export function enhanceScales(w: number, h: number, v5: boolean) {
  const out: (number | "max")[] = [1, 1.5, 2].filter((n) => {
    const x = Math.floor(w * n),
      y = Math.floor(h * n);
    return (
      x >= 64 &&
      y >= 64 &&
      x * y <= 3145728 &&
      ((x % 64 === 0 && y % 64 === 0) ||
        (n === 1.5 && [w, h].sort().join(",") === [832, 1216].sort().join(",")))
    );
  });
  if (v5 && w * h < 3145728 * 0.8) out.push("max");
  return out;
}
export async function upscale(
  blob: Blob,
  settings: Settings,
  signal: AbortSignal,
) {
  const dim = await dimensions(blob);
  if (upscaleCost(dim.width, dim.height) === null)
    throw Error("放大输入面积超过 3,145,728 像素");
  const key = getKey("novelai");
  if (!key) throw Error("请配置 NovelAI Token");
  const r = await directFetch(endpoint(settings.novelAiUrl, "/ai/upscale"), {
    method: "POST",
    signal: AbortSignal.any([signal, AbortSignal.timeout(120000)]),
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-correlation-id": crypto.randomUUID().slice(0, 6),
    },
    body: JSON.stringify({
      image: base64(await bytesOf(await normalizeImage(blob))),
      model: "nai-diffusion-5-curated",
      declared_blur_sigma: 0,
    }),
  });
  await checkResponse(r, key);
  if (Number(r.headers.get("Content-Length")) > 140 * 1024 * 1024)
    throw Error("放大结果过大");
  const v = JSON.parse(await readLimited(r, 140 * 1024 * 1024));
  if (
    !Array.isArray(v.images) ||
    v.images.length !== 1 ||
    typeof v.images[0].image !== "string"
  )
    throw Error("放大结果格式异常");
  return preserveText(
    blob,
    new Blob([new Uint8Array(fromBase64(v.images[0].image))], {
      type: "image/png",
    }),
  );
}
export async function enhance(
  blob: Blob,
  metadata: Record<string, unknown>,
  baseDraft: StudioDraft,
  settings: Settings,
  options: { scale: number | "max"; strength: number; noise: number },
  signal: AbortSignal,
  progress: (p: GenerationProgress) => void,
) {
  const comment = metadata.Comment as any;
  if (!comment || typeof comment !== "object" || !comment.v4_prompt?.caption)
    throw Error("增强需要可还原的 NovelAI 生成元数据");
  const d = applyMetadata(baseDraft, metadata, {
      positive: true,
      negative: true,
      characters: "replace",
      parameters: true,
      seed: true,
    }),
    dim = await dimensions(blob);
  d.style = "";
  d.extra = "";
  d.guidance.action = "img2img";
  d.continuous = false;
  if (
    !enhanceScales(dim.width, dim.height, d.model === "V5_FULL").includes(
      options.scale,
    )
  )
    throw Error("此图片不支持所选增强比例");
  const width =
      options.scale === "max"
        ? dim.width
        : Math.floor(dim.width * options.scale),
    height =
      options.scale === "max"
        ? dim.height
        : Math.floor(dim.height * options.scale);
  const seed = crypto.getRandomValues(new Uint32Array(1))[0],
    request = buildRequest(d, seed, 1, {
      parameters: {},
      width,
      height,
      finish: async (b) => b,
    });
  request.input = String(comment.v4_prompt.caption.base_caption ?? d.base);
  const allowed = [
    "v4_prompt",
    "v4_negative_prompt",
    "negative_prompt",
    "qualityToggle",
    "ucPreset",
    "noise_schedule",
    "legacy",
    "legacy_uc",
    "use_coords",
    "legacy_v3_extend",
    "autoSmea",
    "sm",
    "sm_dyn",
    "dynamic_thresholding",
    "cfg_rescale",
    "skip_cfg_above_sigma",
    "deliberate_euler_ancestral_bug",
    "prefer_brownian",
  ];
  for (const key of allowed)
    if (
      key in comment &&
      (key !== "skip_cfg_above_sigma" || supportsVarietyPlus(d.model))
    )
      (request.parameters as Record<string, unknown>)[key] = comment[key];
  Object.assign(request.parameters, {
    image: base64(await bytesOf(await normalizeImage(blob, width, height))),
    strength: Math.min(0.99, Math.max(0.01, options.strength)),
    noise: Math.min(0.99, Math.max(0, options.noise)),
    upscaled_enhance: options.scale === "max",
    color_correct: false,
    extra_noise_seed: (seed - 1) >>> 0,
  });
  const images = await requestImages(request, settings, signal, progress);
  return images[0];
}
