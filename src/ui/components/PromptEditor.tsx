import { useEffect, useRef, useState } from "react";
import { Maximize2, Languages } from "lucide-react";
import { Modal, Button } from "./ui";
import { searchTags, translateLocal } from "../../data/catalog";
import {
  insertCandidate,
  segments,
  activeFragment,
} from "../../domain/promptPolicy";
import type { Candidate } from "../../domain/types";
import { PromptAnnotations } from "./PromptAnnotations";
type Props = {
  label: string;
  value: string;
  onChange: (v: string) => void;
  translate: boolean;
  rows?: number;
  placeholder?: string;
  fullscreen?: boolean;
  id?: string;
};
export function PromptEditor({
  label,
  value,
  onChange,
  translate,
  rows = 4,
  placeholder,
  fullscreen = false,
  id,
}: Props) {
  const input = useRef<HTMLTextAreaElement>(null),
    [focused, setFocused] = useState(false),
    [cursor, setCursor] = useState(0),
    [suggestions, setSuggestions] = useState<Candidate[]>([]),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [annotations, setAnnotations] = useState<Record<string, string>>({}),
    [limit, setLimit] = useState(40),
    [session, setSession] = useState<{
      original: string;
      text: string;
      start: number;
      end: number;
    } | null>(null);
  const query = focused ? activeFragment(value, cursor)?.query || "" : "";
  useEffect(() => {
    const abort = new AbortController();
    setSuggestions([]);
    setLimit(40);
    setError("");
    if (!query) {
      setLoading(false);
      return;
    }
    setLoading(true);
    searchTags(query, setSuggestions, abort.signal)
      .catch((e) => {
        if (!abort.signal.aborted) setError(String(e));
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [query]);
  useEffect(() => {
    if (!translate) {
      setAnnotations({});
      return;
    }
    const abort = new AbortController(),
      timer = setTimeout(
        () =>
          translateLocal(segments(value), abort.signal)
            .then(setAnnotations)
            .catch((e) => {
              if (!abort.signal.aborted) setError(String(e));
            }),
        250,
      );
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [value, translate]);
  useEffect(() => {
    if (session && session.original !== value) setSession(null);
  }, [value]);
  const select = (c: Candidate) => {
    const result = insertCandidate(
      value,
      input.current?.selectionStart || cursor,
      c.name.replaceAll("_", " "),
    );
    onChange(result.value);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(result.cursor, result.cursor);
      setCursor(result.cursor);
    });
  };
  const tokens = segments(value);
  return (
    <div className="prompt-editor">
      <div className="field-heading">
        <label>{label}</label>
        {!fullscreen && (
          <Button
            size="icon"
            variant="ghost"
            title="全屏编辑"
            onClick={() =>
              setSession({
                original: value,
                text: value,
                start: input.current?.selectionStart || 0,
                end: input.current?.selectionEnd || 0,
              })
            }
          >
            <Maximize2 size={15} />
          </Button>
        )}
      </div>
      <div
        className={
          "prompt-input-surface " + (translate ? "with-translation" : "")
        }
      >
        <textarea
          id={id}
          aria-label={label}
          ref={input}
          value={value}
          rows={rows}
          placeholder={placeholder || "输入提示词，支持中文搜索 Tag…"}
          onChange={(e) => {
            onChange(e.target.value);
            setCursor(e.target.selectionStart);
          }}
          onSelect={(e) => setCursor(e.currentTarget.selectionStart)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          spellCheck={false}
        />
        {translate && value && (
          <PromptAnnotations
            input={input}
            value={value}
            terms={tokens}
            annotations={annotations}
          />
        )}
      </div>
      {error && !(focused && query) && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {focused && query && (
        <div className="suggestion-box">
          <div className="suggestion-state">
            <span>
              {loading ? "正在检索…" : `${suggestions.length} 个候选`}
            </span>
            {error && <span className="error">{error}</span>}
          </div>
          <div className="suggestions" onMouseDown={(e) => e.preventDefault()}>
            {suggestions.slice(0, limit).map((c) => (
              <button key={c.name} type="button" onClick={() => select(c)}>
                <strong>{c.name.replaceAll("_", " ")}</strong>
                <span>{c.translation}</span>
                <small>
                  {c.dictionary ? "词典" : c.count.toLocaleString()}
                </small>
              </button>
            ))}
            {suggestions.length > limit && (
              <button onClick={() => setLimit((n) => n + 80)}>显示更多</button>
            )}
          </div>
        </div>
      )}
      <Modal
        open={!!session}
        onClose={() => setSession(null)}
        title={label + " · 全屏编辑"}
        wide
      >
        {session && (
          <>
            <FullscreenDraft
              initial={session.text}
              start={session.start}
              end={session.end}
              translate={translate}
              onChange={(text) =>
                setSession((s) => (s ? { ...s, text } : null))
              }
            />
            <div className="actions">
              <Button variant="secondary" onClick={() => setSession(null)}>
                取消
              </Button>
              <Button
                onClick={() => {
                  if (session.original === value) onChange(session.text);
                  setSession(null);
                }}
              >
                应用
              </Button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
function FullscreenDraft({
  initial,
  start,
  end,
  translate,
  onChange,
}: {
  initial: string;
  start: number;
  end: number;
  translate: boolean;
  onChange: (v: string) => void;
}) {
  const [value, setValue] = useState(initial),
    root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const input = root.current?.querySelector("textarea");
    input?.focus();
    input?.setSelectionRange(start, end);
  }, []);
  return (
    <div className="fullscreen-editor" ref={root}>
      <PromptEditor
        label="提示词"
        value={value}
        onChange={(v) => {
          setValue(v);
          onChange(v);
        }}
        translate={translate}
        rows={15}
        fullscreen
      />
    </div>
  );
}
