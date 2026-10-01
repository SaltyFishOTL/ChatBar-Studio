import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { StudioProvider, useStudio } from "../src/ui/store";
import { Studio } from "../src/ui/Studio";
import { db, state, saveState } from "../src/data/db";
import {
  draftDefaults,
  settingsDefaults,
  type StudioDraft,
  type Character,
  type ImageModel,
} from "../src/domain/types";
import {
  activeCharacters,
  normalizedPrompt,
  validateDraft,
  copyPositive,
  pastePositive,
} from "../src/domain/promptPolicy";
import { buildRequest } from "../src/api/novelai";
import "../src/ui/styles.css";

const first: Character = {
  id: "first",
  prompt: 'first person, "private words"',
  negative: "first negative",
  center: { x: 0.1, y: 0.9 },
};
const second: Character = {
  id: "second",
  prompt: "second person",
  negative: "second negative",
  center: { x: 0.7, y: 0.3 },
  enabled: true,
};
const fixture = (): StudioDraft => ({
  ...draftDefaults("bad"),
  base: "scene",
  characters: structuredClone([first, second]),
});
const request = (d: StudioDraft) =>
  buildRequest(d, 123, 1, {
    parameters: {},
    width: 832,
    height: 1216,
    finish: async (b) => b,
  });
function assert(value: unknown, message: string): asserts value {
  if (!value) throw Error(message);
}
function run() {
  const passed: string[] = [];
  for (const model of ["V4_5_FULL", "V5_FULL"] as ImageModel[]) {
    const d = fixture();
    d.model = model;
    d.perModel[model].useCoords = true;
    assert(
      request(d).parameters.v4_prompt.caption.char_captions.length === 2,
      "legacy role active",
    );
    d.characters[0].enabled = false;
    const body = request(d);
    assert(
      !JSON.stringify(body).includes("first") &&
        !JSON.stringify(body).includes("private words"),
      "disabled role leaked into request",
    );
    assert(
      normalizedPrompt(d).characters.length === 1,
      "token input includes disabled role",
    );
    for (const key of ["v4_prompt", "v4_negative_prompt"] as const) {
      const captions = body.parameters[key].caption.char_captions;
      assert(
        captions.length === 1 && captions[0].centers[0].x === 0.7,
        "active role coordinate alignment",
      );
    }
    d.characters[0].enabled = true;
    assert(
      request(d).parameters.v4_prompt.caption.char_captions.length === 2,
      "restored role absent",
    );
    passed.push(
      model + " legacy active, filtered request/token inputs, restore",
    );
    d.characters = Array.from({ length: 30 }, (_, i) => ({
      ...first,
      id: String(i),
      enabled: false,
    }));
    validateDraft(d);
    const empty = request(d).parameters;
    assert(
      !empty.use_coords &&
        !empty.v4_prompt.use_coords &&
        !empty.v4_negative_prompt.use_coords,
      "all disabled coordinate flags",
    );
    assert(
      empty.v4_prompt.caption.char_captions.length === 0 &&
        empty.v4_negative_prompt.caption.char_captions.length === 0,
      "all disabled captions",
    );
    const pasted = pastePositive(copyPositive(d, false), d);
    assert(
      pasted.characters.length === d.characters.length &&
        d.characters.every((c, i) =>
          Object.entries(c).every(
            ([key, value]) =>
              JSON.stringify(pasted.characters[i][key as keyof Character]) ===
              JSON.stringify(value),
          ),
        ),
      "clipboard loses folded content",
    );
    passed.push(model + " all folded, effective capacity and clipboard");
  }
  return passed;
}
if (!(await state("draft"))) {
  await saveState("draft", fixture());
  await saveState("settings", { ...settingsDefaults("bad"), translate: false });
}
function Probe() {
  const store = useStudio();
  useEffect(() => {
    (window as any).characterRegression = {
      run,
      draft: store.draft,
      store,
      request: () => request(store.draft),
      persisted: () => state("draft"),
      active: () => activeCharacters(store.draft),
      saveHistory: async () => {
        const recipe = {
          id: "folded-history",
          createdAt: 1,
          draft: structuredClone(store.draft),
          images: [],
          request: {},
          requiredSourceMissing: false,
        };
        await (await db).put("history", recipe, recipe.id);
      },
      applyHistory: async () => {
        const recipe = await (await db).get("history", "folded-history");
        assert(recipe, "saved history missing");
        await store.applyHistory(recipe, 123, "full");
      },
    };
  }, [store]);
  return <Studio navigate={() => {}} onTool={() => {}} />;
}
createRoot(document.getElementById("root")!).render(
  <StudioProvider>
    <Probe />
  </StudioProvider>,
);
