import { PromptFields } from "./PromptText";
import { useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Share2,
  ZoomIn,
  ZoomOut,
  Trash2,
} from "lucide-react";
import { Modal, Button, AssetImage } from "./ui";
import { type HistoryImage } from "../../domain/history";
import { useStudio } from "../store";
import { assetBlob, putAsset } from "../../data/db";
import { download, shareImage } from "../../domain/images";
export function Preview({
  images,
  initial,
  onClose,
  onTool,
  onDelete,
}: {
  images: HistoryImage[];
  initial: number;
  onClose: () => void;
  onTool: (asset: string) => void;
  onDelete?: (asset: string) => void;
}) {
  const s = useStudio(),
    [index, setIndex] = useState(initial),
    [zoom, setZoom] = useState(1),
    [showMeta, setShowMeta] = useState(false),
    image = images[Math.min(index, images.length - 1)];
  if (!image) return null;
  const useAs = async (mode: "img2img" | "infill" | "precise" | "vibe") => {
    try {
      const id = await putAsset(await assetBlob(image.asset));
      s.edit((d) => {
        if (mode === "img2img" || mode === "infill")
          d.guidance = {
            ...d.guidance,
            base: id,
            mask: "",
            focus: undefined,
            action: mode,
          };
        else if (mode === "precise")
          d.guidance = { ...d.guidance, precise: id, referenceMode: "precise" };
        else {
          if (d.guidance.vibes.length >= 16) throw Error("最多 16 个 Vibe");
          d.guidance = {
            ...d.guidance,
            referenceMode: "vibe",
            vibes: [
              ...d.guidance.vibes,
              { asset: id, strength: 0.6, information: 1 },
            ],
          };
        }
        return d;
      });
      s.notify("已复制至图像引导，请打开编辑器配置");
      onClose();
    } catch (e) {
      s.fail(e);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={`图片 ${index + 1} / ${images.length}`}
      wide
    >
      <div
        className="preview-stage"
        onWheel={(e) =>
          setZoom((v) =>
            Math.max(0.25, Math.min(6, v + (e.deltaY < 0 ? 0.1 : -0.1))),
          )
        }
      >
        <div style={{ width: `${zoom * 100}%` }}>
          <AssetImage source={image.asset} />
        </div>
      </div>
      <div className="toolbar">
        <div className="actions">
          <Button
            variant="ghost"
            size="icon"
            disabled={index === 0}
            onClick={() => {
              setIndex((i) => i - 1);
              setZoom(1);
            }}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            disabled={index === images.length - 1}
            onClick={() => {
              setIndex((i) => i + 1);
              setZoom(1);
            }}
          >
            <ChevronRight />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setZoom((v) => Math.min(6, v + 0.25))}
          >
            <ZoomIn size={17} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setZoom((v) => Math.max(0.25, v - 0.25))}
          >
            <ZoomOut size={17} />
          </Button>
        </div>
        <div className="actions">
          {onDelete && (
            <Button variant="destructive" onClick={() => onDelete(image.asset)}>
              <Trash2 size={16} />
              删除这张图片
            </Button>
          )}
          <Button
            variant="secondary"
            onClick={() =>
              assetBlob(image.asset)
                .then((b) => download(b, `ChatBar-${image.seed}.png`))
                .catch(s.fail)
            }
          >
            <Download size={16} />
            下载
          </Button>
          <Button
            variant="ghost"
            onClick={() =>
              assetBlob(image.asset)
                .then((b) => shareImage(b))
                .catch(s.fail)
            }
          >
            <Share2 size={16} />
            分享
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              onTool(image.asset);
              onClose();
            }}
          >
            图片工具
          </Button>
        </div>
      </div>
      <div className="actions">
        <Button
          variant="secondary"
          onClick={() =>
            s
              .applyHistory(image.recipe, image.seed, "full")
              .then(onClose)
              .catch(s.fail)
          }
        >
          完整复现
        </Button>
        <Button
          variant="ghost"
          onClick={() =>
            s
              .applyHistory(image.recipe, image.seed, "random")
              .then(onClose)
              .catch(s.fail)
          }
        >
          应用配方 · 新 Seed
        </Button>
        <Button
          variant="ghost"
          onClick={() =>
            s
              .applyHistory(image.recipe, image.seed, "seed")
              .then(onClose)
              .catch(s.fail)
          }
        >
          仅 Seed
        </Button>
        <select
          defaultValue=""
          onChange={(e) => {
            if (e.target.value) useAs(e.target.value as any);
            e.target.value = "";
          }}
        >
          <option value="">用作…</option>
          <option value="img2img">图生图基图</option>
          <option value="infill">局部重绘基图</option>
          <option value="precise">精确参考</option>
          <option value="vibe">氛围参考</option>
        </select>
        <Button variant="ghost" onClick={() => setShowMeta((v) => !v)}>
          配方详情
        </Button>
      </div>
      {showMeta && (
        <>
          <PromptFields
            fields={[
              ["画风", image.recipe.draft.style],
              ["基础 Prompt", image.recipe.draft.base],
              ["补充 Prompt", image.recipe.draft.extra],
              ["负面 Prompt", image.recipe.draft.negative],
              ...image.recipe.draft.characters.flatMap(
                (c, i): [string, string][] => [
                  [
                    `角色 ${i + 1}${c.enabled === false ? " · 已停用" : ""}`,
                    c.prompt,
                  ],
                  [`角色 ${i + 1} 负面`, c.negative],
                ],
              ),
            ]}
          />
          <details>
            <summary>原始配方</summary>
            <pre className="json-view">
              {JSON.stringify(
                {
                  seed: image.seed,
                  model: image.recipe.draft.model,
                  style: image.recipe.draft.style,
                  base: image.recipe.draft.base,
                  extra: image.recipe.draft.extra,
                  negative: image.recipe.draft.negative,
                  characters: image.recipe.draft.characters,
                  settings:
                    image.recipe.draft.perModel[image.recipe.draft.model],
                },
                null,
                2,
              )}
            </pre>
          </details>
        </>
      )}
    </Modal>
  );
}
