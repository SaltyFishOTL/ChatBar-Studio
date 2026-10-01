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
  page.setDefaultTimeout(15000);
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
  await page.goto(origin + "/tests/layout.html");
  await page.waitForFunction(() => !!window.layoutRegression);
  await page.locator(".output-image img").waitFor();
  const passed = [];
  const geometry = () =>
    page.evaluate(() => {
      const rect = (selector) => {
        const el = document.querySelector(selector),
          r = el.getBoundingClientRect();
        return {
          x: r.x,
          y: r.y,
          right: r.right,
          bottom: r.bottom,
          width: r.width,
          height: r.height,
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
        };
      };
      return {
        left: rect(".studio-controls"),
        center: rect(".output-column"),
        right: rect(".studio-history"),
        list: rect(".studio-history-list"),
        bar: rect(".generation-bar"),
        input: rect('textarea[aria-label="基础 Prompt"]'),
        overflow: document.documentElement.scrollWidth > innerWidth,
        pageScroll: document.documentElement.scrollHeight > innerHeight,
      };
    });
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1280, height: 720 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(150);
    const g = await geometry();
    assert(
      g.left.right <= g.center.x + 1 && g.center.right <= g.right.x + 1,
      "three columns overlap",
    );
    assert(
      g.bar.x >= g.left.x &&
        g.bar.right <= g.left.right &&
        g.bar.bottom <= viewport.height + 1,
      "generation controls escaped left column",
    );
    assert(
      g.list.scrollHeight > g.list.clientHeight,
      "history should scroll vertically",
    );
    assert(!g.overflow && !g.pageScroll, "desktop viewport overflow");
    passed.push(
      `${viewport.width}x${viewport.height} independent desktop columns`,
    );
  }
  const base = page.getByRole("textbox", { name: "基础 Prompt", exact: true });
  const minHeight = await base.evaluate(
    (el) => parseFloat(getComputedStyle(el).lineHeight) * 6,
  );
  assert((await base.boundingBox()).height >= minHeight, "less than six lines");
  const shortHeight = (await base.boundingBox()).height;
  await base.fill(
    Array.from(
      { length: 24 },
      (_, i) => `line ${i}: forest, lake, peaceful landscape`,
    ).join("\n"),
  );
  await page.waitForTimeout(150);
  assert(
    (await base.boundingBox()).height > shortHeight * 2,
    "did not grow with content",
  );
  assert(
    await base.evaluate((el) => el.scrollHeight <= el.clientHeight + 1),
    "textarea has internal scroll",
  );
  await base.fill("short prompt");
  await page.waitForTimeout(150);
  assert(
    (await base.boundingBox()).height < shortHeight + 2,
    "did not shrink after deleting",
  );
  passed.push("six line minimum and grow/shrink without textarea scroll");
  await page.getByRole("button", { name: "中文注释", exact: true }).click();
  await page.waitForTimeout(150);
  assert(
    await base.evaluate(
      (el) =>
        el.clientHeight >= parseFloat(getComputedStyle(el).lineHeight) * 6,
    ),
    "translation line height not respected",
  );
  await page.getByRole("button", { name: "中文注释", exact: true }).click();
  passed.push("translation spacing retains six line minimum");
  assert.equal(await page.locator(".studio-history-list button").count(), 35);
  await page
    .getByRole("button", { name: "查看历史图片 30", exact: true })
    .click();
  await page.waitForTimeout(120);
  const image = await page.locator(".output-image img").getAttribute("src");
  await page.evaluate(() => window.layoutRegression.prepend());
  await page.waitForFunction(
    () =>
      document.querySelectorAll(".studio-history-list button").length === 36,
  );
  assert.equal(
    await page.locator(".output-image img").getAttribute("src"),
    image,
  );
  await page
    .getByRole("button", { name: "查看历史图片 31", exact: true })
    .getAttribute("aria-pressed")
    .then((v) => assert.equal(v, "true"));
  passed.push("full history and identity selection survive incoming history");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存当前图片", exact: true }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream(),
    parts = [];
  for await (const part of stream) parts.push(part);
  const shown = await page.evaluate(async () =>
    Array.from(
      new Uint8Array(
        await (
          await fetch(document.querySelector(".output-image img").src)
        ).arrayBuffer(),
      ),
    ),
  );
  assert.deepEqual(Buffer.concat(parts), Buffer.from(shown));
  passed.push("save uses selected large image");
  await page.getByRole("button", { name: "放大当前图片", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await page.keyboard.press("Escape");
  passed.push("large image opens preview");
  await page.evaluate(() => {
    window.layoutRegression.store.edit((d) => ({
      ...d,
      base: "mountain landscape, quiet lake, morning light",
    }));
    document.querySelector(".studio-controls-scroll").scrollTop = 0;
    document.querySelector(".studio-history-list").scrollTop = 0;
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(300);
  await page.screenshot({
    path: process.env.STUDIO_LAYOUT_SCREENSHOT || "layout-desktop.png",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(150);
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "mobile horizontal overflow",
  );
  assert(
    await base.evaluate((el) => el.style.height === ""),
    "desktop autosize remains on mobile",
  );
  await page
    .getByRole("button", { name: "生成图片", exact: true })
    .isVisible()
    .then((v) => assert(v));
  passed.push("mobile reflow keeps generation and clears desktop autosize");
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({ passed: passed.length, cases: passed }, null, 2),
  );
} finally {
  await browser?.close();
  await server.close();
}
