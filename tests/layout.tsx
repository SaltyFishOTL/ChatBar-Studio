import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { StudioProvider, useStudio } from "../src/ui/store";
import { App } from "../src/ui/App";
import { db, state, saveState, putAsset, changed } from "../src/data/db";
import {
  draftDefaults,
  settingsDefaults,
  type Recipe,
} from "../src/domain/types";
import { canvas, canvasBlob } from "../src/domain/images";
import "../src/ui/styles.css";

const draft = {
  ...draftDefaults("bad"),
  base: "mountain landscape, quiet lake, morning light",
  characters: [
    {
      id: "role",
      prompt: "traveler, blue coat",
      negative: "",
      center: { x: 0.5, y: 0.5 },
    },
  ],
};
async function makeRecipe(index: number): Promise<Recipe> {
  const c = canvas(768, 1024),
    ctx = c.getContext("2d")!;
  const gradient = ctx.createLinearGradient(0, 0, 0, 1024);
  gradient.addColorStop(0, `hsl(${190 + index * 5} 40% 75%)`);
  gradient.addColorStop(1, "#edf3eb");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 768, 1024);
  ctx.fillStyle = "#f9f4d5";
  ctx.beginPath();
  ctx.arc(510, 245, 95, 0, Math.PI * 2);
  ctx.fill();
  for (let k = 0; k < 3; k++) {
    ctx.fillStyle = ["#839e95", "#526f69", "#294b49"][k];
    ctx.beginPath();
    ctx.moveTo(0, 670 + k * 90);
    ctx.lineTo(250 + k * 150, 390 + k * 110);
    ctx.lineTo(768, 760 + k * 70);
    ctx.lineTo(768, 1024);
    ctx.lineTo(0, 1024);
    ctx.fill();
  }
  ctx.fillStyle = "#fff";
  ctx.font = "28px sans-serif";
  ctx.fillText(`Landscape ${index + 1}`, 36, 960);
  const asset = await putAsset(await canvasBlob(c));
  return {
    id: `recipe-${index}`,
    createdAt: index + 1,
    draft,
    images: [{ asset, seed: index + 100 }],
    request: {},
    requiredSourceMissing: false,
  };
}
if (!(await state("layout-fixture"))) {
  await saveState("draft", draft);
  await saveState("settings", { ...settingsDefaults("bad"), translate: false });
  for (let i = 0; i < 35; i++) {
    const recipe = await makeRecipe(i);
    await (await db).put("history", recipe, recipe.id);
  }
  await saveState("layout-fixture", true);
}
function Probe() {
  const store = useStudio();
  useEffect(() => {
    (window as any).layoutRegression = {
      store,
      async prepend() {
        const recipe = await makeRecipe(99);
        await (await db).put("history", recipe, recipe.id);
        changed();
      },
    };
  }, [store]);
  return <App />;
}
createRoot(document.getElementById("root")!).render(
  <StudioProvider>
    <Probe />
  </StudioProvider>,
);
