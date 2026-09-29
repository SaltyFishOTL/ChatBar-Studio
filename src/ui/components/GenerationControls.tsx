import { useState } from "react";
import { Pencil, SlidersHorizontal, ChevronRight } from "lucide-react";
import { useStudio } from "../store";
import {
  MODELS,
  type GenerationSettings,
  type ImageModel,
  type StudioDraft,
} from "../../domain/types";
import {
  aspectRatios,
  sizeTiers,
  sizeChoice,
  choosePreset,
  chooseCustom,
} from "../../domain/studioControls";
import { effectiveSize } from "../../domain/promptPolicy";
import { Button, Field, NumberField, Toggle } from "./ui";
import { SizeEditor } from "./SizeEditor";

const samplers = [
  ["k_euler_ancestral", "Euler Ancestral"],
  ["k_euler", "Euler"],
  ["k_dpmpp_2s_ancestral", "DPM++ 2S Ancestral"],
  ["k_dpmpp_2m", "DPM++ 2M"],
  ["k_dpmpp_sde", "DPM++ SDE"],
  ["ddim_v3", "DDIM"],
];

export function GenerationControls({ cost }: { cost: string }) {
  const s = useStudio(),
    d = s.draft,
    g = d.perModel[d.model],
    choice = sizeChoice(g);
  const [sizeDraft, setSizeDraft] = useState<StudioDraft | null>(null);
  const change = (
    update: (settings: GenerationSettings) => GenerationSettings,
    key?: string,
  ) =>
    s.edit(
      (v) => ({
        ...v,
        perModel: { ...v.perModel, [v.model]: update(v.perModel[v.model]) },
      }),
      key,
    );
  const setting = (key: keyof GenerationSettings, value: unknown) =>
    change((v) => ({ ...v, [key]: value }), "setting:" + key);
  let sizeLabel: string;
  try {
    const size = effectiveSize(g.width, g.height);
    sizeLabel = `${size.width} × ${size.height}`;
  } catch {
    sizeLabel = "请调整尺寸";
  }
  const confirmSize = (width: number, height: number) => {
    if (!sizeDraft) return;
    try {
      s.edit((v) => {
        const initial = sizeDraft.perModel[sizeDraft.model],
          current = v.perModel[v.model];
        if (
          v.model !== sizeDraft.model ||
          current.width !== initial.width ||
          current.height !== initial.height ||
          JSON.stringify(current.sizeChoice) !==
            JSON.stringify(initial.sizeChoice) ||
          JSON.stringify(v.guidance) !== JSON.stringify(sizeDraft.guidance)
        )
          throw Error("尺寸已在其他操作中改变，请重新打开编辑器");
        return {
          ...v,
          perModel: {
            ...v.perModel,
            [v.model]: chooseCustom(current, width, height),
          },
        };
      });
      setSizeDraft(null);
    } catch (e) {
      s.fail(e);
    }
  };
  return (
    <section className="panel parameters generation-controls">
      <div className="section-heading">
        <h2>生成设置</h2>
        <SlidersHorizontal size={17} />
      </div>
      <Field label="模型">
        <select
          value={d.model}
          onChange={(e) =>
            s.edit((v) => ({ ...v, model: e.target.value as ImageModel }))
          }
        >
          {Object.entries(MODELS).map(([id, m]) => (
            <option key={id} value={id}>
              {m.name}
            </option>
          ))}
        </select>
      </Field>
      <div className="parameter-group" role="group" aria-label="尺寸档">
        <div className="field-heading">
          <span>尺寸档</span>
          {choice.custom && <span className="badge">自定义</span>}
        </div>
        <div className="size-tier-choices">
          {sizeTiers.map((tier) => (
            <button
              type="button"
              className="studio-choice"
              aria-pressed={!choice.custom && choice.tier === tier.id}
              key={tier.id}
              onClick={() =>
                change((v) => choosePreset(v, tier.id, sizeChoice(v).ratio))
              }
            >
              <span>{tier.label}</span>
              <small>{tier.name}</small>
            </button>
          ))}
        </div>
      </div>
      <div className="parameter-group" role="group" aria-label="画面比例">
        <div className="field-heading">
          <span>比例 · {sizeLabel}</span>
        </div>
        <div className="ratio-choice-row">
          <div className="ratio-choices">
            {aspectRatios
              .filter((r) => choice.tier !== "WALLPAPER" || r.id !== "SQUARE")
              .map((r) => (
                <button
                  type="button"
                  className="studio-choice"
                  key={r.id}
                  aria-pressed={!choice.custom && choice.ratio === r.id}
                  onClick={() =>
                    change((v) => choosePreset(v, sizeChoice(v).tier, r.id))
                  }
                >
                  <span
                    className={`ratio-symbol ratio-${r.id.toLowerCase()}`}
                    aria-hidden="true"
                  />
                  <span>{r.label}</span>
                </button>
              ))}
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="编辑自定义尺寸"
            title="自定义尺寸与比例预览"
            onClick={() => setSizeDraft(structuredClone(d))}
          >
            <Pencil size={17} />
          </Button>
        </div>
      </div>
      <div className="parameter-group" role="group" aria-label="每批生成数量">
        <div className="field-heading">
          <span>数量</span>
        </div>
        <div className="count-choices">
          {[1, 2, 3, 4].map((count) => (
            <button
              type="button"
              className="studio-choice"
              key={count}
              aria-pressed={g.count === count}
              onClick={() => setting("count", count)}
            >
              {count}
            </button>
          ))}
        </div>
      </div>
      <details
        className="advanced-generation"
        open={!!d.folds.generationAdvanced}
        onToggle={(e) => {
          const open = e.currentTarget.open;
          if (open !== !!d.folds.generationAdvanced)
            s.edit(
              (v) => ({
                ...v,
                folds: { ...v.folds, generationAdvanced: open },
              }),
              "generationAdvanced",
            );
        }}
      >
        <summary>
          <ChevronRight className="disclosure-icon" size={16} />
          <span>
            <strong>高级设置</strong>
            <small>
              {g.steps} Steps · CFG {g.guidance.toFixed(1)} /{" "}
              {g.cfgRescale.toFixed(2)} ·{" "}
              {samplers.find(([id]) => id === g.sampler)?.[1] || g.sampler} ·{" "}
              {g.seedMode === "RANDOM" ? "随机 Seed" : `Seed ${g.seed}`}
            </small>
          </span>
        </summary>
        <Field label={`Steps · ${g.steps}`}>
          <input
            type="range"
            min={1}
            max={50}
            step={1}
            value={g.steps}
            onChange={(e) => setting("steps", Number(e.target.value))}
          />
        </Field>
        <div className="form-grid">
          <Field label={`CFG Scale · ${g.guidance.toFixed(1)}`}>
            <input
              type="range"
              min={1}
              max={10}
              step={0.1}
              value={g.guidance}
              onChange={(e) => setting("guidance", Number(e.target.value))}
            />
          </Field>
          <Field label={`CFG Rescale · ${g.cfgRescale.toFixed(2)}`}>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={g.cfgRescale}
              onChange={(e) => setting("cfgRescale", Number(e.target.value))}
            />
          </Field>
        </div>
        <Field label="Sampler">
          <select
            value={g.sampler}
            onChange={(e) => setting("sampler", e.target.value)}
          >
            {samplers.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Toggle
          label="随机 Seed"
          checked={g.seedMode === "RANDOM"}
          onChange={(v) => setting("seedMode", v ? "RANDOM" : "FIXED")}
        />
        {g.seedMode === "FIXED" && (
          <>
            <NumberField
              label="Seed"
              value={g.seed}
              min={0}
              max={4294967295 - (g.count - 1)}
              onChange={(v) => setting("seed", v)}
            />
            <small
              className={
                g.seed > 4294967295 - (g.count - 1) ? "error" : "muted"
              }
            >
              0–{4294967295 - (g.count - 1)}
            </small>
          </>
        )}
      </details>
      <div className="generation-continuous">
        <Toggle
          label="连续模式"
          checked={d.continuous}
          onChange={(v) => s.edit((d) => ({ ...d, continuous: v }))}
        />
        {d.continuous && (
          <NumberField
            label="目标图片数"
            value={d.targetCount}
            min={1}
            max={10000}
            onChange={(v) => s.edit((d) => ({ ...d, targetCount: v }))}
          />
        )}
      </div>
      <p className="muted">
        {d.guidance.action === "generate"
          ? "文生图"
          : d.guidance.action === "infill"
            ? "局部重绘"
            : "图生图"}{" "}
        · {cost}
      </p>
      {d.guidance.action !== "generate" && (
        <p className="muted">
          图像引导已启用
          {d.guidance.action === "infill" ? " · 聚焦重绘保留原图尺寸" : ""}
        </p>
      )}
      {d.model === "V5_FULL" && d.guidance.referenceMode !== "none" && (
        <p className="warning">V5 已暂停精确 / 氛围参考，配置仍保留。</p>
      )}
      {sizeDraft && (
        <SizeEditor
          draft={sizeDraft}
          onClose={() => setSizeDraft(null)}
          onConfirm={confirmSize}
        />
      )}
    </section>
  );
}
