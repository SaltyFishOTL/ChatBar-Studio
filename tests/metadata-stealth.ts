import { gzipSync, zlibSync } from "fflate";
import {
  pngMetadata,
  applyMetadata,
  stripMetadata,
} from "../src/domain/metadata";
import { encodePng, textChunk, bytesOf } from "../src/domain/images";
import { draftDefaults } from "../src/domain/types";
import {
  inflateMetadata,
  MAX_METADATA_BYTES,
} from "../src/domain/stealthAlpha";

const comment = {
  prompt: "中文 sky",
  uc: "bad",
  width: 832,
  height: 1216,
  steps: 28,
  seed: 42,
  sampler: "k_euler_ancestral",
  scale: 6,
  v4_prompt: {
    caption: {
      base_caption: "中文 sky",
      char_captions: [
        { char_caption: "blue eyes", centers: [{ x: 0.3, y: 0.7 }] },
      ],
    },
  },
  v4_negative_prompt: {
    caption: {
      base_caption: "bad",
      char_captions: [{ char_caption: "bad hands" }],
    },
  },
};
const metadata = { Source: "NovelAI Diffusion V5", Comment: comment };
function assert(value: unknown, message: string): asserts value {
  if (!value) throw Error(message);
}

export function stealthFixture(
  alpha: unknown = metadata,
  options: {
    compressed?: boolean;
    text?: string;
    textType?: string;
    bits?: number;
    badZip?: boolean;
  } = {},
) {
  const width = 96,
    height = 128;
  const raw = new TextEncoder().encode(
    typeof alpha === "string" ? alpha : JSON.stringify(alpha),
  );
  const compressed = options.compressed !== false;
  const payload = compressed ? gzipSync(raw) : raw;
  if (options.badZip) payload[0] = 0;
  const message = new Uint8Array(19 + payload.length);
  message.set(
    new TextEncoder().encode(
      compressed ? "stealth_pngcomp" : "stealth_pnginfo",
    ),
  );
  new DataView(message.buffer).setUint32(
    15,
    options.bits ?? payload.length * 8,
  );
  message.set(payload, 19);
  assert(message.length * 8 <= width * height, "fixture too large");
  const rows = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const bit = x * height + y;
      const low =
        alpha !== null && bit < message.length * 8
          ? (message[bit >> 3] >> (7 - (bit % 8))) & 1
          : 1;
      rows.set([128, 144, 160, 254 + low], y * (width * 4 + 1) + 1 + x * 4);
    }
  const header = new Uint8Array(13);
  new DataView(header.buffer).setUint32(0, width);
  new DataView(header.buffer).setUint32(4, height);
  header[8] = 8;
  header[9] = 6;
  const chunks = [{ type: "IHDR", data: header }];
  if (options.text !== undefined) {
    const t = new TextEncoder().encode(options.text);
    const key = new TextEncoder().encode("Comment\0");
    const type = options.textType ?? "tEXt";
    if (type === "tEXt") chunks.push(textChunk("Comment", options.text));
    else {
      const prefix = type === "iTXt" ? [1, 0, 0, 0] : [0];
      const zipped =
        type === "broken" ? new Uint8Array([1, 2, 3]) : zlibSync(t);
      chunks.push({
        type: type === "broken" ? "zTXt" : type,
        data: new Uint8Array([...key, ...prefix, ...zipped]),
      });
    }
  }
  chunks.push(
    { type: "IDAT", data: zlibSync(rows) },
    { type: "IEND", data: new Uint8Array() },
  );
  return encodePng(chunks);
}

export async function runStealth() {
  const passed: string[] = [];
  for (const compressed of [true, false])
    for (const stringComment of [true, false]) {
      const fixture = stealthFixture(
        {
          ...metadata,
          Comment: stringComment ? JSON.stringify(comment) : comment,
        },
        { compressed },
      );
      const before = Array.from(await bytesOf(fixture)).join();
      const found = await pngMetadata(fixture);
      assert(
        JSON.stringify(found) === JSON.stringify(metadata),
        "alpha fields differ",
      );
      const draft = applyMetadata(draftDefaults("bad"), found, {
        positive: true,
        negative: true,
        characters: "replace",
        parameters: true,
        seed: true,
      });
      assert(
        draft.base === comment.prompt &&
          draft.characters[0].negative === "bad hands",
        "alpha prompt import",
      );
      assert(
        draft.model === "V5_FULL" && draft.perModel.V5_FULL.seed === 42,
        "alpha parameters",
      );
      assert(
        before === Array.from(await bytesOf(fixture)).join(),
        "input modified",
      );
      passed.push(
        `alpha ${compressed ? "gzip" : "plain"} ${stringComment ? "string" : "object"} Comment`,
      );
    }
  for (const textType of ["tEXt", "zTXt", "iTXt"]) {
    const text = JSON.stringify({
      ...comment,
      v4_prompt: undefined,
      prompt: "file prompt",
    });
    const found = await pngMetadata(
      stealthFixture(metadata, { text, textType }),
    );
    assert((found.Comment as any).prompt === "file prompt", "file priority");
    const only = await pngMetadata(stealthFixture(null, { text, textType }));
    assert((only.Comment as any).prompt === "file prompt", "file only");
    passed.push(`${textType} file only and priority`);
  }
  for (const text of ["broken", "{}", JSON.stringify({ prompt: 12 })]) {
    const found = await pngMetadata(stealthFixture(metadata, { text }));
    assert(
      (found.Comment as any).prompt === comment.prompt,
      "bad file masks alpha",
    );
  }
  assert(
    (
      await pngMetadata(
        stealthFixture(metadata, { text: "broken", textType: "broken" }),
      )
    ).Source === metadata.Source,
    "corrupt file compression masks alpha",
  );
  passed.push("invalid file JSON and compression use valid alpha source");
  for (const options of [
    { bits: 0 },
    { bits: 1 },
    { bits: 0xffffffff },
    { badZip: true },
  ]) {
    assert(
      !(await pngMetadata(stealthFixture(metadata, options))).Comment,
      "corrupt alpha accepted",
    );
  }
  assert(
    !(await pngMetadata(stealthFixture(null))).Comment,
    "no metadata accepted",
  );
  assert(
    !(await pngMetadata(stealthFixture("broken JSON"))).Comment,
    "invalid JSON accepted",
  );
  passed.push("invalid alpha header lengths gzip and JSON rejected");
  let rejected = false;
  try {
    await inflateMetadata(
      gzipSync(new Uint8Array(MAX_METADATA_BYTES + 1)),
      "gzip",
    );
  } catch {
    rejected = true;
  }
  assert(rejected, "unbounded inflate");
  passed.push("decompression size bounded");
  const cleaned = await stripMetadata(
    stealthFixture(metadata, { text: JSON.stringify(comment) }),
  );
  assert(!(await pngMetadata(cleaned)).Comment, "privacy export left metadata");
  passed.push("privacy export removes file and alpha metadata");
  return passed;
}
