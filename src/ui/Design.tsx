import { useEffect, useRef, useState } from "react";
import {
  Plus,
  Send,
  Square,
  Paperclip,
  RotateCcw,
  Pencil,
  Trash2,
  Check,
  ImagePlus,
  Bot,
} from "lucide-react";
import { useStudio } from "./store";
import { Button, Field, Toggle, Modal, AssetImage } from "./components/ui";
import {
  db,
  state,
  saveConversation,
  putAsset,
  changed,
  saveState,
} from "../data/db";
import {
  MODELS,
  type DesignConversation,
  type DesignTurn,
  type DesignReply,
  type ImageModel,
} from "../domain/types";
import { designTurn, type DesignProgress } from "../domain/design";
import { normalizeImage } from "../domain/images";
const blank = (
  extraRequirement: string,
  references: DesignConversation["references"],
): DesignConversation => ({
  id: crypto.randomUUID(),
  title: "新设计",
  createdAt: Date.now(),
  updatedAt: Date.now(),
  extraRequirement,
  references: structuredClone(references),
  turns: [],
});
export function Design({ onApply }: { onApply: () => void }) {
  const s = useStudio(),
    [conversation, setConversation] = useState<DesignConversation>(() =>
      blank(s.settings.extraRequirement, s.settings.characterReferences),
    ),
    [histories, setHistories] = useState<DesignConversation[]>([]),
    [input, setInput] = useState(""),
    [attachment, setAttachment] = useState(false),
    [image, setImage] = useState(""),
    [busy, setBusy] = useState(false),
    [stages, setStages] = useState<DesignProgress[]>([]),
    [edit, setEdit] = useState<{ turn: number; text: string } | null>(null);
  const controller = useRef<AbortController | null>(null),
    current = useRef(conversation),
    end = useRef<HTMLDivElement>(null);
  current.current = conversation;
  const loadHistories = async () =>
    setHistories(
      (await (await db).getAll("conversations")).sort(
        (a, b) => b.updatedAt - a.updatedAt,
      ),
    );
  useEffect(() => {
    (async () => {
      await loadHistories();
      const id = await state<string>("currentConversation");
      if (id) {
        const c = await (await db).get("conversations", id);
        if (c) {
          const turns = c.turns.map((t) =>
            t.status === "pending"
              ? {
                  ...t,
                  status: "failed" as const,
                  error: "上次请求中断或结果未知；不会自动重试",
                }
              : t,
          );
          setConversation({ ...c, turns });
        }
      }
    })().catch(s.fail);
    return () => controller.current?.abort();
  }, []);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [stages, conversation.turns.length]);
  const apply = (turn: DesignTurn) => {
    if (!turn.reply) return;
    const p = turn.reply;
    s.edit((d) => ({
      ...d,
      model: turn.target,
      base: p.baseCaption,
      extra: "",
      characters: p.characters.map((c) => ({
        id: crypto.randomUUID(),
        prompt: c.caption,
        negative: "",
        center: { x: 0.5, y: 0.5 },
      })),
    }));
    s.notify("已应用设计；画风、基础负面和参数保留");
    onApply();
  };
  const run = async (c: DesignConversation, turnIndex: number) => {
    if (controller.current) return;
    const ctrl = new AbortController();
    controller.current = ctrl;
    setBusy(true);
    setStages([]);
    let last: DesignProgress = { stage: "", text: "", reasoning: "" };
    const update = (v: DesignProgress) => {
      last = v;
      setStages((old) => {
        const next = [...old],
          i = next.findIndex((x) => x.stage === v.stage);
        if (i < 0) next.push(v);
        else next[i] = v;
        return next;
      });
    };
    const next = structuredClone(c);
    next.turns[turnIndex] = {
      ...next.turns[turnIndex],
      status: "pending",
      error: undefined,
    };
    next.updatedAt = Date.now();
    setConversation(next);
    try {
      await saveConversation(next);
      await loadHistories();
      const result = await designTurn(
        next,
        next.turns[turnIndex],
        s.settings,
        ctrl.signal,
        update,
      );
      next.turns[turnIndex] = {
        ...next.turns[turnIndex],
        ...result,
        status: "complete",
        error: undefined,
      };
      next.updatedAt = Date.now();
      await saveConversation(next);
      setConversation({ ...next });
      await loadHistories();
    } catch (e) {
      const cancelled = ctrl.signal.aborted;
      next.turns[turnIndex] = {
        ...next.turns[turnIndex],
        status: cancelled ? "cancelled" : "failed",
        error: cancelled ? "已停止" : String(e),
        raw: next.turns[turnIndex].raw || last.text,
        reasoning: next.turns[turnIndex].reasoning || last.reasoning,
      };
      setConversation({ ...next });
      try {
        await saveConversation(next);
        await loadHistories();
      } catch (saveError) {
        s.fail(saveError);
      }
      if (!cancelled) s.fail(e);
    } finally {
      controller.current = null;
      setBusy(false);
    }
  };
  const send = () => {
    if (!input.trim() || busy) return;
    if (!s.settings.models.some((m) => m.id === s.settings.designModelId)) {
      s.fail(Error("请先在设置中配置并选择 LLM"));
      return;
    }
    const natural = s.settings.naturalLanguage,
      target: ImageModel = natural ? "V5_FULL" : s.draft.model;
    if (
      attachment &&
      (!s.draft.base.trim() ||
        s.draft.characters.some((c) => !c.prompt.trim()) ||
        s.draft.characters.length > MODELS[target].roles)
    ) {
      s.fail(
        Error(
          "当前工作室基础或角色提示词为空，或角色数量超过目标模型上限，无法附加",
        ),
      );
      return;
    }
    const turn: DesignTurn = {
      id: crypto.randomUUID(),
      text: input.trim(),
      modelId: s.settings.designModelId,
      target,
      natural,
      raw: "",
      reasoning: "",
      status: "pending",
      ...(image ? { image } : {}),
      ...(attachment
        ? {
            attachment: {
              sizePreset: "PORTRAIT",
              baseCaption: s.draft.base,
              characters: s.draft.characters.map((c) => ({
                caption: c.prompt,
              })),
            } as DesignReply,
          }
        : {}),
    };
    const c = {
      ...conversation,
      title: conversation.turns.length
        ? conversation.title
        : input.trim().slice(0, 36),
      turns: [...conversation.turns, turn],
    };
    setInput("");
    setAttachment(false);
    setImage("");
    run(c, c.turns.length - 1);
  };
  return (
    <section className="design-page">
      <aside className="design-history">
        <div className="section-heading">
          <h2>设计对话</h2>
          <Button
            size="icon"
            variant="ghost"
            title="新对话"
            disabled={busy}
            onClick={() => {
              setConversation(
                blank(
                  s.settings.extraRequirement,
                  s.settings.characterReferences,
                ),
              );
              setStages([]);
              setImage("");
              setAttachment(false);
            }}
          >
            <Plus size={19} />
          </Button>
        </div>
        <p className="muted">对话独立保存。只有应用候选才修改工作室。</p>
        {histories.map((c) => (
          <div
            key={c.id}
            className={
              "conversation-link " + (conversation.id === c.id ? "active" : "")
            }
          >
            <button
              disabled={busy}
              onClick={() => {
                setConversation(c);
                saveState("currentConversation", c.id).catch(s.fail);
                setStages([]);
                setAttachment(false);
                setImage("");
              }}
            >
              <strong>{c.title}</strong>
              <small>{new Date(c.updatedAt).toLocaleString()}</small>
            </button>
            <button
              className="icon-button"
              aria-label="删除对话"
              disabled={busy || conversation.id === c.id}
              onClick={async () => {
                if (confirm("删除这段设计对话？")) {
                  await (await db).delete("conversations", c.id);
                  changed();
                  await loadHistories();
                }
              }}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </aside>
      <div className="design-main">
        <header className="design-heading">
          <div>
            <p className="eyebrow">DESIGN WITH AI</p>
            <h1>
              {conversation.turns.length
                ? conversation.title
                : "把想法变成提示词"}
            </h1>
          </div>
          <Field label="设计模型">
            <select
              value={s.settings.designModelId}
              disabled={busy}
              onChange={(e) =>
                s.configure((v) => ({ ...v, designModelId: e.target.value }))
              }
            >
              <option value="">选择 LLM</option>
              {s.settings.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </Field>
        </header>
        <div className="design-messages">
          {!conversation.turns.length && (
            <div className="design-welcome">
              <span>
                <Bot size={40} aria-hidden="true" />
              </span>
              <h2>描述你想看见的画面</h2>
              <p>
                AI 会规划场景、检索 Tag 和法典，
                <br />
                再将画面组织成可编辑的分段提示词。
              </p>
            </div>
          )}
          {conversation.turns.map((turn, i) => (
            <article key={turn.id} className="design-turn">
              <div className="user-message">
                <p>{turn.text}</p>
                {turn.attachment && (
                  <details>
                    <summary>已附加工作室提示词快照</summary>
                    <pre>{JSON.stringify(turn.attachment, null, 2)}</pre>
                  </details>
                )}
                {turn.image && (
                  <AssetImage source={turn.image} className="message-image" />
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => setEdit({ turn: i, text: turn.text })}
                >
                  <Pencil size={13} />
                  编辑并分支
                </Button>
              </div>
              {turn.reply && (
                <div className="assistant-message">
                  <span className="badge">
                    {MODELS[turn.target].name} ·{" "}
                    {turn.natural ? "自然语言" : "结构化 Tag"}
                  </span>
                  <h3>基础 Prompt</h3>
                  <p className="prompt-text">{turn.reply.baseCaption}</p>
                  {turn.reply.characters.map((c, j) => (
                    <div key={j}>
                      <h4>角色 {j + 1}</h4>
                      <p className="prompt-text">{c.caption}</p>
                    </div>
                  ))}
                  <div className="actions">
                    <Button onClick={() => apply(turn)}>
                      <Check size={15} />
                      应用到工作室
                    </Button>
                    {i === conversation.turns.length - 1 && (
                      <Button
                        variant="ghost"
                        disabled={busy}
                        onClick={() => {
                          const c = structuredClone(conversation);
                          c.turns[i] = {
                            ...c.turns[i],
                            natural: s.settings.naturalLanguage,
                            target: s.settings.naturalLanguage
                              ? "V5_FULL"
                              : turn.target,
                          };
                          run(c, i);
                        }}
                      >
                        <RotateCcw size={15} />
                        重新生成
                      </Button>
                    )}
                  </div>
                  <details>
                    <summary>原始回复 / 思考 / 检索依据</summary>
                    <pre>{turn.reasoning}</pre>
                    <pre>{turn.raw}</pre>
                    {turn.evidence && (
                      <pre>{JSON.stringify(turn.evidence, null, 2)}</pre>
                    )}
                  </details>
                </div>
              )}
              {(turn.status === "failed" || turn.status === "cancelled") && (
                <div className="request-error">
                  <p>{turn.error}</p>
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => run(conversation, i)}
                  >
                    按原配置重试
                  </Button>
                </div>
              )}
            </article>
          ))}
          {stages.length > 0 && (
            <div className="stage-list">
              {stages.map((v, i) => (
                <details key={v.stage} open={busy && i === stages.length - 1}>
                  <summary>
                    <span
                      className={
                        busy && i === stages.length - 1 ? "spinner" : ""
                      }
                    />
                    {v.stage}
                  </summary>
                  {v.reasoning && (
                    <pre className="reasoning">{v.reasoning}</pre>
                  )}
                  <pre>{v.text || "处理中…"}</pre>
                </details>
              ))}
            </div>
          )}
          <div ref={end} />
        </div>
        <div className="design-composer">
          <div className="actions">
            <Toggle
              label="V5 中文自然语言"
              checked={s.settings.naturalLanguage}
              onChange={(v) =>
                s.configure((s) => ({ ...s, naturalLanguage: v }))
              }
            />
            <Toggle
              label="附加当前工作室提示词"
              checked={attachment}
              onChange={setAttachment}
            />
            <label className="button button-ghost">
              <ImagePlus size={17} />
              参考图片
              <input
                type="file"
                hidden
                disabled={busy}
                accept="image/png,image/jpeg,image/webp"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (f)
                    try {
                      setImage(await putAsset(await normalizeImage(f)));
                    } catch (err) {
                      s.fail(err);
                    }
                  e.target.value = "";
                }}
              />
            </label>
          </div>
          {image && (
            <div className="actions">
              <AssetImage source={image} className="attachment-thumb" />
              <Button size="sm" variant="ghost" onClick={() => setImage("")}>
                移除附件
              </Button>
            </div>
          )}
          <textarea
            rows={3}
            placeholder="描述场景、人物、构图，或提出修改要求…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                e.preventDefault();
                send();
              }
            }}
          />
          <div className="composer-bottom">
            <small>Ctrl / ⌘ + Enter 发送</small>
            {busy ? (
              <Button
                variant="destructive"
                onClick={() =>
                  controller.current?.abort(
                    new DOMException("已停止", "AbortError"),
                  )
                }
              >
                <Square size={15} />
                停止
              </Button>
            ) : (
              <Button disabled={!input.trim()} onClick={send}>
                <Send size={15} />
                设计提示词
              </Button>
            )}
          </div>
        </div>
      </div>
      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        title="编辑历史输入并创建分支"
      >
        {edit && (
          <>
            <textarea
              rows={6}
              value={edit.text}
              onChange={(e) => setEdit({ ...edit, text: e.target.value })}
            />
            <p className="muted">
              保留原对话；新分支从此轮继续，后续轮次不复制。
            </p>
            <Button
              disabled={!edit.text.trim()}
              onClick={() => {
                const c: DesignConversation = {
                  ...structuredClone(conversation),
                  id: crypto.randomUUID(),
                  title: edit.text.slice(0, 36),
                  createdAt: Date.now(),
                  updatedAt: Date.now(),
                  turns: conversation.turns
                    .slice(0, edit.turn + 1)
                    .map((t) => structuredClone(t)),
                };
                c.turns[edit.turn] = {
                  ...c.turns[edit.turn],
                  id: crypto.randomUUID(),
                  text: edit.text,
                  modelId: s.settings.designModelId,
                  reply: undefined,
                  evidence:
                    edit.turn === 0 ? undefined : c.turns[edit.turn].evidence,
                  raw: "",
                  reasoning: "",
                  status: "pending",
                };
                setEdit(null);
                run(c, c.turns.length - 1);
              }}
            >
              创建分支并设计
            </Button>
          </>
        )}
      </Modal>
    </section>
  );
}
