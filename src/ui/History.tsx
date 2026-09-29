import { useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Search,
  Download,
  Trash2,
  CheckSquare,
  Undo2,
} from "lucide-react";
import { zipSync } from "fflate";
import { useStudio } from "./store";
import { Button, AssetImage, Modal } from "./components/ui";
import { Preview } from "./components/Preview";
import { groupHistory, historyImages } from "../domain/history";
import { assetBlob, deleteHistoryAssets, state, saveState } from "../data/db";
import { bytesOf, download } from "../domain/images";
import type { StudioDraft } from "../domain/types";
type Level = {
  ids: string[] | null;
  query: string;
  date: string;
  title: string;
};
export function History({ onTool }: { onTool: (asset: string) => void }) {
  const s = useStudio(),
    [levels, setLevels] = useState<Level[]>([
      { ids: null, query: "", date: "", title: "全部图片" },
    ]),
    [selected, setSelected] = useState<string[]>([]),
    [selecting, setSelecting] = useState(false),
    [preview, setPreview] = useState<number | null>(null),
    [working, setWorking] = useState(false),
    [deleteTargets, setDeleteTargets] = useState<string[] | null>(null),
    [deleting, setDeleting] = useState(false);
  const deletionLock = useRef(false);
  const level = levels.at(-1)!,
    depth = levels.length - 1,
    mode = s.settings.historyFolds[String(depth)] || "NONE";
  const all = useMemo(() => historyImages(s.history), [s.history]),
    filtered = all.filter(
      (i) =>
        (!level.ids || level.ids.includes(i.asset)) &&
        (!level.query ||
          (
            i.recipe.draft.base +
            " " +
            i.recipe.draft.style +
            " " +
            i.recipe.draft.extra +
            " " +
            i.recipe.draft.characters.map((c) => c.prompt).join(" ")
          )
            .toLowerCase()
            .includes(level.query.toLowerCase())) &&
        (!level.date ||
          new Date(i.recipe.createdAt).toLocaleDateString("en-CA") ===
            level.date),
    );
  const groups = useMemo(
    () => (mode === "NONE" ? [] : groupHistory(filtered, mode)),
    [filtered, mode],
  );
  const chosen = selected.filter((id) => filtered.some((i) => i.asset === id));
  const patch = (v: Partial<Level>) =>
    setLevels((old) => old.map((l, i) => (i === depth ? { ...l, ...v } : l)));
  const toggle = (ids: string[]) =>
    setSelected((old) =>
      ids.every((id) => old.includes(id))
        ? old.filter((id) => !ids.includes(id))
        : [...old, ...ids.filter((id) => !old.includes(id))],
    );
  const confirmDelete = async () => {
    if (!deleteTargets?.length || deletionLock.current) return;
    const targets = new Set(deleteTargets);
    deletionLock.current = true;
    setDeleting(true);
    s.fail("");
    try {
      const count = await deleteHistoryAssets(targets);
      setSelected((old) => old.filter((id) => !targets.has(id)));
      setDeleteTargets(null);
      s.notify(count ? `已删除 ${count} 张历史图片` : "所选图片已不在历史中");
    } catch (e) {
      s.fail(e);
    } finally {
      deletionLock.current = false;
      setDeleting(false);
    }
  };
  const exportSelected = async () => {
    setWorking(true);
    try {
      const records = chosen.length ? chosen : filtered.map((i) => i.asset),
        files: Record<string, Uint8Array> = {};
      let total = 0;
      for (let n = 0; n < records.length; n++) {
        const i = all.find((i) => i.asset === records[n])!;
        const b = await bytesOf(await assetBlob(i.asset));
        total += b.length;
        if (total > 512 * 1024 * 1024)
          throw Error("导出超过 512 MiB，请分批选择");
        files[
          `${new Date(i.recipe.createdAt).toISOString().replace(/[:.]/g, "-")}-${String(n + 1).padStart(4, "0")}.png`
        ] = b;
      }
      download(
        new Blob([new Uint8Array(zipSync(files, { level: 0 }))], {
          type: "application/zip",
        }),
        "ChatBar-images.zip",
      );
    } catch (e) {
      s.fail(e);
    } finally {
      setWorking(false);
    }
  };
  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">YOUR COLLECTION</p>
          <h1>生成历史</h1>
          <p>
            {filtered.length} 张图片 · {level.title}
          </p>
        </div>
        <div className="actions">
          <Button
            variant="ghost"
            onClick={() =>
              state<StudioDraft>("historyApplyUndo")
                .then(async (d) => {
                  if (d) {
                    s.edit(() => d);
                    await saveState("historyApplyUndo", null);
                    s.notify("已恢复应用历史前的草稿");
                  } else s.notify("没有可恢复的草稿");
                })
                .catch(s.fail)
            }
          >
            <Undo2 size={16} />
            撤销历史应用
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setSelecting((v) => !v);
              setSelected([]);
            }}
          >
            <CheckSquare size={16} />
            {selecting ? "完成管理" : "管理历史"}
          </Button>
          <Button
            variant="secondary"
            disabled={working || !filtered.length}
            onClick={exportSelected}
          >
            <Download size={16} />
            {chosen.length ? `导出 ${chosen.length} 张` : "导出当前"}
          </Button>
          {selecting && (
            <Button
              variant="destructive"
              disabled={!chosen.length || deleting || working}
              onClick={() => {
                s.fail("");
                setDeleteTargets([...chosen]);
              }}
            >
              <Trash2 size={16} />
              删除选中 {chosen.length} 张
            </Button>
          )}
        </div>
      </div>
      <div className="toolbar">
        {depth > 0 && (
          <Button
            variant="ghost"
            onClick={() => {
              setLevels((v) => v.slice(0, -1));
              setSelected([]);
            }}
          >
            <ArrowLeft size={16} />
            返回上层
          </Button>
        )}
        <div className="search">
          <Search size={17} />
          <input
            placeholder="搜索提示词"
            value={level.query}
            onChange={(e) => patch({ query: e.target.value })}
          />
        </div>
        <input
          type="date"
          value={level.date}
          onChange={(e) => patch({ date: e.target.value })}
        />
        <select
          value={mode}
          onChange={(e) =>
            s.configure((v) => ({
              ...v,
              historyFolds: {
                ...v.historyFolds,
                [String(depth)]: e.target.value,
              },
            }))
          }
        >
          {[
            ["NONE", "不折叠"],
            ["FULL", "完整提示词"],
            ["CONTENT", "内容"],
            ["BASE", "基础"],
            ["STYLE", "画风"],
            ["DAY", "按日"],
            ["MONTH", "按月"],
            ["YEAR", "按年"],
          ].map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        {selecting && (
          <>
          <span role="status">已选 {chosen.length} / {filtered.length} 张</span>
          <Button
            variant="ghost"
            onClick={() => toggle(filtered.map((i) => i.asset))}
          >
            {filtered.length > 0 && chosen.length === filtered.length ? "取消全选" : "全选当前结果"}
          </Button>
          <Button variant="ghost" disabled={!selected.length} onClick={() => setSelected([])}>
            清空选择
          </Button>
          </>
        )}
      </div>
      <p className="muted">
        {selecting
          ? "点击图片可勾选；点击分组可整组选中。搜索和日期筛选可缩小范围，删除仅针对当前结果中的选中图片。"
          : "打开图片可单张删除；点击「管理历史」可批量选择、导出和删除。"}
      </p>
      {!filtered.length && (
        <div className="empty-collection">
          <h2>这里会留住每一次创作</h2>
          <p>生成的图片和真实参数会一起保存在本机。</p>
        </div>
      )}
      <div className="history-grid">
        {mode === "NONE"
          ? filtered.map((i, index) => (
              <button
                key={i.asset}
                className={
                  "history-tile " + (chosen.includes(i.asset) ? "selected" : "")
                }
                aria-pressed={selecting ? chosen.includes(i.asset) : undefined}
                onClick={() =>
                  selecting ? toggle([i.asset]) : setPreview(index)
                }
              >
                <AssetImage source={i.asset} />
                {selecting && (
                  <span className="selection-badge">
                    {chosen.includes(i.asset)
                      ? chosen.indexOf(i.asset) + 1
                      : "○"}
                  </span>
                )}
                <div>
                  <span>{new Date(i.recipe.createdAt).toLocaleString()}</span>
                  <small>Seed {i.seed}</small>
                </div>
              </button>
            ))
          : groups.map((group) => (
              <button
                className={"history-tile album-tile" + (selecting && group.items.every((i) => chosen.includes(i.asset)) ? " selected" : "")}
                aria-pressed={selecting ? group.items.every((i) => chosen.includes(i.asset)) : undefined}
                key={group.id}
                onClick={() => {
                  if (selecting) toggle(group.items.map((i) => i.asset));
                  else if (group.items.length === 1)
                    setPreview(
                      filtered.findIndex(
                        (i) => i.asset === group.items[0].asset,
                      ),
                    );
                  else {
                    setLevels((v) => [
                      ...v,
                      {
                        ids: group.items.map((i) => i.asset),
                        query: "",
                        date: "",
                        title: group.title,
                      },
                    ]);
                    setSelected([]);
                  }
                }}
              >
                <AssetImage source={group.items[0].asset} />
                <span className="album-count">
                  {selecting
                    ? group.items.filter((i) => chosen.includes(i.asset))
                        .length + " / "
                    : ""}
                  {group.items.length} 张
                </span>
                <div>
                  <span>{group.title}</span>
                </div>
              </button>
            ))}
      </div>
      <Modal
        open={deleteTargets !== null}
        onClose={() => {
          if (!deletionLock.current) setDeleteTargets(null);
        }}
        title="删除历史图片"
        footer={
          <div className="actions">
            <Button variant="secondary" disabled={deleting} onClick={() => setDeleteTargets(null)}>
              取消
            </Button>
            <Button variant="destructive" disabled={deleting} onClick={confirmDelete}>
              <Trash2 size={16} />
              {deleting ? "正在删除…" : "确认删除"}
            </Button>
          </div>
        }
      >
        <p>确定删除选中的 {deleteTargets?.length ?? 0} 张历史图片？删除后无法从历史恢复，请先导出需要保留的图片。</p>
        <p className="muted">已用作参考图的图片和当前草稿不受影响。</p>
      </Modal>
      {preview !== null && (
        <Preview
          images={filtered}
          initial={preview}
          onClose={() => setPreview(null)}
          onTool={onTool}
          onDelete={(asset) => {
            s.fail("");
            setPreview(null);
            setDeleteTargets([asset]);
          }}
        />
      )}
    </section>
  );
}
