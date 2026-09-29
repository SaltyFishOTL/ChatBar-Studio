import type { ModelConfig } from "../domain/types";
import { getKey } from "../data/vault";
import { directFetch, endpoint, checkResponse, readLimited } from "./http";
import { promptConstants, taskInputHeading } from "../domain/prompts";
export type Part =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };
export type Message = {
  role: "system" | "user" | "assistant";
  content: string | Part[];
};
export type TextProgress = { text: string; reasoning: string };
export class TerminalModelError extends Error {}
export async function envelope(
  messages: Message[],
  preserveRoles: boolean,
): Promise<Message[]> {
  const p = await promptConstants();
  const msg = (role: Message["role"], key: string): Message => ({
    role,
    content: p[key],
  });
  const inputs = messages.filter((m) => m.role !== "system");
  let merged: Message["content"] = "";
  if (inputs.length === 1 && inputs[0].role === "user")
    merged = inputs[0].content;
  else
    merged = inputs.flatMap((m, i) => [
      { type: "text", text: taskInputHeading(i, m.role) } as Part,
      ...(typeof m.content === "string"
        ? [{ type: "text", text: m.content } as Part]
        : m.content),
    ]);
  return [
    {
      role: "system",
      content: [
        p.GENERAL_SYSTEM_PROMPT,
        ...messages.filter((m) => m.role === "system").map((m) => m.content),
        p.GENERAL_CREATOR_IDENTITY_SYSTEM_PROMPT,
      ].join("\n\n"),
    },
    msg("assistant", "GENERAL_FIRST_ACK_ASSISTANT_PROMPT"),
    msg("user", "GENERAL_CREATIVE_CONTRACT_USER_PROMPT"),
    msg("assistant", "GENERAL_CONTRACT_CONFIRMATION_ASSISTANT_PROMPT"),
    ...(preserveRoles
      ? inputs
      : [
          {
            role: "user",
            content: merged || p.GENERAL_TASK_EMPTY_INPUT,
          } as Message,
        ]),
    msg("assistant", "GENERAL_CONTEXT_APPROVAL_ASSISTANT_PROMPT"),
    msg("assistant", "GENERAL_POST_USER_ACK_ASSISTANT_PROMPT"),
    msg("user", "GENERAL_POST_USER_IDENTITY_REMINDER_USER_PROMPT"),
  ];
}
export async function complete(
  model: ModelConfig,
  messages: Message[],
  signal: AbortSignal,
  update: (p: TextProgress) => void,
  preserveRoles = false,
  jsonOutput = false,
): Promise<TextProgress> {
  const key = getKey(model.id);
  if (!key) throw Error(`请配置 ${model.name} 的 API Key`);
  const body: Record<string, unknown> = {
    ...model.customParams,
    model: model.model,
    messages: await envelope(messages, preserveRoles),
    stream: true,
  };
  delete body.max_tokens;
  delete body.max_completion_tokens;
  if (model.maxTokens) body[model.outputTokenParameter] = model.maxTokens;
  if (model.reasoningEffort) body.reasoning_effort = model.reasoningEffort;
  if (model.thinking !== "default")
    body.enable_thinking = model.thinking === "on";
  if (model.supportsJsonMode && jsonOutput)
    body.response_format = { type: "json_object" };
  const controller = new AbortController(),
    abort = () => controller.abort(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  let timer: ReturnType<typeof setTimeout>;
  const reset = () => {
    clearTimeout(timer);
    timer = setTimeout(
      () => controller.abort(Error("模型长时间没有有效输出，已停止")),
      120000,
    );
  };
  reset();
  let text = "",
    reasoning = "",
    terminal = false;
  try {
    const r = await directFetch(endpoint(model.baseUrl, "/chat/completions"), {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    await checkResponse(r, key);
    const consume = (v: any) => {
      if (v.error) throw Error(String(v.error.message || v.error));
      const choice = v.choices?.[0],
        d = choice?.delta || choice?.message || {};
      if (
        d.refusal ||
        (Array.isArray(d.content) &&
          d.content.some((p: any) => p.type === "refusal")) ||
        choice?.finish_reason === "content_filter"
      )
        throw new TerminalModelError("模型拒绝或过滤了输出，已停止后续修复");
      if (choice?.finish_reason === "length")
        throw new TerminalModelError("模型输出被截断，未应用不完整结果");
      const chunk = typeof d.content === "string" ? d.content : "";
      const think = d.reasoning_content || d.reasoning || "";
      text += chunk;
      reasoning += think;
      if (chunk.trim() || String(think).trim() || choice?.finish_reason)
        reset();
      if (choice?.finish_reason) terminal = true;
      update({ text, reasoning });
    };
    if (r.headers.get("Content-Type")?.includes("application/json")) {
      consume(await r.json());
      terminal = true;
    } else {
      if (!r.body) throw Error("模型响应为空");
      const reader = r.body.getReader(),
        decoder = new TextDecoder();
      let pending = "";
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          pending += decoder.decode(value, { stream: true });
          let boundary;
          while ((boundary = pending.search(/\r?\n\r?\n/)) >= 0) {
            const block = pending.slice(0, boundary);
            pending = pending.slice(
              boundary + (pending[boundary] === "\r" ? 4 : 2),
            );
            const data = block
              .split(/\r?\n/)
              .filter((l) => l.startsWith("data:"))
              .map((l) => l.slice(5).trimStart())
              .join("\n");
            if (!data) continue;
            if (data === "[DONE]") {
              terminal = true;
              break;
            }
            consume(JSON.parse(data));
          }
          if (terminal) {
            await reader.cancel();
            break;
          }
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
    }
    if (!terminal) throw Error("模型流中断，未收到完成标记");
    const refusal = text.trim();
    if (
      refusal.length <= 500 &&
      !/[\n"“「：`{\[]/.test(refusal) &&
      (/^(?:抱歉[，,。 ]*|对不起[，,。 ]*)?我(?:无法|不能)(?:帮助|协助|提供|生成|完成|处理|满足|继续).{0,180}(?:请求|内容|任务|要求|生成|创作)[。！.! ]*$/.test(
        refusal,
      ) ||
        /^(?:I(?:'m| am) sorry[, .]*|Sorry[, .]*)?I (?:cannot|can't|am unable to) (?:help|assist|provide|generate|fulfill|comply with).{0,180}(?:request|content|task)[.! ]*$/i.test(
          refusal,
        ))
    )
      throw new TerminalModelError("模型拒绝了本次任务，已停止后续修复和重试");
    if (!text.trim())
      throw Error(
        reasoning ? "模型只返回思考，没有设计结果" : "模型返回空结果",
      );
    return { text, reasoning };
  } finally {
    clearTimeout(timer!);
    signal.removeEventListener("abort", abort);
    controller.abort();
  }
}
export async function listModels(model: ModelConfig, signal?: AbortSignal) {
  const key = getKey(model.id).trim();
  if (/[^!-~]/.test(key))
    throw Error("API Key 含无效字符，请检查是否混入空格、换行或中文");
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(
    () => controller.abort(new Error("获取模型列表超时，请检查网络或稍后重试")),
    30000,
  );
  try {
    const r = await directFetch(
      endpoint(model.baseUrl.trim().replace(/\/+$/, ""), "/models"),
      {
        signal: controller.signal,
        redirect: "error",
        headers: key ? { Authorization: `Bearer ${key}` } : {},
      },
    );
    if (!r.ok) {
      await r.body?.cancel();
      if ([401, 403].includes(r.status))
        throw Error(
          `模型列表访问被拒绝（HTTP ${r.status}），请检查 API Key 和账号权限`,
        );
      if ([404, 405].includes(r.status))
        throw Error(
          `服务商未提供此模型列表接口（HTTP ${r.status}），请检查 Base URL 或手动填写模型标识`,
        );
      throw Error(
        `获取模型列表失败（HTTP ${r.status}），请检查服务商状态后重试`,
      );
    }
    const body = await readLimited(r, 8 * 1024 * 1024);
    let data: unknown;
    try {
      data = JSON.parse(body)?.data;
    } catch {
      /* Report protocol error below. */
    }
    if (!Array.isArray(data))
      throw Error("模型列表格式不兼容，需要 OpenAI 兼容接口的 data 列表");
    const ids = [
      ...new Set(
        data.flatMap((entry: unknown) => {
          if (
            !entry ||
            typeof entry !== "object" ||
            !("id" in entry) ||
            typeof entry.id !== "string"
          )
            return [];
          const id = entry.id.trim();
          return id ? [id] : [];
        }),
      ),
    ].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
    if (!ids.length)
      throw Error("服务商未返回可用模型标识，请检查账号权限或手动填写");
    return ids;
  } catch (e) {
    if (controller.signal.aborted) throw controller.signal.reason;
    throw e;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
