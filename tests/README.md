# Image privacy regression

Run only with authorization for offline browser tests:

```sh
node tools/test-image-privacy.mjs
```

The runner uses Vite and Playwright. Set `STUDIO_PLAYWRIGHT_PATH` to an existing Playwright package directory when it is not installed locally. `STUDIO_BROWSER_PATH` optionally selects a Chromium/Edge executable. The runner closes its own browser and server on exit.

All image payloads are synthetic. Preset endpoints are intercepted with inline fixtures; other bundled data and external/API requests are blocked. No API credentials or paid calls are used.

Coverage: four stealth signatures, compressed/uncompressed payloads, damaged headers, complete RGB/alpha carrier erasure, transparency endpoints, source immutability, PNG/WebP/JPEG decoding, animation/corruption rejection, actual tool buttons, mosaic/rotation, cleaning the current result, and downloaded PNG bytes. This does not claim arbitrary steganography removal or cross-browser acceptance.

## 角色折叠离线回归

`node tools/test-characters.mjs` 使用同一浏览器环境变量，临时浏览器数据库和内联角色夹具；外部网络与预置数据被拦截。覆盖 V4.5/V5 请求过滤、旧角色默认启用、全折叠坐标关闭、剪贴板、真实折叠/展开按钮、撤销/重做、刷新、历史恢复与位置编号。运行需用户明确授权。

## 图片角色导入离线回归

`node tools/test-metadata-import.mjs` 使用同一浏览器环境变量，合成 PNG 与草稿，拦截外部网络和预置数据。覆盖角色三态导入、旧角色折叠/位置保留、重复导入身份、缺失/空角色、超限不写入，以及真实新增按钮、撤销/重做和刷新恢复。运行需本次用户授权。

## Studio 桌面排版离线回归

`node tools/test-studio-layout.mjs` 使用相同 Playwright/浏览器环境变量、合成风景图及 35 条历史，不读取预置或调用外部接口。覆盖独立三栏滚动、左侧生成栏、六行输入与自动增高/收缩、翻译行距、完整历史、稳定选图、当前图片下载、预览及窄屏恢复。`STUDIO_LAYOUT_SCREENSHOT` 可指定桌面截图路径。

## 画风负面词离线回归

`node tools/test-style-negatives.mjs` 使用相同浏览器环境变量与合成卡片，拦截预置资源及外部请求。覆盖保存的默认值、新旧卡片、两个选卡入口、现有清空按钮、撤销/重做、刷新持久化、卡片编辑、导入导出与备份，以及 V4.5/V5 请求负面词。
