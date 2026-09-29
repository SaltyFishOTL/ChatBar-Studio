import { useEffect, useState } from "react";
import { ArrowLeftRight } from "lucide-react";
import type { StudioDraft } from "../../domain/types";
import { assetBlob } from "../../data/db";
import { dimensions } from "../../domain/images";
import { effectiveSize } from "../../domain/promptPolicy";
import { customSizeError } from "../../domain/studioControls";
import { Button, Field, Modal } from "./ui";

export function useInpaintCanvas(draft: StudioDraft) {
  const [state, setState] = useState<{
    size?: { width: number; height: number };
    error?: string;
  }>({});
  useEffect(() => {
    let active = true;
    setState({});
    if (draft.guidance.action !== "infill") return;
    if (!draft.guidance.base) {
      setState({ error: "请先设置聚焦重绘基图" });
      return;
    }
    assetBlob(draft.guidance.base)
      .then(dimensions)
      .then((size) => {
        if (active) setState({ size });
      })
      .catch((e) => {
        if (active)
          setState({ error: e instanceof Error ? e.message : "基图加载失败" });
      });
    return () => {
      active = false;
    };
  }, [draft.guidance.action, draft.guidance.base]);
  return state;
}

export function RatioPreview({
  size,
  label,
}: {
  size: { width: number; height: number };
  label: string;
}) {
  return (
    <div className="size-ratio-preview" role="img" aria-label={label}>
      <svg viewBox="0 0 320 128" aria-hidden="true">
        {(() => {
          const scale = Math.min(304 / size.width, 112 / size.height),
            w = size.width * scale,
            h = size.height * scale;
          return (
            <rect x={(320 - w) / 2} y={(128 - h) / 2} width={w} height={h} />
          );
        })()}
      </svg>
    </div>
  );
}
export function SizeEditor({
  draft,
  onClose,
  onConfirm,
}: {
  draft: StudioDraft;
  onClose: () => void;
  onConfirm: (width: number, height: number) => void;
}) {
  const settings = draft.perModel[draft.model];
  const [width, setWidth] = useState(String(settings.width));
  const [height, setHeight] = useState(String(settings.height));
  const source = useInpaintCanvas(draft);
  const error = customSizeError(width, height);
  const inpaint = draft.guidance.action === "infill";
  const preview = inpaint
    ? source.size
    : error
      ? undefined
      : effectiveSize(Number(width), Number(height));
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  const divisor = preview ? gcd(preview.width, preview.height) : 1;
  const label = preview
    ? `${preview.width} × ${preview.height} · ${preview.width / divisor}:${preview.height / divisor}`
    : "";
  return (
    <Modal
      open
      onClose={onClose}
      title="自定义尺寸"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button
            disabled={!!error}
            onClick={() => onConfirm(Number(width), Number(height))}
          >
            确认
          </Button>
        </>
      }
    >
      <div className="studio-control-dialog">
        <div className="form-grid">
          <Field label="宽度（px）">
            <input
              inputMode="numeric"
              value={width}
              onChange={(e) => setWidth(e.target.value)}
              aria-invalid={!!error}
            />
          </Field>
          <Field label="高度（px）">
            <input
              inputMode="numeric"
              value={height}
              onChange={(e) => setHeight(e.target.value)}
              aria-invalid={!!error}
            />
          </Field>
        </div>
        <Button
          variant="secondary"
          onClick={() => {
            setWidth(height);
            setHeight(width);
          }}
        >
          <ArrowLeftRight size={16} />
          交换宽高
        </Button>
        <p className="muted">
          宽高 64–2048 px，按最近的 64 像素倍数规整；总像素不超过 3,145,728。
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {inpaint && (
          <p className={source.error ? "error" : "muted"}>
            {source.error || "聚焦重绘保留原图尺寸；上方宽高用于普通生图。"}
          </p>
        )}
        {preview && (
          <>
            <p>
              {inpaint ? "聚焦重绘最终画布" : "最终尺寸"} · {label}
            </p>
            <RatioPreview size={preview} label={`最终生图比例预览：${label}`} />
          </>
        )}
        {inpaint && !source.size && !source.error && (
          <p role="status">正在读取原图尺寸…</p>
        )}
      </div>
    </Modal>
  );
}
