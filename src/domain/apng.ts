import { zlibSync } from "fflate";
import { parseGIF, decompressFrames } from "gifuct-js";
import {
  bytesOf,
  parsePng,
  encodePng,
  textChunk,
  canvas,
  type Chunk,
} from "./images";
const u32 = (...values: number[]) => {
  const a = new Uint8Array(values.length * 4),
    v = new DataView(a.buffer);
  values.forEach((x, i) => v.setUint32(i * 4, x));
  return a;
};
const get = (a: Uint8Array, offset = 0) =>
  new DataView(a.buffer, a.byteOffset, a.byteLength).getUint32(offset);
function ihdr(w: number, h: number) {
  const a = new Uint8Array(13);
  a.set(u32(w, h));
  a[8] = 8;
  a[9] = 6;
  return { type: "IHDR", data: a };
}
function compressed(rgba: Uint8ClampedArray, w: number, h: number) {
  const rows = new Uint8Array((w * 4 + 1) * h);
  for (let y = 0; y < h; y++)
    rows.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1);
  return zlibSync(rows);
}
function control(seq: number, w: number, h: number, delay = 100, blend = 0) {
  const a = new Uint8Array(26),
    v = new DataView(a.buffer);
  a.set(u32(seq, w, h, 0, 0));
  v.setUint16(20, Math.min(65535, delay));
  v.setUint16(22, 1000);
  a[24] = 0;
  a[25] = blend;
  return { type: "fcTL", data: a };
}
function fd(seq: number, bytes: Uint8Array) {
  const a = new Uint8Array(bytes.length + 4);
  a.set(u32(seq));
  a.set(bytes, 4);
  return { type: "fdAT", data: a };
}
async function pixels(blob: Blob) {
  const b = await createImageBitmap(blob);
  if (b.width * b.height > 16777216) {
    b.close();
    throw Error("图片过大");
  }
  const c = canvas(b.width, b.height),
    ctx = c.getContext("2d")!;
  ctx.drawImage(b, 0, 0);
  b.close();
  return ctx.getImageData(0, 0, c.width, c.height);
}
function cover(w: number, h: number) {
  const c = canvas(w, h),
    ctx = c.getContext("2d")!;
  ctx.fillStyle = "#f8f7f4";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#25362c";
  ctx.font = `600 ${Math.max(12, Math.min(w, h) * 0.09)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("ChatBar Studio", w / 2, h / 2, w * 0.85);
  return ctx.getImageData(0, 0, w, h).data;
}
export function inspectDisguise(bytes: Uint8Array) {
  const chunks = parsePng(bytes),
    header = chunks[0];
  if (
    header.type !== "IHDR" ||
    header.data[8] !== 8 ||
    header.data[9] !== 6 ||
    header.data[12] !== 0
  )
    throw Error("不支持的伪装像素格式");
  const marker = chunks.filter(
    (c) =>
      c.type === "tEXt" &&
      new TextDecoder().decode(c.data).startsWith("ChatBarApngDisguise\0"),
  );
  if (marker.length !== 1) throw Error("不是 ChatBar 伪装图片");
  const parts = new TextDecoder()
      .decode(marker[0].data)
      .split("\0")[1]
      .split(";"),
    version = Number(parts[0]),
    kind = parts[1],
    count = Number(parts[2]);
  if (
    ![1, 2].includes(version) ||
    !["STATIC", "ANIMATED"].includes(kind) ||
    !Number.isInteger(count) ||
    count < 1
  )
    throw Error("伪装标记无效");
  if (chunks[1]?.type !== "acTL" || chunks[2] !== marker[0])
    throw Error("伪装块顺序无效");
  const actl = chunks[1],
    width = get(header.data),
    height = get(header.data, 4);
  let sequence = 0,
    seenDefault = false;
  const frames: { control: Chunk; data: Chunk[] }[] = [];
  for (const c of chunks.slice(3, -1)) {
    if (c.type === "IDAT") {
      if (frames.length) throw Error("默认图位置异常");
      seenDefault = true;
    } else if (c.type === "fcTL") {
      if (!seenDefault || get(c.data) !== sequence++ || c.data.length !== 26)
        throw Error("伪装帧顺序异常");
      frames.push({ control: c, data: [] });
    } else if (c.type === "fdAT") {
      if (!frames.length || get(c.data) !== sequence++)
        throw Error("伪装数据帧顺序异常");
      frames.at(-1)!.data.push(c);
    } else throw Error("伪装包含未知块");
  }
  if (frames.length !== get(actl.data) || frames.some((f) => !f.data.length))
    throw Error("伪装帧数量异常");
  if (kind === "STATIC" && (count !== 1 || frames.length !== 2))
    throw Error("静态伪装帧无效");
  if (kind === "ANIMATED" && (count < 2 || frames.length !== count))
    throw Error("动态伪装帧无效");
  for (const f of frames.slice(0, kind === "STATIC" ? 1 : frames.length))
    if (
      get(f.control.data, 4) !== width ||
      get(f.control.data, 8) !== height ||
      get(f.control.data, 12) ||
      get(f.control.data, 16) ||
      f.control.data[24] ||
      f.control.data[25]
    )
      throw Error("真图帧合成方式无效");
  if (kind === "STATIC") {
    const sentinel = frames[1].control.data;
    if (
      get(sentinel, 4) !== 1 ||
      get(sentinel, 8) !== 1 ||
      sentinel[24] !== 0 ||
      (version === 1 &&
        (get(sentinel, 12) !== 0 ||
          get(sentinel, 16) !== 0 ||
          sentinel[25] !== 1))
    )
      throw Error("静态保活帧无效");
  }
  return { header, actl, frames, kind, width, height, count };
}
export async function restoreDisguise(blob: Blob) {
  const info = inspectDisguise(await bytesOf(blob)),
    out: Chunk[] = [info.header];
  if (info.kind === "STATIC") {
    for (const c of info.frames[0].data)
      out.push({ type: "IDAT", data: c.data.slice(4) });
  } else {
    out.push(info.actl);
    let seq = 0;
    info.frames.forEach((f, i) => {
      const data = f.control.data.slice();
      data.set(u32(seq++));
      out.push({ type: "fcTL", data });
      for (const c of f.data)
        out.push(
          i === 0
            ? { type: "IDAT", data: c.data.slice(4) }
            : fd(seq++, c.data.slice(4)),
        );
    });
  }
  out.push({ type: "IEND", data: new Uint8Array() });
  return encodePng(out);
}
export async function disguise(
  blob: Blob,
  signal: AbortSignal,
  progress: (s: string) => void,
) {
  const bytes = await bytesOf(blob),
    gif = String.fromCharCode(...bytes.subarray(0, 3)) === "GIF";
  if (!gif) {
    try {
      if (parsePng(bytes).some((c) => c.type === "acTL"))
        throw Error("动态 PNG 仅支持还原 ChatBar 伪装；第三方 APNG 不重新编码");
    } catch (e) {
      if ((e as Error).message.includes("动态 PNG")) throw e;
    }
  }
  let width: number,
    height: number,
    frames: { rgba: Uint8ClampedArray; delay: number }[] = [],
    plays = 0;
  if (gif) {
    const parsed = parseGIF(bytes.buffer as ArrayBuffer);
    width = parsed.lsd.width;
    height = parsed.lsd.height;
    const frameCount = parsed.frames.filter((f: any) => f.image).length;
    if (width * height * frameCount > 32000000)
      throw Error("GIF 总像素过大，请缩小或减少帧数");
    const decoded = decompressFrames(parsed, true),
      c = canvas(width, height),
      ctx = c.getContext("2d")!;
    let previous: ImageData | null = null;
    for (let i = 0; i < decoded.length; i++) {
      signal.throwIfAborted();
      const f = decoded[i],
        last = decoded[i - 1];
      if (last?.disposalType === 2)
        ctx.clearRect(
          last.dims.left,
          last.dims.top,
          last.dims.width,
          last.dims.height,
        );
      if (last?.disposalType === 3 && previous)
        ctx.putImageData(previous, 0, 0);
      previous =
        f.disposalType === 3 ? ctx.getImageData(0, 0, width, height) : null;
      const patch = canvas(f.dims.width, f.dims.height);
      patch
        .getContext("2d")!
        .putImageData(
          new ImageData(
            new Uint8ClampedArray(f.patch),
            f.dims.width,
            f.dims.height,
          ),
          0,
          0,
        );
      ctx.drawImage(patch, f.dims.left, f.dims.top);
      frames.push({
        rgba: ctx.getImageData(0, 0, width, height).data,
        delay: f.delay,
      });
    }
    const app = parsed.frames.find((f: any) =>
        f.application?.id?.startsWith("NETSCAPE"),
      ) as any,
      block = app?.application?.blocks;
    if (!block) plays = 1;
    else {
      const loop = block[1] + block[2] * 256;
      plays = loop === 0 ? 0 : loop + 1;
    }
  } else {
    const p = await pixels(blob);
    width = p.width;
    height = p.height;
    frames = [{ rgba: p.data, delay: 100 }];
  }
  if (!frames.length) throw Error("图片没有可用帧");
  const animated = frames.length > 1;
  const out: Chunk[] = [
    ihdr(width, height),
    {
      type: "acTL",
      data: u32(animated ? frames.length : 2, animated ? plays : 0),
    },
    textChunk(
      "ChatBarApngDisguise",
      `1;${animated ? "ANIMATED" : "STATIC"};${animated ? frames.length : 1}`,
    ),
    { type: "IDAT", data: compressed(cover(width, height), width, height) },
  ];
  let seq = 0,
    total = 0;
  for (let i = 0; i < frames.length; i++) {
    signal.throwIfAborted();
    progress(`处理帧 ${i + 1}/${frames.length}`);
    const data = compressed(frames[i].rgba, width, height);
    total += data.length;
    if (total > 100 * 1024 * 1024) throw Error("结果超过 100 MiB");
    out.push(control(seq++, width, height, frames[i].delay), fd(seq++, data));
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  if (!animated)
    out.push(
      control(seq++, 1, 1, 100, 1),
      fd(seq++, compressed(new Uint8ClampedArray(4), 1, 1)),
    );
  out.push({ type: "IEND", data: new Uint8Array() });
  return encodePng(out);
}
