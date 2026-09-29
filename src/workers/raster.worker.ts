type Pixels = { width: number; height: number; data: Uint8ClampedArray };
const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v));
function contributors(source: number, target: number) {
  const scale = target / source,
    filter = Math.min(1, scale),
    support = 3 / filter;
  return Array.from({ length: target }, (_, t) => {
    const center = (t + 0.5) / scale - 0.5,
      first = Math.ceil(center - support),
      last = Math.floor(center + support),
      indices: number[] = [],
      weights: number[] = [];
    let total = 0;
    for (let s = first; s <= last; s++) {
      const x = (center - s) * filter,
        a = Math.abs(x),
        rad = Math.PI * x,
        w =
          (a < 1e-12
            ? 1
            : a >= 3
              ? 0
              : ((Math.sin(rad) / rad) * Math.sin(rad / 3)) / (rad / 3)) *
          filter;
      indices.push(clamp(s, 0, source - 1));
      weights.push(Math.fround(w));
      total += w;
    }
    return { indices, weights: weights.map((w) => Math.fround(w / total)) };
  });
}
function resizeAxis(p: Pixels, target: number, horizontal: boolean): Pixels {
  const table = contributors(horizontal ? p.width : p.height, target),
    width = horizontal ? target : p.width,
    height = horizontal ? p.height : target,
    data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const c = table[horizontal ? x : y];
      for (let ch = 0; ch < 4; ch++) {
        let sum = 0;
        for (let k = 0; k < c.indices.length; k++) {
          const pos = horizontal
            ? (y * p.width + c.indices[k]) * 4 + ch
            : (c.indices[k] * p.width + x) * 4 + ch;
          sum = Math.fround(sum + Math.fround(p.data[pos] * c.weights[k]));
        }
        data[(y * width + x) * 4 + ch] = clamp(Math.floor(sum + 0.5), 0, 255);
      }
    }
  return { width, height, data };
}
function resize(p: Pixels, w: number, h: number) {
  if (p.width === w && p.height === h) return p;
  return w * p.height <= p.width * h
    ? resizeAxis(resizeAxis(p, w, true), h, false)
    : resizeAxis(resizeAxis(p, h, false), w, true);
}
async function read(blob: Blob) {
  const bitmap = await createImageBitmap(blob),
    c = new OffscreenCanvas(bitmap.width, bitmap.height),
    ctx = c.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return ctx.getImageData(0, 0, c.width, c.height);
}
async function encode(p: Pixels) {
  const c = new OffscreenCanvas(p.width, p.height);
  c.getContext("2d")!.putImageData(
    new ImageData(new Uint8ClampedArray(p.data), p.width, p.height),
    0,
    0,
  );
  return c.convertToBlob({ type: "image/png" });
}
function crop(
  p: Pixels,
  f: { x: number; y: number; width: number; height: number },
): Pixels {
  const data = new Uint8ClampedArray(f.width * f.height * 4);
  for (let y = 0; y < f.height; y++)
    data.set(
      p.data.subarray(
        ((y + f.y) * p.width + f.x) * 4,
        ((y + f.y) * p.width + f.x + f.width) * 4,
      ),
      y * f.width * 4,
    );
  return { width: f.width, height: f.height, data };
}
function blur(src: Uint8Array, w: number, h: number, r: number) {
  const a = new Uint8Array(src.length),
    out = new Uint8Array(src.length),
    n = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let x = -r; x <= r; x++) sum += src[y * w + clamp(x, 0, w - 1)];
    for (let x = 0; x < w; x++) {
      a[y * w + x] = Math.floor(sum / n);
      sum +=
        src[y * w + clamp(x + r + 1, 0, w - 1)] -
        src[y * w + clamp(x - r, 0, w - 1)];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) sum += a[clamp(y, 0, h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = Math.floor(sum / n);
      sum +=
        a[clamp(y + r + 1, 0, h - 1) * w + x] -
        a[clamp(y - r, 0, h - 1) * w + x];
    }
  }
  return out;
}
self.onmessage = async ({ data: { id, type, payload: p } }) => {
  try {
    if (type === "resize") {
      self.postMessage({
        id,
        value: await encode(resize(await read(p.blob), p.width, p.height)),
      });
      return;
    }
    if (type === "focus") {
      const base = await read(p.base),
        f = p.focus,
        context = p.context ?? 96;
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
      const scale = Math.sqrt(1048576 / (f.width * f.height)),
        width = Math.max(64, Math.floor(Math.floor(f.width * scale) / 64) * 64),
        height = Math.max(
          64,
          Math.floor(Math.floor(f.height * scale) / 64) * 64,
        ),
        lw = width / 8,
        lh = height / 8;
      const originalMask = p.mask ? await read(p.mask) : null;
      if (
        originalMask &&
        (originalMask.width !== base.width ||
          originalMask.height !== base.height)
      )
        throw Error("蒙版尺寸不一致");
      const selected = (x: number, y: number) => {
        if (!originalMask) return false;
        const i = ((f.y + y) * base.width + f.x + x) * 4;
        return (
          originalMask.data[i + 3] > 155 &&
          (originalMask.data[i] +
            originalMask.data[i + 1] +
            originalMask.data[i + 2]) /
            3 >
            155
        );
      };
      let painted = false;
      for (let y = context; y < f.height - context && !painted; y++)
        for (let x = context; x < f.width - context; x++)
          if (selected(x, y)) {
            painted = true;
            break;
          }
      const latent = new Uint8Array(lw * lh);
      for (let y = 0; y < lh; y++)
        for (let x = 0; x < lw; x++) {
          const cx = Math.floor(((x + 0.5) * f.width) / lw),
            cy = Math.floor(((y + 0.5) * f.height) / lh);
          latent[y * lw + x] =
            cx >= context &&
            cx < f.width - context &&
            cy >= context &&
            cy < f.height - context &&
            (!painted || selected(cx, cy))
              ? 255
              : 0;
        }
      const expanded = new Uint8ClampedArray(width * height * 4),
        dilated = new Uint8Array(lw * lh);
      for (let y = 0; y < lh; y++)
        for (let x = 0; x < lw; x++) {
          let yes = false;
          for (let dy = -4; dy <= 4 && !yes; dy++)
            for (let dx = -4; dx <= 4; dx++)
              if (
                x + dx >= 0 &&
                x + dx < lw &&
                y + dy >= 0 &&
                y + dy < lh &&
                latent[(y + dy) * lw + x + dx]
              ) {
                yes = true;
                break;
              }
          dilated[y * lw + x] = yes ? 255 : 0;
        }
      let alpha = new Uint8Array(width * height);
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const i = y * width + x,
            k = Math.floor(y / 8) * lw + Math.floor(x / 8);
          expanded[i * 4] =
            expanded[i * 4 + 1] =
            expanded[i * 4 + 2] =
              latent[k];
          expanded[i * 4 + 3] = 255;
          alpha[i] = dilated[k];
        }
      alpha = blur(blur(alpha, width, height, 20), width, height, 20);
      self.postMessage(
        {
          id,
          value: {
            width,
            height,
            image: await encode(resize(crop(base, f), width, height)),
            mask: await encode({ width, height, data: expanded }),
            alpha,
          },
        },
        [alpha.buffer],
      );
      return;
    }
    if (type === "compose") {
      const base = await read(p.base),
        patch = resize(await read(p.patch), p.focus.width, p.focus.height),
        a = new Uint8ClampedArray(p.width * p.height * 4);
      for (let i = 0; i < p.alpha.length; i++)
        a[i * 4] = a[i * 4 + 1] = a[i * 4 + 2] = a[i * 4 + 3] = p.alpha[i];
      const mask = resize(
        { width: p.width, height: p.height, data: a },
        p.focus.width,
        p.focus.height,
      );
      for (let y = 0; y < patch.height; y++)
        for (let x = 0; x < patch.width; x++) {
          const i = (y * patch.width + x) * 4,
            j = ((y + p.focus.y) * base.width + x + p.focus.x) * 4,
            m = mask.data[i + 3] / 255,
            sa = patch.data[i + 3] / 255,
            ba = base.data[j + 3] / 255,
            oa = ba * (1 - m) + sa * m;
          for (let c = 0; c < 3; c++)
            base.data[j + c] = oa
              ? Math.round(
                  (base.data[j + c] * ba * (1 - m) +
                    patch.data[i + c] * sa * m) /
                    oa,
                )
              : 0;
          base.data[j + 3] = Math.round(oa * 255);
        }
      self.postMessage({ id, value: await encode(base) });
      return;
    }
    throw Error("未知图片处理操作");
  } catch (e) {
    self.postMessage({ id, error: e instanceof Error ? e.message : String(e) });
  }
};
