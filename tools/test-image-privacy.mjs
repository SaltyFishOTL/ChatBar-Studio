import { createRequire } from "node:module";
import { createServer } from "vite";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.STUDIO_PLAYWRIGHT_PATH || "playwright",
);
const server = await createServer({ server: { host: "127.0.0.1", port: 0 } });
await server.listen();
const address = server.httpServer.address();
const origin = `http://127.0.0.1:${address.port}`;
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.STUDIO_BROWSER_PATH || undefined,
  });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 1000 },
    acceptDownloads: true,
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // Tests never read bundled content or contact paid/external services.
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    const fixtures = {
      "/data/prompts.json": {
        DEFAULT_CHARACTER_NAI_NEGATIVE_PROMPT: "test negative",
      },
      "/data/styles.json": { cards: [], support: {} },
      "/data/style-metadata.json": {},
    };
    if (url.pathname in fixtures)
      return route.fulfill({ json: fixtures[url.pathname] });
    if (url.pathname.startsWith("/data/")) return route.abort();
    return route.continue();
  });
  await page.goto(origin + "/tests/privacy.html");
  await page.waitForFunction(() => !!window.privacyRegression);
  const passed = await page.evaluate(() => window.privacyRegression.run());
  const fixture = await page.evaluate(async () =>
    Array.from(
      new Uint8Array(await window.privacyRegression.fixture().arrayBuffer()),
    ),
  );
  await page
    .locator('input[type="file"]')
    .setInputFiles({
      name: "private-fixture.png",
      mimeType: "image/png",
      buffer: Buffer.from(fixture),
    });
  await page.waitForFunction(() =>
    document.querySelector(".tools-grid")?.textContent.includes("64 × 80"),
  );
  await page
    .getByRole("button", { name: "去除元数据与像素隐写", exact: true })
    .click();
  await page.getByAltText("处理结果").waitFor();
  await page.evaluate(async () =>
    window.privacyRegression.assertClean(
      await (
        await fetch(document.querySelector('img[alt="处理结果"]').src)
      ).blob(),
    ),
  );
  passed.push("UI metadata button");
  await page
    .getByRole("button", { name: "马赛克 / 旋转", exact: true })
    .click();
  await page.getByRole("button", { name: "旋转", exact: true }).click();
  await page
    .locator(".mosaic-stage canvas")
    .click({ position: { x: 25, y: 25 } });
  const oldResult = await page.getByAltText("处理结果").getAttribute("src");
  await page.getByRole("button", { name: "完成", exact: true }).click();
  await page.waitForFunction(
    (previous) =>
      document.querySelector('img[alt="处理结果"]')?.src !== previous,
    oldResult,
  );
  await page.evaluate(async () =>
    window.privacyRegression.assertClean(
      await (
        await fetch(document.querySelector('img[alt="处理结果"]').src)
      ).blob(),
      80,
      64,
    ),
  );
  passed.push("UI mosaic and rotation completion never reattaches metadata");
  const rotated = await page.getByAltText("处理结果").getAttribute("src");
  await page
    .getByRole("button", { name: "去除元数据与像素隐写", exact: true })
    .click();
  await page.waitForFunction(
    (previous) =>
      document.querySelector('img[alt="处理结果"]')?.src !== previous,
    rotated,
  );
  await page.evaluate(async () =>
    window.privacyRegression.assertClean(
      await (
        await fetch(document.querySelector('img[alt="处理结果"]').src)
      ).blob(),
      80,
      64,
    ),
  );
  passed.push("UI removal retains current edited result");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存结果", exact: true }).click();
  const download = await downloadPromise;
  assert.equal(download.suggestedFilename(), "ChatBar-image.png");
  assert.equal(await download.failure(), null);
  const stream = await download.createReadStream();
  const parts = [];
  for await (const part of stream) parts.push(part);
  await page.evaluate(
    async (bytes) =>
      window.privacyRegression.assertClean(
        new Blob([new Uint8Array(bytes)]),
        80,
        64,
      ),
    Array.from(Buffer.concat(parts)),
  );
  passed.push("download contains sanitized PNG bytes");
  const originalBytes = await page.evaluate(async () =>
    Array.from(
      new Uint8Array(
        await (
          await fetch(document.querySelector('img[alt="原图"]').src)
        ).arrayBuffer(),
      ),
    ),
  );
  assert.deepEqual(originalBytes, fixture);
  passed.push("UI source remains byte-identical");
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({ passed: passed.length, cases: passed }, null, 2),
  );
} finally {
  await browser?.close();
  await server.close();
}
