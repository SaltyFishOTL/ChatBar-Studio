import React from "react";
import { createRoot } from "react-dom/client";
import { gzipSync, unzlibSync, zlibSync } from "fflate";
import {
  encodePrivacyPixels,
  privacyCanvasBlob,
  webpAnimated,
} from "../src/domain/imagePrivacy";
import {
  bytesOf,
  canvas,
  encodePng,
  parsePng,
  textChunk,
} from "../src/domain/images";
import { stripMetadata } from "../src/domain/metadata";
import { StudioProvider } from "../src/ui/store";
import { ToolsPage } from "../src/ui/Tools";
import "../src/ui/styles.css";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw Error(message);
}
const width = 64,
  height = 80;
function fixture(signature = "stealth_pngcomp", damaged = false) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let p = 0; p < pixels.length; p += 4)
    pixels.set([128, 144, 160, 255], p);
  const secret = new TextEncoder().encode(
    '{"Comment":"private prompt seed 1234"}',
  );
  const payload = signature.endsWith("comp") ? gzipSync(secret) : secret;
  const header = new TextEncoder().encode(signature);
  const message = new Uint8Array(header.length + 4 + payload.length);
  message.set(header);
  new DataView(message.buffer).setUint32(header.length, payload.length * 8);
  message.set(payload, header.length + 4);
  if (damaged) message[0] = 0;
  const alpha = signature.startsWith("stealth_png");
  for (let bit = 0; bit < message.length * 8; bit++) {
    const ordinal = Math.floor(bit / (alpha ? 1 : 3));
    const index =
      ((ordinal % height) * width + Math.floor(ordinal / height)) * 4 +
      (alpha ? 3 : bit % 3);
    pixels[index] =
      (pixels[index] & 254) | ((message[bit >> 3] >> (7 - (bit % 8))) & 1);
  }
  // Positive control: independently reconstruct every byte before attempting removal.
  for (let bit = 0; bit < message.length * 8; bit++) {
    const ordinal = Math.floor(bit / (alpha ? 1 : 3));
    const channel = alpha ? 3 : bit % 3;
    const p =
      ((ordinal % height) * width + Math.floor(ordinal / height)) * 4 + channel;
    assert(
      (pixels[p] & 1) === ((message[bit >> 3] >> (7 - (bit % 8))) & 1),
      "fixture payload",
    );
  }
  const headerBytes = new Uint8Array(13);
  new DataView(headerBytes.buffer).setUint32(0, width);
  new DataView(headerBytes.buffer).setUint32(4, height);
  headerBytes[8] = 8;
  headerBytes[9] = 6;
  const rows = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; y++)
    rows.set(
      pixels.subarray(y * width * 4, (y + 1) * width * 4),
      y * (width * 4 + 1) + 1,
    );
  return encodePng([
    { type: "IHDR", data: headerBytes },
    textChunk("Comment", "private prompt"),
    textChunk("ChatBarStudio", "private recipe"),
    { type: "IDAT", data: zlibSync(rows) },
    { type: "IEND", data: new Uint8Array() },
  ]);
}
async function assertClean(blob: Blob, w = width, h = height, opaque = true) {
  const chunks = parsePng(await bytesOf(blob));
  assert(
    chunks.map((c) => c.type).join(",") === "IHDR,sRGB,IDAT,IEND",
    "metadata or unexpected chunks survived",
  );
  const header = new DataView(chunks[0].data.buffer);
  assert(
    header.getUint32(0) === w && header.getUint32(4) === h,
    "dimensions changed",
  );
  const raw = unzlibSync(chunks[2].data);
  for (let y = 0; y < h; y++) {
    assert(raw[y * (w * 4 + 1)] === 0, "unexpected row filter");
    for (let x = 0; x < w; x++) {
      const offset = y * (w * 4 + 1) + 1 + x * 4;
      assert(
        [0, 1, 2].every((c) => !(raw[offset + c] & 1)),
        "RGB payload survived",
      );
      const a = raw[offset + 3];
      assert(
        opaque ? a === 255 : a === 255 || !(a & 1),
        "alpha payload survived",
      );
      if (!a)
        assert(
          [0, 1, 2].every((c) => raw[offset + c] === 0),
          "transparent RGB survived",
        );
    }
  }
}
async function run() {
  const passed: string[] = [];
  for (const signature of [
    "stealth_pnginfo",
    "stealth_pngcomp",
    "stealth_rgbinfo",
    "stealth_rgbcomp",
  ]) {
    for (const damaged of [false, true]) {
      const source = fixture(signature, damaged),
        before = await bytesOf(source);
      await assertClean(await stripMetadata(source));
      const after = await bytesOf(source);
      assert(
        before.every((b, i) => b === after[i]),
        "source changed",
      );
      passed.push(signature + (damaged ? " damaged header" : " intact header"));
    }
  }
  const pixels = new Uint8ClampedArray([
    123, 45, 67, 0, 123, 45, 67, 1, 123, 45, 67, 128, 123, 45, 67, 129, 123, 45,
    67, 254, 123, 45, 67, 255,
  ]);
  const before = pixels.slice();
  const clean = encodePrivacyPixels({ width: 6, height: 1, data: pixels });
  await assertClean(clean, 6, 1, false);
  assert(
    before.every((b, i) => b === pixels[i]),
    "input ImageData mutated",
  );
  const raw = unzlibSync(parsePng(await bytesOf(clean))[2].data);
  assert(
    [0, 0, 128, 128, 255, 255].every((a, i) => raw[4 + i * 4] === a),
    "transparency changed unexpectedly",
  );
  passed.push("transparency endpoints and source immutability");
  const c = canvas(width, height),
    bitmap = await createImageBitmap(fixture());
  c.getContext("2d")!.drawImage(bitmap, 0, 0);
  bitmap.close();
  await assertClean(privacyCanvasBlob(c));
  passed.push("edited canvas export");
  for (const type of ["image/webp", "image/jpeg"]) {
    const blob = await new Promise<Blob>((resolve, reject) =>
      c.toBlob((b) => (b ? resolve(b) : reject(Error("encode"))), type, 1),
    );
    assert(blob.type === type, "browser did not produce requested format");
    await assertClean(await stripMetadata(blob));
    passed.push(type + " decoded export");
  }
  const chunks = parsePng(await bytesOf(fixture()));
  const apng = encodePng([
    chunks[0],
    { type: "acTL", data: new Uint8Array([0, 0, 0, 1, 0, 0, 0, 0]) },
    ...chunks.slice(1),
  ]);
  const webp = new Uint8Array(30);
  webp.set(new TextEncoder().encode("RIFF"));
  new DataView(webp.buffer).setUint32(4, 22, true);
  webp.set(new TextEncoder().encode("WEBPVP8X"), 8);
  new DataView(webp.buffer).setUint32(16, 10, true);
  webp[20] = 2;
  assert(webpAnimated(webp), "animated WebP not detected");
  for (const blob of [
    apng,
    new Blob(["GIF89a"]),
    new Blob([webp]),
    new Blob(["broken"]),
    new Blob(),
  ]) {
    let rejected = false;
    try {
      await stripMetadata(blob);
    } catch {
      rejected = true;
    }
    assert(rejected, "unsupported source returned a false success");
  }
  passed.push("APNG/GIF/animated WebP/corrupt/empty inputs rejected");
  return passed;
}
(window as any).privacyRegression = { run, fixture, assertClean };
createRoot(document.getElementById("root")!).render(
  <StudioProvider>
    <ToolsPage initialAsset="" onApply={() => {}} />
  </StudioProvider>,
);
