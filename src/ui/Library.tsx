import { useEffect, useState } from "react";
import { Search, Copy, Plus } from "lucide-react";
import { useStudio } from "./store";
import { Button, Field } from "./components/ui";
import { searchTags, rpc } from "../data/catalog";
import { joinPrompt } from "../domain/promptPolicy";
import type { Candidate, CodexEntry } from "../domain/types";
export function Library() {
  const s = useStudio(),
    [tab, setTab] = useState("tags"),
    [query, setQuery] = useState(""),
    [rows, setRows] = useState<Candidate[]>([]),
    [entries, setEntries] = useState<CodexEntry[]>([]),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [limit, setLimit] = useState(60),
    [target, setTarget] = useState("base");
  useEffect(() => {
    const abort = new AbortController();
    setLimit(60);
    setError("");
    setRows([]);
    setLoading(true);
    const task =
      tab === "tags"
        ? query.trim()
          ? searchTags(query, setRows, abort.signal)
          : Promise.resolve()
        : rpc<CodexEntry[]>("codexAll", null, undefined, abort.signal).then(
            setEntries,
          );
    task
      .catch((e) => {
        if (!abort.signal.aborted) setError(String(e));
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [query, tab]);
  const apply = (text: string) => {
    s.edit((d) => {
      if (target.startsWith("role:")) {
        const id = target.slice(5),
          c = d.characters.find((c) => c.id === id);
        if (!c) throw Error("角色已删除，请重新选择填入位置");
        c.prompt = joinPrompt(c.prompt, text);
      } else if (
        target === "base" ||
        target === "extra" ||
        target === "style" ||
        target === "negative"
      )
        d[target] = joinPrompt(d[target], text);
      return d;
    });
    s.notify("已添加到所选分段，可在工作室撤销");
  };
  const matches = entries.filter((e) =>
    (e.title + " " + e.category + " " + e.prompt + " " + e.searchText)
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">PROMPT REFERENCE</p>
          <h1>Tag 与法典</h1>
          <p>完整本地数据。检索结果可复制，或填入指定分段。</p>
        </div>
      </div>
      <div className="tabs">
        <Button
          variant={tab === "tags" ? "default" : "ghost"}
          onClick={() => setTab("tags")}
        >
          Tag 搜索
        </Button>
        <Button
          variant={tab === "codex" ? "default" : "ghost"}
          onClick={() => setTab("codex")}
        >
          法典数据库
        </Button>
      </div>
      <div className="toolbar">
        <div className="search">
          <Search size={17} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              tab === "tags"
                ? "搜索中文、英文 Tag 或词典"
                : "搜索标题、分类或完整原文"
            }
          />
        </div>
        <Field label="填入位置">
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="base">基础</option>
            <option value="extra">补充</option>
            <option value="style">画风</option>
            <option value="negative">负面</option>
            {s.draft.characters.map((c, i) => (
              <option key={c.id} value={"role:" + c.id}>
                角色 {i + 1}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {loading && <p>正在加载完整数据库…</p>}
      {error && <p className="error">{error}</p>}
      {tab === "tags" ? (
        <div className="panel">
          {!query && (
            <p className="muted">
              输入关键词开始检索；Danbooru 优先，词典补充。
            </p>
          )}
          <p className="muted">{rows.length} 个候选</p>
          {rows.slice(0, limit).map((r) => (
            <div className="library-row" key={r.name}>
              <div>
                <strong>{r.name}</strong>
                <p>{r.translation}</p>
                <small>
                  {r.dictionary
                    ? "离线词典"
                    : `${r.count.toLocaleString()} 次使用 · 分类 ${r.category}`}
                </small>
              </div>
              <div className="actions">
                <Button
                  title="复制"
                  size="icon"
                  variant="ghost"
                  onClick={() =>
                    navigator.clipboard
                      .writeText(r.name.replaceAll("_", " "))
                      .catch(s.fail)
                  }
                >
                  <Copy size={15} />
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => apply(r.name.replaceAll("_", " "))}
                >
                  <Plus size={15} />
                  填入
                </Button>
              </div>
            </div>
          ))}
          {rows.length > limit && (
            <Button variant="ghost" onClick={() => setLimit((n) => n + 80)}>
              显示更多
            </Button>
          )}
        </div>
      ) : (
        <div className="panel">
          <p className="muted">
            {matches.length} / {entries.length} 篇原文
          </p>
          {matches.slice(0, limit).map((e) => (
            <details key={e.id} className="codex-entry">
              <summary>
                {e.title}
                <small> · {e.category}</small>
              </summary>
              <pre className="prompt-text">{e.prompt}</pre>
              <Button
                variant="secondary"
                onClick={() =>
                  navigator.clipboard
                    .writeText(e.prompt)
                    .then(() => s.notify("已复制完整法典原文"))
                    .catch(s.fail)
                }
              >
                <Copy size={15} />
                复制原文
              </Button>
            </details>
          ))}
          {matches.length > limit && (
            <Button variant="ghost" onClick={() => setLimit((n) => n + 60)}>
              显示更多
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
