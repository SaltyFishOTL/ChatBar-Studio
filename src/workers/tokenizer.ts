import { gunzipSync } from "fflate";
class Reader {
  offset = 0;
  view: DataView;
  bytes: Uint8Array;
  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  int() {
    const v = this.view.getInt32(this.offset);
    this.offset += 4;
    return v;
  }
  float() {
    const v = this.view.getFloat32(this.offset);
    this.offset += 4;
    return v;
  }
  text(n: number) {
    const v = new TextDecoder().decode(
      this.bytes.subarray(this.offset, this.offset + n),
    );
    this.offset += n;
    return v;
  }
  sized() {
    return this.text(this.int());
  }
}
type Counter = (text: string) => number;
const counters = new Map<string, Promise<Counter>>();
export function tokenizer(model: string): Promise<Counter> {
  let promise = counters.get(model);
  if (!promise) {
    promise = load(model).catch((e) => {
      counters.delete(model);
      throw e;
    });
    counters.set(model, promise);
  }
  return promise;
}
async function load(model: string): Promise<Counter> {
  const r = await fetch(
    "/data/tokenizers/" +
      (model === "V5_FULL" ? "nai_qwen35_v2.binz" : "nai_t5_v2.binz"),
  );
  if (!r.ok) throw Error("分词器加载失败");
  const reader = new Reader(gunzipSync(new Uint8Array(await r.arrayBuffer())));
  return model === "V5_FULL" ? qwen(reader) : t5(reader);
}
function t5(r: Reader): Counter {
  if (r.text(4) !== "NT51" || r.int() !== 3) throw Error("T5 分词器格式不支持");
  r.int();
  r.int();
  const n = r.int(),
    unknown = r.float(),
    edges = r.int();
  const ids = new Int32Array(n),
    scores = new Float32Array(n),
    first = new Int32Array(n),
    counts = new Int32Array(n),
    units = new Int32Array(edges),
    nodes = new Int32Array(edges);
  for (let i = 0; i < n; i++) {
    ids[i] = r.int();
    scores[i] = r.float();
    first[i] = r.int();
    counts[i] = r.int();
  }
  for (let i = 0; i < edges; i++) {
    units[i] = r.int();
    nodes[i] = r.int();
  }
  const child = (node: number, unit: number) => {
    let lo = first[node],
      hi = lo + counts[node] - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (units[mid] < unit) lo = mid + 1;
      else if (units[mid] > unit) hi = mid - 1;
      else return nodes[mid];
    }
    return -1;
  };
  const piece = (text: string) => {
    const best = new Float32Array(text.length + 1).fill(-Infinity),
      size = new Int32Array(text.length + 1);
    best[0] = 0;
    const update = (a: number, b: number, score: number) => {
      const candidate = Math.fround(best[a] + score);
      if (best[b] === -Infinity || candidate > best[b]) {
        best[b] = candidate;
        size[b] = size[a] + 1;
      }
    };
    for (let a = 0; a < text.length; a++) {
      if (best[a] === -Infinity) continue;
      let node = 0,
        one = false;
      for (let b = a; b < text.length; b++) {
        node = child(node, text.charCodeAt(b));
        if (node < 0) break;
        if (ids[node] >= 0) {
          if (b === a) one = true;
          update(a, b + 1, scores[node]);
        }
      }
      if (!one) update(a, a + 1, unknown);
    }
    return size[text.length];
  };
  return (text) => {
    if (!text) return 1;
    const clean = text.replace(/[\[\]{}]/g, "").replace(/-?\d*\.?\d*::/g, "");
    return (
      1 +
      clean
        .split(
          /[\t-\r \u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+/,
        )
        .reduce((sum, p) => sum + piece(p.startsWith("▁") ? p : "▁" + p), 0)
    );
  };
}
function qwen(r: Reader): Counter {
  if (r.text(4) !== "NQ51" || r.int() !== 1)
    throw Error("Qwen 分词器格式不支持");
  const split = new RegExp(r.sized(), "gu"),
    specials = Array.from({ length: r.int() }, () => r.sized()).sort(
      (a, b) => b.length - a.length,
    ),
    bytes = Array.from({ length: 256 }, () => r.int()),
    merges = new Map<string, [number, number]>();
  const count = r.int();
  for (let rank = 0; rank < count; rank++) {
    const left = r.int(),
      right = r.int(),
      result = r.int();
    merges.set(left + ":" + right, [rank, result]);
  }
  const cache = new Map<string, number>();
  const word = (text: string) => {
    const cached = cache.get(text);
    if (cached !== undefined) return cached;
    let symbols = Array.from(new TextEncoder().encode(text), (b) => bytes[b]);
    while (symbols.length > 1) {
      let best = Infinity,
        left = -1,
        right = -1,
        result = -1;
      for (let i = 0; i < symbols.length - 1; i++) {
        const m = merges.get(symbols[i] + ":" + symbols[i + 1]);
        if (m && m[0] < best) {
          best = m[0];
          left = symbols[i];
          right = symbols[i + 1];
          result = m[1];
        }
      }
      if (best === Infinity) break;
      const next: number[] = [];
      for (let i = 0; i < symbols.length; i++) {
        if (symbols[i] === left && symbols[i + 1] === right) {
          next.push(result);
          i++;
        } else next.push(symbols[i]);
      }
      symbols = next;
    }
    cache.set(text, symbols.length);
    if (cache.size > 2048) cache.delete(cache.keys().next().value!);
    return symbols.length;
  };
  const ordinary = (text: string) => {
    let n = 0;
    for (const m of text.matchAll(split)) n += word(m[0]);
    return n;
  };
  return (raw) => {
    const text = raw.normalize("NFC");
    let cursor = 0,
      n = 0;
    while (cursor < text.length) {
      let best = text.length,
        token = "";
      for (const s of specials) {
        const i = text.indexOf(s, cursor);
        if (i >= 0 && (i < best || (i === best && s.length > token.length))) {
          best = i;
          token = s;
        }
      }
      n += ordinary(text.slice(cursor, best));
      if (!token) break;
      n++;
      cursor = best + token.length;
    }
    return n;
  };
}
