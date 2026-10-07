import { loadHistoryCompact } from "../data/db";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import {
  db,
  state,
  saveDraft,
  saveSettings,
  saveState,
  changes,
  interruptedTask,
  withGenerationLock,
  commitBatch,
} from "../data/db";
import { promptConstants } from "../domain/prompts";
import {
  draftDefaults,
  settingsDefaults,
  type StudioDraft,
  type Settings,
  type StyleCard,
  type Recipe,
  type Account,
} from "../domain/types";
import {
  generate,
  fetchAccount,
  type GenerationProgress,
} from "../api/novelai";
import { attachRecipe } from "../domain/metadata";
import { loadKeys, getKey } from "../data/vault";
type Store = {
  draft: StudioDraft;
  settings: Settings;
  cards: StyleCard[];
  support: Record<string, string>;
  presetNegative: Record<string, boolean>;
  history: Recipe[];
  account: Account | null;
  accountLoading: boolean;
  accountError: string;
  accountUpdatedAt: number | null;
  busy: boolean;
  progress: GenerationProgress | null;
  output: Blob | null;
  unsaved: Blob[];
  error: string;
  notice: string;
  canUndo: boolean;
  canRedo: boolean;
  edit: (fn: (d: StudioDraft) => StudioDraft, key?: string) => void;
  undo: () => void;
  redo: () => void;
  configure: (fn: (s: Settings) => Settings) => void;
  notify: (s: string) => void;
  fail: (e: unknown) => void;
  run: () => Promise<void>;
  stop: () => void;
  refreshAccount: () => Promise<void>;
  applyHistory: (
    r: Recipe,
    seed: number,
    mode: "full" | "random" | "seed",
  ) => Promise<void>;
  runExclusive: <T>(
    kind: string,
    fn: (
      signal: AbortSignal,
      progress: (p: GenerationProgress) => void,
    ) => Promise<T>,
  ) => Promise<T>;
  reload: () => Promise<void>;
  flushSaves: () => Promise<void>;
};
const Context = createContext<Store | null>(null);
export const useStudio = () => useContext(Context)!;
export function StudioProvider({ children }: { children: ReactNode }) {
  const [draft, setDraft] = useState<StudioDraft | null>(null),
    [settings, setSettings] = useState<Settings | null>(null),
    [cards, setCards] = useState<StyleCard[]>([]),
    [support, setSupport] = useState<Record<string, string>>({}),
    [presetNegative, setPresetNegative] = useState<Record<string, boolean>>({}),
    [history, setHistory] = useState<Recipe[]>([]),
    [account, setAccount] = useState<Account | null>(null),
    [accountLoading, setAccountLoading] = useState(false),
    [accountError, setAccountError] = useState(""),
    [accountUpdatedAt, setAccountUpdatedAt] = useState<number | null>(null),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState<GenerationProgress | null>(null),
    [output, setOutput] = useState<Blob | null>(null),
    [unsaved, setUnsaved] = useState<Blob[]>([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [tick, setTick] = useState(0);
  const current = useRef<StudioDraft | null>(null),
    config = useRef<Settings | null>(null),
    preset = useRef<StyleCard[]>([]),
    undoStack = useRef<StudioDraft[]>([]),
    redoStack = useRef<StudioDraft[]>([]),
    lastEdit = useRef({ key: "", at: 0 }),
    controller = useRef<AbortController | null>(null),
    saveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const accountRequest = useRef<{
    controller: AbortController;
    promise: Promise<void>;
  } | null>(null);
  const fail = (e: unknown) =>
    setError(e instanceof Error ? e.message : String(e));
  const notify = (s: string) => {
    setNotice(s);
    setError("");
  };
  const enqueue = (fn: () => Promise<unknown>) => {
    saveQueue.current = saveQueue.current
      .catch(() => {})
      .then(fn)
      .catch(fail);
  };
  const flushSaves = async () => {
    await saveQueue.current;
    if (!current.current || !config.current) throw Error("本机工作室尚未就绪");
    // Re-save the latest state: the normal edit queue reports failures without rejecting.
    // Here persistence errors must reject so an update cannot discard unsaved edits.
    await saveDraft(current.current);
    await saveSettings(config.current);
  };
  const reload = async () => {
    const d = await db;
    await loadKeys().catch(fail);
    const [personal, records] = await Promise.all([
      d.getAll("cards"),
      loadHistoryCompact(),
    ]);
    setCards([
      ...preset.current,
      ...personal.sort((a, b) => b.updatedAt - a.updatedAt),
    ]);
    setHistory(records);
  };
  useEffect(() => {
    let active = true;
    (async () => {
      const p = await promptConstants(),
        negative = p.DEFAULT_CHARACTER_NAI_NEGATIVE_PROMPT;
      const r = await fetch("/data/styles.json");
      if (!r.ok) throw Error("预置画风卡加载失败");
      const data = await r.json();
      const metadataResponse = await fetch("/data/style-metadata.json");
      if (!metadataResponse.ok) throw Error("预置画风负面词标识加载失败");
      const metadata = await metadataResponse.json();
      if (
        !metadata ||
        typeof metadata !== "object" ||
        Array.isArray(metadata) ||
        data.cards.some(
          (card: StyleCard) => typeof metadata[card.id] !== "boolean",
        )
      )
        throw Error("预置画风负面词标识不完整，请刷新资源后重试");
      preset.current = data.cards;
      const s =
          (await state<Settings>("settings")) || settingsDefaults(negative),
        d =
          (await state<StudioDraft>("draft")) ||
          draftDefaults(s.defaultNegative);
      s.translate = s.translate ?? true;
      await loadKeys().catch(fail);
      if (!active) return;
      current.current = d;
      config.current = s;
      setDraft(d);
      setSettings(s);
      setSupport(data.support);
      setPresetNegative(metadata);
      await reload();
      if ((await state("vault")) && !(await state("credentials")))
        notify(
          "旧版加密保存的 Key 需重新填写一次；以后自动保存在本机，无需口令。",
        );
      const task = await interruptedTask();
      if (task)
        notify("上次任务已中断或结果未知，未自动重发；已保存结果仍在历史中。");
    })().catch(fail);
    const onChange = () => reload().catch(fail);
    changes.addEventListener("change", onChange);
    return () => {
      active = false;
      changes.removeEventListener("change", onChange);
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = settings?.theme || "light";
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute(
        "content",
        settings?.theme === "dark" ? "#0f1110" : "#fcfdfc",
      );
  }, [settings?.theme]);
  const publish = (d: StudioDraft) => {
    current.current = d;
    setDraft(d);
    enqueue(() => saveDraft(d));
  };
  const edit = (fn: (d: StudioDraft) => StudioDraft, key = "") => {
    const prev = current.current;
    if (!prev) return;
    const next = fn(structuredClone(prev));
    if (JSON.stringify(prev) === JSON.stringify(next)) return;
    if (
      !key ||
      key !== lastEdit.current.key ||
      Date.now() - lastEdit.current.at > 1200
    ) {
      undoStack.current.push(structuredClone(prev));
      if (undoStack.current.length > 80) undoStack.current.shift();
    }
    lastEdit.current = { key, at: Date.now() };
    redoStack.current = [];
    publish({ ...next, revision: prev.revision + 1 });
    setTick((t) => t + 1);
  };
  const undo = () => {
    const prev = undoStack.current.pop();
    if (prev && current.current) {
      redoStack.current.push(current.current);
      publish({ ...prev, revision: current.current.revision + 1 });
      lastEdit.current = { key: "", at: 0 };
      setTick((t) => t + 1);
    }
  };
  const redo = () => {
    const next = redoStack.current.pop();
    if (next && current.current) {
      undoStack.current.push(current.current);
      publish({ ...next, revision: current.current.revision + 1 });
      lastEdit.current = { key: "", at: 0 };
      setTick((t) => t + 1);
    }
  };
  const configure = (fn: (s: Settings) => Settings) => {
    if (!config.current) return;
    const next = fn(structuredClone(config.current));
    config.current = next;
    setSettings(next);
    enqueue(() => saveSettings(next));
  };
  const refreshAccount = useCallback((): Promise<void> => {
    if (accountRequest.current) return accountRequest.current.promise;
    const cfg = config.current;
    const key = getKey("novelai");
    if (!cfg || !key) {
      setAccount(null);
      setAccountUpdatedAt(null);
      return Promise.resolve();
    }
    const ctrl = new AbortController();
    setAccountLoading(true);
    setAccountError("");
    const promise = (async () => {
      const timeout = setTimeout(
        () => ctrl.abort(Error("额度查询超时")),
        20000,
      );
      try {
        const next = await fetchAccount(cfg, ctrl.signal);
        if (
          accountRequest.current?.controller === ctrl &&
          getKey("novelai") === key &&
          config.current?.novelAiUrl === cfg.novelAiUrl
        ) {
          setAccount(next);
          setAccountUpdatedAt(Date.now());
        }
      } catch (e) {
        if (accountRequest.current?.controller === ctrl)
          setAccountError(e instanceof Error ? e.message : "额度查询失败");
      } finally {
        clearTimeout(timeout);
        if (accountRequest.current?.controller === ctrl) {
          accountRequest.current = null;
          setAccountLoading(false);
        }
      }
    })();
    accountRequest.current = { controller: ctrl, promise };
    return promise;
  }, []);
  const naiKey = getKey("novelai");
  useEffect(() => {
    accountRequest.current?.controller.abort();
    accountRequest.current = null;
    setAccount(null);
    setAccountUpdatedAt(null);
    setAccountError("");
    setAccountLoading(false);
    if (!naiKey || !settings?.novelAiUrl) return;
    const update = () => {
      if (document.visibilityState === "visible" && navigator.onLine)
        void refreshAccount();
    };
    const initial = setTimeout(update, 700);
    const timer = setInterval(update, 30000);
    document.addEventListener("visibilitychange", update);
    window.addEventListener("online", update);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("online", update);
      accountRequest.current?.controller.abort();
      accountRequest.current = null;
    };
  }, [naiKey, settings?.novelAiUrl, refreshAccount]);
  async function runExclusive<T>(
    kind: string,
    fn: (
      signal: AbortSignal,
      progress: (p: GenerationProgress) => void,
    ) => Promise<T>,
  ): Promise<T> {
    if (controller.current) throw Error("已有任务正在运行");
    const ctrl = new AbortController();
    controller.current = ctrl;
    setBusy(true);
    setError("");
    setProgress({ message: kind });
    try {
      return await withGenerationLock(kind, () => fn(ctrl.signal, setProgress));
    } finally {
      controller.current = null;
      setBusy(false);
      setProgress(null);
      void refreshAccount();
    }
  }
  const run = async () => {
    if (!current.current || !config.current) return;
    const snapshot = structuredClone(current.current),
      cfg = structuredClone(config.current);
    try {
      await runExclusive("生图", async (signal, update) => {
        let total = 0;
        const target = snapshot.continuous
          ? Math.max(1, Math.floor(snapshot.targetCount))
          : snapshot.perModel[snapshot.model].count;
        if (!Number.isFinite(target)) throw Error("目标数量无效");
        while (total < target) {
          signal.throwIfAborted();
          const count = Math.min(
            snapshot.perModel[snapshot.model].count,
            target - total,
          );
          const result = await generate(
            snapshot,
            cfg,
            signal,
            (p) => {
              update({
                ...p,
                message: snapshot.continuous
                  ? `${total}/${target} 张 · ${p.message}`
                  : p.message,
              });
              if (p.preview) setOutput(p.preview);
            },
            count,
          );
          setUnsaved(result.images);
          setOutput(result.images[0]);
          const images = await Promise.all(
            result.images.map((blob, i) =>
              attachRecipe(blob, snapshot, result.seed + i),
            ),
          );
          setOutput(images[0]);
          setUnsaved(images);
          const historyDraft = structuredClone(result.draft);
          Object.assign(historyDraft.perModel[historyDraft.model], {
            count,
            seed: result.seed,
            seedMode: "FIXED",
          });
          const requiredSourceMissing = false;
          const request = structuredClone(result.request) as any;
          delete request.parameters.image;
          delete request.parameters.mask;
          const recipe: Recipe = {
            id: crypto.randomUUID(),
            createdAt: Date.now(),
            draft: historyDraft,
            images: images.map((_, i) => ({
              asset: crypto.randomUUID(),
              seed: result.seed + i,
            })),
            request,
            requiredSourceMissing,
          };
          await commitBatch(recipe, images);
          void refreshAccount();
          setUnsaved([]);
          total += images.length;
          update({ message: `已保存 ${total}/${target} 张` });
        }
        notify(`已生成并保存 ${total} 张图片`);
      });
      await refreshAccount();
    } catch (e) {
      if ((e as Error)?.name === "AbortError")
        notify("已停止；之前保存的图片仍在历史中。");
      else fail(e);
    }
  };
  const stop = () =>
    controller.current?.abort(new DOMException("已停止", "AbortError"));
  const applyHistory = async (
    r: Recipe,
    seed: number,
    mode: "full" | "random" | "seed",
  ) => {
    if (!current.current) return;
    if (mode !== "seed" && r.requiredSourceMissing)
      throw Error("此配方缺少原始基图，请先从图片工具重新配置图像引导");
    await saveState("historyApplyUndo", current.current);
    edit((d) => {
      if (mode === "seed") {
        d.perModel[d.model].seedMode = "FIXED";
        d.perModel[d.model].seed = seed;
        return d;
      }
      const restored = structuredClone(r.draft);
      restored.continuous = d.continuous;
      restored.targetCount = d.targetCount;
      restored.perModel[restored.model].seedMode =
        mode === "random" ? "RANDOM" : "FIXED";
      restored.perModel[restored.model].seed = seed;
      return restored;
    });
    notify(mode === "seed" ? "已应用 Seed" : "已应用历史配方");
  };
  if (!draft || !settings)
    return (
      <div className="boot">
        <h1>ChatBar Studio</h1>
        <p>{error || "正在加载本机工作室…"}</p>
        {error && <button onClick={() => location.reload()}>重试</button>}
      </div>
    );
  return (
    <Context.Provider
      value={{
        draft,
        settings,
        cards,
        support,
        presetNegative,
        history,
        account,
        accountLoading,
        accountError,
        accountUpdatedAt,
        busy,
        progress,
        output,
        unsaved,
        error,
        notice,
        canUndo: undoStack.current.length > 0,
        canRedo: redoStack.current.length > 0,
        edit,
        undo,
        redo,
        configure,
        notify,
        fail,
        run,
        stop,
        refreshAccount,
        applyHistory,
        runExclusive,
        reload,
        flushSaves,
      }}
    >
      {children}
    </Context.Provider>
  );
}
