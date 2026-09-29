let worker: Worker | undefined,
  id = 0;
const pending = new Map<
  number,
  { resolve: (v: any) => void; reject: (e: Error) => void }
>();
export function raster<T>(type: string, payload: unknown): Promise<T> {
  if (!worker) {
    worker = new Worker(
      new URL("../workers/raster.worker.ts", import.meta.url),
      { type: "module" },
    );
    worker.onmessage = ({ data }) => {
      const p = pending.get(data.id);
      if (p) {
        pending.delete(data.id);
        data.error ? p.reject(Error(data.error)) : p.resolve(data.value);
      }
    };
    worker.onerror = () => {
      for (const p of pending.values()) p.reject(Error("图片处理线程失败"));
      pending.clear();
      worker?.terminate();
      worker = undefined;
    };
  }
  const key = ++id;
  return new Promise((resolve, reject) => {
    pending.set(key, { resolve, reject });
    worker!.postMessage({ id: key, type, payload });
  });
}
