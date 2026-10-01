import initSqlJs, { type Database } from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import { gunzipSync } from "fflate";
import { tokenizer } from "./tokenizer";
import { normalizedPrompt } from "../domain/promptPolicy";
import type { Candidate, CodexEntry, StudioDraft } from "../domain/types";
const sql = initSqlJs({ locateFile: () => wasmUrl });
const loaded = new Map<string, Promise<Database>>(),
  cancelled = new Set<number>();
async function database(kind: string) {
  let p = loaded.get(kind);
  if (!p) {
    p = (async () => {
      const [r, m] = await Promise.all([
        fetch(
          kind === "ecdict"
            ? "/data/prompt_dictionary/ecdict.sqlite.binz"
            : `/data/tag_completion/${kind}.sqlite.binz`,
        ),
        fetch(
          kind === "ecdict"
            ? "/data/prompt_dictionary/metadata.json"
            : `/data/tag_completion/${kind}.json`,
        ),
      ]);
      if (!r.ok || !m.ok) throw Error(`${kind} 词库加载失败`);
      const manifest = await m.json(),
        bytes = gunzipSync(new Uint8Array(await r.arrayBuffer()));
      const hash = Array.from(
        new Uint8Array(
          await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)),
        ),
      )
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      if (
        hash !== (manifest.sha256 ?? manifest.databaseSha256) ||
        bytes.length !== (manifest.bytes ?? manifest.databaseBytes)
      )
        throw Error("词库完整性校验失败");
      return new (await sql).Database(bytes);
    })().catch((e) => {
      loaded.delete(kind);
      throw e;
    });
    loaded.set(kind, p);
  }
  return p;
}
const sleep = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const rowCandidate = (r: unknown[], dictionary: boolean): Candidate => ({
  name: String(r[0]),
  translation: String(r[1]),
  count: Number(r[2]),
  category: Number(r[3]),
  dictionary,
});
async function search(
  kind: string,
  raw: string,
  id: number,
  onBatch: (v: Candidate[]) => void,
  deadline = Infinity,
) {
  const query = (
    kind === "danbooru"
      ? raw.trim().replace(/\s+/g, "_")
      : raw.trim().replaceAll("_", " ")
  ).toLowerCase();
  if (!query) return;
  const d = await database(kind),
    grams = new Set<number>();
  if (Date.now() >= deadline) throw Error("Tag 检索超时");
  for (let i = 0; i < query.length; i++) {
    if (query.length === 1) grams.add(query.charCodeAt(i) + 1);
    else if (i > 0)
      grams.add(
        (query.charCodeAt(i - 1) + 1) * 131072 + query.charCodeAt(i) + 1,
      );
  }
  let rare = 0,
    min = Infinity;
  const stmt = d.prepare("SELECT n FROM grams WHERE gram=?");
  try {
    for (const gram of grams) {
      stmt.bind([gram]);
      if (!stmt.step()) return;
      const n = Number(stmt.get()[0]);
      stmt.reset();
      if (n < min) {
        min = n;
        rare = gram;
      }
    }
  } finally {
    stmt.free();
  }
  const data = d.exec("SELECT ranks FROM grams WHERE gram=" + rare)[0]
    ?.values[0]?.[0] as Uint8Array | undefined;
  if (!data) return;
  let rank = 0,
    offset = 0,
    batch: Candidate[] = [],
    pages = 0;
  while (offset < data.length && !cancelled.has(id)) {
    if (Date.now() >= deadline) throw Error("Tag 检索超时");
    const ranks: number[] = [];
    while (ranks.length < 64 && offset < data.length) {
      let delta = 0,
        shift = 0;
      while (true) {
        if (offset >= data.length || shift > 49) throw Error("词库索引损坏");
        const b = data[offset++];
        delta += (b & 127) * 2 ** shift;
        if (b < 128) break;
        shift += 7;
      }
      rank += delta;
      ranks.push(rank);
    }
    const rows =
      d.exec(
        `SELECT name,cn_name,post_count,category,a,b FROM entries WHERE rank IN (${ranks.join(",")}) ORDER BY rank`,
      )[0]?.values || [];
    for (const row of rows)
      if (String(row[4]).includes(query) || String(row[5]).includes(query))
        batch.push(rowCandidate(row, kind === "dictionary"));
    if (++pages % 4 === 0) {
      if (batch.length) {
        onBatch(batch);
        batch = [];
      }
      await sleep();
    }
  }
  if (batch.length && !cancelled.has(id)) onBatch(batch);
}
async function exact(
  kind: string,
  query: string,
): Promise<Candidate | undefined> {
  const d = await database(kind),
    stmt = d.prepare(
      "SELECT name,cn_name,post_count,category FROM entries WHERE name = ? LIMIT 1",
    );
  try {
    stmt.bind([query.toLowerCase()]);
    return stmt.step()
      ? rowCandidate(stmt.get(), kind === "dictionary")
      : undefined;
  } finally {
    stmt.free();
  }
}
let overrides: Promise<Record<string, string>> | undefined;
const localWords = (): Promise<Record<string, string>> =>
  (overrides ??= fetch("/data/dictionary-overrides.json")
    .then((r) => {
      if (!r.ok) throw Error("内置词典补充加载失败");
      return r.json();
    })
    .catch((e) => {
      overrides = undefined;
      throw e;
    }));
const meanings = new Map<string, string>();
async function meaning(raw: string) {
  const word = raw
    .trim()
    .replaceAll("_", " ")
    .replaceAll("’", "'")
    .replace(/\s+/g, " ")
    .toLowerCase();
  const local = await localWords();
  if (local[word]) return local[word];
  if (meanings.has(word)) return meanings.get(word)!;
  const d = await database("ecdict"),
    stmt = d.prepare("SELECT meaning FROM words WHERE word = ?");
  let value = "";
  try {
    stmt.bind([word]);
    if (stmt.step()) value = String(stmt.get()[0] || "");
  } finally {
    stmt.free();
  }
  value =
    value
      .split(/[;；\r\n]/)
      .map((s) => s.trim())
      .find(Boolean) || "";
  meanings.set(word, value);
  if (meanings.size > 2048) meanings.delete(meanings.keys().next().value!);
  return value;
}
const chinese = (s: string) => /[\u3400-\u9FFF\uF900-\uFAFF]/.test(s);
async function annotation(
  raw: string,
  natural: boolean,
  warnings: Set<string>,
) {
  if (!natural) {
    try {
      const tag = await exact(
        "danbooru",
        raw.replace(/\s+/g, "_").toLowerCase(),
      );
      if (tag?.translation && chinese(tag.translation)) return tag.translation;
    } catch (error) {
      warnings.add(`Tag 词库查询失败：${String(error)}`);
    }
  }
  const full = await meaning(raw);
  if (chinese(full)) return full;
  let result = "",
    end = 0;
  const source = raw.replaceAll("_", " ");
  const punctuation = (s: string) =>
    [...s]
      .map(
        (c) =>
          ({
            ",": "，",
            ".": "。",
            "!": "！",
            "?": "？",
            ":": "：",
            ";": "；",
            "\\": "/",
            "–": "-",
            "—": "-",
          })[c] ?? (/[，。！？：；/\-]/.test(c) ? c : ""),
      )
      .join("");
  for (const m of source.matchAll(/[A-Za-z]+(?:['’][A-Za-z]+)?/g)) {
    result += punctuation(source.slice(end, m.index));
    const translated = await meaning(m[0]);
    result += translated || " " + m[0] + " ";
    end = m.index + m[0].length;
  }
  result += punctuation(source.slice(end));
  return chinese(result) ? result.trim() : "";
}
const chineseGrams = (s: string) => {
  const set = new Set<string>();
  for (const run of s.match(/[\u3400-\u9fff]+/g) || [])
    for (const n of [2, 3])
      for (let i = 0; i <= run.length - n; i++) set.add(run.slice(i, i + n));
  return set;
};
let codex:
  | Promise<{
      entries: CodexEntry[];
      rewriteRules: { aliases: string[]; replacements: string[] }[];
    }>
  | undefined;
async function loadCodex() {
  if (!codex)
    codex = fetch("/data/codex.json")
      .then((r) => {
        if (!r.ok) throw Error("法典加载失败");
        return r.json();
      })
      .catch((e) => {
        codex = undefined;
        throw e;
      });
  return codex;
}
async function recall(queries: string[], scene: string) {
  const { entries } = await loadCodex(),
    indexed = entries.map((e) => ({
      e,
      g: chineseGrams(String(e.searchText || e.title + " " + e.category)),
    })),
    df = new Map<string, number>();
  for (const { g } of indexed)
    for (const v of g) df.set(v, (df.get(v) || 0) + 1);
  const sum = new Map<string, { e: CodexEntry; s: number }>();
  for (const [text, weight] of [
    [scene, 0.8],
    ...[...new Set(queries)].map((q) => [q, 1]),
  ] as [string, number][]) {
    const grams = chineseGrams(text);
    if (!grams.size) continue;
    const matches = indexed
      .map(({ e, g }) => ({
        e,
        s:
          [...grams]
            .filter((k) => g.has(k))
            .reduce(
              (s, k) =>
                s +
                Math.log(
                  1 + (entries.length - df.get(k)! + 0.5) / (df.get(k)! + 0.5),
                ) *
                  (k.length === 3 ? 1.35 : 1),
              0,
            ) / Math.sqrt(grams.size),
      }))
      .filter((v) => v.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 48);
    for (const m of matches) {
      const old = sum.get(m.e.id);
      sum.set(m.e.id, {
        e: {
          ...m.e,
          matchedQueries: [
            ...(old?.e.matchedQueries || []),
            weight === 0.8 ? "画面描述" : text,
          ],
        },
        s: (old?.s || 0) + weight * m.s,
      });
    }
  }
  const selected = [...sum.values()]
    .sort((a, b) => b.s - a.s)
    .slice(0, 5)
    .map((v) => ({ ...v.e, score: v.s }));
  for (let i = selected.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [selected[i], selected[j]] = [selected[j], selected[i]];
  }
  return selected;
}
self.onmessage = async ({ data }) => {
  const { id, type, payload } = data;
  if (type === "cancel") {
    cancelled.add(id);
    return;
  }
  const send = (value: unknown, done = true) =>
    self.postMessage({ id, value, done });
  try {
    if (type === "search") {
      const warnings: string[] = [];
      const words = await localWords(),
        q = String(payload).replaceAll("_", " ").trim().toLowerCase();
      send(
        Object.entries(words)
          .filter(([k, v]) => k.includes(q) || v.includes(q))
          .map(([name, translation]) => ({
            name,
            translation,
            category: 0,
            count: 0,
            dictionary: true,
          })),
        false,
      );
      await Promise.all(
        ["danbooru", "dictionary"].map(async (kind) => {
          try {
            await search(kind, payload, id, (items) => send(items, false));
          } catch (e) {
            warnings.push(String(e));
          }
        }),
      );
      if (warnings.length) throw Error(warnings.join("；"));
      send([]);
    } else if (type === "research") {
      const results = await Promise.all(
        (payload as string[]).map(async (query) => {
          const candidates: Candidate[] = [];
          let timer: ReturnType<typeof setTimeout> | undefined;
          const deadline = Date.now() + 8000;
          try {
            await Promise.race([
              search(
                "danbooru",
                query,
                id,
                (items) =>
                  candidates.push(
                    ...items.filter((v) => [0, 3, 4].includes(v.category)),
                  ),
                deadline,
              ),
              new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(Error("Tag 检索超时")), 8000);
              }),
            ]);
          } catch (error) {
            if (cancelled.has(id)) throw error;
            self.postMessage({
              id,
              value: `Tag 检索失败（${query}）：${String(error)}`,
              done: false,
            });
            return [];
          } finally {
            clearTimeout(timer);
          }
          return candidates.slice(0, 8).map((c) => ({ ...c, query }));
        }),
      );
      const seen = new Set<string>();
      send(
        results
          .flat()
          .filter((c) => {
            const key = c.name.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          })
          .slice(0, 24),
      );
    } else if (type === "translate") {
      const result: Record<string, string> = {};
      const failures = new Set<string>();
      const unique = new Map(
        (payload as { lookup: string; natural: boolean }[]).map((term) => [
          term.lookup,
          term,
        ]),
      );
      for (const term of unique.values()) {
        if (cancelled.has(id)) return;
        try {
          result[term.lookup] = await annotation(
            term.lookup,
            term.natural,
            failures,
          );
        } catch (error) {
          failures.add(String(error));
        }
      }
      if (cancelled.has(id)) return;
      // Keep successful exact translations visible even if another lookup fails.
      if (failures.size) {
        send(result, false);
        throw Error([...failures].join("；"));
      }
      send(result);
    } else if (type === "tokens") {
      const d = payload as StudioDraft,
        p = normalizedPrompt(d),
        count = await tokenizer(d.model);
      send({
        positive:
          count(p.base) + p.characters.reduce((n, c) => n + count(c.prompt), 0),
        negative:
          count(p.negative) +
          p.characters.reduce((n, c) => n + count(c.negative), 0),
      });
    } else if (type === "codex")
      send(await recall(payload.queries, payload.scene));
    else if (type === "codexAll") send((await loadCodex()).entries);
    else if (type === "rewriteRules") send((await loadCodex()).rewriteRules);
  } catch (e) {
    self.postMessage({
      id,
      error: e instanceof Error ? e.message : String(e),
      done: true,
    });
  } finally {
    cancelled.delete(id);
  }
};
