import { PromptText } from "./components/PromptText";
import { useEffect, useRef, useState } from "react";
import {
  Plus,
  Search,
  Copy,
  Pencil,
  Sparkles,
  Download,
  Upload,
  Trash2,
} from "lucide-react";
import { useStudio } from "./store";
import { AssetImage, Button, Field, Modal } from "./components/ui";
import { PromptEditor } from "./components/PromptEditor";
import { db, deleteCard, saveEditedCard } from "../data/db";
import { getKey } from "../data/vault";
import { SettingsPage, type SettingsFocus } from "./Settings";
import { exportCard, importCard } from "../data/backup";
import { draftDefaults, type StyleCard } from "../domain/types";
import { download, normalizeImage } from "../domain/images";
import { generate } from "../api/novelai";
export function Styles({
  picker = false,
  onSelect,
}: {
  picker?: boolean;
  onSelect?: (card: StyleCard) => void;
}) {
  const s = useStudio(),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [modelFilter, setModelFilter] = useState("all"),
    [editing, setEditing] = useState<StyleCard | null>(null),
    [pendingAvatar, setPendingAvatar] = useState<Blob | null>(null),
    [generatingAvatar, setGeneratingAvatar] = useState(false),
    [uploading, setUploading] = useState(false),
    [saving, setSaving] = useState(false),
    [settingsTarget, setSettingsTarget] = useState<SettingsFocus | null>(null);
  const editorSession = useRef(0),
    expectedVersion = useRef<number | null>(null),
    avatarController = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      editorSession.current++;
      avatarController.current?.abort();
    },
    [],
  );
  const closeEditor = () => {
    if (saving) return;
    editorSession.current++;
    avatarController.current?.abort();
    avatarController.current = null;
    setGeneratingAvatar(false);
    setUploading(false);
    setPendingAvatar(null);
    setEditing(null);
    setSettingsTarget(null);
  };
  const openEditor = (card: StyleCard, existing = false) => {
    editorSession.current++;
    expectedVersion.current = existing ? card.updatedAt : null;
    setPendingAvatar(null);
    setEditing(card);
  };
  const select = (card: StyleCard) => {
    if (onSelect) {
      onSelect(card);
      return;
    }
    s.edit((d) => ({ ...d, style: card.prompt }));
    s.notify("已填入画风：" + card.name);
  };
  const create = () => {
    const now = Date.now();
    openEditor({
      id: crypto.randomUUID(),
      name: "",
      prompt: "",
      avatar: "",
      createdAt: now,
      updatedAt: now,
    });
  };
  const avatar = async (card: StyleCard) => {
    if (avatarController.current || uploading || saving) return;
    const missing = !getKey("novelai").trim()
      ? "novelai-key"
      : !s.settings.stylePreviewTestPrompt.trim()
        ? "style-preview-prompt"
        : null;
    if (missing) {
      s.notify(
        missing === "novelai-key"
          ? "请先填写 NovelAI Token"
          : "请先填写画风测试提示词",
      );
      setSettingsTarget(missing);
      return;
    }
    if (!card.prompt.trim()) {
      s.fail(Error("请先填写画风提示词"));
      return;
    }
    const session = editorSession.current;
    const version = expectedVersion.current;
    const controller = new AbortController();
    avatarController.current = controller;
    setGeneratingAvatar(true);
    const cfg = structuredClone(s.settings);
    const d = draftDefaults(cfg.defaultNegative);
    d.model = s.draft.model;
    d.style = card.prompt;
    d.base = cfg.stylePreviewTestPrompt;
    d.perModel[d.model] = {
      ...structuredClone(s.draft.perModel[d.model]),
      width: 512,
      height: 512,
      count: 1,
      seedMode: "RANDOM",
      useCoords: false,
    };
    try {
      await s.runExclusive("生成画风示例头像", async (signal, progress) => {
        const abort = () => controller.abort(signal.reason);
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
        try {
          const r = await generate(d, cfg, controller.signal, progress);
          controller.signal.throwIfAborted();
          if (version !== null) {
            const current = await (await db).get("cards", card.id);
            if (!current || current.updatedAt !== version)
              throw Error("卡片已删除或被其他页面修改，头像未替换");
          }
          controller.signal.throwIfAborted();
          if (session === editorSession.current) setPendingAvatar(r.images[0]);
        } finally {
          signal.removeEventListener("abort", abort);
        }
      });
      if (session === editorSession.current)
        s.notify("头像已生成，保存画风卡后生效");
      await s.refreshAccount();
    } catch (e) {
      if (!controller.signal.aborted && session === editorSession.current)
        s.fail(e);
    } finally {
      if (avatarController.current === controller)
        avatarController.current = null;
      if (session === editorSession.current) setGeneratingAvatar(false);
    }
  };
  const visible = s.cards.filter(
    (c) =>
      (filter === "all" ||
        (filter === "preset") === c.id.startsWith("preset:")) &&
      (modelFilter === "all" ||
        !s.support[c.id] ||
        s.support[c.id] === "BOTH" ||
        s.support[c.id] === modelFilter) &&
      (c.name + " " + c.prompt).toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <section className={picker ? "" : "page"}>
      {!picker && (
        <div className="page-heading">
          <div>
            <p className="eyebrow">STYLE LIBRARY</p>
            <h1>画风卡</h1>
            <p>用同一个画面，发现不同画风。</p>
          </div>
          <div className="actions">
            <label className="button button-secondary">
              <Upload size={16} />
              导入
              <input
                type="file"
                accept=".json"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f)
                    importCard(f)
                      .then(() => s.notify("画风卡已导入"))
                      .catch(s.fail);
                  e.target.value = "";
                }}
              />
            </label>
            <Button onClick={create}>
              <Plus size={16} />
              新建画风卡
            </Button>
          </div>
        </div>
      )}
      <div className="toolbar">
        <div className="search">
          <Search size={17} />
          <input
            placeholder="搜索名称或提示词"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select
          aria-label="画风来源"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="all">全部画风</option>
          <option value="preset">预置画风</option>
          <option value="personal">我的画风</option>
        </select>
        <div
          className="style-model-filter"
          role="group"
          aria-label="按生图模型筛选画风"
        >
          {[
            ["all", "全部模型"],
            ["V4.5", "V4.5"],
            ["V5", "V5"],
          ].map(([id, name]) => (
            <Button
              key={id}
              size="sm"
              variant={modelFilter === id ? "default" : "secondary"}
              aria-pressed={modelFilter === id}
              onClick={() => setModelFilter(id)}
            >
              {name}
            </Button>
          ))}
        </div>
      </div>
      <div className="style-grid">
        {visible.map((card) => (
          <article className="style-card" key={card.id}>
            <button className="style-image" onClick={() => select(card)}>
              <AssetImage source={card.avatar} alt={card.name} />
              <span>填入画风</span>
            </button>
            <div className="style-info">
              <div>
                <h3>{card.name}</h3>
                <small>
                  {card.id.startsWith("preset:")
                    ? "预置 · " +
                      (s.support[card.id] === "BOTH"
                        ? "V4.5 / V5"
                        : s.support[card.id])
                    : "个人画风"}
                </small>
                <small
                  className="style-negative-label"
                  title="仅标识原预置是否附带独立负面词，选卡不会替换工作室负面提示词"
                >
                  {s.presetNegative[card.id]
                    ? "原预置含负面词 · 不自动填入"
                    : "无独立负面词"}
                </small>
              </div>
              <p>
                <PromptText value={card.prompt} />
              </p>
              {s.support[card.id] &&
                s.support[card.id] !== "BOTH" &&
                s.support[card.id] !==
                  (s.draft.model === "V5_FULL" ? "V5" : "V4.5") && (
                  <small className="warning">
                    此画风推荐 {s.support[card.id]}；不会自动切换模型
                  </small>
                )}
              <div className="actions compact">
                <Button
                  variant="ghost"
                  size="icon"
                  title="复制为个人画风"
                  onClick={() => {
                    const now = Date.now();
                    openEditor({
                      ...card,
                      id: crypto.randomUUID(),
                      name: card.name + " 副本",
                      createdAt: now,
                      updatedAt: now,
                    });
                  }}
                >
                  <Copy size={15} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  title="导出画风卡"
                  onClick={() =>
                    exportCard(card)
                      .then((b) => download(b, card.name + ".json"))
                      .catch(s.fail)
                  }
                >
                  <Download size={15} />
                </Button>
                {!card.id.startsWith("preset:") && (
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="编辑"
                      onClick={() => openEditor({ ...card }, true)}
                    >
                      <Pencil size={15} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="删除"
                      onClick={() => {
                        if (
                          confirm(
                            `删除画风卡“${card.name}”？已有图片和草稿不受影响。`,
                          )
                        )
                          deleteCard(card.id).catch(s.fail);
                      }}
                    >
                      <Trash2 size={15} />
                    </Button>
                  </>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>
      {!visible.length && <p className="muted">没有符合筛选条件的画风卡。</p>}
      <Modal open={!!editing} onClose={closeEditor} title="编辑画风卡" wide>
        {editing && (
          <>
            <fieldset
              className="card-editor-fields"
              disabled={generatingAvatar || uploading || saving}
            >
              <div className="card-editor">
                <AssetImage
                  source={pendingAvatar || editing.avatar}
                  className="avatar-preview"
                />
                <div>
                  <Field label="名称">
                    <input
                      value={editing.name}
                      onChange={(e) =>
                        setEditing({ ...editing, name: e.target.value })
                      }
                    />
                  </Field>
                  <div className="actions">
                    <label className="button button-secondary">
                      <Upload size={15} />
                      上传示例头像
                      <input
                        type="file"
                        hidden
                        accept="image/png,image/jpeg,image/webp"
                        onChange={async (e) => {
                          const f = e.target.files?.[0];
                          e.target.value = "";
                          if (!f) return;
                          const session = editorSession.current;
                          setUploading(true);
                          try {
                            const blob = await normalizeImage(f);
                            if (session === editorSession.current)
                              setPendingAvatar(blob);
                          } catch (err) {
                            if (session === editorSession.current) s.fail(err);
                          } finally {
                            if (session === editorSession.current)
                              setUploading(false);
                          }
                        }}
                      />
                    </label>
                    <Button
                      variant="secondary"
                      disabled={s.busy}
                      onClick={() => void avatar(editing)}
                    >
                      <Sparkles size={15} />
                      生成示例头像
                    </Button>
                  </div>
                  <small>上传或生成后，点击「保存画风卡」生效。</small>
                </div>
              </div>
              <PromptEditor
                label="画风提示词"
                value={editing.prompt}
                onChange={(prompt) => setEditing({ ...editing, prompt })}
                translate={s.settings.translate}
              />
            </fieldset>
            {generatingAvatar && (
              <div className="actions">
                <span role="status" className="muted">
                  {s.progress?.message || "正在生成示例头像…"}
                </span>
                <Button
                  variant="secondary"
                  onClick={() => avatarController.current?.abort()}
                >
                  取消生成
                </Button>
              </div>
            )}
            <div className="actions">
              <Button
                variant="secondary"
                disabled={saving}
                onClick={closeEditor}
              >
                取消
              </Button>
              <Button
                disabled={
                  saving ||
                  uploading ||
                  generatingAvatar ||
                  !editing.name.trim() ||
                  !editing.prompt.trim()
                }
                onClick={async () => {
                  setSaving(true);
                  try {
                    await saveEditedCard(
                      { ...editing, name: editing.name.trim() },
                      pendingAvatar,
                      expectedVersion.current,
                    );
                    setEditing(null);
                    setPendingAvatar(null);
                    s.notify("画风卡已保存");
                  } catch (e) {
                    s.fail(e);
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                保存画风卡
              </Button>
            </div>
          </>
        )}
      </Modal>
      <Modal
        open={!!settingsTarget}
        onClose={() => setSettingsTarget(null)}
        title="完善头像生成设置"
        wide
      >
        {settingsTarget && (
          <>
            <p role="alert">
              {settingsTarget === "novelai-key"
                ? "请填写 NovelAI Token。"
                : "请填写画风测试提示词。"}
              填写后关闭此窗口，返回画风卡继续生成。
            </p>
            <SettingsPage focusTarget={settingsTarget} />
          </>
        )}
      </Modal>
    </section>
  );
}
