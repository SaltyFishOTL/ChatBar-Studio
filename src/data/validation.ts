// Validate imported structure before opening a write transaction. Empty editable drafts are valid.
export function validateManifest(m: any) {
  const fail = (label: string): never => {
    throw Error("备份字段无效：" + label);
  };
  const obj = (v: any, label: string) => {
    if (!v || typeof v !== "object" || Array.isArray(v)) fail(label);
    return v;
  };
  const str = (v: any, label: string) => {
    if (typeof v !== "string") fail(label);
  };
  const num = (v: any, label: string) => {
    if (!Number.isFinite(v)) fail(label);
  };
  const bool = (v: any, label: string) => {
    if (typeof v !== "boolean") fail(label);
  };
  const list = (v: any, label: string): any[] => {
    if (!Array.isArray(v)) fail(label);
    return v;
  };
  const unique = (items: any[], label: string) => {
    const ids = new Set();
    for (const v of items) {
      obj(v, label);
      str(v.id, label + ".id");
      if (!v.id || ids.has(v.id)) fail(label + " 重复 ID");
      ids.add(v.id);
    }
  };
  const reply = (v: any) => {
    obj(v, "候选");
    if (!["PORTRAIT", "SQUARE", "HORIZONTAL"].includes(v.sizePreset))
      fail("sizePreset");
    str(v.baseCaption, "baseCaption");
    for (const c of list(v.characters, "候选角色")) str(c.caption, "caption");
  };
  const refs = (v: any) => {
    for (const r of list(v, "角色参考")) {
      obj(r, "角色参考");
      str(r.name, "参考名称");
      str(r.prompt, "参考文本");
    }
  };
  const draft = (v: any) => {
    obj(v, "草稿");
    if (!["V4_5_FULL", "V5_FULL"].includes(v.model)) fail("生图模型");
    for (const k of ["style", "base", "extra", "negative"]) str(v[k], k);
    bool(v.continuous, "连续模式");
    num(v.targetCount, "目标数量");
    num(v.revision, "草稿版本");
    obj(v.folds, "折叠状态");
    for (const b of Object.values(v.folds)) bool(b, "折叠状态");
    for (const c of list(v.characters, "角色")) {
      obj(c, "角色");
      str(c.id, "角色 ID");
      str(c.prompt, "角色正面");
      str(c.negative, "角色负面");
      obj(c.center, "角色位置");
      num(c.center.x, "角色 X");
      num(c.center.y, "角色 Y");
    }
    obj(v.perModel, "参数");
    for (const key of ["V4_5_FULL", "V5_FULL"]) {
      const s = obj(v.perModel[key], "模型参数");
      for (const k of [
        "width",
        "height",
        "steps",
        "guidance",
        "cfgRescale",
        "count",
        "seed",
      ])
        num(s[k], k);
      str(s.sampler, "sampler");
      bool(s.useCoords, "useCoords");
      if (s.sizeChoice != null) {
        const choice = obj(s.sizeChoice, "尺寸选择");
        if (
          !["SMALL", "NORMAL", "LARGE", "WALLPAPER"].includes(choice.tier) ||
          !["PORTRAIT", "SQUARE", "LANDSCAPE"].includes(choice.ratio)
        )
          fail("尺寸选择");
        bool(choice.custom, "自定义尺寸");
        num(choice.width, "尺寸选择宽度");
        num(choice.height, "尺寸选择高度");
      }
      if (!["RANDOM", "FIXED"].includes(s.seedMode)) fail("Seed 模式");
    }
    const g = obj(v.guidance, "图像引导");
    if (
      !["generate", "img2img", "infill"].includes(g.action) ||
      !["none", "precise", "vibe"].includes(g.referenceMode) ||
      !["character", "style", "character&style"].includes(g.preciseType)
    )
      fail("参考模式");
    for (const k of ["base", "mask", "precise"]) str(g[k], k);
    for (const k of [
      "strength",
      "noise",
      "inpaintStrength",
      "fidelity",
      "preciseStrength",
    ])
      num(g[k], k);
    if (g.focus) {
      obj(g.focus, "焦点");
      for (const k of ["x", "y", "width", "height"]) num(g.focus[k], k);
      if (g.focus.context != null) num(g.focus.context, "context");
    }
    for (const r of list(g.vibes, "Vibe")) {
      obj(r, "Vibe");
      str(r.asset, "Vibe 图片");
      num(r.strength, "Vibe 强度");
      num(r.information, "Vibe 信息");
      if (r.encoding != null) str(r.encoding, "Vibe 编码");
    }
  };
  const settings = m.state.settings;
  if (settings) {
    obj(settings, "设置");
    for (const k of [
      "novelAiUrl",
      "defaultNegative",
      "stylePreviewTestPrompt",
      "designModelId",
      "extraRequirement",
    ])
      str(settings[k], k);
    for (const k of [
      "naturalLanguage",
      "translate",
      "remoteTranslationConsent",
      "copyIgnoreStyle",
    ])
      bool(settings[k], k);
    if (!["light", "dark"].includes(settings.theme)) fail("主题");
    obj(settings.historyFolds, "历史折叠");
    refs(settings.characterReferences);
    const models = list(settings.models, "LLM 配置");
    unique(models, "LLM");
    for (const v of models) {
      for (const k of [
        "name",
        "baseUrl",
        "model",
        "visionModelId",
        "reasoningEffort",
      ])
        str(v[k], k);
      for (const k of ["isMultimodal", "supportsJsonMode"]) bool(v[k], k);
      obj(v.customParams, "自定义参数");
      if (v.maxTokens != null) num(v.maxTokens, "输出上限");
      if (
        !["default", "on", "off"].includes(v.thinking) ||
        !["max_tokens", "max_completion_tokens"].includes(
          v.outputTokenParameter,
        )
      )
        fail("模型参数");
    }
  }
  for (const key of ["draft", "historyApplyUndo"])
    if (m.state[key]) draft(m.state[key]);
  for (const key of ["cards", "history", "conversations", "assets"])
    unique(list(m[key], key), key);
  for (const h of m.history) {
    num(h.createdAt, "历史时间");
    draft(h.draft);
    bool(h.requiredSourceMissing, "历史资源状态");
    obj(h.request, "历史请求");
    for (const image of list(h.images, "历史图片")) {
      str(image.asset, "图片 ID");
      num(image.seed, "图片 Seed");
    }
  }
  for (const c of m.conversations) {
    str(c.title, "对话名称");
    str(c.extraRequirement, "对话要求");
    num(c.createdAt, "对话时间");
    num(c.updatedAt, "对话时间");
    refs(c.references);
    unique(list(c.turns, "轮次"), "轮次");
    for (const t of c.turns) {
      for (const k of ["text", "modelId", "raw", "reasoning"]) str(t[k], k);
      bool(t.natural, "自然语言模式");
      if (
        !["pending", "complete", "failed", "cancelled"].includes(t.status) ||
        !["V4_5_FULL", "V5_FULL"].includes(t.target)
      )
        fail("轮次状态");
      if (t.reply) reply(t.reply);
      if (t.attachment) reply(t.attachment);
      if (t.evidence) {
        str(t.evidence.scene, "画面规划");
        list(t.evidence.tags, "Tag 证据");
        list(t.evidence.codex, "法典证据");
      }
    }
  }
  if (
    m.state.currentConversation &&
    !m.conversations.some((c: any) => c.id === m.state.currentConversation)
  )
    fail("当前对话引用");
  if (m.state.toolResults) {
    unique(list(m.state.toolResults, "图像工具结果"), "图像工具结果");
    for (const r of m.state.toolResults) {
      str(r.source, "工具原图");
      num(r.createdAt, "工具结果时间");
    }
  }
}
