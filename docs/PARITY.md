# 迁移对照与当前边界

“已接入”表示存在端到端代码与界面入口，不等于真实 API 或跨浏览器验收通过。图片隐私导出已通过类型检查、生产构建和 18 项获准的离线 Chromium 回归；其余功能仍以源码对照为主，没有运行付费请求。

| 范围                       | Android 基线入口                           | 网页实现                                        | 状态 / 验证边界                                                                |
| -------------------------- | ------------------------------------------ | ----------------------------------------------- | ------------------------------------------------------------------------------ |
| 25 个预置画风、图片        | NovelAiStyleCatalog / presets/image_styles | public/data/styles.json、style-previews、Styles | 已接入；不导入专属负面                                                         |
| 个人画风卡管理             | 由角色卡管理抽离                           | StyleCard、Styles、db                           | 已接入；卡片只有管理字段、画风、单张头像                                       |
| 测试头像                   | 新需求                                     | Styles / stylePreviewTestPrompt                 | 独立快照、512 方图、单张随机 Seed；待付费验证                                  |
| 一键应用画风               | ImagePromptToolScreen                      | Studio / store                                  | 只替换画风，可撤销；模型适配提示                                               |
| 多模型设置、参数、视觉模型 | ModelConfig / model request runtime        | Settings / llm / vault                          | OpenAI 兼容 API；需供应商逐个实测                                              |
| 模型标识检索选择           | ModelPickerDialog / ModelDiscoveryService  | ModelIdPicker / llm.listModels                  | 关键词 AND、系列筛选、排序、当前项置顶；取消与旧响应隔离；真实接口和交互待验收 |
| 视觉规范                   | ChatBarTheme / AppIcons                    | styles.css / Lucide / icon.png                  | Studio PC 三栏与六行自适应；9 项离线布局回归通过；其余页面视觉验收待执行             |
| 设计规划、检索、修复       | NovelAiPromptDesigner / TagResearch        | design / prompts / jsonCandidates / catalog.worker | 已按当前源码修正首轮/修改轮、证据注入、图片理解、修复与候选转换；实际请求对照待验收 |
| 设计对话、分支、重试       | NovelAiDesignConversationModels            | Design / IndexedDB                              | 独立对话、首轮不隐式读取工作室                                                 |
| 原始提示词                 | PromptTemplates.kt                         | public/data/prompts.json / domain/prompts       | 常量原文导出；动态构造迁移，基线留档                                           |
| Tag 搜索 / 预测            | RankedTagIndex / TagCompletion             | catalog.worker / PromptEditor / Library         | 全量索引、增量结果、排序去重、光标前片段替换；设置画风测试词/默认负面使用同一编辑器 |
| 离线翻译                   | PromptTranslation / WordDictionary         | catalog.worker                                  | Danbooru、完整 ECDICT、原有覆盖词表；无示例库替代                              |
| 远程翻译                   | 冻结基线无远程翻译调用路径                 | 保留同意状态字段，当前只走本地翻译              | 未擅自添加远程服务；若旧版本另有入口，需提供版本后对照                         |
| 法典                       | NovelAiCodexCatalog                        | 完整 codex.json / Worker / Library              | 原文浏览、中文 n-gram 召回、首轮/修改轮区分                                    |
| 分段、复制粘贴、权重       | StudioModels / PromptClipboard             | promptPolicy / Studio / PromptEditor            | 基础、补充、画风、角色正负面、基础负面；全屏确认写回                           |
| 角色折叠/停用              | NovelAiCharacterPromptDraft.enabled / activeCharacters | Studio / promptPolicy.activeCharacters | 折叠保留内容但暂停参与生图；展开恢复；草稿/历史/撤销/备份保留状态，旧数据默认启用 |
| Token 计数                 | PromptTokenCounter / V5TextPolicy          | tokenizer Worker / normalizedPrompt             | T5、Qwen 数据与算法迁入；与请求共用规范化                                      |
| 生图 / 批量 / 连续 / 预览  | NovelAiImageService / StreamFrameDecoder   | novelai / store                                 | MsgPack 分帧、仅 429 自动重试、启动快照、整批事务                              |
| 额度与费用                 | NovelAiAccountService                      | novelai / Settings / Studio                     | 生成按钮旁显示积分、V5 额度和估算张数；30 秒/前台/联网/批次/任务结束刷新；实际余额待验证 |
| 生成设置与尺寸交互         | GenerationSettingsSection / NovelAiStudioSizeDialog | GenerationControls / SizeEditor / studioControls | 尺寸档、比例、数量快捷按钮；高级参数摘要与滑块；自定义宽高、交换、最终比例预览、确认/取消，待跨浏览器交互验收 |
| 角色位置编辑               | NovelAiCharacterPositionDialog / PositionPolicy | CharacterPositionEditor / normalizePosition | 编号画布点按/拖动/键盘、百分比、均匀排列、AI 自动；V4.5 格心与 V5 自由坐标，共用请求规范化；待触摸验收 |
| 图生图 / 局部重绘          | FocusedInpaint / MaskEncoder / Composer    | Guidance / raster.worker                        | 焦点、上下文、潜空间蒙版、Lanczos3 合成；像素对照待验收                        |
| Precise / Vibe             | NovelAiImageGuidance / VibeEncoding        | Guidance / novelai                              | 模型限制、归一化、按需编码缓存与历史编码快照                                   |
| PNG / 反推 / 静态编辑      | PngMetadataReader / ImageProcessing        | metadata / Tools                                | 文件块/透明度 LSB 双来源读取（18 项离线导入回归通过）；选择性导入（角色关/覆盖/新增）、候选反推、旋转、马赛克；隐私导出统一 PNG，清除文件元数据及 RGB/alpha 最低位隐写，不附回生成参数                                   |
| APNG 伪装 / 还原           | ApngDisguiseCodec                          | domain/apng / Tools                             | PNG/GIF 伪装，v1/v2 还原、帧时序；动态图片禁用静态编辑                         |
| Enhance / Upscale          | ImagePostProcessing / UpscaleService       | postprocess / Tools                             | 请求参数、强度比例、结果保存、前后对比；真实调用待验证                         |
| 历史                       | HistoryFolding / GalleryExport             | History / Preview / domain/history              | 分组、搜索、选择删除、导出、复现、Seed、参考图、应用撤销                       |
| 完整备份                   | 新独立格式                                 | backup / validation                             | ZIP 清单、SHA-256、暂存校验、确认后单事务替换                                  |
| 密钥                       | 网页新增规则                               | vault                                           | 用户授权直接本机保存，无口令；自动读取；普通备份排除凭据                       |
| 任务与存储                 | Android 后台机制改为浏览器机制             | Web Locks / IndexedDB / PWA                     | 多标签页生成互斥；中断不自动重发；未保存结果可整批下载                         |
| 发布                       | 独立工程                                   | Dockerfile / server.mjs / metadata.json         | 生产构建通过；AI Studio/Cloud Run 未实际发布                                   |

Studio 桌面三栏与 Prompt 六行自适应已通过 9 项离线 Chromium 回归，含 1280/1440/1920 宽屏及 390px 手机；图片工具的付费 API 与其他浏览器不在此次验证范围。

## 数据保留与容量

画风库与工作室画风选择器支持 V4.5/V5 筛选；原预置独立负面词存在标识保留在目录元数据，卡片本身仍不保存负面词，选卡也不会替换负面段。头像生成位于卡片编辑器，缺少 Token/测试词时打开设置并定位，返回保留编辑草稿。生成和上传头像随卡片一起事务保存，取消编辑不覆盖旧头像。

历史记录删除会移除历史条目。图片可能仍被草稿、参考图、撤销快照或工具结果使用；当前实现保守保留底层图片资源，不自动做不可恢复的资源清扫。完整备份也包含这些资源，因此删除历史暂时不保证立即释放空间。

历史删除使用页面内确认窗口，捕获选择快照；事务完成后显示实际删除数，重复点击不重复提交，失败保留选中项。待手工验收：选择单张/分组→删除→取消保留；确认后条目消失且刷新不恢复，未选择项与参考图保留。内嵌浏览器交互尚未实测。

备份导入上限 512 MiB，展开上限 1 GiB；图片批量导出上限 512 MiB。大型 ZIP 的组装仍占用浏览器内存，应分批导出图片。移动 Safari 的实际容量和淘汰策略需设备验收。

## 平台限制与尚未通过的关卡

1. **直连未验证**：当前网络到官方 NovelAI 的匿名 OPTIONS 超时。不能认定服务器允许或拒绝 CORS。站点没有代理。用户配置自己的 HTTPS 地址可由浏览器直接使用。
2. **浏览器验收未全面执行**：图片隐私导入、马赛克/旋转、清理和下载已在桌面 Chromium 验证；Firefox、Safari、Android/iOS，以及其他界面、PWA 流程仍需按验收清单操作。
3. **实时 API 验收未执行**：流式响应、限流、取消、结果未知、扣费、额度变化、Vibe 缓存复用、Enhance/Upscale 必须在明确授权后验证。
4. **浏览器后台受限**：关闭、锁屏、系统回收后不保证任务继续。设计页面离开时会取消该页面的设计请求，重新打开显示中断状态。
5. **视觉实现是响应式改编**：网页用可见按钮替代长按，中文注释通过测量层显示在对应原文下方，跟随换行/滚动；保留原生输入、选区和 IME。浏览器字体度量、缩放及软键盘需视觉验收，没有声称与 Android 像素一致。
6. **上线未完成**：没有 Cloud 项目 ID、区域和可用 gcloud 环境。交付包含导入与发布说明。

## 下一轮验收后优先收敛

- 按供应商真实响应修正协议差异，不以静默降级隐藏失败。
- 对照真实样本验证 PNG/APNG 像素、透明度、帧延迟与 Enhance 参数继承。
- 根据移动端表现决定大 ZIP 流式导出与保守资源清扫方案。

## 当前设计流程对照依据

2026-09-29 从当前 Android 工作区同步，提交 `148b3a9637eadf577afbb4947158dd6f80e17f4f`。初始冻结基线未覆盖；当前源文件与资源清单见 `reference/current-parity.json`。

- 提示词：22 个常量/静态函数输出从 `PromptTemplates.kt` 原文导入，V5 按 APP 的替换规则生成。动态首轮、修改轮、检索规划、画面历史、Tag/法典证据文本集中在 `domain/prompts.ts`，已逐段对照。
- 首轮：原始场景包装为 APP 对话输入；全局要求放在同一输入；规划场景作为实际 user/assistant 历史传入。视觉模型的描述作为场景系统证据，图片理解使用原系统提示词及关闭思考的参数规则。
- 修改轮：上一候选为唯一 assistant 基线；法典仅按本轮修改需求召回，Tag 规划过滤已有角色词；复用首轮研究证据，一旦附加工作室快照即停止继承旧证据。法典按 ID 保留第一次命中，不用后续证据覆盖首轮。
- 检索：最多 6 查询、每查询 8 候选、按查询顺序去重后最多 24 个，类别为 general/copyright/character；8 秒查询超时与资源失败明确显示。法典采用完整数据及中文 n-gram/IDF 权重、首轮场景权重 0.8、每查询 48 候选、最终 5 条随机顺序。
- 校验：最终结果一次 JSON 修复；支持 APP 的旧字段与比例别名；AI 结果角色按模型上限生成候选，手工工作室输入超限仍报错。后处理保留歧义词，基础关系 Tag 经过同一转换规则；画风始终不被设计候选应用覆盖。
- 资源：9 个法典/词典/索引/分词器文件与 Android SHA-256 一致，法典 SHA-256 为 `80ae04bff76f500d240075c0666b2399e83fffaf549ec2dc96034b2f2b6d235a`。

以上为源码与资源一致性证据。未运行自动化、付费 API 或跨浏览器测试，不能据此声称所有模型服务、异常分片与设备表现已完全验收。
