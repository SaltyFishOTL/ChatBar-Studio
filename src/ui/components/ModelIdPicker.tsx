import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, RefreshCw, Search } from "lucide-react";
import { listModels } from "../../api/llm";
import type { ModelConfig } from "../../domain/types";
import { Button, Modal, errorText } from "./ui";

// Match Android ModelPickerDialog: series are name groups, not capabilities.
function modelFamily(id: string) {
  const name = id.slice(id.lastIndexOf("/") + 1).toLowerCase();
  const families: [string[], string][] = [
    [["deepseek"], "DeepSeek"],
    [["qwen"], "Qwen"],
    [["claude"], "Claude"],
    [["gemini"], "Gemini"],
    [["gpt"], "GPT"],
    [["llama"], "Llama"],
    [["gemma"], "Gemma"],
    [["mistral", "mixtral"], "Mistral"],
    [["glm"], "GLM"],
    [["kimi", "moonshot"], "Kimi"],
    [["doubao"], "Doubao"],
  ];
  return (
    families.find(([words]) =>
      words.some((word) => name.includes(word)),
    )?.[1] ?? "其他"
  );
}

/** Parent keys this component by endpoint and credential revision. */
export function ModelIdPicker({
  model,
  onSelect,
}: {
  model: ModelConfig;
  onSelect: (id: string, fromList: boolean) => void;
}) {
  const fieldId = useId();
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [family, setFamily] = useState("");
  const [descending, setDescending] = useState(false);
  const request = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      request.current?.abort();
      request.current = null;
    },
    [],
  );

  async function refresh() {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError("");
    try {
      const next = await listModels(model, controller.signal);
      if (request.current === controller) setModels(next);
    } catch (e) {
      if (request.current === controller && !controller.signal.aborted)
        setError(errorText(e));
    } finally {
      if (request.current === controller) {
        request.current = null;
        setLoading(false);
      }
    }
  }

  function close() {
    setOpen(false);
    request.current?.abort();
    request.current = null;
    setLoading(false);
  }

  const families = useMemo(() => {
    const counts = new Map<string, number>();
    for (const id of models ?? []) {
      const group = modelFamily(id);
      counts.set(group, (counts.get(group) ?? 0) + 1);
    }
    return [...counts].sort(([a], [b]) => a.localeCompare(b));
  }, [models]);

  const filtered = useMemo(() => {
    const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    return (models ?? [])
      .filter(
        (id) =>
          (!family || modelFamily(id) === family) &&
          terms.every((term) => id.toLowerCase().includes(term)),
      )
      .sort((a, b) => {
        if (a === model.model) return -1;
        if (b === model.model) return 1;
        return (
          a.localeCompare(b, "en", { sensitivity: "base" }) *
          (descending ? -1 : 1)
        );
      });
  }, [models, query, family, descending, model.model]);

  return (
    <div className="field">
      <label htmlFor={fieldId}>模型 ID</label>
      <div className="model-id-control">
        <input
          id={fieldId}
          value={model.model}
          onChange={(e) => onSelect(e.target.value, false)}
          placeholder="手动输入或检索选择"
        />
        <Button
          variant="secondary"
          aria-haspopup="dialog"
          onClick={() => {
            setOpen(true);
            if (!models) void refresh();
          }}
        >
          <Search size={16} />
          检索选择
        </Button>
      </div>
      <Modal open={open} onClose={close} title="选择模型">
        <p className="muted">
          从当前 API 地址获取模型标识；也可关闭窗口手动填写。系列仅按名称分组。
        </p>
        <label className="search model-search">
          <Search size={16} aria-hidden="true" />
          <input
            autoFocus
            aria-label="搜索模型标识"
            placeholder="搜索标识，空格分隔关键词"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        {models && (
          <>
            <div
              className="model-families"
              role="group"
              aria-label="模型系列筛选"
            >
              {[["", models.length], ...families].map(([name, count]) => (
                <Button
                  key={name}
                  size="sm"
                  variant={family === name ? "default" : "secondary"}
                  aria-pressed={family === name}
                  onClick={() => setFamily(String(name))}
                >
                  {name || "全部"} {count}
                </Button>
              ))}
            </div>
            <div className="model-picker-toolbar">
              <span className="muted" role="status">
                {filtered.length} / {models.length} 个模型
              </span>
              <div className="actions">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setDescending((v) => !v)}
                  aria-label={
                    descending
                      ? "模型排序 Z 到 A，点击切换"
                      : "模型排序 A 到 Z，点击切换"
                  }
                >
                  {descending ? "Z → A" : "A → Z"}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={loading}
                  onClick={() => void refresh()}
                >
                  <RefreshCw size={16} />
                  刷新
                </Button>
              </div>
            </div>
            {model.model && !models.includes(model.model) && (
              <p className="muted model-picker-notice">
                当前标识「{model.model}
                」不在列表中，已保留。选择其他模型前不会更改。
              </p>
            )}
          </>
        )}
        {loading && (
          <p role="status" className="muted">
            {models ? "正在刷新，可继续选择现有列表…" : "正在获取模型列表…"}
          </p>
        )}
        {error && (
          <div className="model-picker-error" role="alert">
            <p>
              {models ? "刷新失败，显示上次成功获取的列表。" : "获取失败。"}
              {error}
            </p>
            <Button
              size="sm"
              variant="secondary"
              disabled={loading}
              onClick={() => void refresh()}
            >
              重试
            </Button>
          </div>
        )}
        <div
          className="model-results"
          aria-label="可选模型"
          aria-busy={loading}
        >
          {filtered.map((id) => (
            <button
              type="button"
              className={
                "model-result " + (id === model.model ? "selected" : "")
              }
              key={id}
              aria-pressed={id === model.model}
              onClick={() => {
                onSelect(id, true);
                close();
              }}
            >
              <span>
                {id}
                <small>{modelFamily(id)}</small>
              </span>
              {id === model.model && <Check size={18} aria-label="当前选择" />}
            </button>
          ))}
        </div>
        {models && !filtered.length && (
          <div className="model-picker-empty">
            <p>没有匹配的模型</p>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setQuery("");
                setFamily("");
              }}
            >
              清除筛选
            </Button>
          </div>
        )}
        <p className="muted model-picker-footnote">
          列表可用不代表已验证聊天或图片能力；能力设置保持不变。
        </p>
      </Modal>
    </div>
  );
}
