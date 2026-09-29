# ChatBar Studio

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![ChatChatBar](https://img.shields.io/badge/Related-ChatChatBar-181717)](https://github.com/SaltyFishOTL/ChatChatBar)

独立网页版生图工作室。React、TypeScript、Vite，采用 Radix / shadcn 组件模式和响应式设计。数据保存在当前浏览器的 IndexedDB 中。

从 [ChatChatBar Android APP](https://github.com/SaltyFishOTL/ChatChatBar) 的生图工作室迁移，作为同作者的独立配套项目维护；保留画风、提示词设计与图像工作流。此仓库不是原项目的完整 fork，不包含聊天、朋友圈和社区模块。

源码：[SaltyFishOTL/ChatBar-Studio](https://github.com/SaltyFishOTL/ChatBar-Studio) · 下载：[Releases](https://github.com/SaltyFishOTL/ChatBar-Studio/releases)

当前为 **v0.1.0 预览版**。发布到 GitHub 不代表已部署可在线使用的网站；可按下方步骤本机运行，或部署至自己的静态站点 / Cloud Run。

## 启动

需要 Node.js 22 或更新版本。首次运行：

```powershell
npm ci
npm run dev -- --host 127.0.0.1
```

打开终端显示的网址。生产版本：

```powershell
npm run build
npm start
```

默认生产端口为 8080，Cloud Run 使用 `PORT` 环境变量。

## 功能入口

- **工作室**：画风、基础、补充、角色正负面、基础负面编辑，模型参数、Tag 预测、Token 计数、图像引导和连续生成。
- **画风卡**：25 张预置及示例图，个人卡管理、导入导出、统一测试画面头像生成。
- **AI 设计**：独立对话、场景规划、完整 Tag/法典检索、结构校验、候选预览、修改分支、附件与明确应用。
- **Tag 与法典**：完整 Tag、词典检索和法典原文浏览。
- **历史记录**：提示词/日期分组、搜索、批量导出删除、配方复现、Seed、转参考图。
- **图像工具**：PNG 元数据选择性导入、反推、马赛克、旋转、APNG、Enhance、Upscale、前后对比和结果保存。
- **设置**：NovelAI、多个 OpenAI 兼容 LLM、自定义参数、本机凭据、备份与存储占用。

## 数据与请求

浏览器直接请求用户配置的 HTTPS 服务。静态服务器只提供网页文件，不接收模型请求或 API Key。按用户要求，Key 填写后直接保存在本机 IndexedDB，刷新后自动读取，无需口令；ZIP 备份不包含凭据。设置可清除本机 Key。旧版加密保存的 Key 需重新填写一次，旧密文保留到用户清除凭据。

首次搜索、翻译、分词会下载完整资源，之后由 PWA 缓存。离线可使用已缓存的编辑器、词库和历史，生成需要联网。页面关闭或锁屏后不保证请求继续，不自动重发可能收费的请求。

## 迁移与验证状态

Android 基线：`148b3a9637eadf577afbb4947158dd6f80e17f4f`，开始时工作区干净；Enhance/Upscale 包含在基线中。资源和相关源码哈希见 `reference/baseline.json`。

类型检查和生产构建已执行；真实 API、浏览器交互、故障注入和跨平台验收尚未执行。官方 NovelAI 匿名 OPTIONS 请求在当前网络超时，不能将其解释为 CORS 拒绝，也不能宣称直连已验证。

- [迁移对照与边界](docs/PARITY.md)
- [发布到 AI Studio / Cloud Run](docs/DEPLOY.md)
- [手工验收清单](docs/ACCEPTANCE.md)
- [当前交接状态](docs/HANDOFF.md)

不包含聊天、朋友圈、社区。网页 ZIP 是独立格式，不是 Android 存档。

## 资源来源

预置画风、示例图、法典及提示词沿用 ChatBar 基线内容。第三方数据来源与许可边界见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)，词库原始声明保留在 `public/data/licenses/`。

## 开源协议

本仓库作者拥有权利的代码采用 **GNU GPL v3.0 only**，完整条款见 [LICENSE](LICENSE)。允许使用、修改、商用和分发；分发本程序或其衍生版本时，须按 GPLv3 提供相应源码并保留许可与版权声明。个人私下修改无需主动公开。

Copyright (C) 2026 SaltyFishOTL and ChatBar Studio contributors. This program is distributed without any warranty; see the GNU General Public License version 3 for details.

第三方依赖、数据、模型资源及素材遵循各自声明，本协议不替代其许可；也不改变原 ChatChatBar 仓库的许可状态。
