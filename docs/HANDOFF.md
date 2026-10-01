# ChatBar Studio 当前状态

目标：独立网页完整迁移 Android 生图工作室，画风卡替代角色卡。Android 不修改。

## 基线

- Android HEAD：148b3a9637eadf577afbb4947158dd6f80e17f4f，实施开始工作区干净，Enhance/Upscale 已包含。
- `reference/baseline.json` 记录源文件哈希；`reference/android/` 保留业务参考。
- 当前流程复核使用 `reference/current-parity.json` 与 `reference/current-android/`，通过 `tools/import_android.py <Android目录> --refresh` 更新，不覆盖初始基线。2026-09-29：完整法典、Tag 词库、词典和分词器共 9 个源资源哈希一致；源码对照不等同于实际调用验收。
- 25 张预置卡、图片、完整词典/索引/分词器和法典已迁入 `public/data/`。

## 已落地

- React/TypeScript/Vite 工程、响应式界面、本机 IndexedDB、独立 API 配置。用户已明确改为 Key 直接本机保存：`state.credentials` 自动持久化，无口令，不进入备份；旧 `state.vault` 无法无口令解密，提示重填，清除凭据时一并删除。
- 画风卡管理/头像、分段编辑、生图请求及流解析、历史、设计对话、检索与分词 Worker。
- 历史删除改用页面内确认窗口，避免依赖内嵌浏览器原生 confirm；确认目标快照、重复点击互斥、事务完成后提示实际删除数，失败保留选择以便重试。只改动命中的历史条目，保留草稿/参考资源。交互验收待执行。
- 图片历史提供明确「管理历史」入口、已选数量、全选当前结果/取消全选、清空选择和批量删除；预览提供「删除这张图片」，复用同一确认与事务流程。分组支持整组选中，搜索/日期限制删除范围；工作室输出预览不显示历史删除入口。
- 提示词翻译统一由 `usePromptTranslation`、`PromptAnnotations` 与 `PromptText/PromptFields` 提供：工作室/全屏/设置/角色参考编辑器、画风预览、AI 设计及附件、反推结果、图片元数据、历史配方、法典与角色位置均接入同一全局开关。默认关闭保留 APP 规则，导航与提示词栏均有明确开关；中文下标提高对比度，查询失败保留成功项并提示原因，取消和旧响应不覆盖新内容；原文/复制/请求不变。`tools/test-prompt-assistance.mjs` 14 项离线 Chromium 回归通过（合成 SQL 词库、分词/设计夹具，未调用付费 API）。
- 生成按钮直接显示随模型、张数、参数和账户变化的费用估算（含 Vibe 额外费用提示）；按钮正上方常驻 APP 同规格正/负 Token 进度条，V4.5 512、V5 1471，85% 警告、超限红色，计数失败可见且不阻止生图。账户摘要仍在固定操作栏，前台每 30 秒、联网/前台恢复及任务结束刷新；失败保留旧余额并标识。
- 生成设置按 APP 拆成尺寸档、比例、1–4 张按钮；高级设置摘要展开 Steps/CFG 滑块、Sampler、随机 Seed。尺寸编辑器可交换宽高、预览最终比例，确认一次保存、取消不写入。角色位置改为独立编号画布、AI 自动/自定义、百分比、均匀排列；V4.5 网格吸附、V5 自由位置，与请求共用规范化规则。新组件在 `ui/components/GenerationControls.tsx`、`SizeEditor.tsx`、`CharacterPositionEditor.tsx`，规则在 `domain/studioControls.ts`。`GenerationSettings.sizeChoice` 仅保存可选界面选择状态；旧草稿按宽高识别，无存储迁移。
- 角色提示词删除按钮左侧提供折叠/展开：`Character.enabled` 缺省视为启用。停用角色保留正负面、位置、顺序，随草稿/历史/撤销/备份保存；请求、Token、角色上限、位置编辑和附加当前设计只读取 `activeCharacters`。已通过 11 项离线 Chromium 回归，含真实按钮、撤销/重做、刷新、历史恢复、位置过滤和两模型请求；没有付费调用。
- 图片角色 Prompt 导入支持关/覆盖/新增，默认覆盖。`MetadataSections.characters` 使用 off/replace/append；新增保留原角色 ID、折叠状态和位置，末尾追加新的独立角色；仍可整次撤销。数量校验按实际目标模型和启用角色计算，失败不替换草稿。两端编译及网页构建通过；新增导入离线 Chromium 回归 7 项通过，角色折叠关联回归 11 项通过；Android 导入、位置、折叠回归共 14 项通过。
- 图像引导编辑、聚焦重绘、Precise/Vibe、元数据、Enhance/Upscale、APNG、ZIP 备份。
- 图片元数据读取支持 PNG 文本块与 alpha LSB `stealth_pngcomp`/`stealth_pnginfo`：优先有效文件 Comment，缺失/无效时读取透明度；不混合冲突来源的 Source/配方。`domain/stealthAlpha.ts` 按列提取、校验长度并限制解压为 8 MiB；仅读取，不上传或改写原图。`tests/metadata-stealth.ts` 合成样本覆盖压缩/原文、字符串/对象 Comment、文件块兼容、损坏数据及隐私清理；`test-metadata-import.mjs` 18 项通过，真实导入使用仅透明度元数据图，关联隐私回归 18 项通过。
- 图片隐私导出由 `domain/imagePrivacy.ts` 统一负责：去元数据处理当前结果或原图，马赛克/旋转完成不再附回原文元数据；整图 RGB/alpha 最低位归一化后直接编码新 PNG，清除透明像素 RGB，保留尺寸和透明端点。动画拒绝静态清理；失败保留旧结果并报错。旧版结果需重新处理，APNG 伪装不等于清理。
- PWA、静态资源服务器、Cloud Run Dockerfile。
- PWA 后台轮询只检查版本，不发送 SKIP_WAITING；useRegisterSW.onNeedReload 覆盖默认刷新，平台/其他标签页接管不触发导航。仅用户点击「刷新更新」后等待草稿与设置落盘、目标 /sw.js 接管，再单次刷新；生图、AI 设计和未保存图片阻止更新，激活失败或超时保留当前页。更新期间暂禁页面操作。侧栏保留版本时间与检查更新，version.json 不加入离线缓存。入口为 ui/App.tsx、ui/studioUpdate.ts、store.flushSaves。普通刷新可能仍打开旧离线版本；不要仅凭构建成功声称预览或线上已更新。后台不闪屏与跨标签页行为仍待浏览器验收。
- PC Studio（宽度 ≥1100px）采用三栏：左侧独立滚动的提示词/设置，底部固定积分与生成操作；中央自适应大图与图片工具；右侧完整历史纵向滚动。导航收窄为图标栏，帮助/更新入口保留。PromptEditor 的 `desktopGrow` 仅在工作室桌面启用：至少六行，随内容/宽度/翻译行距增高与收缩，窄屏恢复原输入框。历史按配方 ID+图片 ID 选中，历史刷新不串图；保存按钮下载正在展示的历史图片。主题沿用现有设计；手机保持单列与固定生成栏。`tools/test-studio-layout.mjs` 9 项离线 Chromium 检查通过（1280/1440/1920 桌面、390px 手机、输入伸缩、翻译行距、35+ 历史、选图下载及预览）；角色折叠关联 11 项通过。
- 模型 ID 支持手填及检索选择：当前 API `/models`、多关键词、系列筛选、A–Z/Z–A、当前项置顶、刷新/重试。地址或 Key 变化销毁旧列表并取消旧请求；刷新失败保留旧列表，关闭窗口取消请求。
- 画风库与工作室选择器支持 V4.5/V5 筛选，BOTH 和未限定模型的个人卡均可见；`style-metadata.json` 从 Android 原预置提取独立负面词存在标识，选卡不写入负面文本。
- 头像生成放在编辑框上传按钮旁，缺 Token/测试词时打开设置并聚焦对应字段，保留编辑内容。生成/上传头像先留在编辑器，保存时与画风卡事务提交；取消、关闭、版本冲突或删除均不会覆盖旧头像。
- 独立公开 GitHub 仓库：`https://github.com/SaltyFishOTL/ChatBar-Studio`，关联原项目 `SaltyFishOTL/ChatChatBar`。初始开发分支 `codex/studio-web`，发布主分支 `main`；首版 `v0.1.0` 按预览版交付。发布规范见 `.agents/skills/studio-web-release/SKILL.md`，发布说明见 `docs/RELEASE-v0.1.0.md`，网页包由 `tools/package_release.py` 生成到忽略目录 `release/`。
- 用户已选择 GPLv3（`GPL-3.0-only`）。根目录 `LICENSE` 为官方全文；第三方依赖与数据保留各自许可，边界在 `THIRD_PARTY_NOTICES.md`。README、网页侧栏和仓库主页关联 ChatChatBar；不改变 Android 仓库的许可或代码。
- 类型检查和生产构建通过。图片隐私修复已通过 18 项获准的离线 Chromium 回归，覆盖四种 stealth 格式及损坏头、透明度、PNG/WebP/JPEG、动画/损坏输入拒绝、真实马赛克/旋转/去元数据按钮和下载字节；其他功能不能由此推定验收通过。

## 已核对的关键规则

- Vibe 归一化、按需编码与配方编码快照；历史保留基图和蒙版资源引用。
- 当前 APP 原始提示词常量与动态首轮/修改轮文本已对照；修正首轮对话包装、图片理解参数、图片附件与反推区分、场景消息角色、法典先于 Tag 的证据顺序、初轮证据继承/附件清空、检索规划兼容解析及 6/8/24 检索上限。修改轮不再额外追加要求消息。候选解析、比例别名、关系 Tag 规范化按 APP 迁移；歧义 Tag 不自动改写。
- 结构化剪贴板转义与空白保留，预测插入保留原权重与光标后文本。
- 图片批次与历史事务提交，写入失败后整批结果可下载。
- 工具结果持久化，备份导入结构/资源/哈希检查后单事务替换。

## 仍需外部条件的验收

1. 当前网络对 NovelAI 匿名 OPTIONS 请求超时，官方直连尚未验证。设置页提供匿名只读诊断。
2. 图片隐私已在 Chromium 用合成图片验证；其余浏览器交互、跨平台验收、故障注入及付费 API 尚未全面执行，仍需相应测试授权。
3. 未指定 Cloud 项目/区域；本机没有 gcloud。尚未发布 AI Studio / Cloud Run，部署步骤见 DEPLOY.md。
4. 当前底层图片采取保守保留策略，无自动孤儿清扫。大型 ZIP 有内存和容量限制，见 PARITY.md。
5. 基线翻译服务只有离线词典路径。远程同意状态保留，未虚构远程翻译服务。

后续从 `docs/PARITY.md` 与 `docs/ACCEPTANCE.md` 开始。不要重新实施已有模块，也不要把未验收项标成已通过。

## 授权边界

- 用户授权类型检查、生产构建和本计划实施。
- 当前视觉与模型检索调整已通过 `npm run build`（包含 TypeScript 检查）；未进行浏览器操作或真实模型列表请求验收。
- 画风筛选与头像交互调整已通过类型检查及生产构建，未运行自动化/付费调用。HTTP 模型开关因可能明文传输 Key 被自动审批拒绝，已向用户请求精确授权；当前仍仅允许 HTTPS，不得绕过拒绝。
- 用户已授权本次开发后续自动执行离线回归，通过后自动提交、push；不包含真实付费 API 调用。
- 新项目位于原工作区的相邻目录；必要写入通过受控提权，用户已明确授权目标路径。
- 不能用云端代理绕过 CORS；用户密钥只在浏览器处理。
- 发布必须确认实际 Google/GitHub 账号环境；未取得部署网址前不能称已上线。
