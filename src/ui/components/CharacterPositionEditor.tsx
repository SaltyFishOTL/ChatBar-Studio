import { PromptText } from "./PromptText";
import {
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type KeyboardEvent,
} from "react";
import type { StudioDraft } from "../../domain/types";
import {
  normalizePosition,
  evenlyPlaced,
  focusPreviewSize,
} from "../../domain/studioControls";
import { activeCharacters, effectiveSize } from "../../domain/promptPolicy";
import { Button, Field, Modal } from "./ui";
import { useInpaintCanvas } from "./SizeEditor";

type Center = { x: number; y: number };
type Values = Record<string, [string, string]>;
const percentText = (center: Center): [string, string] => [
  String(Math.round(center.x * 1000) / 10),
  String(Math.round(center.y * 1000) / 10),
];
export function CharacterPositionEditor({
  draft,
  onClose,
  onConfirm,
}: {
  draft: StudioDraft;
  onClose: () => void;
  onConfirm: (enabled: boolean, centers: Record<string, Center>) => void;
}) {
  const characters = activeCharacters(draft),
    settings = draft.perModel[draft.model];
  const initial = useMemo(
    () =>
      Object.fromEntries(
        characters.map((c, i) => [
          c.id,
          normalizePosition(
            c.center || evenlyPlaced(i, characters.length, draft.model),
            draft.model,
          ),
        ]),
      ),
    [draft],
  );
  const [enabled, setEnabled] = useState(settings.useCoords),
    [selected, setSelected] = useState(characters[0].id),
    [values, setValues] = useState<Values>(() =>
      Object.fromEntries(
        characters.map((c) => [c.id, percentText(initial[c.id])]),
      ),
    );
  const pointer = useRef<number | null>(null),
    source = useInpaintCanvas(draft);
  const centers: Record<string, Center> = {};
  const validNumber = (v: string) =>
    v.trim() !== "" &&
    Number.isFinite(Number(v)) &&
    Number(v) >= 0 &&
    Number(v) <= 100;
  for (const c of characters) {
    const [x, y] = values[c.id];
    if (validNumber(x) && validNumber(y))
      centers[c.id] = normalizePosition(
        { x: Number(x) / 100, y: Number(y) / 100 },
        draft.model,
      );
  }
  const valid = Object.keys(centers).length === characters.length,
    raw = values[selected];
  let size: { width: number; height: number } | undefined,
    error = "";
  try {
    size = effectiveSize(settings.width, settings.height);
  } catch (e) {
    error = (e as Error).message;
  }
  if (draft.guidance.action === "infill") {
    error = source.error || (!source.size ? "正在读取聚焦重绘基图…" : "");
    if (source.size)
      try {
        size = focusPreviewSize(source.size, draft.guidance.focus);
      } catch (e) {
        error = (e as Error).message;
      }
  }
  const place = (point: Center) =>
    setValues((old) => ({
      ...old,
      [selected]: percentText(normalizePosition(point, draft.model)),
    }));
  const placePointer = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (enabled && rect.width && rect.height)
      place({
        x: (event.clientX - rect.left) / rect.width,
        y: (event.clientY - rect.top) / rect.height,
      });
  };
  const keyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      !enabled ||
      !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
    )
      return;
    event.preventDefault();
    const c = centers[selected] || initial[selected],
      step = draft.model === "V4_5_FULL" ? 0.2 : event.shiftKey ? 0.1 : 0.01;
    place({
      x:
        c.x +
        (event.key === "ArrowLeft"
          ? -step
          : event.key === "ArrowRight"
            ? step
            : 0),
      y:
        c.y +
        (event.key === "ArrowUp"
          ? -step
          : event.key === "ArrowDown"
            ? step
            : 0),
    });
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="角色位置"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button
            disabled={enabled && (!valid || !!error)}
            onClick={() => onConfirm(enabled, valid ? centers : {})}
          >
            确认
          </Button>
        </>
      }
    >
      <div className="studio-control-dialog">
        <Field label="定位方式">
          <select
            value={enabled ? "custom" : "auto"}
            onChange={(e) => setEnabled(e.target.value === "custom")}
          >
            <option value="auto">AI 自动</option>
            <option value="custom">自定义</option>
          </select>
        </Field>
        <p className="muted">
          {enabled
            ? "先选择角色，再点按或拖动画布设置位置；数字与角色顺序对应。"
            : "由 AI 安排角色位置。切回自定义可继续编辑已保存的位置。"}
        </p>
        {draft.guidance.action === "infill" && (
          <p className={error ? "error" : "muted"}>
            {error || "聚焦重绘：位置相对于选中的聚焦区域，而非整张原图。"}
          </p>
        )}
        {draft.guidance.action !== "infill" && error && (
          <p className="error">{error}</p>
        )}
        <Field label="当前角色">
          <select
            disabled={!enabled}
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            {characters.map((c) => (
              <option key={c.id} value={c.id}>
                角色 {draft.characters.indexOf(c) + 1} ·{" "}
                {c.prompt.trim().slice(0, 24) || "未填写"}
              </option>
            ))}
          </select>
        </Field>
        <PromptText
          value={characters.find((c) => c.id === selected)?.prompt || ""}
        />
        <div className="position-preview-frame">
          {size && (
            <div
              className="position-canvas"
              data-enabled={enabled}
              style={{
                aspectRatio: `${size.width} / ${size.height}`,
                width: `min(100%, ${(220 * size.width) / size.height}px)`,
              }}
              role="group"
              tabIndex={enabled ? 0 : -1}
              aria-label="角色位置画布，横向从左到右，纵向从上到下；可点按、拖动或使用方向键，也可输入下方百分比"
              onKeyDown={keyboard}
              onPointerDown={(e) => {
                if (!enabled || !e.isPrimary || e.button !== 0) return;
                e.preventDefault();
                e.currentTarget.focus();
                pointer.current = e.pointerId;
                e.currentTarget.setPointerCapture(e.pointerId);
                placePointer(e);
              }}
              onPointerMove={(e) => {
                if (pointer.current === e.pointerId) placePointer(e);
              }}
              onPointerUp={(e) => {
                if (pointer.current === e.pointerId) {
                  placePointer(e);
                  pointer.current = null;
                  e.currentTarget.releasePointerCapture(e.pointerId);
                }
              }}
              onPointerCancel={() => {
                pointer.current = null;
              }}
              onLostPointerCapture={() => {
                pointer.current = null;
              }}
            >
              {[1, 2, 3, 4].map((step) => (
                <span
                  key={step}
                  className="position-gridline"
                  style={{ left: `${step * 20}%` }}
                />
              ))}
              {[1, 2, 3, 4].map((step) => (
                <span
                  key={step}
                  className="position-gridline horizontal"
                  style={{ top: `${step * 20}%` }}
                />
              ))}
              {characters.map((c) => {
                const center = centers[c.id] || initial[c.id];
                return (
                  <span
                    key={c.id}
                    className="position-marker"
                    data-active={enabled && selected === c.id}
                    style={{
                      left: `${center.x * 100}%`,
                      top: `${center.y * 100}%`,
                    }}
                    aria-hidden="true"
                  >
                    {draft.characters.indexOf(c) + 1}
                  </span>
                );
              })}
            </div>
          )}
        </div>
        <div className="form-grid">
          {[0, 1].map((axis) => (
            <Field
              key={axis}
              label={axis === 0 ? "横向（左 → 右 %）" : "纵向（上 → 下 %）"}
            >
              <input
                inputMode="decimal"
                disabled={!enabled}
                value={raw[axis]}
                aria-invalid={!validNumber(raw[axis])}
                onChange={(e) =>
                  setValues((old) => ({
                    ...old,
                    [selected]:
                      axis === 0
                        ? [e.target.value, old[selected][1]]
                        : [old[selected][0], e.target.value],
                  }))
                }
              />
            </Field>
          ))}
        </div>
        <p className="muted">
          {draft.model === "V4_5_FULL"
            ? "V4.5 使用 5×5 网格，位置会吸附到最近格心（10%、30%、50%、70%、90%）。"
            : "V5 支持自由位置，横纵坐标范围均为 0–100%。网格仅供参考。"}
        </p>
        {centers[selected] && (
          <p className="position-effective" aria-live="polite">
            生效位置：横向 {percentText(centers[selected])[0]}% · 纵向{" "}
            {percentText(centers[selected])[1]}%
          </p>
        )}
        {enabled && !valid && (
          <p className="error" role="alert">
            请为每个角色填写 0–100 的有效位置。
          </p>
        )}
        <Button
          variant="secondary"
          disabled={!enabled}
          onClick={() =>
            setValues(
              Object.fromEntries(
                characters.map((c, i) => [
                  c.id,
                  percentText(evenlyPlaced(i, characters.length, draft.model)),
                ]),
              ),
            )
          }
        >
          重置为均匀排列
        </Button>
      </div>
    </Modal>
  );
}
