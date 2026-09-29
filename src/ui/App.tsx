import { useCallback, useEffect, useRef, useState } from "react";
import {
  Image,
  Palette,
  Bot,
  History as HistoryIcon,
  Settings,
  Wrench,
  Menu,
  X,
  CircleHelp,
  BookOpen,
  RefreshCw,
} from "lucide-react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { useStudio } from "./store";
import { Button, Modal } from "./components/ui";
import { Studio } from "./Studio";
import { Styles } from "./Styles";
import { SettingsPage } from "./Settings";
import { Design } from "./Design";
import { History } from "./History";
import { ToolsPage } from "./Tools";
import { Library } from "./Library";
const pages = [
  ["studio", "工作室", Image],
  ["styles", "画风卡", Palette],
  ["design", "AI 设计", Bot],
  ["library", "Tag 与法典", BookOpen],
  ["history", "历史记录", HistoryIcon],
  ["tools", "图像工具", Wrench],
  ["settings", "设置", Settings],
] as const;
function isVersionNewer(remote?: string | null, local?: string | null): boolean {
  if (!remote || !local || remote === local) return false;
  const remoteTime = Date.parse(remote);
  const localTime = Date.parse(local);
  if (!Number.isNaN(remoteTime) && !Number.isNaN(localTime)) {
    return remoteTime > localTime;
  }
  return false;
}

export function App() {
  const s = useStudio(),
    [page, setPage] = useState("studio"),
    [menu, setMenu] = useState(false),
    [help, setHelp] = useState(false),
    [toolAsset, setToolAsset] = useState("");
  const registration = useRef<ServiceWorkerRegistration | undefined>(undefined);
  const checkingRef = useRef(false);
  const [checking, setChecking] = useState(false);
  const [updateError, setUpdateError] = useState("");
  const [serviceOffline, setServiceOffline] = useState(false);
  const [available, setAvailable] = useState(false);
  const buildId = import.meta.env.VITE_STUDIO_BUILD as string;
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    immediate: true,
    onRegisteredSW(_url, value) {
      registration.current = value;
    },
    onNeedRefresh() {
      void checkRef.current(false);
    },
    onRegisterError() {
      if (!import.meta.env.DEV) {
        setUpdateError("离线更新组件加载失败，请检查网页服务后重试。");
      }
    },
  });
  const checkUpdate = useCallback(
    async (manual = false) => {
      if (checkingRef.current) return;
      checkingRef.current = true;
      setChecking(true);
      setUpdateError("");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      let serverResponded = false;
      try {
        const response = await fetch("/version.json", {
          cache: "no-store",
          headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
          signal: controller.signal,
        });
        if (!response.ok) throw Error("版本信息暂不可用");
        const contentType = response.headers.get("content-type") || "";
        if (!contentType.includes("application/json")) {
          throw Error("版本信息格式无效");
        }
        const version = await response.json();
        if (typeof version.buildId !== "string")
          throw Error("版本信息格式无效");
        serverResponded = true;
        setServiceOffline(false);

        const hasNewer = isVersionNewer(version.buildId, buildId);
        setAvailable(hasNewer);

        if (!hasNewer) {
          // 当前版本较新或一致，不显示刷新提示
          setNeedRefresh(false);
          if ("serviceWorker" in navigator) {
            const current =
              registration.current ||
              (await navigator.serviceWorker.getRegistration());
            if (current?.waiting) {
              current.waiting.postMessage({ type: "SKIP_WAITING" });
            }
          }
          if (manual) s.notify("当前已是最新界面");
        } else {
          // 远端确有更新版本
          if ("serviceWorker" in navigator) {
            const current =
              registration.current ||
              (await navigator.serviceWorker.getRegistration());
            registration.current = current;
            if (current) {
              await current.update();
              if (current.waiting) setNeedRefresh(true);
            }
          }
        }
      } catch {
        setServiceOffline(!serverResponded);
        if (manual) {
          setUpdateError(
            serverResponded
              ? "网页服务已连接，但检查更新失败，请重试。"
              : "未能连接网页更新服务，当前可能仍是离线缓存。恢复服务后点击检查更新。",
          );
        }
      } finally {
        clearTimeout(timer);
        checkingRef.current = false;
        setChecking(false);
      }
    },
    [buildId, setNeedRefresh, s.notify],
  );
  const checkRef = useRef(checkUpdate);
  checkRef.current = checkUpdate;
  useEffect(() => {
    const check = () => {
      if (document.visibilityState === "visible") void checkRef.current();
    };
    const first = setTimeout(check, 500);
    const interval = setInterval(check, 60000);
    window.addEventListener("online", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      clearTimeout(first);
      clearInterval(interval);
      window.removeEventListener("online", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);
  const navigate = (next: string) => {
    setPage(next);
    setMenu(false);
  };
  const onTool = (asset: string) => {
    setToolAsset(asset);
    navigate("tools");
  };
  return (
    <div className="app-shell">
      <header className="mobile-header">
        <button className="brand" onClick={() => navigate("studio")}>
          <img src="/icon.png" alt="" />
          <span>
            ChatBar <em>Studio</em>
          </span>
        </button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="导航菜单"
          onClick={() => setMenu((v) => !v)}
        >
          {menu ? <X /> : <Menu />}
        </Button>
      </header>
      <aside className={"sidebar " + (menu ? "open" : "")}>
        <button className="brand" onClick={() => navigate("studio")}>
          <img src="/icon.png" alt="" />
          <span>
            ChatBar <em>Studio</em>
          </span>
        </button>
        <div className="sidebar-label">WORKSPACE</div>
        <nav>
          {pages.map(([id, name, Icon]) => (
            <button
              key={id}
              className={"nav-item " + (page === id ? "active" : "")}
              onClick={() => navigate(id)}
              aria-label={name}
              aria-current={page === id ? "page" : undefined}
              title={name}
            >
              <Icon size={19} />
              <span>{name}</span>
              {id === "studio" && s.busy && <i className="activity-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-badge">
            <i />
            本机工作室<small>你的数据，由你保管</small>
          </div>
          <Button variant="ghost" onClick={() => setHelp(true)}>
            <CircleHelp size={16} />
            使用指南
          </Button>
          {!import.meta.env.DEV && (
            <>
              <Button
                variant="ghost"
                disabled={checking}
                onClick={() => void checkUpdate(true)}
              >
                <RefreshCw size={16} />
                {checking ? "正在检查…" : "检查更新"}
              </Button>
              <small className="build-version" title={buildId}>
                界面版本 · {new Date(buildId).toLocaleString()}
              </small>
            </>
          )}
        </div>
      </aside>
      {menu && (
        <div className="mobile-backdrop" onClick={() => setMenu(false)} />
      )}
      <main className="main-content">
        {s.error && (
          <div className="banner banner-error" role="alert">
            <span>{s.error}</span>
            <button aria-label="关闭错误" onClick={() => s.fail("")}>
              <X size={16} />
            </button>
          </div>
        )}
        {!s.error && s.notice && (
          <div className="banner" role="status">
            <span>{s.notice}</span>
            <button aria-label="关闭提示" onClick={() => s.notify("")}>
              <X size={16} />
            </button>
          </div>
        )}
        {updateError && (
          <div className="banner banner-error" role="status">
            <span>{updateError}</span>
            <Button
              variant="secondary"
              size="sm"
              disabled={checking}
              onClick={() => void checkUpdate(true)}
            >
              检查更新
            </Button>
          </div>
        )}
        {available && !serviceOffline && (
          <div className="banner">
            <span>
              {needRefresh
                ? "新版界面已就绪。保存当前编辑后点击刷新更新，本机数据会保留。"
                : "检测到新版界面，正在准备更新…"}
            </span>
            <Button
              variant="secondary"
              size="sm"
              disabled={s.busy}
              onClick={async () => {
                setUpdateError("");
                try {
                  if (registration.current?.waiting) {
                    registration.current.waiting.postMessage({
                      type: "SKIP_WAITING",
                    });
                  }
                  await updateServiceWorker(true);
                } catch {
                  // ignore
                }
                setNeedRefresh(false);
                setAvailable(false);
                setTimeout(() => {
                  window.location.reload();
                }, 200);
              }}
            >
              刷新更新
            </Button>
          </div>
        )}
        {page === "studio" && <Studio navigate={navigate} onTool={onTool} />}
        {page === "styles" && <Styles />}
        {page === "library" && <Library />}
        {page === "design" && <Design onApply={() => navigate("studio")} />}
        {page === "history" && <History onTool={onTool} />}
        {page === "tools" && (
          <ToolsPage
            initialAsset={toolAsset}
            onApply={() => navigate("studio")}
          />
        )}
        {page === "settings" && <SettingsPage />}
      </main>
      <Modal open={help} onClose={() => setHelp(false)} title="使用指南">
        <div className="help-content">
          <h3>第一次使用</h3>
          <ol>
            <li>在设置中填写 NovelAI Token、LLM 地址与 Key，选择设计模型。</li>
            <li>选择预置画风卡，在工作室填写基础场景，或打开 AI 设计。</li>
            <li>检查模型、尺寸、数量与费用估算，然后生成。</li>
          </ol>
          <h3>画风卡</h3>
          <p>
            预置卡可复制为个人画风。设置统一的画风测试提示词后，点击个人卡的星光按钮生成示例头像。填入画风只替换画风段。
          </p>
          <h3>提示词与 Tag</h3>
          <p>
            输入时按光标位置检索完整 Tag
            库与词典。点击候选替换当前片段，保留光标后文本。翻译按钮开启中文注释；全屏编辑确认后才写回。
          </p>
          <h3>局部重绘</h3>
          <p>
            导入基图，选择局部重绘，再拖出焦点区域。八个边角手柄用于调整范围；单指画笔涂抹、双指平移缩放。空蒙版表示重绘区域内扣除上下文边界后的内容。
          </p>
          <h3>历史</h3>
          <p>
            按提示词或日期折叠成相册，点击相册进入下一层。选择模式可批量导出或删除。打开图片可复现、仅用
            Seed、转参考图或进入工具。
          </p>
          <h3>本机数据与后台限制</h3>
          <p>
            页面关闭、断网、锁屏后不保证继续生成；重新打开不会自动重发。定期导出
            ZIP 备份。API 跨域失败时，可设置你自己的 HTTPS
            代理地址，本站不会转发凭据。
          </p>
          <h3>隐私</h3>
          <p>
            提示词和图片只发送给你配置的服务。本机保存的 API Key
            自动保存在当前浏览器，无需口令；不上传到网页服务器，也不包含在备份中。
          </p>
          <h3>相关链接</h3>
          <div style={{ display: "flex", gap: "10px", marginTop: "10px" }}>
            <a
              href="https://github.com/SaltyFishOTL/ChatBar-Studio"
              target="_blank"
              rel="noopener noreferrer"
              className="button button-secondary button-sm"
            >
              开源项目 GitHub
            </a>
            <a
              href="https://github.com/SaltyFishOTL/ChatChatBar"
              target="_blank"
              rel="noopener noreferrer"
              className="button button-secondary button-sm"
            >
              ChatChatBar APP
            </a>
          </div>
        </div>
      </Modal>
    </div>
  );
}
