import { zlibSync } from "fflate";
import { bytesOf, canvas, encodePng, parsePng } from "./images";

const MAX_PIXELS = 12_582_912;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const ascii = (bytes: Uint8Array, start: number, length: number) =>
  String.fromCharCode(...bytes.subarray(start, start + length));

export function webpAnimated(bytes: Uint8Array): boolean {
  if (ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP")
    return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = view.getUint32(4, true) + 8;
  if (end < 12 || end > bytes.length) throw Error("WebP 文件长度无效");
  for (let offset = 12; offset < end;) {
    if (offset + 8 > end) throw Error("WebP 数据块截断");
    const type = ascii(bytes, offset, 4);
    const length = view.getUint32(offset + 4, true);
    const next = offset + 8 + length + (length & 1);
    if (next > end) throw Error("WebP 数据块截断");
    if (type === "ANIM" || type === "ANMF") return true;
    if (type === "VP8X") {
      if (length !== 10) throw Error("WebP VP8X 数据块无效");
      if (bytes[offset + 8] & 2) return true;
    }
    offset = next;
  }
  return false;
}

function validateSize(width: number, height: number) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width * height > MAX_PIXELS
  )
    throw Error("图片尺寸无效或超过 12,582,912 像素");
}

/** Fresh PNG bytes: no source chunks, Canvas re-encoding, or metadata reinsertion. */
export function encodePrivacyPixels(image: {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}): Blob {
  const { width, height, data } = image;
  validateSize(width, height);
  if (data.length !== width * height * 4) throw Error("图片像素数据无效");
  const rows = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const source = (y * width + x) * 4;
      const target = y * (width * 4 + 1) + 1 + x * 4;
      // Erase the full payload, even if a signature was damaged by editing.
      // Pairwise quantization discards original LSBs and preserves alpha endpoints.
      const alpha = data[source + 3] & 254;
      if (alpha === 0) continue; // Remove invisible RGB data as well.
      rows[target] = data[source] & 254;
      rows[target + 1] = data[source + 1] & 254;
      rows[target + 2] = data[source + 2] & 254;
      rows[target + 3] = alpha === 254 ? 255 : alpha;
    }
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8;
  header[9] = 6;
  return encodePng([
    { type: "IHDR", data: header },
    { type: "sRGB", data: new Uint8Array([0]) },
    { type: "IDAT", data: zlibSync(rows) },
    { type: "IEND", data: new Uint8Array() },
  ]);
}

export function privacyCanvasBlob(source: HTMLCanvasElement): Blob {
  validateSize(source.width, source.height);
  const context = source.getContext("2d");
  if (!context) throw Error("无法读取图片像素");
  // Encode ImageData directly: putImageData/toBlob may round premultiplied alpha,
  // which can reintroduce low-bit variations into the sanitized result.
  return encodePrivacyPixels(
    context.getImageData(0, 0, source.width, source.height),
  );
}

export async function stripImageMetadata(source: Blob): Promise<Blob> {
  if (source.size <= 0 || source.size > 100 * 1024 * 1024)
    throw Error("图片为空或超过 100 MB");
  const bytes = await bytesOf(source);
  if (PNG_SIGNATURE.every((value, index) => bytes[index] === value)) {
    const chunks = parsePng(bytes);
    if (chunks.some((chunk) => chunk.type === "acTL"))
      throw Error("动态 PNG 不支持静态去元数据");
    const header = chunks[0];
    if (header?.type !== "IHDR" || header.data.length !== 13)
      throw Error("PNG 图片头无效");
    const view = new DataView(header.data.buffer, header.data.byteOffset, 13);
    validateSize(view.getUint32(0), view.getUint32(4));
  } else if (ascii(bytes, 0, 3) === "GIF") {
    throw Error("GIF 不支持静态去元数据");
  } else if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    if (webpAnimated(bytes)) throw Error("动态 WebP 不支持静态去元数据");
  } else if (bytes[0] !== 255 || bytes[1] !== 216) {
    throw Error("暂不支持此图片格式去除元数据");
  }
  // The browser applies EXIF orientation. Output dimensions/pixels include that
  // orientation, so no source EXIF or colour-profile payload needs to survive.
  const bitmap = await createImageBitmap(source, { premultiplyAlpha: "none" });
  let target: HTMLCanvasElement | undefined;
  try {
    validateSize(bitmap.width, bitmap.height);
    target = canvas(bitmap.width, bitmap.height);
    const context = target.getContext("2d");
    if (!context) throw Error("无法创建图片处理画布");
    context.drawImage(bitmap, 0, 0);
    return privacyCanvasBlob(target);
  } finally {
    bitmap.close();
    if (target) target.width = target.height = 0;
  }
}
