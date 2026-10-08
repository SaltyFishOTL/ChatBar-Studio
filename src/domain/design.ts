import {
  MODELS,
  type DesignConversation,
  type DesignReply,
  type DesignTurn,
  type Evidence,
  type Settings,
} from "./types";
import {
  promptConstants,
  plannerInput,
  referencePrompt,
  firstDesignInput,
  sceneDescriptionSystem,
  sceneHistory,
  evidencePrompt,
  codexPrompt,
  revisionPrompt,
  revisionResearch,
} from "./prompts";
import {
  complete,
  TerminalModelError,
  type Message,
  type Part,
} from "../api/llm";
import { researchTags, recallCodex, rpc } from "../data/catalog";
import { assetBlob } from "../data/db";
import { blobBase64 } from "./images";
import { postprocess, type RewriteRule } from "./postprocess";
import { jsonObjectCandidates } from "./jsonCandidates";
export type DesignProgress = { stage: string; text: string; reasoning: string };
export function parseJson(raw: string) {
  const text = raw
    .trim()
    .replace(/^```(?:json)?\s*/, "")
    .replace(/\s*```$/, "");
  const first = text.indexOf("{"),
    last = text.lastIndexOf("}");
  if (first < 0 || last < first) throw Error("没有找到 JSON");
  return JSON.parse(text.slice(first, last + 1));
}
export function validateReply(value: any, limit: number): DesignReply {
  const base = value?.baseCaption?.trim()
    ? value.baseCaption
    : value?.scenePrompt;
  if (typeof base !== "string" || !base.trim())
    throw Error("设计结果缺少基础/角色提示词");
  const characters = value.characters ?? [];
  if (
    !Array.isArray(characters) ||
    !characters.every(
      (c: any) => c && typeof (c.caption ?? c.adjustment ?? "") === "string",
    )
  )
    throw Error("角色提示词格式无效");
  const size = String(value.sizePreset || "")
    .trim()
    .replace(/[- ]/g, "_")
    .toUpperCase();
  return {
    sizePreset: ["SQUARE", "NORMAL_SQUARE"].includes(size)
      ? "SQUARE"
      : [
            "HORIZONTAL",
            "LANDSCAPE",
            "NORMAL_HORIZONTAL",
            "NORMAL_LANDSCAPE",
          ].includes(size)
        ? "HORIZONTAL"
        : "PORTRAIT",
    baseCaption: base,
    characters: characters
      .slice(0, limit)
      .map((c: any) => ({
        caption: (c.caption?.trim() ? c.caption : c.adjustment || "").trim(),
      }))
      .filter((c) => c.caption),
  };
}

function plannerDecision(
  parsed: any,
  refs: { name: string; prompt: string }[],
  queriesOnly: boolean,
) {
  const normalize = (s: string) => s.replace(/\s+/g, " ").trim();
  const key = (s: string) =>
    s
      .replace(/[{}\[\]()]/g, "")
      .replace(/[:：]\s*[+-]?\d+(\.\d+)?$/, "")
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[\s_]+/g, "");
  const existing = new Set(
    refs
      .flatMap((r) => [
        r.name,
        ...r.name.split(/[\/;；()（）]/),
        ...r.prompt.split(/[,\n;；]/),
      ])
      .map(key),
  );
  const rawQueries = parsed.queries ?? parsed.keywords;
  if (queriesOnly && rawQueries === undefined)
    throw Error("检索规划缺少 queries");
  let values: unknown[] = Array.isArray(rawQueries)
    ? rawQueries.map((q) =>
        typeof q === "object" && q ? (q.query ?? q.keyword ?? q.term) : q,
      )
    : [];
  if (!values.length) values = [parsed.query ?? parsed.keyword ?? parsed.term];
  const seen = new Set<string>();
  const queries = values
    .filter((q): q is string => typeof q === "string")
    .map((q) => normalize(q).slice(0, 80))
    .filter((q) => {
      const k = q.toLowerCase();
      if (q.length < 2 || seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 6)
    .filter((q) => !existing.has(key(q)));
  const scene = normalize(
    String(
      parsed.sceneDescription ??
        parsed.scene_description ??
        parsed.imageDescription ??
        parsed.image_description ??
        "",
    ),
  );
  if (!queriesOnly && !scene) throw Error("画面规划缺少 sceneDescription");
  if (!queriesOnly) {
    const action = String(
      parsed.action ??
        parsed.type ??
        ((parsed.needSearch ?? parsed.need_search) === false ? "finish" : ""),
    )
      .trim()
      .toLowerCase();
    if (["finish", "done", "stop", "结束", "完成"].includes(action))
      queries.length = 0;
    else if (
      action &&
      !["search", "query", "lookup", "搜索", "查询"].includes(action)
    )
      throw Error("画面规划 action 无效");
  }
  return { queries, scene };
}
export async function recognizeReverseScene(
  turn: DesignTurn,
  settings: Settings,
  references: { name: string; prompt: string }[],
  signal: AbortSignal,
  update: (p: DesignProgress) => void,
): Promise<string> {
  const model = settings.models.find((m) => m.id === turn.modelId);
  if (!model) throw Error("所选 LLM 已不存在，请重新选择");
  if (!turn.image) throw Error("请先选择图片");
  const p = await promptConstants();
  const vision = model.isMultimodal
    ? model
    : settings.models.find((m) => m.id === model.visionModelId);
  if (!vision?.isMultimodal)
    throw Error("当前模型不支持图片，请配置关联视觉模型");
  const blob = await assetBlob(turn.image);
  const image: Part = {
    type: "image_url",
    image_url: {
      url: `data:${blob.type || "image/png"};base64,${await blobBase64(blob)}`,
    },
  };
  const raw = await complete(
    vision,
    [
      {
        role: "system",
        content: model.isMultimodal
          ? p.NOVELAI_TAG_SEARCH_PLANNER_SYSTEM
          : p.IMAGE_DESCRIPTION_PROMPT,
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: model.isMultimodal
              ? plannerInput(
                  p.novelAiImageReversePromptUser.replaceAll(
                    "$targetImageModel",
                    MODELS[turn.target].name,
                  ),
                  references,
                  false,
                )
              : "",
          },
          image,
        ],
      },
    ],
    signal,
    (v) => update({ stage: "识别图片场景", ...v }),
    false,
    model.isMultimodal,
  );
  signal.throwIfAborted();
  if (!model.isMultimodal) {
    if (!raw.text.trim()) throw Error("图片识别未返回场景描述");
    return raw.text.trim();
  }
  for (const candidate of jsonObjectCandidates(raw.text)) {
    try {
      return plannerDecision(JSON.parse(candidate), references, false).scene;
    } catch {
      /* Try the next complete JSON object. */
    }
  }
  throw Error("图片识别未返回有效 sceneDescription");
}

export async function designTurn(
  conversation: DesignConversation,
  turn: DesignTurn,
  settings: Settings,
  signal: AbortSignal,
  update: (p: DesignProgress) => void,
  confirmedSceneDescription?: string,
): Promise<{
  reply: DesignReply;
  raw: string;
  reasoning: string;
  evidence: Evidence;
}> {
  const model = settings.models.find((m) => m.id === turn.modelId);
  if (!model) throw Error("所选 LLM 已不存在，请重新选择");
  const p = await promptConstants(),
    index = conversation.turns.findIndex((t) => t.id === turn.id),
    prefix = conversation.turns.slice(
      0,
      index < 0 ? conversation.turns.length : index,
    ),
    previous =
      turn.attachment || [...prefix].reverse().find((t) => t.reply)?.reply;
  const natural = turn.natural,
    refs = conversation.references,
    extra = conversation.extraRequirement;
  if (natural && turn.target !== "V5_FULL")
    throw Error("自然语言模式仅支持 V5");
  if (turn.reverse && !confirmedSceneDescription?.trim())
    throw Error("请先确认场景描述");
  let image: Part | undefined,
    visionDescription = confirmedSceneDescription ?? "";
  if (turn.image && confirmedSceneDescription === undefined) {
    const blob = await assetBlob(turn.image);
    image = {
      type: "image_url",
      image_url: {
        url: `data:${blob.type || "image/png"};base64,${await blobBase64(blob)}`,
      },
    };
    if (!model.isMultimodal) {
      const vision = settings.models.find((m) => m.id === model.visionModelId);
      if (!vision?.isMultimodal)
        throw Error("当前模型不支持图片，请配置关联视觉模型");
      const r = await complete(
        vision,
        [
          { role: "system", content: p.IMAGE_DESCRIPTION_PROMPT },
          {
            role: "user",
            content: [{ type: "text", text: "" }, image],
          },
        ],
        signal,
        (v) => update({ stage: "图片理解", ...v }),
        false,
        false,
      );
      visionDescription = r.text.replace(/\s+/g, " ").trim();
      image = undefined;
    }
  }
  const user = previous
    ? revisionPrompt(turn.text, extra, turn.target, natural)
    : firstDesignInput(
        turn.text,
        extra,
        turn.target,
        visionDescription,
        turn.image
          ? (turn.reverse
              ? p.novelAiImageReversePromptUser
              : p.novelAiImagePromptReferenceImageUser
            ).replaceAll("$targetImageModel", MODELS[turn.target].name)
          : "",
      );
  const task = previous
    ? revisionResearch(planJson(previous), turn.text, extra)
    : user;
  const warn = (stage: string, error: unknown) =>
    update({ stage, text: String(error), reasoning: "" });
  const recall = async (queries: string[], scene: string) => {
    try {
      return await recallCodex(queries, scene, signal);
    } catch (error) {
      if (signal.aborted) throw error;
      warn("法典召回失败；本轮缺少法典证据", error);
      return [];
    }
  };
  let codex = previous ? await recall([], turn.text) : [];
  let scene = "",
    sceneFromPlanner = false,
    queries: string[] = [];
  try {
    const request: Message[] = [
      {
        role: "system",
        content:
          previous || visionDescription
            ? p.NOVELAI_TAG_REVISION_QUERY_PLANNER_SYSTEM
            : p.NOVELAI_TAG_SEARCH_PLANNER_SYSTEM,
      },
      {
        role: "user",
        content: image
          ? [
              {
                type: "text",
                text: plannerInput(
                  task,
                  refs,
                  !!previous || !!visionDescription,
                ),
              },
              image,
            ]
          : plannerInput(task, refs, !!previous || !!visionDescription),
      },
    ];
    const raw = await complete(model, request, signal, (v) =>
      update({ stage: previous ? "修改轮检索规划" : "画面规划", ...v }),
    );
    let parsed: ReturnType<typeof plannerDecision> | undefined;
    const candidates = jsonObjectCandidates(raw.text);
    for (const candidate of candidates.length
      ? candidates
      : [raw.text.trim()]) {
      try {
        parsed = plannerDecision(
          JSON.parse(candidate),
          refs,
          !!previous || !!visionDescription,
        );
        break;
      } catch {
        /* Android selects the first decodable research object. */
      }
    }
    if (!parsed) throw Error("画面草案与检索规划 JSON 无法解析");
    queries = parsed.queries;
    scene = previous ? "" : visionDescription || parsed.scene;
    sceneFromPlanner = !!scene && !visionDescription && !previous;
  } catch (e) {
    if (signal.aborted || e instanceof TerminalModelError) throw e;
    update({
      stage: "规划失败；使用原输入检索法典",
      text: String(e),
      reasoning: "",
    });
    scene = previous
      ? ""
      : visionDescription || task.replace(/\s+/g, " ").trim();
  }
  update({ stage: "检索 Tag 与法典", text: "", reasoning: "" });
  if (!previous) codex = await recall(queries, scene);
  const tags = await researchTags(queries, signal, (message) =>
    warn("Tag 检索不完整", message),
  );
  const baseline =
    !turn.attachment && !prefix.some((t) => t.attachment)
      ? prefix.find((t) => t.reply && t.evidence)?.evidence
      : undefined;
  const evidence: Evidence = { scene, tags, codex, sceneFromPlanner };
  const tagEvidence = [...(baseline?.tags || []), ...tags],
    codexEvidence = [...(baseline?.codex || []), ...codex].filter(
      (entry, i, all) => all.findIndex((e) => e.id === entry.id) === i,
    );
  const system = [
    natural
      ? p.NOVELAI_IMAGE_NATURAL_LANGUAGE_PROMPT_SYSTEM_V5
      : turn.target === "V5_FULL"
        ? p.NOVELAI_IMAGE_PROMPT_SYSTEM_V5
        : p.NOVELAI_IMAGE_PROMPT_SYSTEM,
    ...(!turn.reverse ? [p.novelAiImagePromptStyleExclusionSystem] : []),
    ...(previous || refs.length ? [referencePrompt(refs)] : []),
    ...(scene && !sceneFromPlanner
      ? [sceneDescriptionSystem(scene, natural)]
      : []),
    ...(codexEvidence.length ? [codexPrompt(codexEvidence, natural)] : []),
    ...(tagEvidence.length ? [evidencePrompt(tagEvidence, natural)] : []),
  ].join("\n\n");
  const messages: Message[] = [{ role: "system", content: system }];
  if (previous)
    messages.push({ role: "assistant", content: planJson(previous) });
  else if (sceneFromPlanner)
    messages.push(
      { role: "user", content: sceneHistory(natural) },
      { role: "assistant", content: scene },
    );
  messages.push({
    role: "user",
    content: image ? [{ type: "text", text: user }, image] : user,
  });
  const raw = await complete(
    model,
    messages,
    signal,
    (v) => update({ stage: "设计提示词", ...v }),
    true,
  );
  let reply: DesignReply;
  try {
    reply = validateReply(parseJson(raw.text), MODELS[turn.target].roles);
  } catch {
    const repair = await complete(
      model,
      [
        {
          role: "system",
          content: natural
            ? p.NOVELAI_IMAGE_NATURAL_LANGUAGE_PROMPT_REPAIR_SYSTEM_V5
            : p.NOVELAI_IMAGE_PROMPT_REPAIR_SYSTEM,
        },
        { role: "user", content: raw.text },
      ],
      signal,
      (v) => update({ stage: "修复 JSON", ...v }),
    );
    reply = validateReply(parseJson(repair.text), MODELS[turn.target].roles);
    raw.text = repair.text;
    raw.reasoning += [repair.reasoning].filter(Boolean).join("\n");
  }
  if (!natural) {
    const rules = await rpc<RewriteRule[]>(
      "rewriteRules",
      null,
      undefined,
      signal,
    );
    const result = postprocess(reply, rules);
    reply = result.reply;
    if (result.issues.length || result.rewrites.length)
      update({
        stage: "提示词规范化与检查",
        text: JSON.stringify(
          { rewrites: result.rewrites, issues: result.issues },
          null,
          2,
        ),
        reasoning: "",
      });
  }
  // The Android plan conversion normalizes base relation tags in both language modes.
  reply.baseCaption = reply.baseCaption
    .replace(/\b(source|target|mutual)#(?!\d+\b)[^,\s]+/gi, "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .join(", ");
  signal.throwIfAborted();
  return { reply, raw: raw.text, reasoning: raw.reasoning, evidence };
}

function planJson(plan: DesignReply) {
  // Kotlin's DesignedImagePrompt serializer omits default fields.
  return JSON.stringify({
    ...(plan.baseCaption ? { baseCaption: plan.baseCaption } : {}),
    ...(plan.sizePreset !== "PORTRAIT" ? { sizePreset: plan.sizePreset } : {}),
    ...(plan.characters.length
      ? {
          characters: plan.characters.map((c) =>
            c.caption ? { caption: c.caption } : {},
          ),
        }
      : {}),
  });
}
