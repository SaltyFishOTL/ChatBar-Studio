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
