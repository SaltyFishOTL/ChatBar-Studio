import { createRequire } from "node:module";
import { createServer } from "vite";
import assert from "node:assert/strict";
import initSqlJs from "sql.js";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.STUDIO_PLAYWRIGHT_PATH || "playwright",
);
const sql = await initSqlJs();
const db = new sql.Database();
db.run(
  "CREATE TABLE entries (rank INTEGER PRIMARY KEY,name TEXT,cn_name TEXT,post_count INTEGER,category INTEGER,a TEXT,b TEXT)",
);
db.run("CREATE TABLE grams (gram INTEGER PRIMARY KEY,n INTEGER,ranks BLOB)");
db.run(
  "INSERT INTO entries VALUES (1,'blue_hair','蓝发',100,0,'blue_hair','蓝发'),(2,'red_eyes','红眼',80,0,'red_eyes','红眼'),(3,'landscape','风景',70,0,'landscape','风景')",
);
const dictionary = new sql.Database();
dictionary.run("CREATE TABLE words (word TEXT PRIMARY KEY,meaning TEXT)");
dictionary.run(
  "INSERT INTO words VALUES ('quiet','安静；静谧'),('lake','湖泊')",
);
const packages = new Map();
for (const [name, database] of [
  ["danbooru", db],
  ["dictionary", db],
  ["ecdict", dictionary],
]) {
  const bytes = Buffer.from(database.export());
  packages.set(name, {
    body: gzipSync(bytes),
    manifest: {
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.length,
    },
  });
}
const server = await createServer({ server: { host: "127.0.0.1", port: 0 } });
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
let browser;
const passed = [];
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.STUDIO_BROWSER_PATH || undefined,
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  let failDictionary = false;
  const external = [];
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) {
      external.push(url.pathname);
      return route.abort();
    }
    if (url.pathname === "/src/domain/design.ts")
      return route.fulfill({
        contentType: "application/javascript",
        body: 'export async function designTurn(){return {reply:{baseCaption:"blue hair",characters:[{caption:"red eyes"}],sizePreset:"PORTRAIT"}}}',
      });
    // Real translation worker, synthetic SQL stores. No bundled content reads.
    if (url.pathname === "/src/workers/tokenizer.ts")
      return route.fulfill({
        contentType: "application/javascript",
        body: 'export async function tokenizer(){return text=>{if(text.includes("TOKEN_FAIL")) throw Error("synthetic token error");return text.trim() ? text.trim().split(/\\s+/).length : 0}}',
      });
    const fixtures = {
      "/data/prompts.json": {
        DEFAULT_CHARACTER_NAI_NEGATIVE_PROMPT: "red eyes",
      },
      "/data/styles.json": { cards: [], support: {} },
      "/data/style-metadata.json": {},
      "/data/dictionary-overrides.json": {},
      "/data/codex.json": {
        entries: [
          {
            id: "fixture",
            title: "合成法典",
            category: "测试",
            prompt: "blue hair, red eyes",
          },
        ],
        rewriteRules: [],
      },
    };
    if (url.pathname in fixtures)
      return route.fulfill({ json: fixtures[url.pathname] });
    for (const [name, p] of packages) {
      if (url.pathname.endsWith(name + ".sqlite.binz"))
        return name === "ecdict" && failDictionary
          ? route.abort()
          : route.fulfill({ body: p.body });
      if (
        url.pathname.endsWith(name + ".json") ||
        (name === "ecdict" &&
          url.pathname === "/data/prompt_dictionary/metadata.json")
      )
        return route.fulfill({ json: p.manifest });
    }
    if (url.pathname.startsWith("/data/")) return route.abort();
    return route.continue();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin + "/tests/layout.html");
  await page.waitForFunction(() => !!window.layoutRegression);
  const edit = (patch) =>
    page.evaluate(
      (p) => window.layoutRegression.store.edit((d) => ({ ...d, ...p })),
      patch,
    );
  await edit({
    style: "",
    extra: "",
    base: "blue hair",
    negative: "red eyes",
    characters: [],
  });
  await page.getByRole("button", { name: "中文注释", exact: true }).click();
  const base = page.getByRole("textbox", { name: "基础 Prompt", exact: true });
  const editor = page.locator(".prompt-editor").filter({ has: base });
  await editor
    .locator(".prompt-annotation-text")
    .filter({ hasText: "蓝发" })
    .waitFor();
  assert.equal(await base.inputValue(), "blue hair");
  await base.fill("red eyes");
  await editor
    .locator(".prompt-annotation-text")
    .filter({ hasText: "红眼" })
    .waitFor();
  assert.equal(
    await editor
      .locator(".prompt-annotation-text")
      .filter({ hasText: "蓝发" })
      .count(),
    0,
  );
  passed.push(
    "editor live translations preserve raw text and reject stale labels",
  );
  await editor.getByRole("button", { name: "全屏编辑" }).click();
  await page
    .getByRole("dialog")
    .locator(".prompt-annotation-text")
    .filter({ hasText: "红眼" })
    .waitFor();
  await page.getByRole("dialog").getByRole("textbox").fill("blue hair");
  await page
    .getByRole("dialog")
    .locator(".prompt-annotation-text")
    .filter({ hasText: "蓝发" })
    .waitFor();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "取消", exact: true })
    .click();
  assert.equal(await base.inputValue(), "red eyes");
  passed.push("fullscreen translation and cancel isolation");
  // Force an unloaded dictionary failure: successful catalog hit must survive.
  failDictionary = true;
  await base.fill("blue hair, unknown_fixture_word");
  await editor
    .locator(".prompt-annotation-text")
    .filter({ hasText: "蓝发" })
    .waitFor();
  await editor.getByRole("status").waitFor();
  failDictionary = false;
  await base.fill("blue hair, quiet lake");
  await editor
    .locator(".prompt-annotation-text")
    .filter({ hasText: "安静湖泊" })
    .waitFor();
  assert.equal(await editor.getByRole("status").count(), 0);
  passed.push(
    "partial lookup failure visible, exact matches retained, dictionary recovery",
  );
  await page
    .getByRole("button", { name: "提示词实时翻译", exact: true })
    .click();
  assert.equal(await page.locator(".prompt-annotation").count(), 0);
  await page
    .getByRole("button", { name: "提示词实时翻译", exact: true })
    .click();
  await editor
    .locator(".prompt-annotation-text")
    .filter({ hasText: "蓝发" })
    .waitFor();
  passed.push("global translation toggle clears and restores annotations");
  await edit({ base: "blue hair", negative: "red eyes", characters: [] });
  const positive = page.getByRole("progressbar", {
    name: "正面 Token",
    exact: true,
  });
  await page.waitForFunction(
    () =>
      document
        .querySelector('[aria-label="正面 Token"]')
        .getAttribute("aria-valuenow") === "2",
  );
  await edit({
    base: Array(440).fill("word").join(" "),
    negative: Array(520).fill("word").join(" "),
  });
  await page.waitForFunction(
    () =>
      document.querySelector(".prompt-token-row.near") &&
      document.querySelector(".prompt-token-row.over"),
  );
  assert.equal(await positive.getAttribute("aria-valuemax"), "512");
  await edit({ model: "V5_FULL" });
  await page.waitForFunction(
    () =>
      document
        .querySelector('[aria-label="正面 Token"]')
        .getAttribute("aria-valuemax") === "1471" &&
      document.querySelectorAll(".prompt-token-row.normal").length === 2,
  );
  await edit({
    base: "blue hair",
    negative: "red eyes",
    characters: [
      {
        id: "disabled",
        enabled: false,
        prompt: "ignored ignored",
        negative: "ignored",
        center: { x: 0.5, y: 0.5 },
      },
    ],
  });
  await page.waitForFunction(
    () =>
      document
        .querySelector('[aria-label="正面 Token"]')
        .getAttribute("aria-valuenow") === "2",
  );
  passed.push(
    "positive/negative limits, 85% warning, overflow, model switching, folded roles excluded",
  );
  await edit({ base: "TOKEN_FAIL" });
  await page.locator(".prompt-token-budget").getByRole("status").waitFor();
  assert.equal(
    await page.getByRole("button", { name: /生成图片/ }).isEnabled(),
    true,
  );
  await edit({ base: "blue hair", model: "V4_5_FULL" });
  await page.waitForFunction(
    () =>
      document
        .querySelector('[aria-label="正面 Token"]')
        .getAttribute("aria-valuenow") === "2",
  );
  passed.push("token failure visible without blocking generation; recovery");
  const cost = () => page.locator(".generation-cost").innerText();
  const oldCost = await cost();
  await page.evaluate(() =>
    window.layoutRegression.store.edit((d) => ({
      ...d,
      perModel: {
        ...d.perModel,
        [d.model]: { ...d.perModel[d.model], count: 4 },
      },
    })),
  );
  assert.notEqual(await cost(), oldCost);
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(180);
    const r = await page.locator(".generation-submit").boundingBox();
    assert(
      r.x >= 0 &&
        r.y >= 0 &&
        r.x + r.width <= viewport.width + 1 &&
        r.y + r.height <= viewport.height + 1,
    );
    const b = await page.locator(".generate-button").boundingBox(),
      t = await page.locator(".prompt-token-budget").boundingBox();
    assert(t.y + t.height <= b.y, "token bars must be above button");
    assert(await page.locator(".generate-button .generation-cost").isVisible());
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
  }
  passed.push(
    "live button costs and pinned token bars at desktop/mobile sizes",
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(async () => {
    const { db, changed } = await import("/src/data/db.ts");
    const store = await db;
    await store.put(
      "cards",
      {
        id: "fixture-style",
        name: "翻译测试画风",
        prompt: "blue hair, red eyes",
        avatar: "",
        createdAt: 1,
        updatedAt: 1,
      },
      "fixture-style",
    );
    await store.put(
      "conversations",
      {
        id: "fixture-chat",
        title: "翻译测试设计",
        createdAt: 1,
        updatedAt: 1,
        extraRequirement: "",
        references: [],
        turns: [
          {
            id: "turn",
            text: "测试",
            modelId: "",
            target: "V4_5_FULL",
            natural: false,
            reply: {
              baseCaption: "blue hair",
              characters: [{ caption: "red eyes" }],
              sizePreset: "PORTRAIT",
            },
            raw: "",
            reasoning: "",
            status: "complete",
          },
        ],
      },
      "fixture-chat",
    );
    const history = await store.getAll("history");
    const recipe = history[0];
    recipe.draft = {
      ...recipe.draft,
      base: "blue hair",
      style: "red eyes",
      extra: "quiet lake",
      negative: "red eyes",
      characters: [],
    };
    await store.put("history", recipe, recipe.id);
    changed();
  });
  await page.getByRole("button", { name: "画风卡", exact: true }).click();
  await page
    .locator(".style-info .prompt-annotation-text")
    .filter({ hasText: "蓝发" })
    .waitFor();
  passed.push("style gallery prompt annotations");
  await page.getByRole("button", { name: "AI 设计", exact: true }).click();
  await page.getByText("翻译测试设计", { exact: true }).first().click();
  await page
    .locator(".assistant-message .prompt-annotation-text")
    .filter({ hasText: "蓝发" })
    .waitFor();
  await page
    .locator(".assistant-message .prompt-annotation-text")
    .filter({ hasText: "红眼" })
    .waitFor();
  passed.push("AI design base and character result annotations");
  await page.getByRole("button", { name: "Tag 与法典", exact: true }).click();
  await page.getByRole("button", { name: "法典数据库", exact: true }).click();
  await page.getByText("合成法典", { exact: false }).first().click();
  await page
    .locator(".codex-entry .prompt-annotation-text")
    .filter({ hasText: "蓝发" })
    .waitFor();
  passed.push("codex prompt annotations");
  await page.getByRole("button", { name: "工作室", exact: true }).click();
  await page
    .getByRole("button", { name: "查看历史图片 35", exact: true })
    .click();
  await page.getByRole("button", { name: "放大当前图片", exact: true }).click();
  await page.getByRole("button", { name: "配方详情", exact: true }).click();
  await page
    .getByRole("dialog")
    .locator(".prompt-annotation-text")
    .filter({ hasText: "蓝发" })
    .waitFor();
  passed.push("history recipe prompt annotations");
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "图像工具", exact: true })
    .first()
    .click();
  const fixture = await page.evaluate(async () => {
    const { canvas, canvasBlob } = await import("/src/domain/images.ts");
    const { attachRecipe } = await import("/src/domain/metadata.ts");
    const draft = {
      ...window.layoutRegression.store.draft,
      base: "blue hair",
      negative: "red eyes",
      characters: [],
    };
    const c = canvas(64, 64);
    c.getContext("2d").fillRect(0, 0, 64, 64);
    return [
      ...new Uint8Array(
        await (await attachRecipe(await canvasBlob(c), draft, 1)).arrayBuffer(),
      ),
    ];
  });
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "translation.png",
      mimeType: "image/png",
      buffer: Buffer.from(fixture),
    });
  await page.getByRole("button", { name: "元数据", exact: true }).click();
  await page
    .locator(".prompt-fields .prompt-annotation-text")
    .filter({ hasText: "蓝发" })
    .waitFor();
  await page
    .locator(".prompt-fields .prompt-annotation-text")
    .filter({ hasText: "红眼" })
    .waitFor();
  passed.push("imported image metadata translated positive and negative views");
  await page.getByRole("button", { name: "反推 Prompt", exact: true }).click();
  await page.getByRole("button", { name: "反推提示词", exact: true }).click();
  await page
    .locator(".candidate .prompt-annotation-text")
    .filter({ hasText: "蓝发" })
    .waitFor();
  await page
    .locator(".candidate .prompt-annotation-text")
    .filter({ hasText: "红眼" })
    .waitFor();
  passed.push(
    "reverse candidate base and character translations with synthetic design service",
  );
  await page.getByRole("button", { name: "设置", exact: true }).click();
  for (const label of ["画风测试提示词", "默认负面提示词", "角色参考提示词"]) {
    const input = page.getByRole("textbox", { name: label, exact: true });
    await input.fill("blue hair");
    await page
      .locator(".prompt-editor")
      .filter({ has: input })
      .locator(".prompt-annotation-text")
      .filter({ hasText: "蓝发" })
      .waitFor();
  }
  passed.push("settings test/negative/reference editors translate live");
  await page.getByRole("button", { name: "工作室", exact: true }).click();
  await base.fill("blue hair, red eyes, quiet lake");
  await base.blur();
  await page.waitForTimeout(300);
  if (process.env.STUDIO_SCREENSHOT_PATH)
    await page.screenshot({ path: process.env.STUDIO_SCREENSHOT_PATH });
  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({ passed: passed.length, checks: passed }, null, 2),
  );
} finally {
  await browser?.close();
  await server.close();
}
