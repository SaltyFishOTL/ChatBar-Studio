import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { StudioProvider, useStudio } from "../src/ui/store";
import { ToolsPage } from "../src/ui/Tools";
import { putAsset, saveState } from "../src/data/db";
import { setKey } from "../src/data/vault";
import { settingsDefaults, draftDefaults } from "../src/domain/types";
import "../src/ui/styles.css";
const model = {
  id: "test",
  name: "test",
  baseUrl: "https://offline.test/v1",
  model: "test",
  isMultimodal: true,
  visionModelId: "",
  reasoningEffort: "high",
  thinking: "on" as const,
  maxTokens: 1234,
  outputTokenParameter: "max_tokens" as const,
  supportsJsonMode: false,
  customParams: { temperature: 0.65 },
};
await setKey(model.id, "synthetic-key");
await saveState("settings", {
  ...settingsDefaults("default"),
  models: [model],
  designModelId: model.id,
  naturalLanguage: true,
  translate: false,
});
await saveState("draft", {
  ...draftDefaults("negative"),
  style: "kept style",
  base: "old base",
  characters: [
    {
      id: "role",
      prompt: "old role",
      negative: "kept negative",
      center: { x: 0.5, y: 0.5 },
    },
  ],
});
const c = document.createElement("canvas");
c.width = c.height = 16;
const blob = await new Promise<Blob>((resolve) =>
  c.toBlob((b) => resolve(b!), "image/png"),
);
const asset = await putAsset(blob);
function Probe() {
  const store = useStudio();
  useEffect(() => {
    (window as any).reverseTest = { store, asset };
  }, [store]);
  return <ToolsPage initialAsset={asset} onApply={() => {}} />;
}
createRoot(document.getElementById("root")!).render(
  <StudioProvider>
    <Probe />
  </StudioProvider>,
);
