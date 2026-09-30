/** Explicit user action only. Background SW events must never call this function. */
export async function activateStudioUpdate(
  registered?: ServiceWorkerRegistration,
): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const workers = navigator.serviceWorker;
  const registration = registered || (await workers.getRegistration());
  const expectedUrl = new URL("/sw.js", window.location.href).href;
  const target = registration?.waiting || registration?.installing;
  if (!target) {
    // No pending worker: a normal document reload also covers non-PWA browsers
    // and a worker already activated by another tab.
    if (workers.controller && workers.controller.scriptURL !== expectedUrl) {
      throw Error(
        "页面由其他离线组件控制，更新未执行。请关闭本站页面后重新打开。",
      );
    }
    return;
  }
  if (target.scriptURL !== expectedUrl) {
    throw Error("检测到其他离线组件，更新未执行。请关闭本站页面后重新打开。");
  }
  await new Promise<void>((resolve, reject) => {
    let sent = false;
    const finish = (error?: Error) => {
      clearTimeout(timer);
      workers.removeEventListener("controllerchange", check);
      target.removeEventListener("statechange", check);
      if (error) reject(error);
      else resolve();
    };
    const check = () => {
      if (
        workers.controller === target ||
        (!workers.controller && target.state === "activated")
      ) {
        finish();
      } else if (target.state === "redundant") {
        finish(Error("新版离线组件激活失败，当前页面已保留，请重试。"));
      } else if (target.state === "installed" && !sent) {
        sent = true;
        try {
          target.postMessage({ type: "SKIP_WAITING" });
        } catch {
          finish(Error("无法激活新版界面，当前页面已保留，请重试。"));
        }
      }
    };
    // Timeout reports failure; it never forces a reload or leaves a reload listener behind.
    const timer = setTimeout(
      () => finish(Error("更新准备超时，当前页面已保留，请重试。")),
      12000,
    );
    workers.addEventListener("controllerchange", check);
    target.addEventListener("statechange", check);
    check();
  });
}
