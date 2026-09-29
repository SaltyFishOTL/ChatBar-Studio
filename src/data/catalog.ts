import type { Candidate, CodexEntry, StudioDraft } from "../domain/types";
let worker: Worker | undefined,
  seq = 0;
const pending = new Map<
  number,
  {
    resolve: (v: any) => void;
    reject: (e: Error) => void;
    partial?: (v: any) => void;
  }
>();
function getWorker() {
  if (!worker) {
    worker = new Worker(
      new URL("../workers/catalog.worker.ts", import.meta.url),
      { type: "module" },
    );
    worker.onmessage = ({ data }) => {
      const p = pending.get(data.id);
      if (!p) return;
      if (data.error) {
        p.reject(Error(data.error));
        pending.delete(data.id);
      } else if (data.done) {
        p.resolve(data.value);
        pending.delete(data.id);
      } else p.partial?.(data.value);
    };
    worker.onerror = () => {
      for (const p of pending.values()) p.reject(Error("词库工作线程启动失败"));
      pending.clear();
      worker?.terminate();
      worker = undefined;
    };
  }
  return worker;
}
export function rpc<T>(
  type: string,
  payload: unknown,
  partial?: (v: any) => void,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const cancel = () => {
      getWorker().postMessage({ id, type: "cancel" });
      pending.delete(id);
      reject(new DOMException("已停止", "AbortError"));
    };
    pending.set(id, {
      resolve: (v) => {
        signal?.removeEventListener("abort", cancel);
        resolve(v);
      },
      reject: (e) => {
        signal?.removeEventListener("abort", cancel);
        reject(e);
      },
      partial,
    });
    signal?.addEventListener("abort", cancel, { once: true });
    getWorker().postMessage({ id, type, payload });
  });
}
export async function searchTags(
  query: string,
  update: (rows: Candidate[]) => void,
  signal?: AbortSignal,
) {
  const rows = new Map<string, Candidate>();
  await rpc(
    "search",
    query,
    (items: Candidate[]) => {
      for (const c of items) {
        const old = rows.get(c.name.toLowerCase());
        if (!old || (old.dictionary && !c.dictionary))
          rows.set(c.name.toLowerCase(), c);
      }
      update(
        [...rows.values()].sort(
          (a, b) =>
            Number(a.dictionary) - Number(b.dictionary) ||
            (a.dictionary
              ? a.name.localeCompare(b.name)
              : b.count - a.count || a.name.localeCompare(b.name)),
        ),
      );
    },
    signal,
  );
}
export const countTokens = (d: StudioDraft, signal?: AbortSignal) =>
  rpc<{ positive: number; negative: number }>("tokens", d, undefined, signal);
export const translateLocal = (
  terms: { lookup: string; natural: boolean }[],
  signal?: AbortSignal,
) => rpc<Record<string, string>>("translate", terms, undefined, signal);
export const researchTags = (
  queries: string[],
  signal?: AbortSignal,
  warning?: (message: string) => void,
) => rpc<Candidate[]>("research", queries, warning, signal);
export const recallCodex = (
  queries: string[],
  scene: string,
  signal?: AbortSignal,
) => rpc<CodexEntry[]>("codex", { queries, scene }, undefined, signal);
