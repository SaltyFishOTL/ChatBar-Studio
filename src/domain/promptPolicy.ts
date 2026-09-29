import {
  MODELS,
  type StudioDraft,
  type ImageModel,
  type Character,
} from "./types";
export const joinPrompt = (...parts: string[]) =>
  parts
    .map((s) => s.trim())
    .filter(Boolean)
    .join(", ");
export function normalizedPrompt(d: StudioDraft) {
  const normalize = (s: string) => s.replaceAll("，", ",");
  const characters = d.characters.map((c) => ({
    ...c,
    prompt: normalize(c.prompt),
    negative: normalize(c.negative),
  }));
  return {
    base: expandV5(
      normalize(joinPrompt(d.style, d.base, d.extra)),
      characters,
      d.model,
    ),
    negative: normalize(d.negative).trim(),
    characters,
  };
}
export function expandV5(base: string, roles: Character[], model: ImageModel) {
  if (model !== "V5_FULL") return base;
  const explicit = /(?:^|[\s,.:\[\]{}、。])text:(?!:)/i;
  if ([base, ...roles.map((r) => r.prompt)].some((s) => explicit.test(s)))
    return base;
  let chunkEnd = base.length,
    randomizer = false;
  for (let i = 0; i < base.length; i++) {
    if (base.slice(i, i + 2) === "||") {
      randomizer = !randomizer;
      i++;
    } else if (base[i] === "|" && !randomizer) {
      chunkEnd = i;
      break;
    }
  }
  const quoted = (s: string) => {
    const out: string[] = [],
      pairs: Record<string, string> = {
        '"': '"',
        "“": "”",
        "「": "」",
        "'": "'",
        "‘": "’",
      };
    for (let i = 0; i < s.length; i++) {
      const end = pairs[s[i]];
      if (!end || (s[i] === "'" && i > 0 && !/[\s,.]/.test(s[i - 1]))) continue;
      let j = i + 1;
      while (
        j < s.length &&
        (s[j] !== end ||
          ((end === "'" || end === "’") &&
            /[\p{L}\p{N}]/u.test(s[j + 1] || "")))
      )
        j++;
      if (j < s.length) {
        const text = s.slice(i + 1, j).trim();
        if (text) out.push(text);
        i = j;
      }
    }
    return out;
  };
  const groups = [
      quoted(base.slice(0, chunkEnd)),
      ...roles.filter((c) => c.prompt).map((c) => quoted(c.prompt)),
    ],
    text = groups.flat().join("");
  if (!text) return base;
  const reverse =
    (text.match(
      /[\u3000-\u303F\u3040-\u309F\u30A0-\u30FF\uFF00-\uFF9F\u4E00-\u9FAF\u3400-\u4DBF]/g,
    )?.length || 0) /
      text.length >
    0.3;
  const block =
    "teXt: " +
    groups.flatMap((g) => (reverse ? [...g].reverse() : g)).join("\n\n");
  const head = base.slice(0, chunkEnd).replace(/[,\s]+$/, "");
  return (head ? head + ", " : "") + block + base.slice(chunkEnd);
}
export function effectiveSize(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height))
    throw Error("尺寸必须是数字");
  const w = Math.round(width / 64) * 64,
    h = Math.round(height / 64) * 64;
  if (w < 64 || h < 64 || w > 2048 || h > 2048 || w * h > 3145728)
    throw Error("尺寸需在 64–2048 内，面积不能超过 3,145,728 像素");
  return { width: w, height: h };
}
export function validateDraft(d: StudioDraft) {
  const s = d.perModel[d.model];
  effectiveSize(s.width, s.height);
  if (!joinPrompt(d.style, d.base, d.extra).trim())
    throw Error("请输入正面提示词");
  if (d.characters.length > MODELS[d.model].roles)
    throw Error(
      `${MODELS[d.model].name} 最多支持 ${MODELS[d.model].roles} 个角色，不会自动截断`,
    );
  if (!Number.isInteger(s.count) || s.count < 1 || s.count > 4)
    throw Error("每批数量必须是 1–4");
  if (
    ![
      s.guidance,
      s.cfgRescale,
      ...d.characters.flatMap((c) => [c.center.x, c.center.y]),
    ].every(Number.isFinite)
  )
    throw Error("生成参数必须是有效数字");
  if (
    !Number.isInteger(s.steps) ||
    s.steps < 1 ||
    s.steps > 50 ||
    s.guidance < 1 ||
    s.guidance > 10 ||
    s.cfgRescale < 0 ||
    s.cfgRescale > 1
  )
    throw Error("生成参数超出范围");
  if (
    s.seedMode === "FIXED" &&
    (!Number.isInteger(s.seed) ||
      s.seed < 0 ||
      s.seed > 4294967295 - (s.count - 1))
  )
    throw Error("当前批量下 Seed 超出范围");
  const g = d.guidance;
  if (
    ![
      g.strength,
      g.noise,
      g.inpaintStrength,
      g.preciseStrength,
      g.fidelity,
      ...g.vibes.flatMap((v) => [v.strength, v.information]),
    ].every((v) => Number.isFinite(v) && v >= 0 && v <= 1)
  )
    throw Error("图像引导参数必须在 0–1 之间");
  if (d.model === "V4_5_FULL" && g.referenceMode === "precise" && !g.precise)
    throw Error("请导入精确参考图片");
  if (d.model === "V4_5_FULL" && g.referenceMode === "vibe" && !g.vibes.length)
    throw Error("请导入氛围参考图片");
  if (d.guidance.action !== "generate" && !d.guidance.base)
    throw Error("缺少基图");
  if (d.guidance.action === "infill" && !d.guidance.focus)
    throw Error("请先选择局部重绘区域");
}
const heading = /^【(画风|基础|补充|角色 ([1-9]\d*))】$/;
export function copyPositive(d: StudioDraft, ignoreStyle: boolean) {
  const escape = (s: string) =>
    s
      .split("\n")
      .map((l) => (l.startsWith("\\") || heading.test(l) ? "\\" + l : l))
      .join("\n");
  const sections: [string, string][] = [
    ...(!ignoreStyle ? [["画风", d.style] as [string, string]] : []),
    ["基础", d.base],
    ...(d.extra ? [["补充", d.extra] as [string, string]] : []),
    ...d.characters.map(
      (c, i) => [`角色 ${i + 1}`, c.prompt] as [string, string],
    ),
  ];
  return sections
    .map(([name, value]) => `【${name}】\n${escape(value)}`)
    .join("\n\n");
}
export function pastePositive(text: string, d: StudioDraft): StudioDraft {
  if (text.trim().startsWith("{")) {
    const v = JSON.parse(text);
    if (
      v.format !== "chatbar-positive-prompt-v1" ||
      typeof v.basePrompt !== "string" ||
      typeof v.extraPrompt !== "string" ||
      !Array.isArray(v.characterPrompts) ||
      !v.characterPrompts.every((p: unknown) => typeof p === "string") ||
      (v.stylePrompt != null && typeof v.stylePrompt !== "string")
    )
      throw Error("不是工作室提示词格式");
    const r = {
      ...d,
      style: v.stylePrompt ?? d.style,
      base: v.basePrompt ?? "",
      extra: v.extraPrompt ?? "",
      characters: (v.characterPrompts || []).map(
        (prompt: string, i: number) => ({
          ...d.characters[i],
          id: d.characters[i]?.id || crypto.randomUUID(),
          prompt,
          negative: d.characters[i]?.negative || "",
          center: d.characters[i]?.center || { x: 0.5, y: 0.5 },
        }),
      ),
    };
    if (r.characters.length > MODELS[d.model].roles)
      throw Error("角色数量超限");
    return r;
  }
  const values = new Map<string, string>();
  const source = text.replaceAll("\r\n", "\n"),
    matches = [...source.matchAll(/^【(画风|基础|补充|角色 [1-9]\d*)】$/gm)];
  if (!matches.length || matches[0].index !== 0)
    throw Error("缺少提示词分段标识");
  matches.forEach((m, i) => {
    if (values.has(m[1])) throw Error("提示词分段重复");
    let content = source.slice(
      m.index + m[0].length,
      matches[i + 1]?.index ?? source.length,
    );
    if (content && !content.startsWith("\n")) throw Error("分段标识后需要换行");
    content = content.replace(/^\n/, "");
    if (i < matches.length - 1 && content.endsWith("\n\n"))
      content = content.slice(0, -2);
    values.set(
      m[1],
      content
        .split("\n")
        .map((line) =>
          line.startsWith("\\\\") ||
          (line.startsWith("\\") && heading.test(line.slice(1)))
            ? line.slice(1)
            : line,
        )
        .join("\n"),
    );
  });
  if (!values.has("基础")) throw Error("缺少【基础】分段");
  const value = (k: string) => values.get(k) || "";
  const roles = [...values.keys()].filter((k) => k.startsWith("角色 "));
  if (
    roles.some((k, i) => k !== `角色 ${i + 1}`) ||
    roles.length > MODELS[d.model].roles
  )
    throw Error("角色编号不连续或数量超限");
  return {
    ...d,
    style: values.has("画风") ? value("画风") : d.style,
    base: value("基础"),
    extra: value("补充"),
    characters: roles.map((k, i) => ({
      id: d.characters[i]?.id || crypto.randomUUID(),
      prompt: value(k),
      negative: d.characters[i]?.negative || "",
      center: d.characters[i]?.center || { x: 0.5, y: 0.5 },
    })),
  };
}
export type Segment = {
  start: number;
  end: number;
  source: string;
  lookup: string;
  natural: boolean;
};
export function segments(text: string): Segment[] {
  const result: Segment[] = [];
  let start = 0,
    quote = "",
    natural = false;
  const push = (end: number) => {
    let a = start,
      b = end;
    while (a < b && /\s/.test(text[a])) a++;
    while (b > a && /\s/.test(text[b - 1])) b--;
    if (a < b) {
      const source = text.slice(a, b),
        lookup = source
          .replace(/^[\[{]*(?:-?\d*\.?\d*::)?/, "")
          .replace(/(?:[\]}]|::)+$/, "")
          .replace(/^text:\s*/i, "")
          .trim();
      result.push({ start: a, end: b, source, lookup, natural });
    }
  };
  for (let i = 0; i <= text.length; i++) {
    if (i === start) natural = /^[\s\[{}]*text:/i.test(text.slice(i));
    const c = text[i];
    if (i === text.length) {
      push(i);
      break;
    }
    if (quote) {
      if (c === quote) quote = "";
      continue;
    }
    if (c === '"' || c === "“") {
      quote = c === "“" ? "”" : '"';
      continue;
    }
    const marker = !natural
      ? text.slice(i).match(/^(?:source|target|mutual)#/i)
      : null;
    if (marker) {
      push(i);
      i += marker[0].length - 1;
      start = i + 1;
      continue;
    }
    if (c === "\n" || (!natural && (c === "," || c === "，"))) {
      push(i);
      start = i + 1;
    }
  }
  return result;
}
export function activeFragment(text: string, cursor: number) {
  cursor = Math.max(0, Math.min(cursor, text.length));
  let start = cursor;
  while (start > 0 && !/[,，\n]/.test(text[start - 1])) start--;
  const segmentStart = start;
  for (const m of text
    .slice(segmentStart, cursor)
    .matchAll(/(?:source|target)#/gi))
    start = segmentStart + m.index + m[0].length;
  while (start < cursor && /[\s{[(]/.test(text[start])) start++;
  while (true) {
    const m = text.slice(start, cursor).match(/^[+-]?(?:\d+(?:\.\d+)?)?::/);
    if (!m) break;
    start += m[0].length;
  }
  let end = cursor;
  while (end > start && /[\s}\])]/.test(text[end - 1])) end--;
  while (end - 2 >= start && text.slice(end - 2, end) === "::") end -= 2;
  const query = text.slice(start, end).trim();
  return query ? { query, start, end } : null;
}
export function insertCandidate(
  text: string,
  cursor: number,
  candidate: string,
) {
  const f = activeFragment(text, cursor);
  if (!f)
    return { value: text, cursor: Math.max(0, Math.min(cursor, text.length)) };
  const suffix = text.slice(f.end),
    tail = suffix.trimStart(),
    insert = !!tail && !/^[,，\n}\])]/.test(tail) && !tail.startsWith("::"),
    replace = candidate + (insert ? ", " : "");
  return {
    value:
      text.slice(0, f.start) +
      replace +
      suffix.slice(insert ? suffix.length - tail.length : 0),
    cursor: f.start + replace.length,
  };
}
