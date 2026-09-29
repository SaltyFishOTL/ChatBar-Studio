import type { DesignReply } from "./types";
export type RewriteRule = {
  aliases: string[];
  replacements: string[];
  mode: string;
};
export function postprocess(reply: DesignReply, rules: RewriteRule[]) {
  const normalize = (s: string) =>
    s
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[_\s]+/g, " ")
      .trim();
  const index = new Map<string, RewriteRule>();
  for (const r of rules)
    for (const alias of r.aliases) {
      const k = normalize(alias);
      if (k && !index.has(k)) index.set(k, r);
    }
  const issues: string[] = [],
    rewrites: { location: string; before: string; after: string }[] = [];
  const core = (text: string, location: string) => {
    const m = text.match(/^((?:source|target|mutual)#(?:\d+:)?)(.+)$/i),
      prefix = m?.[1] || "",
      tag = m?.[2] || text,
      r = index.get(normalize(tag));
    if (!r) return text;
    if (r.mode === "AMBIGUOUS") {
      issues.push(
        `${location}：歧义 tag 未自动替换：${tag} → ${r.replacements.join(" / ")}`,
      );
      return text;
    }
    return r.replacements.map((v) => prefix + v).join(", ");
  };
  const caption = (text: string, location: string) => {
    if (!text.trim()) return text;
    const atoms = text
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean)
      .map((atom) => {
        const sd = atom.match(/^\((.+):([+-]?\d+(?:\.\d+)?)\)$/);
        let after: string;
        if (sd) after = `${sd[2]}::${core(sd[1].trim(), location)}::`;
        else {
          let start = atom.match(/^[+-]?\d+(?:\.\d+)?::\s*/)?.[0].length || 0;
          while (start < atom.length && "{[".includes(atom[start])) start++;
          let end = atom.length;
          if (atom.endsWith("::")) end -= 2;
          while (end > start && "}]".includes(atom[end - 1])) end--;
          after =
            end > start
              ? atom.slice(0, start) +
                core(atom.slice(start, end).trim(), location) +
                atom.slice(end)
              : atom;
        }
        if (after !== atom) rewrites.push({ location, before: atom, after });
        return after;
      });
    const result =
      atoms.join(", ") +
      (text.trimEnd().endsWith(",") && atoms.length ? "," : "");
    for (const [left, right, label] of [
      ["{", "}", "花括号"],
      ["[", "]", "方括号"],
    ])
      if (result.split(left).length !== result.split(right).length)
        issues.push(`${location}：${label}权重未配平`);
    if ((result.match(/::/g)?.length || 0) % 2)
      issues.push(`${location}：数值权重 :: 未配平`);
    if (/#绘画|--steps|prompt_guidance|ntags\s*=/i.test(result))
      issues.push(`${location}：检测到法典 Bot/参数指令；已保留，请应用前检查`);
    if (/\([^,()]+:[+-]?\d+(?:\.\d+)?\)/.test(result))
      issues.push(`${location}：检测到未标准化的 Stable Diffusion 权重语法`);
    return result;
  };
  return {
    reply: {
      ...reply,
      baseCaption: caption(reply.baseCaption, "baseCaption"),
      characters: reply.characters.map((c, i) => ({
        caption: caption(c.caption, `characters[${i}].caption`),
      })),
    },
    issues,
    rewrites,
  };
}
