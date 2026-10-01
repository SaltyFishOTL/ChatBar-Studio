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
  page.setDefaultTimeout(15000);
  await page.goto(origin + "/tests/metadata-import.html");
  await page.waitForFunction(() => !!window.importRegression);
  const passed = await page.evaluate(() => window.importRegression.run());
  const fixture = await page.evaluate(async () =>
    Array.from(
      new Uint8Array(
        await (await window.importRegression.fixture()).arrayBuffer(),
      ),
    ),
  );
  await page.locator('input[type="file"]').setInputFiles({
    name: "roles.png",
    mimeType: "image/png",
    buffer: Buffer.from(fixture),
  });
  await page.getByRole("button", { name: "元数据", exact: true }).click();
  await page
    .getByRole("button", { name: "选择字段并填入工作室", exact: true })
    .click();
  const choice = page.getByRole("combobox", { name: "角色 Prompt 导入方式" });
  assert.equal(await choice.inputValue(), "replace");
  assert.deepEqual(await choice.locator("option").allTextContents(), [
    "关",
    "覆盖",
    "新增",
  ]);
  await choice.selectOption("append");
  await page.getByRole("button", { name: "应用选中字段", exact: true }).click();
  await page.waitForFunction(
    () => window.importRegression.draft.characters.length === 3,
  );
  const chars = await page.evaluate(
    () => window.importRegression.draft.characters,
  );
  assert.equal(chars[0].id, "old");
  assert.equal(chars[0].enabled, false);
  assert.deepEqual(
    chars.map((c) => c.prompt),
    ["old person", "alice", "bob"],
  );
  passed.push("UI three-way selector appends imported roles");
  await page.evaluate(() => window.importRegression.store.undo());
  await page.waitForFunction(
    () => window.importRegression.draft.characters.length === 1,
  );
  await page.evaluate(() => window.importRegression.store.redo());
  await page.waitForFunction(
    () => window.importRegression.draft.characters.length === 3,
  );
  await page.evaluate(() => window.importRegression.store.flushSaves());
  await page.reload();
  await page.waitForFunction(() => !!window.importRegression);
  assert.deepEqual(
    await page.evaluate(() => window.importRegression.draft.characters),
    chars,
  );
  passed.push("append undo redo and reload preserve data");
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({ passed: passed.length, cases: passed }, null, 2),
  );
} finally {
  await browser?.close();
  await server.close();
}
