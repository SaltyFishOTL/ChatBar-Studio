import { PromptText, PromptFields } from "./components/PromptText";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import {
  Upload,
  Download,
  Share2,
  RotateCw,
  Undo2,
  Redo2,
  Sparkles,
} from "lucide-react";
import { useStudio } from "./store";
import {
  Button,
  Field,
  NumberField,
  Toggle,
  Modal,
  AssetImage,
  useImage,
} from "./components/ui";
import { assetBlob, putAsset, saveToolResult, state } from "../data/db";
import {
  bytesOf,
  canvas,
  download,
  shareImage,
  dimensions,
  pngAnimated,
} from "../domain/images";
import {
  pngMetadata,
  applyMetadata,
  importMetadata,
  stripMetadata,
  type MetadataSections,
  type CharacterImportMode,
} from "../domain/metadata";
import { disguise, restoreDisguise, inspectDisguise } from "../domain/apng";
import { privacyCanvasBlob, webpAnimated } from "../domain/imagePrivacy";
import {
  enhance,
  upscale,
  enhanceScales,
  upscaleCost,
} from "../api/postprocess";
import { designTurn, type DesignProgress } from "../domain/design";
import type {
  DesignReply,
  DesignConversation,
  DesignTurn,
} from "../domain/types";
export function ToolsPage({
  initialAsset,
  onApply,
}: {
  initialAsset: string;
  onApply: () => void;
}) {
  const s = useStudio(),
    [source, setSource] = useState<Blob | null>(null),
    [sourceId, setSourceId] = useState(initialAsset),
    [savedResults, setSavedResults] = useState<
      { id: string; source: string; createdAt: number }[]
    >([]),
    [result, setResult] = useState<Blob | null>(null),
    [metadata, setMetadata] = useState<Record<string, unknown>>({}),
    [animated, setAnimated] = useState(false),
    [isDisguise, setIsDisguise] = useState(false),
    [size, setSize] = useState({ width: 0, height: 0 }),
    [compare, setCompare] = useState(50),
    [tab, setTab] = useState("edit"),
    [mosaic, setMosaic] = useState(false),
    [importing, setImporting] = useState(false),
    [sections, setSections] = useState<MetadataSections>({
      positive: true,
      negative: true,
      characters: "replace",
      parameters: true,
      seed: true,
      style: false,
      guidance: false,
    }),
    [scale, setScale] = useState<number | "max">(1),
    [strength, setStrength] = useState(0.5),
    [noise, setNoise] = useState(0),
    [candidate, setCandidate] = useState<DesignReply | null>(null),
    [reverseTarget, setReverseTarget] = useState(s.draft.model),
    [stages, setStages] = useState<DesignProgress[]>([]),
    [reverseBusy, setReverseBusy] = useState(false),
    [localBusy, setLocalBusy] = useState(false),
    [processStatus, setProcessStatus] = useState("");
  const metadataFields: [string, string][] = [];
  const comment = metadata.Comment as any;
  const ownRecipe = metadata.ChatBarStudio as any;
  if (ownRecipe && typeof ownRecipe === "object") {
    for (const [label, value] of [
      ["画风", ownRecipe.style],
      ["基础 Prompt", ownRecipe.base],
      ["补充 Prompt", ownRecipe.extra],
      ["负面 Prompt", ownRecipe.negative],
    ]) {
      if (typeof value === "string") metadataFields.push([label, value]);
    }
    if (Array.isArray(ownRecipe.characters))
      ownRecipe.characters.forEach((c: any, i: number) => {
        if (typeof c?.prompt === "string")
          metadataFields.push([`角色 ${i + 1}`, c.prompt]);
        if (typeof c?.negative === "string")
          metadataFields.push([`角色 ${i + 1} 负面`, c.negative]);
      });
  } else if (comment && typeof comment === "object") {
    const positive = comment.v4_prompt?.caption,
      negative = comment.v4_negative_prompt?.caption;
    const add = (label: string, value: unknown) => {
      if (typeof value === "string") metadataFields.push([label, value]);
    };
    add("基础 Prompt", positive?.base_caption ?? comment.prompt);
    add(
      "负面 Prompt",
      negative?.base_caption ?? comment.uc ?? comment.negative_prompt,
    );
    if (Array.isArray(positive?.char_captions))
      positive.char_captions.forEach((c: any, i: number) => {
        add(`角色 ${i + 1}`, c?.char_caption);
        add(`角色 ${i + 1} 负面`, negative?.char_captions?.[i]?.char_caption);
      });
  }
  const reverseCtrl = useRef<AbortController | null>(null),
    loadVersion = useRef(0),
    processCtrl = useRef<AbortController | null>(null),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      reverseCtrl.current?.abort();
      processCtrl.current?.abort();
    };
  }, []);
  const load = async (blob: Blob, id = "") => {
    const revision = ++loadVersion.current;
    reverseCtrl.current?.abort();
    processCtrl.current?.abort();
    setSource(blob);
    const asset = id || (await putAsset(blob));
    if (revision !== loadVersion.current || !mounted.current) return;
    setSourceId(asset);
    setResult(null);
    setCandidate(null);
    setStages([]);
    const bytes = await bytesOf(blob),
      isGif = String.fromCharCode(...bytes.subarray(0, 3)) === "GIF";
    setAnimated(isGif || pngAnimated(bytes) || webpAnimated(bytes));
    try {
      inspectDisguise(bytes);
      setIsDisguise(true);
    } catch {
      setIsDisguise(false);
    }
    try {
      setMetadata(await pngMetadata(blob));
    } catch {
      setMetadata({});
    }
    setSize(await dimensions(blob));
    setScale(1);
  };
  useEffect(() => {
    state<typeof savedResults>("toolResults")
      .then((v) => setSavedResults(v || []))
      .catch(s.fail);
    if (initialAsset)
      assetBlob(initialAsset)
        .then((b) => load(b, initialAsset))
        .catch(s.fail);
  }, [initialAsset]);
  const saveResult = async (blob: Blob) => {
    await saveToolResult(blob, sourceId);
    setSavedResults((await state<typeof savedResults>("toolResults")) || []);
  };
  const process = async (fn: () => Promise<Blob>) => {
    if (localBusy) return;
    setLocalBusy(true);
    try {
      const b = await fn();
      if (mounted.current) {
        setResult(b);
        await saveResult(b);
      }
    } catch (e) {
      s.fail(e);
    } finally {
      if (mounted.current) setLocalBusy(false);
    }
  };
  const reverse = async () => {
    if (!sourceId || reverseCtrl.current) return;
    const ctrl = new AbortController();
    reverseCtrl.current = ctrl;
    setReverseBusy(true);
    setStages([]);
    const target = s.settings.naturalLanguage ? "V5_FULL" : s.draft.model;
    const turn: DesignTurn = {
      id: crypto.randomUUID(),
      text: "",
      image: sourceId,
      reverse: true,
      modelId: s.settings.designModelId,
      target,
      natural: s.settings.naturalLanguage,
      raw: "",
      reasoning: "",
      status: "pending",
    };
    const c: DesignConversation = {
      id: crypto.randomUUID(),
      title: "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      extraRequirement: s.settings.extraRequirement,
      references: s.settings.characterReferences,
      turns: [turn],
    };
    try {
      const v = await designTurn(c, turn, s.settings, ctrl.signal, (p) =>
        setStages((old) => {
          const next = [...old],
            i = next.findIndex((x) => x.stage === p.stage);
          if (i < 0) next.push(p);
          else next[i] = p;
          return next;
        }),
      );
      if (!ctrl.signal.aborted) {
        setCandidate(v.reply);
        setReverseTarget(target);
      }
    } catch (e) {
      if (!ctrl.signal.aborted) s.fail(e);
    } finally {
      reverseCtrl.current = null;
      if (mounted.current) setReverseBusy(false);
    }
  };
  const generatePost = async (mode: "upscale" | "enhance") => {
    if (!source) return;
    try {
      const b = await s.runExclusive(
        mode === "upscale" ? "图片放大" : "图片增强",
        (signal, progress) =>
          mode === "upscale"
            ? upscale(source, s.settings, signal)
            : enhance(
                source,
                metadata,
                s.draft,
                s.settings,
                { scale, strength, noise },
                signal,
                progress,
              ),
      );
      setResult(b);
      await saveResult(b);
      await s.refreshAccount();
    } catch (e) {
      s.fail(e);
    }
  };
  const isV5 = /v5|5-full/i.test(String(metadata.Source || "")),
    scales = enhanceScales(size.width, size.height, isV5);
  const sourceUrl = useImage(source),
    resultUrl = useImage(result);
  return (
    <section className="page tools-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">IMAGE LAB</p>
          <h1>图像工具</h1>
          <p>编辑、反推、增强，让每张图片继续生长。</p>
        </div>
        <label className="button button-secondary">
          <Upload size={16} />
          导入图片
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,.apng"
            hidden
            disabled={s.busy || localBusy || reverseBusy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) load(f).catch(s.fail);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      {savedResults.length > 0 && (
        <div className="panel">
          <h3>已保存的工具结果</h3>
          <div className="recent-strip">
            {savedResults.map((r) => (
              <button
                key={r.id}
                disabled={s.busy || localBusy || reverseBusy}
                title={new Date(r.createdAt).toLocaleString()}
                onClick={() =>
                  assetBlob(r.id)
                    .then((b) => load(b, r.id))
                    .catch(s.fail)
                }
              >
                <AssetImage source={r.id} />
              </button>
            ))}
          </div>
        </div>
      )}
      {!source ? (
        <div className="empty-collection">
          <h2>放入一张图片</h2>
          <p>支持 PNG、JPEG、WebP、GIF 与 APNG。</p>
        </div>
      ) : (
        <div className="tools-grid">
          <section className="panel">
            <div
              className="comparison"
              style={{ aspectRatio: `${size.width || 1}/${size.height || 1}` }}
            >
              <img src={sourceUrl} alt="原图" />
              {resultUrl && (
                <img
                  src={resultUrl}
                  alt="处理结果"
                  style={{ clipPath: `inset(0 0 0 ${compare}%)` }}
                />
              )}
              {result && (
                <div
                  className="comparison-line"
                  style={{ left: compare + "%" }}
                />
              )}
            </div>
            {result && (
              <Field label="前后对比">
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={compare}
                  onChange={(e) => setCompare(Number(e.target.value))}
                />
              </Field>
            )}
            <p className="muted">
              {size.width} × {size.height} ·{" "}
              {animated ? "动态图片" : "静态图片"}
              {isDisguise ? " · ChatBar 伪装" : ""}
            </p>
            <div className="actions">
              <Button
                onClick={() =>
                  download(
                    result || source,
                    "ChatBar-image." +
                      ({
                        "image/jpeg": "jpg",
                        "image/gif": "gif",
                        "image/webp": "webp",
                      }[(result || source).type] || "png"),
                  )
                }
              >
                <Download size={16} />
                保存{result ? "结果" : "原图"}
              </Button>
              <Button
                variant="secondary"
                onClick={() => shareImage(result || source).catch(s.fail)}
              >
                <Share2 size={16} />
                分享
              </Button>
              {result && (
                <Button
                  variant="ghost"
                  onClick={() => load(result).catch(s.fail)}
                >
                  以结果继续编辑
                </Button>
              )}
            </div>
            {s.progress && <p>{s.progress.message}</p>}
            {processStatus && <p>{processStatus}</p>}
          </section>
          <section className="panel">
            <div className="tabs">
              {[
                ["edit", "图像编辑"],
                ["metadata", "元数据"],
                ["reverse", "反推 Prompt"],
                ["enhance", "增强 / 放大"],
              ].map(([id, label]) => (
                <Button
                  key={id}
                  variant={tab === id ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => setTab(id)}
                >
                  {label}
                </Button>
              ))}
            </div>
            {tab === "edit" && (
              <div className="tool-list">
                <Button
                  variant="secondary"
                  disabled={animated || localBusy}
                  onClick={() => setMosaic(true)}
                >
                  马赛克 / 旋转
                </Button>
                <Button
                  variant="secondary"
                  disabled={animated || localBusy}
                  onClick={() => process(() => stripMetadata(result || source))}
                >
                  去除元数据与像素隐写
                </Button>
                <Button
                  variant="secondary"
                  disabled={
                    localBusy ||
                    (animated && !isDisguise && source.type !== "image/gif")
                  }
                  onClick={() =>
                    process(async () => {
                      if (isDisguise) return restoreDisguise(source);
                      const ctrl = new AbortController();
                      processCtrl.current = ctrl;
                      try {
                        return await disguise(
                          source,
                          ctrl.signal,
                          setProcessStatus,
                        );
                      } finally {
                        processCtrl.current = null;
                        setProcessStatus("");
                      }
                    })
                  }
                >
                  {isDisguise ? "还原 ChatBar 伪装" : "转换为 APNG 伪装"}
                </Button>
                {localBusy && (
                  <Button
                    variant="ghost"
                    onClick={() => processCtrl.current?.abort()}
                  >
                    停止处理
                  </Button>
                )}
                {animated && (
                  <p className="muted">
                    动态图片禁用静态编辑，避免丢失动画。第三方 APNG
                    仅查看与保存。
                  </p>
                )}
                <p className="muted">
                  去元数据或编辑完成均导出 PNG
                  副本，清除文件元数据和像素最低位隐写；颜色与透明度可能有极轻微变化，原图保留。旧版结果需重新清理。APNG
                  伪装不属于去元数据操作；伪装还原不会恢复原 JPEG/GIF 编码字节。
                </p>
              </div>
            )}
            {tab === "metadata" && (
              <>
                <Button
                  disabled={!metadata.Comment}
                  onClick={() => setImporting(true)}
                >
                  选择字段并填入工作室
                </Button>
                <PromptFields fields={metadataFields} />
                <details>
                  <summary>原始元数据</summary>
                  <pre className="json-view">
                    {JSON.stringify(metadata, null, 2) || "没有可读元数据"}
                  </pre>
                </details>
              </>
            )}
            {tab === "reverse" && (
              <>
                <p className="muted">
                  使用当前设计模型、工作室目标模型和全局额外要求。完成后需明确应用。
                </p>
                <div className="actions">
                  <Button disabled={animated || reverseBusy} onClick={reverse}>
                    <Sparkles size={15} />
                    {candidate ? "重新反推" : "反推提示词"}
                  </Button>
                  {reverseBusy && (
                    <Button
                      variant="destructive"
                      onClick={() => reverseCtrl.current?.abort()}
                    >
                      停止
                    </Button>
                  )}
                </div>
                {stages.map((v, i) => (
                  <details key={v.stage} open={i === stages.length - 1}>
                    <summary>{v.stage}</summary>
                    <pre className="reasoning">{v.reasoning}</pre>
                    <pre>{v.text}</pre>
                  </details>
                ))}
                {candidate && (
                  <div className="candidate">
                    <h3>候选提示词</h3>
                    <PromptText value={candidate.baseCaption} />
                    {candidate.characters.map((c, i) => (
                      <p key={i}>
                        <strong>角色 {i + 1}</strong>
                        <br />
                        <PromptText value={c.caption} />
                      </p>
                    ))}
                    <Button
                      disabled={reverseBusy}
                      onClick={() => {
                        s.edit((d) => ({
                          ...d,
                          model: reverseTarget,
                          base: candidate.baseCaption,
                          extra: "",
                          characters: candidate.characters.map((c, i) => ({
                            id: d.characters[i]?.id || crypto.randomUUID(),
                            prompt: c.caption,
                            negative: d.characters[i]?.negative || "",
                            center: d.characters[i]?.center || {
                              x: 0.5,
                              y: 0.5,
                            },
                          })),
                        }));
                        s.notify("已应用图片反推；画风和负面提示词保留");
                        onApply();
                      }}
                    >
                      应用到工作室
                    </Button>
                  </div>
                )}
              </>
            )}
            {tab === "enhance" && (
              <>
                <h3>Enhance 增强</h3>
                <p className="muted">
                  需要原图 NovelAI 参数；不会借用当前工作室场景。
                </p>
                <Field label="比例">
                  <select
                    value={scale}
                    onChange={(e) =>
                      setScale(
                        e.target.value === "max"
                          ? "max"
                          : Number(e.target.value),
                      )
                    }
                  >
                    {scales.map((v) => (
                      <option key={v} value={v}>
                        {v === "max" ? "Max ✨" : v + "×"}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="强度预设">
                  <select
                    defaultValue="3"
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      setStrength([0.2, 0.4, 0.5, 0.6, 0.7][n - 1]);
                      setNoise(n === 5 ? 0.1 : 0);
                    }}
                  >
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                  </select>
                </Field>
                <NumberField
                  label="Strength"
                  value={strength}
                  min={0.01}
                  max={0.99}
                  step={0.01}
                  onChange={setStrength}
                />
                <NumberField
                  label="Noise"
                  value={noise}
                  min={0}
                  max={0.99}
                  step={0.01}
                  onChange={setNoise}
                />
                <Button
                  disabled={
                    animated || s.busy || !metadata.Comment || !scales.length
                  }
                  onClick={() => generatePost("enhance")}
                >
                  增强图片
                </Button>
                <hr />
                <h3>Upscale 放大</h3>
                <p className="muted">
                  预计 {upscaleCost(size.width, size.height) ?? "不支持此尺寸"}{" "}
                  Anlas
                </p>
                <Button
                  disabled={
                    animated ||
                    s.busy ||
                    upscaleCost(size.width, size.height) === null
                  }
                  onClick={() => generatePost("upscale")}
                >
                  放大图片
                </Button>
                {s.busy && (
                  <Button variant="destructive" onClick={s.stop}>
                    停止
                  </Button>
                )}
              </>
            )}
          </section>
        </div>
      )}
      <Modal
        open={importing}
        onClose={() => setImporting(false)}
        title="选择要导入的字段"
      >
        {(
          Object.entries({
            positive: "基础正面（网页原图恢复基础及补充分段）",
            style: "独立画风（仅 ChatBar Studio 原图）",
            guidance: "元数据中包含的图像引导与参考配置",
            negative: "基础负面",
            parameters: "生成参数",
            seed: "Seed",
          }) as [Exclude<keyof MetadataSections, "characters">, string][]
        ).map(([k, label]) => (
          <Toggle
            key={k}
            label={label}
            checked={!!sections[k]}
            onChange={(v) => setSections((s) => ({ ...s, [k]: v }))}
          />
        ))}
        <Field label="角色 Prompt（正向与负面）">
          <select
            aria-label="角色 Prompt 导入方式"
            value={sections.characters}
            onChange={(e) =>
              setSections((v) => ({
                ...v,
                characters: e.target.value as CharacterImportMode,
              }))
            }
          >
            <option value="off">关</option>
            <option value="replace">覆盖</option>
            <option value="append">新增</option>
          </select>
        </Field>
        <p className="muted">
          新增会保留原有角色，并将图片中的角色正负面与位置追加到末尾。
        </p>
        <Button
          onClick={async () => {
            try {
              const sourceDraft = s.draft;
              const d = await importMetadata(sourceDraft, metadata, sections);
              s.edit((current) => {
                if (current.revision !== sourceDraft.revision)
                  throw Error("工作室内容已改变，请重新确认导入");
                return d;
              });
              setImporting(false);
              s.notify("已导入选中字段");
              onApply();
            } catch (e) {
              s.fail(e);
            }
          }}
        >
          应用选中字段
        </Button>
      </Modal>
      {mosaic && source && (
        <MosaicEditor
          source={source}
          onClose={() => setMosaic(false)}
          onDone={(b) => {
            setResult(b);
            setMosaic(false);
            saveResult(b).catch(s.fail);
          }}
        />
      )}
    </section>
  );
}
function MosaicEditor({
  source,
  onClose,
  onDone,
}: {
  source: Blob;
  onClose: () => void;
  onDone: (blob: Blob) => void;
}) {
  const s = useStudio(),
    ref = useRef<HTMLCanvasElement>(null),
    [brush, setBrush] = useState(45),
    [ready, setReady] = useState(false),
    [saving, setSaving] = useState(false),
    [version, setVersion] = useState(0),
    past = useRef<ImageData[]>([]),
    future = useRef<ImageData[]>([]),
    drawing = useRef(false);
  useEffect(() => {
    let active = true;
    setReady(false);
    createImageBitmap(source)
      .then((b) => {
        if (active && ref.current) {
          const c = ref.current;
          c.width = b.width;
          c.height = b.height;
          c.getContext("2d")!.drawImage(b, 0, 0);
          setReady(true);
        }
        b.close();
      })
      .catch(s.fail);
    return () => {
      active = false;
    };
  }, [source]);
  const remember = () => {
    const c = ref.current!;
    past.current.push(
      c.getContext("2d")!.getImageData(0, 0, c.width, c.height),
    );
    if (past.current.length > 12) past.current.shift();
    future.current = [];
    setVersion((v) => v + 1);
  };
  const paint = (e: PointerEvent) => {
    if (!ready || saving || !drawing.current) return;
    const c = ref.current!,
      ctx = c.getContext("2d")!,
      r = c.getBoundingClientRect(),
      x = ((e.clientX - r.left) * c.width) / r.width,
      y = ((e.clientY - r.top) * c.height) / r.height,
      block = 12;
    for (
      let yy = Math.max(0, Math.floor((y - brush / 2) / block) * block);
      yy < Math.min(c.height, y + brush / 2);
      yy += block
    )
      for (
        let xx = Math.max(0, Math.floor((x - brush / 2) / block) * block);
        xx < Math.min(c.width, x + brush / 2);
        xx += block
      ) {
        const p = ctx.getImageData(
          Math.min(c.width - 1, xx + 6),
          Math.min(c.height - 1, yy + 6),
          1,
          1,
        ).data;
        ctx.fillStyle = `rgba(${p[0]},${p[1]},${p[2]},${p[3] / 255})`;
        ctx.fillRect(
          xx,
          yy,
          Math.min(block, c.width - xx),
          Math.min(block, c.height - yy),
        );
      }
  };
  const restore = (from: ImageData[], to: ImageData[]) => {
    const p = from.pop();
    if (p) {
      const c = ref.current!,
        ctx = c.getContext("2d")!;
      to.push(ctx.getImageData(0, 0, c.width, c.height));
      c.width = p.width;
      c.height = p.height;
      ctx.putImageData(p, 0, 0);
      setVersion((v) => v + 1);
    }
  };
  return (
    <Modal open onClose={onClose} title="马赛克与旋转" wide>
      <div className="actions">
        <NumberField
          label="笔刷大小"
          value={brush}
          min={12}
          max={300}
          onChange={setBrush}
        />
        <Button
          variant="ghost"
          disabled={!ready || saving || !past.current.length}
          onClick={() => restore(past.current, future.current)}
        >
          <Undo2 size={16} />
        </Button>
        <Button
          variant="ghost"
          disabled={!ready || saving || !future.current.length}
          onClick={() => restore(future.current, past.current)}
        >
          <Redo2 size={16} />
        </Button>
        <Button
          variant="secondary"
          disabled={!ready || saving}
          onClick={() => {
            remember();
            const c = ref.current!,
              temp = canvas(c.width, c.height);
            temp.getContext("2d")!.drawImage(c, 0, 0);
            [c.width, c.height] = [c.height, c.width];
            const ctx = c.getContext("2d")!;
            ctx.translate(c.width, 0);
            ctx.rotate(Math.PI / 2);
            ctx.drawImage(temp, 0, 0);
            ctx.resetTransform();
          }}
        >
          <RotateCw size={16} />
          旋转
        </Button>
      </div>
      <p className="muted">
        完成时自动清除元数据与像素最低位隐写，导出 PNG 副本；原图保留。
      </p>
      <div className="mosaic-stage">
        <canvas
          ref={ref}
          onPointerDown={(e) => {
            if (!ready || saving) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            remember();
            drawing.current = true;
            paint(e);
          }}
          onPointerMove={paint}
          onPointerUp={() => {
            drawing.current = false;
          }}
          onPointerCancel={() => {
            drawing.current = false;
          }}
        />
      </div>
      <div className="actions">
        <Button variant="secondary" onClick={onClose}>
          取消
        </Button>
        <Button
          disabled={!ready || saving}
          onClick={() => {
            if (!ready || saving || !ref.current) return;
            setSaving(true);
            try {
              onDone(privacyCanvasBlob(ref.current));
            } catch (error) {
              s.fail(error);
            } finally {
              setSaving(false);
            }
          }}
        >
          完成
        </Button>
      </div>
    </Modal>
  );
}
