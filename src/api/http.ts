export function endpoint(base: string, path: string) {
  const u = new URL(base);
  if (u.protocol !== "https:") throw Error("API 地址必须使用 HTTPS");
  if (u.username || u.password || u.search || u.hash)
    throw Error("API 地址不能包含凭据、查询参数或片段");
  return u.href.replace(/\/$/, "") + path;
}
export async function directFetch(url: string, init: RequestInit) {
  try {
    return await fetch(url, {
      ...init,
      credentials: "omit",
      referrerPolicy: "no-referrer",
      cache: "no-store",
    });
  } catch (e) {
    if (init.signal?.aborted) throw init.signal.reason;
    throw Error(
      "无法连接 API：可能是网络、跨域或地址配置问题。本站不会自动切换代理。",
    );
  }
}
export async function checkResponse(r: Response, key = "") {
  if (r.ok) return;
  const body = (await readLimited(r, 8192, true)).slice(0, 800);
  throw Error(
    `HTTP ${r.status}：${key ? body.replaceAll(key, "[已隐藏]") : body}`,
  );
}
export async function readLimited(
  r: Response,
  limit: number,
  truncate = false,
) {
  if (!r.body) return "";
  const reader = r.body.getReader(),
    chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (total + value.length > limit) {
        if (!truncate) throw Error("响应超过允许大小");
        chunks.push(value.slice(0, limit - total));
        total = limit;
        break;
      }
      chunks.push(value);
      total += value.length;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const b of chunks) {
    out.set(b, offset);
    offset += b.length;
  }
  return new TextDecoder().decode(out);
}
export async function diagnoseConnection(base: string, path: string) {
  const r = await directFetch(endpoint(base, path), {
    method: "GET",
    signal: AbortSignal.timeout(20000),
  });
  await r.body?.cancel();
  return `浏览器已收到 HTTP ${r.status}；该只读路径跨域可达。生图或 LLM 的 POST 路径仍需单独验证。`;
}
export function pause(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    if (signal.aborted) {
      clearTimeout(timer);
      reject(signal.reason);
    } else signal.addEventListener("abort", onAbort, { once: true });
  });
}
