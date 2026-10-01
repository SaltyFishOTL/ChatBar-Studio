# Image privacy regression

Run only with authorization for offline browser tests:

```sh
node tools/test-image-privacy.mjs
```

The runner uses Vite and Playwright. Set `STUDIO_PLAYWRIGHT_PATH` to an existing Playwright package directory when it is not installed locally. `STUDIO_BROWSER_PATH` optionally selects a Chromium/Edge executable. The runner closes its own browser and server on exit.

All image payloads are synthetic. Preset endpoints are intercepted with inline fixtures; other bundled data and external/API requests are blocked. No API credentials or paid calls are used.

Coverage: four stealth signatures, compressed/uncompressed payloads, damaged headers, complete RGB/alpha carrier erasure, transparency endpoints, source immutability, PNG/WebP/JPEG decoding, animation/corruption rejection, actual tool buttons, mosaic/rotation, cleaning the current result, and downloaded PNG bytes. This does not claim arbitrary steganography removal or cross-browser acceptance.
