import type { ImageModel, GenerationSettings, StyleCard } from "./types";
const common = [
  ["k_euler_ancestral", "Euler Ancestral"],
  ["k_euler", "Euler"],
  ["k_dpmpp_2s_ancestral", "DPM++ 2S Ancestral"],
  ["k_dpmpp_2m", "DPM++ 2M"],
  ["k_dpmpp_sde", "DPM++ SDE"],
];
export const samplersFor = (model: ImageModel) =>
  model === "V5_FULL"
    ? [...common, ["k_dpmpp_2m_sde", "DPM++ 2M SDE"]]
    : common;
export const supportsVarietyPlus = (model: ImageModel) => model === "V4_5_FULL";
export function compatibleSampler(model: ImageModel, sampler: string) {
  return samplersFor(model).some(([id]) => id === sampler)
    ? sampler
    : "k_euler_ancestral";
}
export function normalizeImageSettings(
  model: ImageModel,
  settings: GenerationSettings,
): GenerationSettings {
  return { ...settings, sampler: compatibleSampler(model, settings.sampler) };
}

export function validCardImageSettings(value: unknown): boolean {
  if (value === undefined) return true;
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    (v.model === "V4_5_FULL" || v.model === "V5_FULL") &&
    typeof v.sampler === "string" &&
    samplersFor(v.model).some(([id]) => id === v.sampler) &&
    typeof v.steps === "number" &&
    Number.isInteger(v.steps) &&
    v.steps >= 1 &&
    v.steps <= 50 &&
    typeof v.guidance === "number" &&
    v.guidance >= 1 &&
    v.guidance <= 10 &&
    typeof v.cfgRescale === "number" &&
    v.cfgRescale >= 0 &&
    v.cfgRescale <= 1 &&
    (v.varietyPlus === undefined || typeof v.varietyPlus === "boolean")
  );
}

export function cardImageSettings(
  model: ImageModel,
  settings: GenerationSettings,
): NonNullable<StyleCard["imageSettings"]> {
  const { steps, guidance, cfgRescale, varietyPlus } = settings;
  return {
    model,
    steps,
    guidance,
    cfgRescale,
    varietyPlus,
    sampler: compatibleSampler(model, settings.sampler),
  };
}
export function applyCardImageSettings(
  base: GenerationSettings,
  settings: NonNullable<StyleCard["imageSettings"]>,
): GenerationSettings {
  const { model, ...values } = cardImageSettings(settings.model, {
    ...base,
    ...settings,
  });
  return normalizeImageSettings(model, { ...base, ...values });
}
