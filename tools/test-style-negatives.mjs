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
  await page.goto(origin + "/tests/style-negatives.html");
  await page.waitForFunction(() => !!window.negativeRegression);
  const draft = () =>
    page.evaluate(() => window.negativeRegression.store.draft);
  assert.equal((await draft()).negative, "configured default");
  const passed = ["fresh draft uses saved settings default"];
  await page.getByRole("button", { name: "选择画风卡" }).click();
  await page.locator(".style-card .style-image").first().click();
  await page.waitForFunction(
    () => window.negativeRegression.store.draft.negative === "card negative",
  );
  assert.equal((await draft()).appliedStyleCardId, "personal");
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await page.waitForFunction(
    () =>
      window.negativeRegression.store.draft.negative === "configured default",
  );
  await page.getByRole("button", { name: "重做", exact: true }).click();
  await page.waitForFunction(
    () => window.negativeRegression.store.draft.negative === "card negative",
  );
  passed.push("picker applies style and negative in one undo/redo");
  await page.evaluate(() =>
    window.negativeRegression.store.edit((d) => ({
      ...d,
      base: "scene",
      extra: "extra",
      negative: "manual",
    })),
  );
  await page.waitForFunction(
    () => window.negativeRegression.store.draft.negative === "manual",
  );
  page.on("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "清空提示词", exact: true }).click();
  await page.waitForFunction(
    () => window.negativeRegression.store.draft.negative === "card negative",
  );
  assert.equal((await draft()).base, "");
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await page.waitForFunction(
    () => window.negativeRegression.store.draft.negative === "manual",
  );
  assert.equal((await draft()).base, "scene");
  passed.push("existing clear restores card negative and undo restores edits");
  await page.evaluate(() => window.negativeRegression.store.flushSaves());
  await page.reload();
  await page.waitForFunction(() => !!window.negativeRegression);
  assert.equal((await draft()).negative, "manual");
  assert.equal((await draft()).appliedStyleCardId, "personal");
  passed.push("refresh preserves manual negative and selected card identity");
  await page.getByRole("button", { name: "Toggle library" }).click();
  await page.locator(".style-card .style-image").first().click();
  await page.waitForFunction(
    () => window.negativeRegression.store.draft.negative === "card negative",
  );
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  const editor = page.getByRole("dialog");
  assert.equal(await editor.locator("details").getAttribute("open"), null);
  await editor.locator("summary").filter({ hasText: "高级设置" }).click();
  await editor.locator("details select").first().selectOption("V5_FULL");
  assert.equal(await editor.locator("details input[type=checkbox]").count(), 0);
  await editor.locator("details select").first().selectOption("V4_5_FULL");
  assert.equal(await editor.locator("details input[type=checkbox]").count(), 1);
  await editor.locator("details input[type=checkbox]").check();
  passed.push("advanced editor starts collapsed and gates V+ by model");
  await editor.locator("textarea").nth(1).fill("edited negative");
  await page.getByRole("button", { name: "保存画风卡", exact: true }).click();
  await page.waitForFunction(() =>
    window.negativeRegression.store.cards.some(
      (c) => c.negative === "edited negative",
    ),
  );
  await page.locator(".style-card .style-image").first().click();
  await page.waitForFunction(
    () => window.negativeRegression.store.draft.negative === "edited negative",
  );
  passed.push("library applies negatives and editor persists negative field");
  // Restore synthetic fixture for isolated import/export checks.
  await page.evaluate(async () => {
    const { db } = await import("/src/data/db.ts");
    const c = await (await db).get("cards", "personal");
    await (
      await db
    ).put("cards", { ...c, negative: " card negative " }, "personal");
  });
  passed.push(...(await page.evaluate(() => window.negativeRegression.run())));
  passed.push(
    ...(await page.evaluate(async () => {
      const { runAdvancedRegression } =
        await import("/tests/advanced-generation.ts");
      return runAdvancedRegression();
    })),
  );
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({ passed: passed.length, cases: passed }, null, 2),
  );
} finally {
  await browser?.close();
  await server.close();
}
