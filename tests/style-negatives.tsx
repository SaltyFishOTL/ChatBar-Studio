import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { StudioProvider, useStudio } from "../src/ui/store";
import { Studio } from "../src/ui/Studio";
import { Styles } from "../src/ui/Styles";
import { db, state, saveState } from "../src/data/db";
import {
  exportCard,
  importCard,
  exportBackup,
  stageBackup,
} from "../src/data/backup";
import {
  draftDefaults,
  settingsDefaults,
  type ImageModel,
  type StyleCard,
} from "../src/domain/types";
import { applyStyleCard, clearStudioPrompts } from "../src/domain/stylePolicy";
import { buildRequest } from "../src/api/novelai";
import "../src/ui/styles.css";
const card: StyleCard = {
  id: "personal",
  name: "Synthetic card",
  prompt: "synthetic style",
  negative: " card negative ",
  avatar: "",
  createdAt: 1,
  updatedAt: 1,
};
if (!(await state("settings"))) {
  await saveState("settings", {
    ...settingsDefaults("configured default"),
    translate: false,
  });
  await (await db).put("cards", card, card.id);
}
function check(v: unknown, m: string) {
  if (!v) throw Error(m);
}
async function run() {
  const passed: string[] = [];
  const original = {
    ...draftDefaults("manual"),
    base: "scene",
    extra: "extra",
    characters: [
      {
        id: "role",
        prompt: "person",
        negative: "role negative",
        center: { x: 0.5, y: 0.5 },
      },
    ],
  };
  const applied = applyStyleCard(original, card, "default");
  check(
    applied.negative === "card negative" &&
      applied.base === "scene" &&
      applied.characters === original.characters,
    "apply isolation",
  );
  for (const model of ["V4_5_FULL", "V5_FULL"] as ImageModel[]) {
    const body = buildRequest({ ...applied, model }, 123, 1, {
      parameters: {},
      width: 832,
      height: 1216,
      finish: async (b) => b,
    });
    check(
      body.parameters.negative_prompt === "card negative" &&
        body.parameters.v4_negative_prompt.caption.base_caption ===
          "card negative",
      model + " request negative",
    );
    passed.push(model + " request negative");
  }
  check(
    applyStyleCard(original, { ...card, negative: undefined }, "default")
      .negative === "default",
    "legacy default",
  );
  check(
    applyStyleCard(original, { ...card, negative: "  " }, "default")
      .negative === "default",
    "blank default",
  );
  passed.push("legacy and blank card defaults");
  const cleared = clearStudioPrompts(
    applied,
    [{ ...card, negative: "updated" }],
    "default",
  );
  check(
    cleared.negative === "updated" &&
      !cleared.style &&
      !cleared.base &&
      !cleared.extra &&
      cleared.characters.length === 0 &&
      cleared.perModel === applied.perModel &&
      cleared.guidance === applied.guidance &&
      cleared.appliedStyleCardId === card.id,
    "clear retains settings and uses current card",
  );
  check(
    clearStudioPrompts(applied, [], "default").negative === "default",
    "deleted card default",
  );
  passed.push("clear current card, deleted card, retained parameters");
  await importCard(new File([await exportCard(card)], "card.json"));
  check(
    (await (await db).getAll("cards")).some(
      (c) => c.id !== card.id && c.negative === card.negative,
    ),
    "card round trip",
  );
  await importCard(
    new File(
      [
        JSON.stringify({
          format: "chatbar-style-card",
          version: 1,
          card: { name: "Legacy", prompt: "old" },
        }),
      ],
      "legacy.json",
    ),
  );
  const before = await (await db).count("cards");
  let rejected = false;
  try {
    await importCard(
      new File(
        [
          JSON.stringify({
            format: "chatbar-style-card",
            version: 1,
            card: { name: "Bad", prompt: "x", negative: 42 },
          }),
        ],
        "bad.json",
      ),
    );
  } catch {
    rejected = true;
  }
  check(
    rejected && (await (await db).count("cards")) === before,
    "invalid import atomic",
  );
  passed.push(
    "card export import, legacy compatibility, invalid import atomic",
  );
  const staged = await stageBackup(
    new File([await exportBackup()], "backup.zip"),
  );
  check(
    staged.cards.some((c) => c.id === card.id && c.negative === card.negative),
    "backup negative",
  );
  passed.push("full backup preserves card negatives");
  return passed;
}
function Probe() {
  const store = useStudio();
  const [library, setLibrary] = useState(false);
  useEffect(() => {
    (window as any).negativeRegression = { store, run };
  }, [store]);
  return (
    <>
      <button onClick={() => setLibrary(!library)}>Toggle library</button>
      {library ? <Styles /> : <Studio navigate={() => {}} onTool={() => {}} />}
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <StudioProvider>
    <Probe />
  </StudioProvider>,
);
