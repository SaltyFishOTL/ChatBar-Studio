import { useEffect, useState } from "react";
import { Plus, Trash2, Download, Upload, ChevronRight } from "lucide-react";
import { useStudio } from "./store";
import { Button, Field, NumberField, Toggle, Modal } from "./components/ui";
import { getKey, setKey, forgetKeys } from "../data/vault";
import {
  exportBackup,
  stageBackup,
  restoreBackup,
  type StagedBackup,
} from "../data/backup";
import { download } from "../domain/images";
import { ModelIdPicker } from "./components/ModelIdPicker";
import { PromptEditor } from "./components/PromptEditor";
import { diagnoseConnection } from "../api/http";
import type { ModelConfig } from "../domain/types";
export type SettingsFocus = "novelai-key" | "style-preview-prompt";
export function SettingsPage({
  focusTarget,
}: { focusTarget?: SettingsFocus } = {}) {
  const s = useStudio(),
    [tick, setTick] = useState(0),
    [staged, setStaged] = useState<StagedBackup | null>(null),
    [storage, setStorage] = useState<StorageEstimate | null>(null),
    [referencesText, setReferencesText] = useState(() =>
      s.settings.characterReferences
        .map((r) => r.name + " | " + r.prompt)
        .join("\n"),
    ),
    [working, setWorking] = useState(false);
  useEffect(() => {
    navigator.storage?.estimate().then(setStorage);
  }, []);
  useEffect(() => {
    if (!focusTarget) return;
    const frame = requestAnimationFrame(() => {
      const field = document.getElementById(focusTarget);
      field?.scrollIntoView({ block: "center" });
      field?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusTarget]);
  const patch = (key: string, value: unknown) =>
    s.configure((v) => ({ ...v, [key]: value }));
  const work = async (fn: () => Promise<void>) => {
    if (working) return;
    setWorking(true);
    try {
      await fn();
    } catch (e) {
      s.fail(e);
    } finally {
      setWorking(false);
    }
  };
  const addModel = () =>
    s.configure((v) => {
      const model: ModelConfig = {
        id: crypto.randomUUID(),
        name: "新模型",
        baseUrl: "https://api.openai.com/v1",
        model: "",
        isMultimodal: false,
        visionModelId: "",
        reasoningEffort: "",
        thinking: "default",
        maxTokens: null,
        outputTokenParameter: "max_tokens",
        supportsJsonMode: false,
        customParams: {},
      };
      return {
        ...v,
        models: [...v.models, model],
        designModelId: v.designModelId || model.id,
      };
    });
  return (
    <section className="page settings-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">YOUR WORKSPACE</p>
          <h1>设置</h1>
          <p>API 由浏览器直连，数据保存在这台设备。</p>
        </div>
      </div>
      <section className="panel">
        <h2>NovelAI</h2>
        <div className="form-grid">
          <Field label="API 地址" hint="填写官方地址或你自己的 HTTPS 代理地址">
            <input
              value={s.settings.novelAiUrl}
              onChange={(e) => patch("novelAiUrl", e.target.value)}
              type="url"
            />
          </Field>
          <Field
            label="NovelAI Token"
            hint="自动保存在当前浏览器，无需口令；不包含在备份中"
          >
            <input
              key={tick}
              id="novelai-key"
              type="password"
              autoComplete="off"
              defaultValue={getKey("novelai")}
              onChange={(e) => {
                void setKey("novelai", e.target.value).catch(s.fail);
              }}
            />
          </Field>
        </div>
        <Button
          variant="ghost"
          disabled={working}
          onClick={() =>
            work(async () =>
              s.notify(
                await diagnoseConnection(
                  s.settings.novelAiUrl,
                  "/user/subscription",
                ),
              ),
            )
          }
        >
          匿名连接诊断（不发 Key）
        </Button>
        <Button variant="secondary" onClick={() => s.refreshAccount()}>
          查询账户 / 检查连接
        </Button>
        {s.account && (
          <p>
            余额 {s.account.anlas} Anlas
            {s.account.percent !== null &&
              ` · V5 约 ${s.account.exhausted ? 0 : Math.round(s.account.percent * 17.3)} 张`}
          </p>
        )}
        <div className="field">
          <PromptEditor
            label="画风测试提示词"
            id="style-preview-prompt"
            rows={4}
            value={s.settings.stylePreviewTestPrompt}
            onChange={(value) => patch("stylePreviewTestPrompt", value)}
            translate={s.settings.translate}
            placeholder="填写固定主体、动作或场景，用于比较画风"
          />
          <small>
            生成画风卡头像时：卡片画风＋此处测试内容；不使用工作室当前场景
          </small>
        </div>
        <div className="field">
          <PromptEditor
            label="默认负面提示词"
            rows={3}
            value={s.settings.defaultNegative}
            onChange={(value) => patch("defaultNegative", value)}
            translate={s.settings.translate}
          />
        </div>
      </section>
      <section className="panel">
        <div className="section-heading">
          <h2>LLM 模型</h2>
          <Button variant="secondary" onClick={addModel}>
            <Plus size={16} />
            添加模型
          </Button>
        </div>
        <p className="muted">
          支持 OpenAI 兼容接口。设计、检索规划和修复沿用所选模型配置。
        </p>
        {s.settings.models.map((model) => (
          <ModelEditor
            key={model.id + ":" + tick}
            model={model}
            onChange={(next) =>
              s.configure((v) => ({
                ...v,
                models: v.models.map((m) => (m.id === next.id ? next : m)),
              }))
            }
            onDelete={async () => {
              if (confirm("删除此模型配置？")) {
                try {
                  await setKey(model.id, "");
                } catch (e) {
                  s.fail(e);
                  return;
                }
                s.configure((v) => ({
                  ...v,
                  models: v.models.filter((m) => m.id !== model.id),
                  designModelId:
                    v.designModelId === model.id ? "" : v.designModelId,
                }));
              }
            }}
          />
        ))}
        <Field label="默认设计模型">
          <select
            value={s.settings.designModelId}
            onChange={(e) => patch("designModelId", e.target.value)}
          >
            <option value="">选择模型</option>
            {s.settings.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="AI 设计全局额外要求">
          <textarea
            rows={3}
            value={s.settings.extraRequirement}
            onChange={(e) => patch("extraRequirement", e.target.value)}
          />
        </Field>
        <Field
          label="角色参考文本"
          hint="每行：名称 | 角色提示词；只作为候选参考，不会自动增加画面人物"
        >
          <textarea
            rows={4}
            value={referencesText}
            onChange={(e) => {
              setReferencesText(e.target.value);
              patch(
                "characterReferences",
                e.target.value.split("\n").map((line) => {
                  const i = line.indexOf("|");
                  return {
                    name: i < 0 ? line : line.slice(0, i).trim(),
                    prompt: i < 0 ? "" : line.slice(i + 1).trim(),
                  };
                }),
              );
            }}
          />
        </Field>
      </section>
      <section className="panel">
        <h2>本机凭据</h2>
        <p className="muted">
          Key
          填写后自动保存在当前浏览器，刷新或重新打开时自动读取，无需加密口令。不上传到网页服务器，不包含在备份中；调用时只发送给你配置的
          API 服务。
        </p>
        <div className="actions">
          <Button
            variant="ghost"
            disabled={working}
            onClick={() =>
              work(async () => {
                await forgetKeys();
                setTick((t) => t + 1);
                s.notify("已清除保存的凭据");
              })
            }
          >
            清除本机 Key
          </Button>
        </div>
      </section>
      <section className="panel">
        <h2>工作室偏好</h2>
        <Toggle
          label="提示词中文注释"
          checked={s.settings.translate}
          onChange={(v) => patch("translate", v)}
        />
        <Toggle
          label="复制正面提示词时忽略画风"
          checked={s.settings.copyIgnoreStyle}
          onChange={(v) => patch("copyIgnoreStyle", v)}
        />
        <Toggle
          label="深色外观"
          checked={s.settings.theme === "dark"}
          onChange={(v) => patch("theme", v ? "dark" : "light")}
        />
      </section>
      <section className="panel">
        <h2>数据与备份</h2>
        <p className="muted">
          {storage
            ? `本机已用 ${(Number(storage.usage || 0) / 1048576).toFixed(1)} MiB，浏览器配额约 ${(Number(storage.quota || 0) / 1073741824).toFixed(1)} GiB`
            : "正在读取存储信息…"}
        </p>
        <div className="actions">
          <Button
            variant="secondary"
            disabled={working || s.busy}
            onClick={() =>
              work(async () =>
                download(
                  await exportBackup(),
                  "ChatBar-Studio-" +
                    new Date().toISOString().slice(0, 10) +
                    ".zip",
                ),
              )
            }
          >
            <Download size={16} />
            导出完整备份
          </Button>
          <label className="button button-secondary">
            <Upload size={16} />
            导入备份
            <input
              type="file"
              hidden
              disabled={working || s.busy}
              accept=".zip"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) work(async () => setStaged(await stageBackup(f)));
                e.target.value = "";
              }}
            />
          </label>
          <Button
            variant="ghost"
            onClick={() =>
              navigator.storage
                .persist()
                .then((v) =>
                  s.notify(
                    v
                      ? "浏览器已授予持久存储"
                      : "浏览器未授予持久存储，请定期备份",
                  ),
                )
                .catch(s.fail)
            }
          >
            申请持久存储
          </Button>
        </div>
        <p className="muted">
          备份不含 API Key；清理浏览器数据会删除本机工作室。
        </p>
      </section>
      <Modal
        open={!!staged}
        onClose={() => setStaged(null)}
        title="替换本机工作室"
      >
        {staged && (
          <>
            <p>
              备份包含 {staged.cards.length} 张个人画风卡、
              {staged.history.length} 批历史、{staged.conversations.length}{" "}
              个设计对话、{staged.assets.length} 个图片资源。
            </p>
            <p>确认后整体替换当前工作室数据。请先导出当前备份。</p>
            <div className="actions">
              <Button variant="secondary" onClick={() => setStaged(null)}>
                取消
              </Button>
              <Button
                variant="destructive"
                disabled={working}
                onClick={() =>
                  work(async () => {
                    await restoreBackup(staged);
                    location.reload();
                  })
                }
              >
                确认替换
              </Button>
            </div>
          </>
        )}
      </Modal>
    </section>
  );
}
function ModelEditor({
  model,
  onChange,
  onDelete,
}: {
  model: ModelConfig;
  onChange: (m: ModelConfig) => void;
  onDelete: () => void;
}) {
  const s = useStudio(),
    [credentialRevision, setCredentialRevision] = useState(0),
    [params, setParams] = useState(JSON.stringify(model.customParams, null, 2)),
    [paramError, setParamError] = useState("");
  const patch = (key: string, value: unknown) =>
    onChange({ ...model, [key]: value });
  return (
    <details className="model-editor" open>
      <summary>
        <ChevronRight
          className="disclosure-icon"
          size={16}
          aria-hidden="true"
        />
        {model.name}
        <button
          className="icon-button"
          aria-label="删除模型"
          onClick={(e) => {
            e.preventDefault();
            onDelete();
          }}
        >
          <Trash2 size={15} />
        </button>
      </summary>
      <div className="form-grid">
        <Field label="显示名称">
          <input
            value={model.name}
            onChange={(e) => patch("name", e.target.value)}
          />
        </Field>
        <Field label="Base URL">
          <input
            type="url"
            value={model.baseUrl}
            onChange={(e) => {
              patch("baseUrl", e.target.value);
            }}
          />
        </Field>
        <Field label="API Key" hint="自动保存在当前浏览器，无需口令">
          <input
            type="password"
            autoComplete="off"
            defaultValue={getKey(model.id)}
            onChange={(e) => {
              void setKey(model.id, e.target.value).catch(s.fail);
              setCredentialRevision((v) => v + 1);
            }}
          />
        </Field>
        <ModelIdPicker
          key={`${model.id}:${model.baseUrl}:${credentialRevision}`}
          model={model}
          onSelect={(id, fromList) =>
            onChange({
              ...model,
              model: id,
              name: fromList && !model.name.trim() ? id : model.name,
            })
          }
        />
      </div>
      <div className="form-grid">
        <Field label="思考强度">
          <select
            value={model.reasoningEffort}
            onChange={(e) => patch("reasoningEffort", e.target.value)}
          >
            {["", "none", "minimal", "low", "medium", "high", "xhigh"].map(
              (v) => (
                <option key={v} value={v}>
                  {v || "不发送"}
                </option>
              ),
            )}
          </select>
        </Field>
        <Field label="旧式思考开关">
          <select
            value={model.thinking}
            onChange={(e) => patch("thinking", e.target.value)}
          >
            <option value="default">不发送</option>
            <option value="on">开启</option>
            <option value="off">关闭</option>
          </select>
        </Field>
        <Field label="输出上限（留空不限制）">
          <input
            type="number"
            min={1}
            value={model.maxTokens ?? ""}
            onChange={(e) =>
              patch("maxTokens", e.target.value ? Number(e.target.value) : null)
            }
          />
        </Field>
        <Field label="输出上限参数名">
          <select
            value={model.outputTokenParameter}
            onChange={(e) => patch("outputTokenParameter", e.target.value)}
          >
            <option>max_tokens</option>
            <option>max_completion_tokens</option>
          </select>
        </Field>
      </div>
      <Toggle
        label="支持图片输入"
        checked={model.isMultimodal}
        onChange={(v) => patch("isMultimodal", v)}
      />
      <Toggle
        label="明确支持 JSON Mode"
        checked={model.supportsJsonMode}
        onChange={(v) => patch("supportsJsonMode", v)}
      />
      {!model.isMultimodal && (
        <Field label="关联视觉模型">
          <select
            value={model.visionModelId}
            onChange={(e) => patch("visionModelId", e.target.value)}
          >
            <option value="">未设置</option>
            {s.settings.models
              .filter((m) => m.id !== model.id && m.isMultimodal)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
          </select>
        </Field>
      )}
      <Field label="自定义参数 JSON">
        <textarea
          rows={3}
          value={params}
          onChange={(e) => {
            setParams(e.target.value);
            try {
              const value = JSON.parse(e.target.value);
              if (!value || Array.isArray(value) || typeof value !== "object")
                throw Error("需要 JSON 对象");
              patch("customParams", value);
              setParamError("");
            } catch {
              setParamError("JSON 格式无效，尚未保存");
            }
          }}
        />
      </Field>
      {paramError && <p className="error">{paramError}</p>}
    </details>
  );
}
