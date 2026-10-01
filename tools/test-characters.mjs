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
  await page.goto(origin + "/tests/characters.html");
  await page.waitForFunction(() => !!window.characterRegression);
  const passed = await page.evaluate(() => window.characterRegression.run());
  const original = await page.evaluate(
    () => window.characterRegression.draft.characters,
  );
  const cards = page.locator(".role-card");
  assert.equal(await cards.count(), 2);
  const collapse = "折叠角色（不参与生图）",
    expand = "展开角色（参与生图）";
  await cards
    .nth(0)
    .getByRole("button", { name: collapse, exact: true })
    .click();
  await page.waitForFunction(
    () => window.characterRegression.draft.characters[0].enabled === false,
  );
  assert.equal(await cards.nth(0).locator("textarea").count(), 0);
  assert.equal(await cards.nth(1).locator("textarea").count(), 2);
  const folded = await page.evaluate(
    () => window.characterRegression.draft.characters,
  );
  assert.deepEqual(folded, [{ ...original[0], enabled: false }, original[1]]);
  assert.equal(
    (await page.evaluate(() => window.characterRegression.request())).parameters
      .v4_prompt.caption.char_captions.length,
    1,
  );
  passed.push("UI collapse retains all role data and filters request");
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await page.waitForFunction(
    () => window.characterRegression.draft.characters[0].enabled !== false,
  );
  await page.getByRole("button", { name: "重做", exact: true }).click();
  await page.waitForFunction(
    () => window.characterRegression.draft.characters[0].enabled === false,
  );
  passed.push("UI undo and redo");
  await page.evaluate(() => window.characterRegression.store.flushSaves());
  assert.deepEqual(
    (await page.evaluate(() => window.characterRegression.persisted()))
      .characters,
    folded,
  );
  await page.evaluate(() => window.characterRegression.saveHistory());
  await page.reload();
  await page.waitForFunction(() => !!window.characterRegression);
  assert.equal(await cards.nth(0).locator("textarea").count(), 0);
  assert.deepEqual(
    await page.evaluate(() => window.characterRegression.draft.characters),
    folded,
  );
  passed.push("IndexedDB reload preserves collapsed state");
  await cards.nth(0).getByRole("button", { name: expand, exact: true }).click();
  await page.waitForFunction(
    () => window.characterRegression.draft.characters[0].enabled === true,
  );
  assert.deepEqual(
    await page.evaluate(() => window.characterRegression.draft.characters),
    [{ ...original[0], enabled: true }, original[1]],
  );
  passed.push("UI restore retains positive negative and position");
  await page.evaluate(() => window.characterRegression.applyHistory());
  await page.waitForFunction(
    () => window.characterRegression.draft.characters[0].enabled === false,
  );
  assert.deepEqual(
    await page.evaluate(() => window.characterRegression.draft.characters),
    folded,
  );
  passed.push("History application preserves collapsed role");
  await page.getByRole("button", { name: "编辑位置", exact: true }).click();
  assert.equal(await page.locator(".position-marker").count(), 1);
  assert.equal(await page.locator(".position-marker").textContent(), "2");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  passed.push("Position editor excludes folded roles and retains numbering");
  await cards
    .nth(1)
    .getByRole("button", { name: collapse, exact: true })
    .click();
  await page.waitForFunction(
    () => window.characterRegression.active().length === 0,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "编辑位置", exact: true })
      .isDisabled(),
    true,
  );
  assert.equal(
    (await page.evaluate(() => window.characterRegression.request())).parameters
      .use_coords,
    false,
  );
  passed.push("UI all folded supports base only generation");
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({ passed: passed.length, cases: passed }, null, 2),
  );
} finally {
  await browser?.close();
  await server.close();
}
