import {
  draftDefaults,
  settingsDefaults,
  type StyleCard,
  type ModelConfig,
} from "../src/domain/types";
import { applyStyleCard } from "../src/domain/stylePolicy";
import {
  samplersFor,
  compatibleSampler,
} from "../src/domain/imageCapabilities";
import { buildRequest } from "../src/api/novelai";
import {
  db,
  state,
  loadHistoryCompact,
  resolveVibePayload,
  putAsset,
  VIBE_ASSET_PREFIX,
} from "../src/data/db";
import {
  exportCard,
  importCard,
  exportBackup,
  stageBackup,
} from "../src/data/backup";
import { designTurn } from "../src/domain/design";
import { setKey } from "../src/data/vault";
const check = (v: unknown, m: string) => {
  if (!v) throw Error(m);
};
export async function runAdvancedRegression() {
  const passed: string[] = [];
  const original = draftDefaults("negative");
  const profile = {
    model: "V5_FULL" as const,
    sampler: "k_dpmpp_2m_sde",
    steps: 39,
    guidance: 7.1,
    cfgRescale: 0.3,
    varietyPlus: true,
  };
  const card: StyleCard = {
    id: "advanced",
    name: "advanced",
    prompt: "style",
    avatar: "",
    createdAt: 1,
    updatedAt: 1,
    imageSettings: profile,
  };
  const applied = applyStyleCard(
    original,
    { ...card, imageSettings: { ...profile, width: 64, seed: 999 } as any },
    "default",
  );
  check(
    applied.model === "V5_FULL" && applied.perModel.V5_FULL.steps === 39,
    "card applies profile",
  );
  check(
    applied.perModel.V5_FULL.width === original.perModel.V5_FULL.width &&
      applied.perModel.V5_FULL.seed === original.perModel.V5_FULL.seed,
    "card must not change size or seed",
  );
  passed.push("card advanced settings preserve dimensions and seed");
  for (const model of ["V4_5_FULL", "V5_FULL"] as const) {
    for (const enabled of [false, true]) {
      const draft = structuredClone(applied);
      draft.model = model;
      draft.perModel[model].varietyPlus = enabled;
      draft.perModel[model].sampler = "ddim_v3";
      const p = buildRequest(draft, 123, 1, {
        parameters: model === "V5_FULL" ? { skip_cfg_above_sigma: 58 } : {},
        width: 832,
        height: 1216,
        finish: async (b) => b,
      }).parameters;
      check(
        p.sampler === compatibleSampler(model, "ddim_v3"),
        "legacy sampler compatibility",
      );
      check(
        model === "V5_FULL"
          ? !("skip_cfg_above_sigma" in p)
          : p.skip_cfg_above_sigma === (enabled ? 58 : null),
        "V+ model capability",
      );
    }
    check(
      samplersFor(model).every(([id]) => id !== "ddim_v3"),
      "unsupported sampler hidden",
    );
  }
  passed.push("sampler compatibility and V+ request gating for both models");
  await importCard(new File([await exportCard(card)], "advanced.json"));
  check(
    (await (await db).getAll("cards")).some(
      (c) => c.imageSettings?.steps === 39,
    ),
    "advanced card roundtrip",
  );
  passed.push("advanced card import export roundtrip");
  const asset = await putAsset(new Blob(["image"], { type: "image/png" }));
  const legacy = draftDefaults("negative");
  legacy.style = "preserved fold style";
  legacy.guidance.vibes = [
    {
      asset,
      encoding: "A".repeat(8 * 1024 * 1024),
      strength: 0.6,
      information: 1,
    },
  ];
  await (await db).put("state", legacy, "draft");
  for (let i = 0; i < 8; i++)
    await (
      await db
    ).put(
      "history",
      {
        id: "large-" + i,
        createdAt: i,
        draft: legacy,
        images: [{ asset, seed: i }],
        request: { large: "X".repeat(1024 * 1024) },
        requiredSourceMissing: false,
      },
      "large-" + i,
    );
  const restored = await state<typeof legacy>("draft");
  check(
    restored?.guidance.vibes[0].encoding?.startsWith(VIBE_ASSET_PREFIX),
    "legacy draft compaction",
  );
  check(
    (await resolveVibePayload(restored!.guidance.vibes[0].encoding!)).length ===
      8 * 1024 * 1024,
    "lossless payload",
  );
  const history = await loadHistoryCompact();
  check(
    history.length === 8 && JSON.stringify(history).length < 65536,
    "history bounded resident payloads",
  );
  check(
    history.every(
      (h) => h.draft.style === legacy.style && h.images[0].seed === h.createdAt,
    ),
    "history grouping and seeds preserved",
  );
  check(
    !!(await (await db).get("history", "large-0"))!.request.large,
    "raw request retained on disk",
  );
  const count = await (await db).count("assets");
  await loadHistoryCompact();
  check((await (await db).count("assets")) === count, "migration idempotent");
  passed.push(
    "64 MB legacy history cursor migration preserves recipes and grouping",
  );
  const backup = await stageBackup(
    new File([await exportBackup()], "test.zip"),
  );
  check(!!backup, "externalized payload full backup validates");
  passed.push("backup retains and validates external payload assets");
  const model: ModelConfig = {
    id: "text-test",
    name: "text",
    baseUrl: "https://offline.test/v1",
    model: "text",
    isMultimodal: false,
    visionModelId: "vision-test",
    reasoningEffort: "low",
    thinking: "off",
    maxTokens: 77,
    outputTokenParameter: "max_tokens",
    supportsJsonMode: false,
    customParams: {},
  };
  const vision: ModelConfig = {
    ...model,
    id: "vision-test",
    model: "vision",
    isMultimodal: true,
    reasoningEffort: "high",
    thinking: "on",
    maxTokens: 1234,
    customParams: { temperature: 0.65, thinking_budget: 4096 },
  };
  await setKey(vision.id, "synthetic-key");
  const controller = new AbortController(),
    fetchOriginal = window.fetch;
  let captured: any;
  window.fetch = async (input, init) => {
    if (String(input).includes("offline.test")) {
      captured = JSON.parse(String(init?.body));
      controller.abort();
      throw new DOMException("test stop", "AbortError");
    }
    return fetchOriginal(input, init);
  };
  try {
    await designTurn(
      { turns: [], references: [], extraRequirement: "" } as any,
      {
        id: "turn",
        modelId: model.id,
        image: asset,
        target: "V4_5_FULL",
        natural: false,
        text: "test",
      } as any,
      { ...settingsDefaults("negative"), models: [model, vision] },
      controller.signal,
      () => {},
    );
  } catch {
  } finally {
    window.fetch = fetchOriginal;
  }
  check(
    captured?.model === "vision" &&
      captured.reasoning_effort === "high" &&
      captured.enable_thinking === true &&
      captured.thinking_budget === 4096 &&
      captured.temperature === 0.65 &&
      captured.max_tokens === 1234,
    "selected vision parameters reach request",
  );
  passed.push("reverse prompting inherits selected vision model parameters");
  return passed;
}
