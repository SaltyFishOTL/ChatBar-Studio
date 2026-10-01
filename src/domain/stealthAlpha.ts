import { canvas } from "./images";

export const MAX_METADATA_BYTES = 8 * 1024 * 1024;

export async function inflateMetadata(
  data: Uint8Array,
  format: "gzip" | "deflate",
) {
  const reader = new Blob([new Uint8Array(data)])
    .stream()
    .pipeThrough(new DecompressionStream(format))
    .getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > MAX_METADATA_BYTES) throw Error("图片元数据解压后超过限制");
      parts.push(next.value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

export async function decodeAlphaMetadata(
  width: number,
  height: number,
  data: Uint8ClampedArray,
) {
  const capacity = width * height;
  if (capacity < 152) return null;
  let position = 0;
  const byte = () => {
    if (position + 8 > capacity) throw Error("透明度元数据截断");
    let result = 0;
    for (let bit = 0; bit < 8; bit++, position++) {
      const index =
        ((position % height) * width + Math.floor(position / height)) * 4 + 3;
      result = (result << 1) | (data[index] & 1);
    }
    return result;
  };
  const signature = String.fromCharCode(...Array.from({ length: 15 }, byte));
  if (signature !== "stealth_pngcomp" && signature !== "stealth_pnginfo")
    return null;
  let bits = 0;
  for (let i = 0; i < 4; i++) bits = bits * 256 + byte();
  if (
    !bits ||
    bits % 8 ||
    bits > capacity - position ||
    bits / 8 > MAX_METADATA_BYTES
  )
    throw Error("透明度元数据长度无效或超过限制");
  const payload = Uint8Array.from({ length: bits / 8 }, byte);
  return new TextDecoder("utf-8", { fatal: true }).decode(
    signature.endsWith("comp")
      ? await inflateMetadata(payload, "gzip")
      : payload,
  );
}

export async function readAlphaMetadata(blob: Blob) {
  const bitmap = await createImageBitmap(blob, {
    premultiplyAlpha: "none",
    colorSpaceConversion: "none",
    imageOrientation: "none",
  });
  let target: HTMLCanvasElement | undefined;
  try {
    if (bitmap.width * bitmap.height > 12_582_912)
      throw Error("图片尺寸过大，无法读取透明度元数据");
    target = canvas(bitmap.width, bitmap.height);
    const context = target.getContext("2d", { willReadFrequently: true });
    if (!context) throw Error("无法读取图片透明度");
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height);
    return await decodeAlphaMetadata(bitmap.width, bitmap.height, pixels.data);
  } finally {
    bitmap.close();
    if (target) target.width = target.height = 0;
  }
}
