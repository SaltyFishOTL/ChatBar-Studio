## 更新内容

- 首次发布独立网页版 ChatBar Studio，从 ChatChatBar 生图工作室迁移，支持桌面、手机和平板响应式布局。
- 提供画风卡、示例头像、分段提示词、Tag 预测、翻译、完整法典与独立 AI 设计对话。
- 提供图像引导、图像工具、Enhance/Upscale、历史分组、单张及批量删除、图片导出和本机备份。
- 支持自带 NovelAI 和兼容 LLM API、模型检索、本机保存 Key、积分额度显示与离线缓存。
- 采用 GPLv3 开源，允许商用和修改；分发衍生版本须按 GPLv3 提供相应源码。

## 下载与运行

- `ChatBar-Studio-v0.1.0-web.zip`：已构建网页、静态服务与许可文件。解压后安装 Node.js 22+，在解压目录运行 `node server.mjs`，打开 http://localhost:8080/ 。无须安装 npm 依赖。
- GitHub 自动提供的 Source code：完整可构建源码，运行 `npm ci`、`npm run build`、`npm start`。
- `SHA256SUMS.txt`：网页包校验值。

关联原项目：https://github.com/SaltyFishOTL/ChatChatBar

## 预览版边界

类型检查与生产构建通过；未执行自动化测试、真实付费 API 调用或完整跨浏览器操作验收。官方端点的跨域直连仍需在使用环境核实。GitHub 发布不包含托管网站，AI Studio / Cloud Run 部署方法见仓库 `docs/DEPLOY.md`。

数据与 Key 仅保存在使用者当前浏览器；普通备份排除 Key。第三方资源遵循各自许可，不因本项目 GPLv3 而自动获得统一授权。
