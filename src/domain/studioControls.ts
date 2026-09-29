import type { GenerationSettings, ImageModel, Focus } from "./types";
import { effectiveSize } from "./promptPolicy";

export const sizeTiers = [
  { id: "SMALL", label: "小图", name: "Small" },
  { id: "NORMAL", label: "标准", name: "Normal" },
  { id: "LARGE", label: "大图", name: "Large" },
  { id: "WALLPAPER", label: "壁纸", name: "Wallpaper" },
] as const;
export const aspectRatios = [
  { id: "PORTRAIT", label: "竖图" },
  { id: "SQUARE", label: "方图" },
  { id: "LANDSCAPE", label: "横图" },
] as const;
export type SizeTier = (typeof sizeTiers)[number]["id"];
export type AspectRatio = (typeof aspectRatios)[number]["id"];
const presets: Record<SizeTier, Record<AspectRatio, [number, number]>> = {
  SMALL: { PORTRAIT: [512, 768], SQUARE: [640, 640], LANDSCAPE: [768, 512] },
  NORMAL: {
    PORTRAIT: [832, 1216],
    SQUARE: [1024, 1024],
    LANDSCAPE: [1216, 832],
  },
  LARGE: {
    PORTRAIT: [1024, 1536],
    SQUARE: [1472, 1472],
    LANDSCAPE: [1536, 1024],
  },
  WALLPAPER: {
    PORTRAIT: [1088, 1920],
    SQUARE: [1088, 1920],
    LANDSCAPE: [1920, 1088],
  },
};
export function sizeChoice(settings: GenerationSettings) {
  const saved = settings.sizeChoice;
  if (
    saved &&
    saved.width === settings.width &&
    saved.height === settings.height
  )
    return saved;
  for (const { id: tier } of sizeTiers)
    for (const { id: ratio } of aspectRatios) {
      if (tier === "WALLPAPER" && ratio === "SQUARE") continue;
      const [width, height] = presets[tier][ratio];
      if (width === settings.width && height === settings.height)
        return { tier, ratio, custom: false, width, height };
    }
  return {
    tier: saved?.tier ?? "NORMAL",
    ratio:
      saved?.ratio ??
      (settings.width > settings.height
        ? "LANDSCAPE"
        : settings.width === settings.height
          ? "SQUARE"
          : "PORTRAIT"),
    custom: true,
    width: settings.width,
    height: settings.height,
  } as const;
}
export function choosePreset(
  settings: GenerationSettings,
  tier: SizeTier,
  ratio: AspectRatio,
): GenerationSettings {
  if (tier === "WALLPAPER" && ratio === "SQUARE") ratio = "PORTRAIT";
  const [width, height] = presets[tier][ratio];
  return {
    ...settings,
    width,
    height,
    sizeChoice: { tier, ratio, width, height, custom: false },
  };
}
export function chooseCustom(
  settings: GenerationSettings,
  width: number,
  height: number,
): GenerationSettings {
  return {
    ...settings,
    width,
    height,
    sizeChoice: { ...sizeChoice(settings), width, height, custom: true },
  };
}
export function customSizeError(width: string, height: string) {
  if (!/^\d+$/.test(width) || !/^\d+$/.test(height))
    return "请填写自定义宽度和高度";
  if ([Number(width), Number(height)].some((v) => v < 64 || v > 2048))
    return "宽高需在 64–2048 像素之间";
  try {
    effectiveSize(Number(width), Number(height));
    return "";
  } catch {
    return "规整后超过 3,145,728 像素，请减小宽度或高度";
  }
}
export function normalizePosition(
  center: { x: number; y: number },
  model: ImageModel,
) {
  const coordinate = (v: number) => {
    if (!Number.isFinite(v)) throw Error("角色位置必须是有效数值");
    const bounded = Math.max(0, Math.min(1, v));
    return model === "V4_5_FULL"
      ? (Math.min(4, Math.floor(bounded * 5)) + 0.5) / 5
      : bounded;
  };
  return { x: coordinate(center.x), y: coordinate(center.y) };
}
export function evenlyPlaced(index: number, count: number, model: ImageModel) {
  return normalizePosition({ x: (index + 1) / (count + 1), y: 0.5 }, model);
}
export function focusPreviewSize(
  base: { width: number; height: number },
  f?: Focus,
) {
  if (!f) throw Error("请先设置聚焦区域");
  const context = f.context ?? 96;
  if (
    context < 32 ||
    context > 96 ||
    f.width <= 2 * context ||
    f.height <= 2 * context ||
    f.width * f.height > 589824 ||
    f.x < 0 ||
    f.y < 0 ||
    f.x + f.width > base.width ||
    f.y + f.height > base.height
  )
    throw Error(
      "聚焦区域需大于两倍 Minimum Context，面积不超过 589,824 像素，且位于基图内",
    );
  const scale = Math.sqrt(1048576 / (f.width * f.height));
  return {
    width: Math.max(64, Math.floor(Math.floor(f.width * scale) / 64) * 64),
    height: Math.max(64, Math.floor(Math.floor(f.height * scale) / 64) * 64),
  };
}
