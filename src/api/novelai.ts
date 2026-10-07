import { resolveVibePayload } from "../data/db";
import {
  compatibleSampler,
  supportsVarietyPlus,
} from "../domain/imageCapabilities";
import { decode } from "@msgpack/msgpack";
import {
  MODELS,
  type StudioDraft,
  type Account,
  type Settings,
} from "../domain/types";
import {
  normalizedPrompt,
  effectiveSize,
  validateDraft,
} from "../domain/promptPolicy";
import { assetBlob, db } from "../data/db";
import { getKey } from "../data/vault";
import {
  bytesOf,
  base64,
  normalizedAsset,
  dimensions,
  canvas,
  canvasBlob,
  preserveText,
} from "../domain/images";
import { directFetch, endpoint, checkResponse, pause } from "./http";
import { raster } from "../data/raster";
import { normalizePosition } from "../domain/studioControls";
export type GenerationProgress = {
  message: string;
  preview?: Blob;
  step?: number;
};
export type Prepared = {
  parameters: Record<string, unknown>;
  width: number;
  height: number;
  finish: (b: Blob) => Promise<Blob>;
};
async function vibe(
  asset: string,
  information: number,
  settings: Settings,
  signal: AbortSignal,
) {
  const blob = await assetBlob(asset),
    bytes = await bytesOf(blob),
    sha = Array.from(
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)),
      ),
    )
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("");
  const cacheKey = `vibe:${sha}:nai-diffusion-4-5-full:${information.toFixed(4)}`,
    cached = await (await db).get("cache", cacheKey);
  if (typeof cached === "string") return cached;
  const key = getKey("novelai");
  const r = await directFetch(
    endpoint(settings.novelAiUrl, "/ai/encode-vibe"),
    {
      method: "POST",
      signal,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "x-correlation-id": crypto.randomUUID().slice(0, 6),
      },
      body: JSON.stringify({
        image: base64(bytes),
        information_extracted: information,
        model: MODELS.V4_5_FULL.api,
      }),
    },
  );
  await checkResponse(r, key);
  const encoding = base64(new Uint8Array(await r.arrayBuffer()));
  if (!encoding) throw Error("Vibe 编码为空");
  await (await db).put("cache", encoding, cacheKey);
  return encoding;
}
export async function prepareGuidance(
  d: StudioDraft,
  settings: Settings,
  signal: AbortSignal,
): Promise<Prepared> {
  const g = d.guidance,
    size = effectiveSize(d.perModel[d.model].width, d.perModel[d.model].height),
    p: Record<string, unknown> = {};
  let finish = async (b: Blob) => b;
  if (g.action === "img2img") {
    p.image = await normalizedAsset(g.base, size.width, size.height);
    p.strength = g.strength;
    p.noise = g.noise;
  }
  if (g.action === "infill") {
    if (!g.focus) throw Error("局部重绘需要焦点区域");
    const source = await assetBlob(g.base),
      f = g.focus;
    const prepared = await raster<{
      width: number;
      height: number;
      image: Blob;
      mask: Blob;
      alpha: Uint8Array;
    }>("focus", {
      base: source,
      mask: g.mask ? await assetBlob(g.mask) : null,
      focus: f,
      context: f.context ?? 96,
    });
    size.width = prepared.width;
    size.height = prepared.height;
    p.image = base64(await bytesOf(prepared.image));
    p.mask = base64(await bytesOf(prepared.mask));
    p.strength = g.strength;
    p.noise = g.noise;
    p.inpaintImg2ImgStrength = g.inpaintStrength;
    p.add_original_image = false;
    if (g.inpaintStrength !== 1)
      p.img2img = { strength: g.inpaintStrength, color_correct: true };
    finish = async (output) =>
      preserveText(
        output,
        await raster<Blob>("compose", {
          base: source,
          patch: output,
          focus: f,
          width: prepared.width,
          height: prepared.height,
          alpha: prepared.alpha,
        }),
      );
  }
  if (d.model === "V4_5_FULL" && g.referenceMode === "precise" && g.precise) {
    const dim = await dimensions(await assetBlob(g.precise)),
      sizes = [
        [1024, 1536],
        [1472, 1472],
        [1536, 1024],
      ],
      chosen = sizes.sort(
        (a, b) =>
          Math.abs(a[0] / a[1] - dim.width / dim.height) -
          Math.abs(b[0] / b[1] - dim.width / dim.height),
      )[0];
    p.director_reference_images = [
      await normalizedAsset(g.precise, chosen[0], chosen[1], true),
    ];
    p.director_reference_descriptions = [
      {
        caption: { base_caption: g.preciseType, char_captions: [] },
        legacy_uc: false,
      },
    ];
    p.director_reference_information_extracted = [1];
    p.director_reference_strength_values = [g.preciseStrength];
    p.director_reference_secondary_strength_values = [1 - g.fidelity];
  }
  if (d.model === "V4_5_FULL" && g.referenceMode === "vibe") {
    if (g.vibes.length > 16) throw Error("最多 16 个 Vibe");
    p.reference_image_multiple = await Promise.all(
      g.vibes.map((v) =>
        v.encoding
          ? resolveVibePayload(v.encoding)
          : vibe(v.asset, v.information, settings, signal),
      ),
    );
    p.reference_information_extracted_multiple = g.vibes.map(
      (v) => v.information,
    );
    const strengths = g.vibes.map((v) => v.strength),
      sum = strengths.reduce((a, b) => a + b, 0);
    p.reference_strength_multiple =
      g.normalizeVibeStrengths !== false && sum > 1
        ? strengths.map((v) => v / sum)
        : strengths;
  }
  return { parameters: p, ...size, finish };
}
export function buildRequest(
  d: StudioDraft,
  seed: number,
  count: number,
  prepared: Prepared,
) {
  const s = d.perModel[d.model],
    p = normalizedPrompt(d),
    coords = s.useCoords && p.characters.length > 0;
  const centers = (c: { center: { x: number; y: number } }) => {
    return [normalizePosition(c.center, d.model)];
  };
  return {
    input: p.base,
    model:
      MODELS[d.model].api +
      (d.guidance.action === "infill" ? "-inpainting" : ""),
    action: d.guidance.action,
    parameters: {
      params_version: 3,
      width: prepared.width,
      height: prepared.height,
      scale: s.guidance,
      sampler: compatibleSampler(d.model, s.sampler),
      steps: s.steps,
      seed,
      extra_noise_seed: seed,
      n_samples: count,
      ucPreset: 3,
      qualityToggle: false,
      negative_prompt: p.negative,
      noise_schedule: "karras",
      legacy: false,
      legacy_uc: false,
      use_coords: coords,
      legacy_v3_extend: false,
      autoSmea: false,
      sm: false,
      sm_dyn: false,
      dynamic_thresholding: false,
      cfg_rescale: s.cfgRescale,
      ...(supportsVarietyPlus(d.model)
        ? { skip_cfg_above_sigma: s.varietyPlus ? 58 : null }
        : {}),
      deliberate_euler_ancestral_bug: false,
      prefer_brownian: true,
      stream: "msgpack",
      v4_prompt: {
        caption: {
          base_caption: p.base,
          char_captions: p.characters.map((c) => ({
            char_caption: c.prompt,
            centers: centers(c),
          })),
        },
        use_coords: coords,
        use_order: true,
      },
      v4_negative_prompt: {
        caption: {
          base_caption: p.negative,
          char_captions: p.characters.map((c) => ({
            char_caption: c.negative,
            centers: centers(c),
          })),
        },
        legacy_uc: false,
        use_coords: coords,
        use_order: true,
      },
      ...Object.fromEntries(
        Object.entries(prepared.parameters).filter(
          ([key]) =>
            key !== "skip_cfg_above_sigma" || supportsVarietyPlus(d.model),
        ),
      ),
    },
  };
}
export async function requestImages(
  request: ReturnType<typeof buildRequest>,
  settings: Settings,
  signal: AbortSignal,
  progress: (p: GenerationProgress) => void,
  continuous = false,
): Promise<Blob[]> {
  const key = getKey("novelai");
  if (!key) throw Error("请在设置中填写 NovelAI Token");
  const url = endpoint(settings.novelAiUrl, "/ai/generate-image-stream");
  for (let attempt = 1; ; attempt++) {
    signal.throwIfAborted();
    const controller = new AbortController(),
      abort = () => controller.abort(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    let timer: ReturnType<typeof setTimeout>;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(
        () => controller.abort(Error("读取超时；结果未知，未自动重发")),
        continuous ? 120000 : 600000,
      );
    };
    reset();
    try {
      progress({ message: `第 ${attempt} 次请求 · 正在连接` });
      const r = await directFetch(url, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Accept: "application/octet-stream",
          "x-correlation-id": crypto.randomUUID().slice(0, 6),
        },
        body: JSON.stringify(request),
      });
      if (r.status === 429 && (continuous || attempt < 3)) {
        const header = Number(r.headers.get("Retry-After")),
          ms = Math.max(
            1000,
            Math.min(
              30000,
              Number.isFinite(header) && header > 0
                ? header * 1000
                : attempt * 1000,
            ),
          );
        await r.body?.cancel();
        clearTimeout(timer!);
        progress({ message: `请求限流，${ms / 1000} 秒后重试` });
        await pause(ms, signal);
        continue;
      }
      await checkResponse(r, key);
      if (!r.body) throw Error("生图响应为空");
      progress({ message: "已接通，等待图片" });
      const reader = r.body.getReader(),
        images: Blob[] = [];
      let pending = new Uint8Array(0);
      try {
        while (true) {
          reset();
          const { value, done } = await reader.read();
          if (done) break;
          const next = new Uint8Array(pending.length + value.length);
          next.set(pending);
          next.set(value, pending.length);
          pending = next;
          let offset = 0;
          while (pending.length - offset >= 4) {
            const size = new DataView(pending.buffer).getUint32(offset);
            if (size < 1 || size > 32 * 1024 * 1024)
              throw Error("生图流帧大小异常");
            if (pending.length - offset < 4 + size) break;
            const frame = decode(
              pending.subarray(offset + 4, offset + 4 + size),
            ) as {
              event_type: string;
              image?: Uint8Array;
              step_ix?: number;
              message?: string;
            };
            offset += 4 + size;
            if (frame.event_type === "error")
              throw Error("NovelAI：" + frame.message);
            if (frame.event_type === "retry") continue;
            if (!frame.image) throw Error("生图流缺少图片");
            const blob = new Blob([new Uint8Array(frame.image)], {
              type: "image/png",
            });
            if (frame.event_type === "final") images.push(blob);
            else if (frame.event_type === "intermediate")
              progress({
                message: `生成中 · ${frame.step_ix || 0}/${request.parameters.steps}`,
                preview: blob,
                step: frame.step_ix,
              });
            else throw Error("未知生图流事件");
          }
          pending = pending.slice(offset);
          if (images.length >= request.parameters.n_samples) {
            if (images.length !== request.parameters.n_samples)
              throw Error("返回图片数量超出请求");
            await reader.cancel();
            return images;
          }
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      throw Error(
        `批次不完整：收到 ${images.length}/${request.parameters.n_samples}，未写入历史`,
      );
    } finally {
      clearTimeout(timer!);
      signal.removeEventListener("abort", abort);
      controller.abort();
    }
  }
}
export async function generate(
  d: StudioDraft,
  settings: Settings,
  signal: AbortSignal,
  progress: (p: GenerationProgress) => void,
  count = d.perModel[d.model].count,
) {
  validateDraft(d);
  const prepared = await prepareGuidance(d, settings, signal),
    s = d.perModel[d.model];
  const seed =
    s.seedMode === "FIXED"
      ? s.seed
      : crypto.getRandomValues(new Uint32Array(1))[0] %
        (4294967296 - count + 1);
  const request = buildRequest(d, seed, count, prepared),
    raw = await requestImages(
      request,
      settings,
      signal,
      progress,
      d.continuous,
    );
  const images = await Promise.all(raw.map(prepared.finish));
  const draft = structuredClone(d);
  if (Array.isArray(prepared.parameters.reference_image_multiple))
    draft.guidance.vibes = draft.guidance.vibes.map((v, i) => ({
      ...v,
      encoding: (prepared.parameters.reference_image_multiple as string[])[i],
    }));
  return { images, seed, request, draft };
}
export async function fetchAccount(
  settings: Settings,
  signal?: AbortSignal,
): Promise<Account> {
  const key = getKey("novelai");
  if (!key) throw Error("请填写 NovelAI Token");
  const r = await directFetch(
    endpoint(settings.novelAiUrl, "/user/subscription"),
    { signal, headers: { Authorization: `Bearer ${key}` } },
  );
  await checkResponse(r, key);
  const v = await r.json(),
    steps = v.trainingStepsLeft;
  return {
    anlas:
      typeof steps === "number" || typeof steps === "string"
        ? Number(steps)
        : Number(steps?.fixedTrainingStepsLeft || 0) +
          Number(steps?.purchasedTrainingSteps || 0),
    tier: Number(v.tier || 0),
    active: v.active ?? (Number(v.tier) > 0 && v.expiresAt > Date.now() / 1000),
    percent:
      v.usage?.percent == null || !Number.isFinite(Number(v.usage.percent))
        ? null
        : Number(v.usage.percent),
    exhausted: !!v.usage?.isNegative,
  };
}
export function estimateCost(d: StudioDraft, a: Account | null) {
  const s = d.perModel[d.model],
    g = d.guidance,
    pixels =
      g.action === "infill"
        ? 1048576
        : effectiveSize(s.width, s.height).width *
          effectiveSize(s.width, s.height).height,
    ref = d.model === "V5_FULL" ? "none" : g.referenceMode,
    free =
      a?.active &&
      a.tier >= 3 &&
      s.count === 1 &&
      pixels <= 1048576 &&
      s.steps <= 28 &&
      g.action !== "img2img" &&
      ref === "none" &&
      (d.model !== "V5_FULL" || (a.percent !== null && !a.exhausted));
  let n =
    Math.max(
      2,
      Math.ceil(
        Math.ceil(
          2.951823174884865e-6 * Math.max(65536, pixels) +
            5.753298233447344e-7 * Math.max(65536, pixels) * s.steps,
        ) * (d.model === "V5_FULL" ? 1.5 : 1),
      ),
    ) * s.count;
  if (free) n = 0;
  if (ref === "precise" && g.precise) n += 5 * s.count;
  if (ref === "vibe") n += Math.max(0, g.vibes.length - 4) * 2 * s.count;
  return {
    anlas: n,
    label: free
      ? d.model === "V5_FULL"
        ? "约 1 次 V5 额度"
        : "Opus 免费"
      : `${n} Anlas`,
    vibe: ref === "vibe",
  };
}
