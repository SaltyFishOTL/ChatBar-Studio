import { assetBlob } from "../data/db";
import { zipSync } from "fflate";
export async function downloadImages(images: Blob[]) {
  const files: Record<string, Uint8Array> = {};
  for (let i = 0; i < images.length; i++)
    files[`image-${i + 1}.png`] = await bytesOf(images[i]);
  download(
    new Blob([new Uint8Array(zipSync(files, { level: 0 }))], {
      type: "application/zip",
    }),
    "ChatBar-unsaved-images.zip",
  );
}
export const bytesOf = (blob: Blob) =>
  blob.arrayBuffer().then((b) => new Uint8Array(b));
export function base64(bytes: Uint8Array) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 32768)
    out += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(out);
}
export const fromBase64 = (s: string) =>
  Uint8Array.from(atob(s.replace(/^data:[^,]+,/, "")), (c) => c.charCodeAt(0));
export const blobBase64 = async (blob: Blob) => base64(await bytesOf(blob));
export async function dimensions(blob: Blob) {
  const b = await createImageBitmap(blob);
  const size = { width: b.width, height: b.height };
  b.close();
  return size;
}
export function canvas(width: number, height: number) {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c;
}
export const canvasBlob = (c: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) =>
    c.toBlob(
      (b) => (b ? resolve(b) : reject(Error("图片编码失败"))),
      "image/png",
    ),
  );
export async function normalizeImage(
  blob: Blob,
  width?: number,
  height?: number,
  pad = false,
) {
  const bytes = await bytesOf(blob);
  if (
    String.fromCharCode(...bytes.subarray(0, 3)) === "GIF" ||
    pngAnimated(bytes)
  )
    throw Error("动态图片不能作为静态参考图");
  const b = await createImageBitmap(blob),
    c = canvas(width || b.width, height || b.height),
    ctx = c.getContext("2d")!;
  if (pad) {
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, c.width, c.height);
    const scale = Math.min(c.width / b.width, c.height / b.height),
      w = b.width * scale,
      h = b.height * scale;
    ctx.drawImage(b, (c.width - w) / 2, (c.height - h) / 2, w, h);
  } else ctx.drawImage(b, 0, 0, c.width, c.height);
  b.close();
  return canvasBlob(c);
}
export async function normalizedAsset(
  id: string,
  width?: number,
  height?: number,
  pad = false,
) {
  return blobBase64(
    await normalizeImage(await assetBlob(id), width, height, pad),
  );
}
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export async function shareImage(blob: Blob, name = "ChatBar.png") {
  name = name.replace(
    /\.png$/,
    "." +
      ({ "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" }[
        blob.type
      ] || "png"),
  );
  const file = new File([blob], name, { type: blob.type || "image/png" });
  if (navigator.canShare?.({ files: [file] }))
    await navigator.share({ files: [file] });
  else download(blob, name);
}
export type Chunk = { type: string; data: Uint8Array };
const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
export function crc(bytes: Uint8Array) {
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
export function parsePng(bytes: Uint8Array): Chunk[] {
  if (!signature.every((b, i) => bytes[i] === b)) throw Error("不是 PNG 文件");
  const chunks: Chunk[] = [];
  let offset = 8;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  while (offset + 12 <= bytes.length) {
    const n = view.getUint32(offset);
    if (n > bytes.length - offset - 12) throw Error("PNG 数据截断");
    const type = new TextDecoder().decode(
        bytes.subarray(offset + 4, offset + 8),
      ),
      data = bytes.slice(offset + 8, offset + 8 + n);
    if (
      crc(bytes.subarray(offset + 4, offset + 8 + n)) !==
      view.getUint32(offset + 8 + n)
    )
      throw Error("PNG 校验失败");
    chunks.push({ type, data });
    offset += n + 12;
    if (type === "IEND") {
      if (offset !== bytes.length) throw Error("PNG 尾部存在异常数据");
      return chunks;
    }
  }
  throw Error("PNG 缺少结束块");
}
export function pngAnimated(bytes: Uint8Array) {
  try {
    return parsePng(bytes).some((c) => c.type === "acTL");
  } catch {
    return false;
  }
}
export function encodePng(chunks: Chunk[]) {
  const parts: Uint8Array<ArrayBuffer>[] = [signature];
  for (const { type, data } of chunks) {
    const part = new Uint8Array(data.length + 12),
      v = new DataView(part.buffer);
    v.setUint32(0, data.length);
    part.set(new TextEncoder().encode(type), 4);
    part.set(data, 8);
    v.setUint32(data.length + 8, crc(part.subarray(4, data.length + 8)));
    parts.push(part);
  }
  return new Blob(parts, { type: "image/png" });
}
export function textChunk(keyword: string, value: string): Chunk {
  return {
    type: "tEXt",
    data: new TextEncoder().encode(keyword + "\0" + value),
  };
}
export async function preserveText(source: Blob, result: Blob) {
  try {
    const sourceChunks = parsePng(await bytesOf(source)),
      resultChunks = parsePng(await bytesOf(result));
    const text = sourceChunks.filter((c) =>
      ["tEXt", "iTXt", "zTXt"].includes(c.type),
    );
    return encodePng([
      ...resultChunks.filter(
        (c) => c.type !== "IEND" && !["tEXt", "iTXt", "zTXt"].includes(c.type),
      ),
      ...text,
      { type: "IEND", data: new Uint8Array() },
    ]);
  } catch {
    return result;
  }
}
