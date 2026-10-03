import { PromptTokenBudget } from "./components/PromptTokenBudget";
import { PromptText } from "./components/PromptText";
import { useEffect, useRef, useState } from "react";
import {
  Play,
  Square,
  Sparkles,
  ImagePlus,
  Palette,
  Undo2,
  Redo2,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Copy,
  ClipboardPaste,
  Languages,
  Download,
  Pencil,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  RefreshCw,
} from "lucide-react";
import { useStudio } from "./store";
import { AssetImage, Button, Toggle, Modal } from "./components/ui";
import { PromptEditor } from "./components/PromptEditor";
import { Styles } from "./Styles";
import { applyStyleCard, clearStudioPrompts } from "../domain/stylePolicy";
import { GuidanceEditor } from "./Guidance";
import { MODELS, newCharacter, type StudioDraft } from "../domain/types";
import {
  activeCharacters,
  copyPositive,
  pastePositive,
  effectiveSize,
} from "../domain/promptPolicy";
import { countTokens } from "../data/catalog";
import { estimateCost } from "../api/novelai";
import { download, downloadImages } from "../domain/images";
import { assetBlob } from "../data/db";
import { historyImages } from "../domain/history";
import { Preview } from "./components/Preview";
import { GenerationControls } from "./components/GenerationControls";
import { CharacterPositionEditor } from "./components/CharacterPositionEditor";
export function Studio({
  navigate,
  onTool,
}: {
  navigate: (page: string) => void;
  onTool: (asset: string) => void;
}) {
  const s = useStudio(),
    d = s.draft,
    activeRoles = activeCharacters(d),
    g = d.perModel[d.model],
    [stylePicker, setStylePicker] = useState(false),
    [guidance, setGuidance] = useState(false),
    [tokens, setTokens] = useState<{
      positive: number;
      negative: number;
    } | null>(null),
    [tokenError, setTokenError] = useState(""),
    [tokenLoading, setTokenLoading] = useState(true),
    [tokenModel, setTokenModel] = useState(d.model),
    [selected, setSelected] = useState<string | null>(null),
    [preview, setPreview] = useState(false),
    [paste, setPaste] = useState<string | null>(null),
    [positionDraft, setPositionDraft] = useState<StudioDraft | null>(null);
  const images = historyImages(s.history),
    selectedIndex = Math.max(
      0,
      images.findIndex(
        (image) => `${image.recipe.id}:${image.asset}` === selected,
      ),
    ),
    current = images[selectedIndex];
  const generationBar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const bar = generationBar.current;
    const page = bar?.closest<HTMLElement>(".studio-page");
    if (!bar || !page) return;
    const resize = () => {
      page.style.setProperty(
        "--generation-bar-height",
        `${bar.getBoundingClientRect().height}px`,
      );
    };
    const observer = new ResizeObserver(resize);
    observer.observe(bar);
    resize();
    return () => {
      observer.disconnect();
      page.style.removeProperty("--generation-bar-height");
    };
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    setTokenLoading(true);
    setTokenError("");
    const timer = setTimeout(
      () =>
        countTokens(d, abort.signal)
          .then((v) => {
            if (abort.signal.aborted) return;
            setTokens(v);
            setTokenModel(d.model);
            setTokenLoading(false);
            setTokenError("");
          })
          .catch((e) => {
            if (!abort.signal.aborted) {
              setTokenError(String(e));
              setTokenLoading(false);
            }
          }),
      180,
    );
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [d.style, d.base, d.extra, d.negative, d.characters, d.model]);
  const text = (
    field: "style" | "base" | "extra" | "negative",
    value: string,
  ) => s.edit((d) => ({ ...d, [field]: value }), field);
  let sizeLabel = "",
    cost = "";
  try {
    const size = effectiveSize(g.width, g.height);
    sizeLabel = `${size.width} × ${size.height}`;
    const e = estimateCost(d, s.account);
    cost = e.label + (e.vibe ? "＋可能的 Vibe 编码费用" : "");
  } catch (e) {
    sizeLabel = (e as Error).message;
  }
  const promptField = (
    field: "style" | "base" | "extra" | "negative",
    label: string,
  ) => (
    <details
      className="prompt-section"
      open={field === "base" || !d.folds[field]}
      onToggle={(e) => {
        if (field !== "base") {
          const collapsed = !e.currentTarget.open;
          if (collapsed !== d.folds[field])
            s.edit(
              (v) => ({ ...v, folds: { ...v.folds, [field]: collapsed } }),
              "fold:" + field,
            );
        }
      }}
    >
      <summary>
        <ChevronRight
          className="disclosure-icon"
          size={16}
          aria-hidden="true"
        />
        <span>{label}</span>
        {field !== "base" && d[field] && (
          <small>
            <PromptText value={d[field].slice(0, 65)} />
          </small>
        )}
      </summary>
      <PromptEditor
        label={label}
        value={d[field]}
        onChange={(v) => text(field, v)}
        translate={s.settings.translate}
        desktopGrow
        rows={field === "base" ? 5 : 3}
      />
    </details>
  );
  return (
    <section className="studio-page">
      <div className="studio-grid">
        <div className="studio-controls">
          <div className="studio-controls-scroll">
            <div className="studio-heading">
              <div>
                <p className="eyebrow">CREATE SOMETHING YOURS</p>
                <h1>生图工作室</h1>
              </div>
              <div className="actions">
                <Button variant="ghost" onClick={() => navigate("design")}>
                  <Sparkles size={17} />
                  AI 设计
                </Button>
                <Button variant="ghost" onClick={() => setGuidance(true)}>
                  <ImagePlus size={17} />
                  图像引导
                </Button>
                <Button variant="ghost" onClick={() => navigate("tools")}>
                  图像工具
                </Button>
              </div>
            </div>
            <div className="editor-column">
              <section className="panel prompt-panel">
                <div className="section-heading">
                  <h2>提示词</h2>
                  <div className="actions compact">
                    <Button
                      size="sm"
                      aria-label="中文注释"
                      aria-pressed={s.settings.translate}
                      variant={s.settings.translate ? "secondary" : "ghost"}
                      title="中文注释"
                      onClick={() =>
                        s.configure((v) => ({ ...v, translate: !v.translate }))
                      }
                    >
                      <Languages size={16} />
                      实时翻译
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      title="复制正面提示词"
                      onClick={() =>
                        navigator.clipboard
                          .writeText(
                            copyPositive(d, s.settings.copyIgnoreStyle),
                          )
                          .then(() => s.notify("已复制分段提示词"))
                          .catch(s.fail)
                      }
                    >
                      <Copy size={16} />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      title="粘贴覆盖"
                      onClick={() => setPaste("")}
                    >
                      <ClipboardPaste size={16} />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      title="撤销"
                      disabled={!s.canUndo}
                      onClick={s.undo}
                    >
                      <Undo2 size={16} />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      title="重做"
                      disabled={!s.canRedo}
                      onClick={s.redo}
                    >
                      <Redo2 size={16} />
                    </Button>
                  </div>
                </div>
                <Button
                  className="style-switch"
                  variant="secondary"
                  onClick={() => setStylePicker(true)}
                >
                  <Palette size={17} />
                  <span>选择画风卡</span>
                  <small>{d.style ? "替换画风段" : "25 种预置画风"}</small>
                </Button>
                {promptField("style", "画风")}
                {promptField("base", "基础 Prompt")}
                {promptField("extra", "补充 Prompt")}
                <div className="section-heading role-heading">
                  <h3>
                    角色{" "}
                    <span className="badge">
                      {activeRoles.length}/{MODELS[d.model].roles}
                    </span>
                  </h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={activeRoles.length >= MODELS[d.model].roles}
                    onClick={() =>
                      s.edit((v) => ({
                        ...v,
                        characters: [...v.characters, newCharacter()],
                      }))
                    }
                  >
                    <Plus size={16} />
                    添加角色
                  </Button>
                </div>
                <div className="role-position-entry">
                  <span>角色位置 · {g.useCoords ? "自定义" : "AI 自动"}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!activeRoles.length}
                    onClick={() => setPositionDraft(structuredClone(d))}
                  >
                    <Pencil size={16} />
                    编辑位置
                  </Button>
                </div>
                {d.characters.map((c, i) => (
                  <section key={c.id} className="role-card">
                    <div className="section-heading">
                      <strong>
                        角色 {i + 1}
                        {c.enabled === false && " · 已停用"}
                      </strong>
                      <div className="actions compact">
                        <Button
                          size="icon"
                          variant="ghost"
                          disabled={i === 0}
                          title="上移"
                          onClick={() =>
                            s.edit((v) => {
                              [v.characters[i - 1], v.characters[i]] = [
                                v.characters[i],
                                v.characters[i - 1],
                              ];
                              return v;
                            })
                          }
                        >
                          <ArrowUp size={14} />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          disabled={i === d.characters.length - 1}
                          title="下移"
                          onClick={() =>
                            s.edit((v) => {
                              [v.characters[i + 1], v.characters[i]] = [
                                v.characters[i],
                                v.characters[i + 1],
                              ];
                              return v;
                            })
                          }
                        >
                          <ArrowDown size={14} />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          title={
                            c.enabled === false
                              ? "展开角色（参与生图）"
                              : "折叠角色（不参与生图）"
                          }
                          aria-label={
                            c.enabled === false
                              ? "展开角色（参与生图）"
                              : "折叠角色（不参与生图）"
                          }
                          aria-expanded={c.enabled !== false}
                          onClick={() =>
                            s.edit((v) => ({
                              ...v,
                              characters: v.characters.map((x) =>
                                x.id === c.id
                                  ? { ...x, enabled: x.enabled === false }
                                  : x,
                              ),
                            }))
                          }
                        >
                          {c.enabled === false ? (
                            <ChevronDown size={14} />
                          ) : (
                            <ChevronUp size={14} />
                          )}
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          title="删除角色"
                          onClick={() =>
                            s.edit((v) => ({
                              ...v,
                              characters: v.characters.filter(
                                (x) => x.id !== c.id,
                              ),
                            }))
                          }
                        >
                          <Trash2 size={14} />
                        </Button>
                      </div>
                    </div>
                    {c.enabled !== false && (
                      <>
                        <PromptEditor
                          label="角色正面"
                          value={c.prompt}
                          onChange={(prompt) =>
                            s.edit(
                              (v) => ({
                                ...v,
                                characters: v.characters.map((x) =>
                                  x.id === c.id ? { ...x, prompt } : x,
                                ),
                              }),
                              "role:" + c.id,
                            )
                          }
                          translate={s.settings.translate}
                          desktopGrow
                          rows={3}
                        />
                        <details>
                          <summary>角色负面</summary>
                          <PromptEditor
                            label="角色负面"
                            value={c.negative}
                            onChange={(negative) =>
                              s.edit(
                                (v) => ({
                                  ...v,
                                  characters: v.characters.map((x) =>
                                    x.id === c.id ? { ...x, negative } : x,
                                  ),
                                }),
                                "negative:" + c.id,
                              )
                            }
                            translate={s.settings.translate}
                            desktopGrow
                            rows={2}
                          />
                        </details>
                      </>
                    )}
                  </section>
                ))}
                {promptField("negative", "负面 Prompt")}
                <div className="token-row">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (
                        confirm(
                          "清空正向提示词并恢复所选画风卡负面词（未设置时使用默认负面词）？参数和参考图保留，可撤销。",
                        )
                      )
                        s.edit((v) =>
                          clearStudioPrompts(
                            v,
                            s.cards,
                            s.settings.defaultNegative,
                          ),
                        );
                    }}
                  >
                    清空提示词
                  </Button>
                </div>
              </section>
            </div>
            <GenerationControls />
          </div>
          <div ref={generationBar} className="generation-bar">
            <div>
              <strong>
                {s.busy
                  ? s.progress?.message || "处理中"
                  : MODELS[d.model].name}
              </strong>
              <small>
                {s.busy
                  ? "可继续编辑提示词；当前任务使用启动时快照"
                  : sizeLabel}
              </small>
            </div>
            <div className="generation-actions">
              <div className="account-summary" aria-live="polite">
                <strong>
                  {s.account
                    ? `${s.account.anlas.toLocaleString()} Anlas 积分`
                    : s.accountLoading
                      ? "正在查询积分…"
                      : "积分未获取"}
                </strong>
                <small>
                  {s.account
                    ? s.account.percent === null
                      ? "V5 额度未返回"
                      : `V5 剩余 ${s.account.exhausted ? 0 : Math.max(0, Math.min(100, s.account.percent)).toFixed(1)}% · 约 ${s.account.exhausted ? 0 : Math.round(Math.max(0, Math.min(100, s.account.percent)) * 17.3)} 张`
                    : "填写 NovelAI Token 后自动更新"}
                </small>
                {s.accountError && (
                  <small className="error">
                    {s.account ? "刷新失败，显示上次余额" : s.accountError}
                  </small>
                )}
                {s.accountUpdatedAt && (
                  <small title={new Date(s.accountUpdatedAt).toLocaleString()}>
                    {s.accountLoading
                      ? "正在更新…"
                      : `更新于 ${new Date(s.accountUpdatedAt).toLocaleTimeString()}`}
                  </small>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label="刷新积分和额度"
                title={s.accountError || "刷新积分和额度"}
                disabled={s.accountLoading}
                onClick={() => void s.refreshAccount()}
              >
                <RefreshCw size={16} />
              </Button>
              {s.busy ? (
                <div className="generation-submit">
                  <PromptTokenBudget
                    tokens={tokenModel === d.model ? tokens : null}
                    limit={MODELS[d.model].tokens}
                    loading={tokenLoading}
                    error={tokenError}
                  />
                  <Button variant="destructive" onClick={s.stop}>
                    <Square size={16} />
                    停止
                  </Button>
                </div>
              ) : (
                <div className="generation-submit">
                  <PromptTokenBudget
                    tokens={tokenModel === d.model ? tokens : null}
                    limit={MODELS[d.model].tokens}
                    loading={tokenLoading}
                    error={tokenError}
                  />
                  <Button onClick={s.run} className="generate-button">
                    <span>
                      <Play size={17} />
                      生成图片
                    </span>
                    <span className="generation-cost">
                      {cost || "费用待计算"}
                    </span>
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
        <aside className="output-column">
          <section className="panel output-panel">
            <div className="section-heading">
              <h2>画面</h2>
              <span className="badge">
                {s.busy ? "生成中" : current ? "已保存" : "准备就绪"}
              </span>
            </div>
            <button
              className="output-image"
              aria-label="放大当前图片"
              onClick={() => {
                if (current && !s.busy) setPreview(true);
              }}
            >
              <AssetImage
                source={s.busy ? s.output : current?.asset || s.output}
                alt="当前图片"
              />
              {!current && !s.output && (
                <div className="empty-state">
                  <div className="empty-mark">
                    <ImagePlus size={40} aria-hidden="true" />
                  </div>
                  <h3>从一个想法开始</h3>
                  <p>
                    选择画风，写下场景。
                    <br />
                    也可以让 AI 帮你设计提示词。
                  </p>
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate("design");
                    }}
                  >
                    打开 AI 设计 →
                  </span>
                </div>
              )}
            </button>
            {s.progress && (
              <div className="progress-message">
                <span className="spinner" />
                {s.progress.message}
              </div>
            )}
            {!s.busy && current && (
              <div className="actions image-tools" aria-label="当前图片工具">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    s
                      .applyHistory(current.recipe, current.seed, "random")
                      .catch(s.fail)
                  }
                >
                  应用配方 · 新 Seed
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    s
                      .applyHistory(current.recipe, current.seed, "seed")
                      .catch(s.fail)
                  }
                >
                  仅应用 Seed
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onTool(current.asset)}
                >
                  工具
                </Button>
              </div>
            )}
            {!s.busy && (current || s.output) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (current)
                    assetBlob(current.asset)
                      .then((blob) => download(blob, "ChatBar-current.png"))
                      .catch(s.fail);
                  else if (s.output) download(s.output, "ChatBar-current.png");
                }}
              >
                <Download size={14} />
                保存当前图片
              </Button>
            )}
            {!s.busy && s.unsaved.length > 0 && (
              <div className="banner banner-error">
                <span>
                  本批 {s.unsaved.length}{" "}
                  张图片尚未写入历史。请先下载，勿关闭页面。
                </span>
                <Button onClick={() => downloadImages(s.unsaved).catch(s.fail)}>
                  下载整批结果
                </Button>
              </div>
            )}
          </section>
        </aside>
        <aside className="studio-history" aria-label="生图历史">
          <div className="section-heading">
            <h2>
              历史 <span className="badge">{images.length}</span>
            </h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("history")}
            >
              管理
            </Button>
          </div>
          <div
            className="studio-history-list"
            tabIndex={0}
            aria-label="历史图片列表"
          >
            {images.length === 0 && (
              <p className="history-empty">生成的图片会保存在这里</p>
            )}
            {images.map((image, i) => (
              <button
                key={`${image.recipe.id}:${image.asset}`}
                className={selectedIndex === i ? "selected" : ""}
                aria-label={`查看历史图片 ${i + 1}`}
                aria-pressed={selectedIndex === i}
                title={`${new Date(image.recipe.createdAt).toLocaleString()} · Seed ${image.seed}`}
                onClick={() => setSelected(`${image.recipe.id}:${image.asset}`)}
              >
                <AssetImage source={image.asset} alt={`历史图片 ${i + 1}`} />
              </button>
            ))}
          </div>
        </aside>
      </div>
      {positionDraft && (
        <CharacterPositionEditor
          draft={positionDraft}
          onClose={() => setPositionDraft(null)}
          onConfirm={(enabled, centers) => {
            try {
              s.edit((v) => {
                const signature = (draft: StudioDraft) =>
                  JSON.stringify([
                    draft.model,
                    draft.characters.map((c) => [
                      c.id,
                      c.center,
                      c.enabled !== false,
                    ]),
                    draft.perModel[draft.model].useCoords,
                    draft.perModel[draft.model].width,
                    draft.perModel[draft.model].height,
                    draft.guidance,
                  ]);
                if (signature(v) !== signature(positionDraft))
                  throw Error("角色或位置已在其他操作中改变，请重新打开编辑器");
                return {
                  ...v,
                  characters: v.characters.map((c) => ({
                    ...c,
                    center: centers[c.id] || c.center,
                  })),
                  perModel: {
                    ...v.perModel,
                    [v.model]: { ...v.perModel[v.model], useCoords: enabled },
                  },
                };
              });
              setPositionDraft(null);
            } catch (e) {
              s.fail(e);
            }
          }}
        />
      )}
      <Modal
        open={stylePicker}
        onClose={() => setStylePicker(false)}
        title="选择画风卡"
        wide
      >
        <Styles
          picker
          onSelect={(card) => {
            s.edit((d) => applyStyleCard(d, card, s.settings.defaultNegative));
            setStylePicker(false);
            s.notify("已填入画风与负面词：" + card.name);
          }}
        />
      </Modal>
      {guidance && <GuidanceEditor onClose={() => setGuidance(false)} />}
      <Modal
        open={paste !== null}
        onClose={() => setPaste(null)}
        title="粘贴分段提示词"
      >
        <PromptEditor
          label="粘贴分段提示词"
          rows={12}
          value={paste || ""}
          onChange={setPaste}
          translate={s.settings.translate}
          placeholder="【基础】…"
        />
        <div className="actions">
          <Button
            variant="secondary"
            onClick={() =>
              navigator.clipboard.readText().then(setPaste).catch(s.fail)
            }
          >
            从剪贴板读取
          </Button>
          <Button
            onClick={() => {
              try {
                const next = pastePositive(paste || "", d);
                s.edit(() => next);
                setPaste(null);
              } catch (e) {
                s.fail(e);
              }
            }}
          >
            校验并覆盖
          </Button>
        </div>
      </Modal>
      {preview && current && (
        <Preview
          images={images}
          initial={selectedIndex}
          onClose={() => setPreview(false)}
          onTool={onTool}
        />
      )}
    </section>
  );
}
