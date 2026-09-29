import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Upload, Undo2, Redo2, Trash2, Plus } from "lucide-react";
import { useStudio } from "./store";
import {
  Modal,
  Button,
  NumberField,
  Field,
  AssetImage,
  Toggle,
} from "./components/ui";
import { assetBlob, putAsset } from "../data/db";
import { normalizeImage, canvasBlob, canvas } from "../domain/images";
import type { Guidance as GuidanceData, Focus } from "../domain/types";
type Snapshot = { g: GuidanceData; mask: string };
export function GuidanceEditor({ onClose }: { onClose: () => void }) {
  const s = useStudio(),
    [g, setG] = useState(() => structuredClone(s.draft.guidance)),
    [tab, setTab] = useState("base"),
    [tool, setTool] = useState("focus"),
    [brush, setBrush] = useState(40),
    [zoom, setZoom] = useState(1),
    [pan, setPan] = useState({ x: 0, y: 0 }),
    [size, setSize] = useState({ width: 1, height: 1 }),
    [ready, setReady] = useState(false),
    [version, setVersion] = useState(0),
    [saving, setSaving] = useState(false);
  const baseCanvas = useRef<HTMLCanvasElement>(null),
    overlay = useRef<HTMLCanvasElement>(null),
    mask = useRef<HTMLCanvasElement>(canvas(1, 1)),
    painted = useRef(false),
    stage = useRef<HTMLDivElement>(null),
    timeline = useRef<Snapshot[]>([]),
    future = useRef<Snapshot[]>([]),
    pointers = useRef(new Map<number, { x: number; y: number }>()),
    start = useRef<{
      x: number;
      y: number;
      mask: string;
      focus?: Focus;
      handle: string;
    } | null>(null),
    pinch = useRef<{
      distance: number;
      zoom: number;
      cx: number;
      cy: number;
      pan: { x: number; y: number };
    } | null>(null);
  const snapshot = (): Snapshot => ({
    g: structuredClone(g),
    mask: mask.current.toDataURL(),
  });
  const record = () => {
    timeline.current.push(snapshot());
    if (timeline.current.length > 20) timeline.current.shift();
    future.current = [];
    setVersion((v) => v + 1);
  };
  const redraw = () => {
    const out = overlay.current;
    if (!out) return;
    out.width = mask.current.width;
    out.height = mask.current.height;
    const src = mask.current
      .getContext("2d")!
      .getImageData(0, 0, out.width, out.height);
    for (let i = 0; i < src.data.length; i += 4) {
      const yes = src.data[i] > 155;
      src.data[i] = 70;
      src.data[i + 1] = 130;
      src.data[i + 2] = 255;
      src.data[i + 3] = yes ? 95 : 0;
    }
    out.getContext("2d")!.putImageData(src, 0, 0);
  };
  const loadMask = (url: string) =>
    new Promise<void>((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        const ctx = mask.current.getContext("2d")!;
        ctx.clearRect(0, 0, mask.current.width, mask.current.height);
        ctx.drawImage(image, 0, 0);
        painted.current = true;
        redraw();
        resolve();
      };
      image.onerror = reject;
      image.src = url;
    });
  const restore = async (v: Snapshot) => {
    setG(v.g);
    await loadMask(v.mask);
    setVersion((n) => n + 1);
  };
  useEffect(() => {
    let active = true;
    setReady(false);
    if (!g.base) {
      for (const c of [baseCanvas.current, overlay.current, mask.current])
        if (c) c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
      return;
    }
    (async () => {
      const b = await createImageBitmap(await assetBlob(g.base));
      if (!active) {
        b.close();
        return;
      }
      if (b.width * b.height > 25000000) {
        b.close();
        throw Error("图片过大，请先缩小后编辑");
      }
      setSize({ width: b.width, height: b.height });
      for (const c of [baseCanvas.current, mask.current, overlay.current])
        if (c) {
          c.width = b.width;
          c.height = b.height;
        }
      baseCanvas.current!.getContext("2d")!.drawImage(b, 0, 0);
      b.close();
      const ctx = mask.current.getContext("2d")!;
      ctx.fillStyle = "black";
      ctx.fillRect(0, 0, mask.current.width, mask.current.height);
      painted.current = !!g.mask;
      if (g.mask) {
        const m = await createImageBitmap(await assetBlob(g.mask));
        ctx.drawImage(m, 0, 0);
        m.close();
      }
      redraw();
      setReady(true);
      setZoom(1);
      setPan({ x: 0, y: 0 });
    })().catch(s.fail);
    return () => {
      active = false;
    };
  }, [g.base]);
  const change = (fn: (v: GuidanceData) => GuidanceData) => {
    record();
    setG(fn(g));
  };
  const importSource = async (
    file: File,
    dest: "base" | "precise" | "vibe",
  ) => {
    try {
      const blob = await normalizeImage(file),
        id = await putAsset(blob);
      record();
      if (dest === "base") {
        setG((v) => ({ ...v, base: id, mask: "", focus: undefined }));
        painted.current = false;
      } else if (dest === "precise")
        setG((v) => ({ ...v, precise: id, referenceMode: "precise" }));
      else {
        if (g.vibes.length >= 16) throw Error("最多 16 个 Vibe");
        setG((v) => ({
          ...v,
          referenceMode: "vibe",
          vibes: [...v.vibes, { asset: id, strength: 0.6, information: 1 }],
        }));
      }
    } catch (e) {
      s.fail(e);
    }
  };
  const position = (e: PointerEvent) => {
    const r = baseCanvas.current!.getBoundingClientRect();
    return {
      x: Math.max(
        0,
        Math.min(size.width, ((e.clientX - r.left) / r.width) * size.width),
      ),
      y: Math.max(
        0,
        Math.min(size.height, ((e.clientY - r.top) / r.height) * size.height),
      ),
    };
  };
  const draw = (x: number, y: number) => {
    const ctx = mask.current.getContext("2d")!;
    ctx.fillStyle = tool === "erase" ? "black" : "white";
    ctx.beginPath();
    ctx.arc(x, y, brush / 2, 0, Math.PI * 2);
    ctx.fill();
    painted.current = true;
    redraw();
  };
  const lastPaint = useRef<{ x: number; y: number } | null>(null);
  const down = (e: PointerEvent) => {
    lastPaint.current = null;
    if (!ready || g.action !== "infill") return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      if (start.current) {
        const initial = start.current;
        loadMask(initial.mask).catch(s.fail);
        setG((v) => ({ ...v, focus: initial.focus }));
        start.current = null;
      }
      const [a, b] = [...pointers.current.values()];
      pinch.current = {
        distance: Math.hypot(a.x - b.x, a.y - b.y),
        zoom,
        cx: (a.x + b.x) / 2,
        cy: (a.y + b.y) / 2,
        pan,
      };
      return;
    }
    if (pointers.current.size > 1) return;
    record();
    const p = position(e);
    start.current = {
      ...p,
      mask: mask.current.toDataURL(),
      focus: g.focus,
      handle: (e.target as HTMLElement).dataset?.handle || "",
    };
    if (tool === "brush" || tool === "erase") {
      draw(p.x, p.y);
      lastPaint.current = p;
    }
  };
  const move = (e: PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size >= 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()],
        p = pinch.current;
      setZoom(
        Math.max(
          0.5,
          Math.min(
            8,
            (p.zoom * Math.hypot(a.x - b.x, a.y - b.y)) /
              Math.max(1, p.distance),
          ),
        ),
      );
      setPan({
        x: p.pan.x + (a.x + b.x) / 2 - p.cx,
        y: p.pan.y + (a.y + b.y) / 2 - p.cy,
      });
      return;
    }
    if (!start.current) return;
    const p = position(e),
      a = start.current;
    if (tool === "brush" || tool === "erase") {
      const prev = lastPaint.current;
      if (prev) {
        const ctx = mask.current.getContext("2d")!;
        ctx.strokeStyle = tool === "erase" ? "black" : "white";
        ctx.lineWidth = brush;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
      lastPaint.current = p;
      draw(p.x, p.y);
      return;
    }
    if (tool === "focus") {
      let left = Math.min(a.x, p.x),
        top = Math.min(a.y, p.y),
        right = Math.max(a.x, p.x),
        bottom = Math.max(a.y, p.y);
      if (a.handle && a.focus) {
        left = a.focus.x;
        top = a.focus.y;
        right = left + a.focus.width;
        bottom = top + a.focus.height;
        if (a.handle.includes("w")) left = p.x;
        if (a.handle.includes("e")) right = p.x;
        if (a.handle.includes("n")) top = p.y;
        if (a.handle.includes("s")) bottom = p.y;
      }
      const x = Math.round(Math.min(left, right) / 8) * 8,
        y = Math.round(Math.min(top, bottom) / 8) * 8,
        width = Math.max(8, Math.round(Math.abs(right - left) / 8) * 8),
        height = Math.max(8, Math.round(Math.abs(bottom - top) / 8) * 8);
      setG((v) => ({
        ...v,
        focus: {
          x: Math.min(size.width - 8, x),
          y: Math.min(size.height - 8, y),
          width: Math.min(width, size.width - x),
          height: Math.min(height, size.height - y),
          context: a.focus?.context ?? 96,
        },
      }));
    }
  };
  const up = (e: PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (!pointers.current.size) {
      start.current = null;
      pinch.current = null;
    } else if (pinch.current) start.current = null;
  };
  const save = async () => {
    setSaving(true);
    try {
      let next = g;
      if (painted.current && g.base) {
        const blob = await canvasBlob(mask.current);
        next = { ...g, mask: await putAsset(blob) };
      }
      s.edit((d) => ({ ...d, guidance: next }));
      onClose();
    } catch (e) {
      s.fail(e);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal open onClose={onClose} title="图像引导" wide>
      <div className="tabs">
        {[
          ["base", "基图与局部重绘"],
          ["precise", "精确参考"],
          ["vibe", "氛围参考"],
        ].map(([id, label]) => (
          <Button
            key={id}
            variant={tab === id ? "default" : "ghost"}
            onClick={() => setTab(id)}
          >
            {label}
          </Button>
        ))}
      </div>
      <div className="actions">
        <Button
          size="sm"
          variant="ghost"
          disabled={!timeline.current.length}
          onClick={() => {
            const v = timeline.current.pop();
            if (v) {
              future.current.push(snapshot());
              restore(v).catch(s.fail);
            }
          }}
        >
          <Undo2 size={15} />
          撤销
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={!future.current.length}
          onClick={() => {
            const v = future.current.pop();
            if (v) {
              timeline.current.push(snapshot());
              restore(v).catch(s.fail);
            }
          }}
        >
          <Redo2 size={15} />
          重做
        </Button>
      </div>
      <div hidden={tab !== "base"}>
        <Field label="生成方式">
          <select
            value={g.action}
            onChange={(e) =>
              change((v) => ({
                ...v,
                action: e.target.value as GuidanceData["action"],
              }))
            }
          >
            <option value="generate">文生图（暂停基图）</option>
            <option value="img2img">图生图</option>
            <option value="infill">局部重绘</option>
          </select>
        </Field>
        <div className="actions">
          <label className="button button-secondary">
            <Upload size={15} />
            {g.base ? "替换基图" : "导入基图"}
            <input
              type="file"
              hidden
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importSource(f, "base");
                e.target.value = "";
              }}
            />
          </label>
          <Button
            variant="ghost"
            onClick={() =>
              change((v) => ({
                ...v,
                base: "",
                mask: "",
                focus: undefined,
                action: "generate",
              }))
            }
          >
            清除基图
          </Button>
          {g.action === "infill" && (
            <>
              <select value={tool} onChange={(e) => setTool(e.target.value)}>
                <option value="focus">选择 / 调整焦点区域</option>
                <option value="brush">画笔</option>
                <option value="erase">橡皮</option>
              </select>
              <NumberField
                label="笔刷"
                value={brush}
                min={2}
                max={300}
                onChange={setBrush}
              />
              <Button
                variant="ghost"
                onClick={() => {
                  record();
                  mask.current.getContext("2d")!.fillStyle = "black";
                  mask.current
                    .getContext("2d")!
                    .fillRect(0, 0, size.width, size.height);
                  painted.current = false;
                  setG((v) => ({ ...v, mask: "", focus: undefined }));
                  setTool("focus");
                  redraw();
                }}
              >
                清除蒙版
              </Button>
            </>
          )}
        </div>
        <div
          className="guidance-stage"
          ref={stage}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
        >
          <div
            className="canvas-transform"
            style={{
              transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})`,
            }}
          >
            <canvas ref={baseCanvas} />
            <canvas
              ref={overlay}
              className="mask-overlay"
              hidden={g.action !== "infill"}
            />
            {g.action === "infill" && g.focus && (
              <div
                className="focus-region"
                style={{
                  left: `${(g.focus.x / size.width) * 100}%`,
                  top: `${(g.focus.y / size.height) * 100}%`,
                  width: `${(g.focus.width / size.width) * 100}%`,
                  height: `${(g.focus.height / size.height) * 100}%`,
                }}
              >
                {tool === "focus" &&
                  ["nw", "n", "ne", "e", "se", "s", "sw", "w"].map((h) => (
                    <span
                      key={h}
                      className={"focus-handle " + h}
                      data-handle={h}
                    />
                  ))}
              </div>
            )}
          </div>
          {!g.base && <p className="canvas-empty">导入图片开始编辑</p>}
        </div>
        {g.action === "infill" && (
          <>
            <p className="muted">
              单指画笔 / 焦点选择；双指缩放平移。区域面积 ≤589,824
              像素，宽高需大于两倍上下文边界。
            </p>
            {g.focus && (
              <div className="form-grid">
                {(["x", "y", "width", "height"] as const).map((k) => (
                  <NumberField
                    key={k}
                    label={k}
                    value={g.focus![k]}
                    step={8}
                    min={0}
                    onChange={(value) =>
                      change((v) => ({
                        ...v,
                        focus: { ...v.focus!, [k]: Math.round(value / 8) * 8 },
                      }))
                    }
                  />
                ))}
                <NumberField
                  label="Minimum Context"
                  value={g.focus.context ?? 96}
                  min={32}
                  max={96}
                  onChange={(value) =>
                    change((v) => ({
                      ...v,
                      focus: { ...v.focus!, context: value },
                    }))
                  }
                />
              </div>
            )}
            <NumberField
              label="Inpaint Strength"
              value={g.inpaintStrength}
              min={0}
              max={1}
              step={0.01}
              onChange={(value) =>
                change((v) => ({ ...v, inpaintStrength: value }))
              }
            />
          </>
        )}
        <div className="form-grid">
          <NumberField
            label="Strength"
            value={g.strength}
            min={0}
            max={1}
            step={0.01}
            onChange={(value) => change((v) => ({ ...v, strength: value }))}
          />
          <NumberField
            label="Noise"
            value={g.noise}
            min={0}
            max={1}
            step={0.01}
            onChange={(value) => change((v) => ({ ...v, noise: value }))}
          />
        </div>
      </div>
      {tab === "precise" && (
        <>
          <p className="muted">V5 暂停精确参考，切回 V4.5 后保留配置。</p>
          <AssetImage source={g.precise} className="reference-preview" />
          <div className="actions">
            <label className="button button-secondary">
              <Upload size={15} />
              导入参考图
              <input
                type="file"
                hidden
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) importSource(f, "precise");
                  e.target.value = "";
                }}
              />
            </label>
            <Button
              variant="ghost"
              onClick={() =>
                change((v) => ({ ...v, precise: "", referenceMode: "none" }))
              }
            >
              清除
            </Button>
          </div>
          <Field label="参考模式">
            <select
              value={g.referenceMode === "precise" ? "precise" : "none"}
              onChange={(e) =>
                change((v) => ({
                  ...v,
                  referenceMode: e.target.value as "none" | "precise",
                }))
              }
            >
              <option value="none">暂停</option>
              <option value="precise">启用精确参考</option>
            </select>
          </Field>
          <Field label="参考内容">
            <select
              value={g.preciseType}
              onChange={(e) =>
                change((v) => ({
                  ...v,
                  preciseType: e.target.value as GuidanceData["preciseType"],
                }))
              }
            >
              <option value="character">角色</option>
              <option value="style">画风</option>
              <option value="character&style">角色与画风</option>
            </select>
          </Field>
          <NumberField
            label="Strength"
            value={g.preciseStrength}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => change((g) => ({ ...g, preciseStrength: v }))}
          />
          <NumberField
            label="Fidelity"
            value={g.fidelity}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => change((g) => ({ ...g, fidelity: v }))}
          />
        </>
      )}
      {tab === "vibe" && (
        <>
          <p className="muted">
            最多 16 张；生成时才编码，滑动参数不会产生请求。V5 暂停氛围参考。
          </p>
          <Field label="参考模式">
            <select
              value={g.referenceMode === "vibe" ? "vibe" : "none"}
              onChange={(e) =>
                change((v) => ({
                  ...v,
                  referenceMode: e.target.value as "none" | "vibe",
                }))
              }
            >
              <option value="none">暂停</option>
              <option value="vibe">启用氛围参考</option>
            </select>
          </Field>
          <Toggle
            label="归一化 Vibe 强度"
            checked={g.normalizeVibeStrengths !== false}
            onChange={(value) =>
              change((v) => ({ ...v, normalizeVibeStrengths: value }))
            }
          />
          <div className="vibe-grid">
            {g.vibes.map((v, i) => (
              <div className="panel" key={i}>
                <AssetImage source={v.asset} className="reference-preview" />
                <NumberField
                  label="Strength"
                  value={v.strength}
                  min={0}
                  max={1}
                  step={0.01}
                  onChange={(value) =>
                    change((g) => ({
                      ...g,
                      vibes: g.vibes.map((x, j) =>
                        i === j ? { ...x, strength: value } : x,
                      ),
                    }))
                  }
                />
                <NumberField
                  label="Information Extracted"
                  disabled={!v.asset}
                  value={v.information}
                  min={0}
                  max={1}
                  step={0.01}
                  onChange={(value) =>
                    change((g) => ({
                      ...g,
                      vibes: g.vibes.map((x, j) =>
                        i === j
                          ? { ...x, information: value, encoding: undefined }
                          : x,
                      ),
                    }))
                  }
                />
                <Button
                  variant="ghost"
                  onClick={() =>
                    change((g) => ({
                      ...g,
                      vibes: g.vibes.filter((_, j) => i !== j),
                    }))
                  }
                >
                  <Trash2 size={15} />
                  移除
                </Button>
              </div>
            ))}
          </div>
          <label className="button button-secondary">
            <Plus size={15} />
            添加 Vibe
            <input
              hidden
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importSource(f, "vibe");
                e.target.value = "";
              }}
            />
          </label>
        </>
      )}
      <div className="dialog-footer">
        <Button variant="secondary" disabled={saving} onClick={onClose}>
          取消
        </Button>
        <Button disabled={saving} onClick={save}>
          {saving ? "正在保存…" : "完成"}
        </Button>
      </div>
    </Modal>
  );
}
