# AI Studio 与 Cloud Run 发布

## 当前交付

生产构建产物位于 `dist/`；`Dockerfile` 可构建纯静态资源服务。未创建线上服务，未取得线上网址。当前机器未安装 gcloud，尚未指定 Google Cloud 项目和区域。

## AI Studio 管理

1. 使用独立仓库 [SaltyFishOTL/ChatBar-Studio](https://github.com/SaltyFishOTL/ChatBar-Studio)，保留 `public/data/` 完整资源。不要上传 `node_modules/` 或个人备份。
2. 在 Google AI Studio 的 Build 输入区点击 **+ → Import from GitHub**，选择该仓库。
3. 保留本项目的用户自带 API 架构。无需 `GEMINI_API_KEY`，不要让生成器添加服务端 Gemini 转发、云数据库或共享 API Key。
4. 安装使用 `npm ci`，预览使用 `npm run dev -- --host 0.0.0.0`。生产命令为 `npm run build`、`npm start`。
5. 设置 GitHub 双向同步后再编辑；发布选择 Cloud Run，指定自己的 Cloud 项目。
6. 在正式 HTTPS 域名完成连接诊断。开发域名允许跨域不代表生产域名也允许。

依据：[Google AI Studio Build 官方文档](https://ai.google.dev/gemini-api/docs/aistudio-build-mode)，2026-09-28 查阅。该文档说明 GitHub 导入、双向同步和 Cloud Run 发布。

## 直接从源码部署

已安装 gcloud、登录并选好项目时，在本目录执行以下命令；占位符需替换为实际项目与区域。

```powershell
gcloud run deploy chatbar-studio --source . --project YOUR_PROJECT_ID --region YOUR_REGION --allow-unauthenticated
```

Cloud Run 服务公开提供网页，但模型请求仍由每位用户的浏览器直连。静态服务不使用用户 Key，不设置模型 API 环境变量。`Dockerfile` 使用多阶段构建，不把参考源码、工具或本机数据部署为网页资源。

## 发布验收

- 地址使用 HTTPS，首次加载与 PWA 更新正常。
- 词库、索引、分词器、示例图资源能完整下载；失败显示错误。
- 用户配置的端点需允许本站 Origin、Authorization、Content-Type 和 NovelAI 的 x-correlation-id。
- 官方服务若不允许跨域，纯前端无法绕过。由用户明确配置自己的 HTTPS 服务，不使用公共代理。
- Cloud Run 只处理网页资源请求；不添加 `/api` 转发入口。
- 本机数据按域名隔离；更换访问域名前，先导出 ZIP，再在新域名导入。

本次没有触发真实生图、LLM、Vibe 编码或后处理请求。
