import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { StudioProvider, useStudio } from "../src/ui/store";
import { ToolsPage } from "../src/ui/Tools";
import { state, saveState } from "../src/data/db";
import { draftDefaults, settingsDefaults } from "../src/domain/types";
import { applyMetadata, type MetadataSections } from "../src/domain/metadata";
import {
  canvas,
  canvasBlob,
  bytesOf,
  parsePng,
  encodePng,
  textChunk,
} from "../src/domain/images";
import "../src/ui/styles.css";

const original = {
  id: "old",
  prompt: "old person",
  negative: "old negative",
  center: { x: 0.3, y: 0.7 },
  enabled: false,
};
const draft = () => ({
  ...draftDefaults("bad"),
  base: "keep base",
  characters: [structuredClone(original)],
});
const metadata = {
  Source: "NovelAI Diffusion V4.5",
  Comment: {
    v4_prompt: {
      caption: {
        base_caption: "imported base",
        char_captions: [
          { char_caption: "alice", centers: [{ x: 0.9, y: 0.1 }] },
          { char_caption: "bob", centers: [{ x: 0.5, y: 0.5 }] },
        ],
      },
    },
    v4_negative_prompt: {
      caption: {
        base_caption: "imported negative",
        char_captions: [
          { char_caption: "bad alice" },
          { char_caption: "bad bob" },
        ],
      },
    },
  },
};
const sections: MetadataSections = {
  positive: false,
  negative: false,
  characters: "append",
  parameters: false,
  seed: false,
};
function assert(value: unknown, message: string): asserts value {
  if (!value) throw Error(message);
}
function run() {
  const d = draft(),
    before = JSON.stringify(d),
    appended = applyMetadata(d, metadata, sections);
  assert(JSON.stringify(d) === before, "source draft mutated");
  assert(
    JSON.stringify(appended.characters[0]) === JSON.stringify(original),
    "existing role changed",
  );
  assert(
    appended.characters.map((c) => c.prompt).join() === "old person,alice,bob",
    "append order",
  );
  assert(
    appended.characters[1].negative === "bad alice" &&
      appended.characters[1].center.x === 0.9,
    "imported fields",
  );
  assert(
    appended.characters.slice(1).every((c) => c.enabled !== false),
    "new roles should be enabled",
  );
  const again = applyMetadata(appended, metadata, sections);
  assert(
    new Set(again.characters.map((c) => c.id)).size === 5,
    "repeated import needs new identities",
  );
  const off = applyMetadata(d, metadata, { ...sections, characters: "off" });
  assert(JSON.stringify(off) === before, "off changed draft");
  const replaced = applyMetadata(d, metadata, {
    ...sections,
    characters: "replace",
  });
  assert(
    replaced.characters.map((c) => c.prompt).join() === "alice,bob",
    "replace behavior",
  );
  for (const mode of ["off", "replace", "append"] as const) {
    const absent = applyMetadata(
      d,
      { Comment: {} },
      { ...sections, characters: mode },
    );
    assert(JSON.stringify(absent) === before, "missing metadata erased role");
  }
  const empty = { Comment: { v4_prompt: { caption: { char_captions: [] } } } };
  assert(
    applyMetadata(d, empty, sections).characters.length === 1,
    "append empty",
  );
  assert(
    applyMetadata(d, empty, { ...sections, characters: "replace" }).characters
      .length === 0,
    "replace empty",
  );
  const many = {
    ...d,
    characters: Array.from({ length: 6 }, (_, i) => ({
      ...original,
      id: String(i),
      enabled: true,
    })),
  };
  let rejected = false;
  try {
    applyMetadata(many, metadata, sections);
  } catch {
    rejected = true;
  }
  assert(
    rejected && many.characters.length === 6,
    "overflow must leave original intact",
  );
  return [
    "append preserves identity state fields and order",
    "repeated append uses unique IDs",
    "off and replace",
    "missing and empty roles",
    "overflow rejects without mutation",
  ];
}
async function fixture() {
  const c = canvas(32, 32);
  c.getContext("2d")!.fillRect(0, 0, 32, 32);
  const chunks = parsePng(await bytesOf(await canvasBlob(c)));
  return encodePng([
    ...chunks.slice(0, -1),
    textChunk("Comment", JSON.stringify(metadata.Comment)),
    textChunk("Source", metadata.Source),
    chunks[chunks.length - 1],
  ]);
}
if (!(await state("draft"))) {
  await saveState("draft", draft());
  await saveState("settings", { ...settingsDefaults("bad"), translate: false });
}
function Probe() {
  const store = useStudio();
  useEffect(() => {
    (window as any).importRegression = {
      run,
      fixture,
      store,
      draft: store.draft,
    };
  }, [store]);
  return <ToolsPage initialAsset="" onApply={() => {}} />;
}
createRoot(document.getElementById("root")!).render(
  <StudioProvider>
    <Probe />
  </StudioProvider>,
);
