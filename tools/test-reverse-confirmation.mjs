import { createRequire } from "node:module";
import { createServer } from "vite";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.STUDIO_PLAYWRIGHT_PATH || "playwright",
);
const server = await createServer({ server: { host: "127.0.0.1", port: 0 } });
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.STUDIO_BROWSER_PATH || undefined,
  });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 1000 },
  });
  const requests = [],
    passed = [],
    errors = [];
  let failRecognition = false;
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    window.catalogCalls = [];
    window.Worker = class {
      postMessage(data) {
        window.catalogCalls.push(data);
        queueMicrotask(() =>
          this.onmessage?.({ data: { id: data.id, done: true, value: [] } }),
        );
      }
      terminate() {}
    };
  });
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "offline.test") {
      const body = route.request().postDataJSON();
      requests.push(body);
      const system = body.messages[0].content;
      const recognition = JSON.stringify(body.messages).includes("image_url");
      const text =
        body.model === "vision"
          ? "关联视觉模型场景"
          : recognition
            ? failRecognition
              ? "invalid scene"
              : JSON.stringify({
                  sceneDescription: "识别草稿错误",
                  queries: ["错误词"],
                })
            : system.includes("QUERY")
              ? JSON.stringify({ queries: ["窗边"] })
              : JSON.stringify({
                  baseCaption: system.includes("NATURAL")
                    ? "窗边的自然语言描述"
                    : "window, sunlight",
                  characters: [{ caption: "person" }],
                });
      return route.fulfill({
        json: {
          choices: [{ message: { content: text }, finish_reason: "stop" }],
        },
      });
    }
    if (url.origin !== origin) return route.abort();
    if (url.pathname === "/data/prompts.json")
      return route.fulfill({
        json: {
          DEFAULT_CHARACTER_NAI_NEGATIVE_PROMPT: "default",
          novelAiImageReversePromptUser: "REVERSE $targetImageModel",
          NOVELAI_TAG_SEARCH_PLANNER_SYSTEM: "PLAN",
          NOVELAI_TAG_REVISION_QUERY_PLANNER_SYSTEM: "QUERY",
          NOVELAI_IMAGE_NATURAL_LANGUAGE_PROMPT_SYSTEM_V5: "NATURAL",
          NOVELAI_IMAGE_PROMPT_SYSTEM: "TAG45",
          NOVELAI_IMAGE_PROMPT_SYSTEM_V5: "TAG5",
          IMAGE_DESCRIPTION_PROMPT: "VISION",
          novelAiImagePromptStyleExclusionSystem: "NO_STYLE",
        },
      });
    if (url.pathname === "/data/styles.json")
      return route.fulfill({ json: { cards: [], support: {} } });
    if (url.pathname === "/data/style-metadata.json")
      return route.fulfill({ json: {} });
    if (url.pathname.startsWith("/data/")) return route.abort();
    return route.continue();
  });
  await page.goto(origin + "/tests/reverse-confirmation.html");
  await page.waitForFunction(() => !!window.reverseTest);
  await page.getByRole("button", { name: "反推 Prompt", exact: true }).click();
  await page.getByRole("button", { name: "反推提示词", exact: true }).click();
  const field = page.getByRole("textbox", {
    name: "确认场景描述",
    exact: true,
  });
  await field.waitFor();
  assert.equal(requests.length, 1);
  assert.equal(
    (await page.evaluate(() => window.catalogCalls)).filter((x) =>
      ["codex", "rewriteRules"].includes(x.type),
    ).length,
    0,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "应用到工作室", exact: true })
      .count(),
    0,
  );
  passed.push("recognition pauses before research and design");
  await field.fill(" ");
  assert.equal(
    await page.getByRole("button", { name: "确认并继续" }).isDisabled(),
    true,
  );
  await field.fill("用户修正：窗边单人，没有雨伞");
  await page.getByRole("button", { name: "确认并继续" }).click();
  await page
    .getByRole("button", { name: "应用到工作室", exact: true })
    .waitFor();
  assert.equal(requests.length, 3);
  for (const body of requests.slice(1)) {
    const text = JSON.stringify(body.messages);
    assert.ok(text.includes("用户修正"));
    assert.ok(!text.includes("识别草稿错误"));
    assert.ok(!text.includes("image_url"));
    assert.equal(body.reasoning_effort, "high");
    assert.equal(body.max_tokens, 1234);
  }
  assert.ok(requests[2].messages[0].content.includes("NATURAL"));
  assert.ok(
    !(await page.evaluate(() => window.catalogCalls)).some(
      (x) => x.type === "rewriteRules",
    ),
  );
  passed.push(
    "edited scene and selected parameters reach query and natural design",
  );
  await page.getByRole("button", { name: "应用到工作室", exact: true }).click();
  await page.waitForFunction(
    () => window.reverseTest.store.draft.base === "窗边的自然语言描述",
  );
  const draft = await page.evaluate(() => window.reverseTest.store.draft);
  assert.equal(draft.model, "V5_FULL");
  assert.equal(draft.style, "kept style");
  assert.equal(draft.negative, "negative");
  assert.equal(draft.characters[0].negative, "kept negative");
  passed.push("natural result applies V5 while preserving style and negatives");
  await page.evaluate(() =>
    window.reverseTest.store.configure((s) => ({
      ...s,
      naturalLanguage: false,
    })),
  );
  await field.fill("结构化修正场景");
  assert.equal(
    await page
      .getByRole("button", { name: "应用到工作室", exact: true })
      .count(),
    0,
  );
  await page.getByRole("button", { name: "确认并继续" }).click();
  await page
    .getByRole("button", { name: "应用到工作室", exact: true })
    .waitFor();
  assert.ok(requests.at(-1).messages[0].content.includes("TAG5"));
  assert.ok(
    (await page.evaluate(() => window.catalogCalls)).some(
      (x) => x.type === "rewriteRules",
    ),
  );
  passed.push("switching language mode uses tag system and postprocessing");
  failRecognition = true;
  const count = requests.length;
  await page.getByRole("button", { name: "重新识别图片", exact: true }).click();
  await page.waitForFunction(() => window.reverseTest.store.error.length > 0);
  assert.equal(requests.length, count + 1);
  assert.equal(
    await page
      .getByRole("button", { name: "应用到工作室", exact: true })
      .count(),
    1,
  );
  passed.push(
    "invalid recognition stops downstream work and retains previous candidate",
  );
  failRecognition = false;
  await page.getByRole("button", { name: "重新识别图片", exact: true }).click();
  await field.waitFor();
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles({
      name: "new.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=",
        "base64",
      ),
    });
  await field.waitFor({ state: "detached" });
  assert.equal(
    await page
      .getByRole("button", { name: "应用到工作室", exact: true })
      .count(),
    0,
  );
  passed.push("replacing source clears previous scene and candidate");
  const linked = await page.evaluate(async () => {
    const { recognizeReverseScene, designTurn } =
      await import("/src/domain/design.ts");
    const { setKey } = await import("/src/data/vault.ts");
    const settings = window.reverseTest.store.settings;
    const model = {
      ...settings.models[0],
      isMultimodal: false,
      visionModelId: "vision",
    };
    const vision = {
      ...settings.models[0],
      id: "vision",
      model: "vision",
      reasoningEffort: "low",
      maxTokens: 4321,
    };
    await setKey("vision", "synthetic");
    const turn = {
      id: "test",
      modelId: model.id,
      target: "V5_FULL",
      image: window.reverseTest.asset,
      reverse: true,
      natural: true,
      text: "",
    };
    const effective = { ...settings, models: [model, vision] };
    const signal = new AbortController().signal;
    const scene = await recognizeReverseScene(
      turn,
      effective,
      [],
      signal,
      () => {},
    );
    let rejected = false;
    try {
      await designTurn(
        { turns: [], references: [], extraRequirement: "" },
        turn,
        effective,
        signal,
        () => {},
      );
    } catch {
      rejected = true;
    }
    return { scene, rejected };
  });
  assert.equal(linked.scene, "关联视觉模型场景");
  assert.equal(requests.at(-1).model, "vision");
  assert.equal(requests.at(-1).reasoning_effort, "low");
  assert.equal(requests.at(-1).max_tokens, 4321);
  passed.push("linked vision recognition inherits its own model parameters");
  assert.equal(linked.rejected, true);
  passed.push("domain rejects reverse generation without confirmed scene");
  const aborted = await page.evaluate(async () => {
    const { recognizeReverseScene } = await import("/src/domain/design.ts");
    const ctrl = new AbortController();
    ctrl.abort();
    try {
      await recognizeReverseScene(
        { modelId: "test", target: "V5_FULL", image: window.reverseTest.asset },
        window.reverseTest.store.settings,
        [],
        ctrl.signal,
        () => {},
      );
      return false;
    } catch {
      return true;
    }
  });
  assert.equal(aborted, true);
  passed.push("cancelled recognition never returns a confirmed scene");
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({ passed: passed.length, cases: passed }, null, 2),
  );
} finally {
  await browser?.close();
  await server.close();
}
