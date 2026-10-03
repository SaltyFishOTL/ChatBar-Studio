export type ImageModel = "V4_5_FULL" | "V5_FULL";
export const MODELS = {
  V4_5_FULL: {
    api: "nai-diffusion-4-5-full",
    name: "V4.5 Full",
    roles: 6,
    tokens: 512,
  },
  V5_FULL: {
    api: "nai-diffusion-5-full",
    name: "V5 Full",
    roles: 22,
    tokens: 1471,
  },
} as const;
export type StyleCard = {
  negative?: string;
  id: string;
  name: string;
  prompt: string;
  avatar: string;
  createdAt: number;
  updatedAt: number;
};
export type Character = {
  enabled?: boolean;
  id: string;
  prompt: string;
  negative: string;
  center: { x: number; y: number };
};
export type GenerationSettings = {
  // Optional editor state. Width/height remain the request and legacy backup contract.
  sizeChoice?: {
    tier: "SMALL" | "NORMAL" | "LARGE" | "WALLPAPER";
    ratio: "PORTRAIT" | "SQUARE" | "LANDSCAPE";
    custom: boolean;
    width: number;
    height: number;
  };
  width: number;
  height: number;
  steps: number;
  guidance: number;
  cfgRescale: number;
  sampler: string;
  count: number;
  seed: number;
  seedMode: "RANDOM" | "FIXED";
  useCoords: boolean;
};
export type Reference = {
  asset: string;
  strength: number;
  information: number;
  encoding?: string;
  cacheKey?: string;
};
export type Focus = {
  x: number;
  y: number;
  width: number;
  height: number;
  context?: number;
};
export type Guidance = {
  action: "generate" | "img2img" | "infill";
  base: string;
  mask: string;
  focus?: Focus;
  strength: number;
  noise: number;
  inpaintStrength: number;
  referenceMode: "none" | "precise" | "vibe";
  precise: string;
  preciseType: "character" | "style" | "character&style";
  fidelity: number;
  preciseStrength: number;
  normalizeVibeStrengths?: boolean;
  vibes: Reference[];
};
export type StudioDraft = {
  appliedStyleCardId?: string;
  style: string;
  base: string;
  extra: string;
  negative: string;
  characters: Character[];
  model: ImageModel;
  perModel: Record<ImageModel, GenerationSettings>;
  guidance: Guidance;
  continuous: boolean;
  targetCount: number;
  revision: number;
  folds: Record<string, boolean>;
};
export type ModelConfig = {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  isMultimodal: boolean;
  visionModelId: string;
  reasoningEffort: string;
  thinking: "default" | "on" | "off";
  maxTokens: number | null;
  outputTokenParameter: "max_tokens" | "max_completion_tokens";
  supportsJsonMode: boolean;
  customParams: Record<string, unknown>;
};
export type Settings = {
  novelAiUrl: string;
  defaultNegative: string;
  stylePreviewTestPrompt: string;
  models: ModelConfig[];
  designModelId: string;
  naturalLanguage: boolean;
  extraRequirement: string;
  characterReferences: { name: string; prompt: string }[];
  translate: boolean;
  remoteTranslationConsent: boolean;
  copyIgnoreStyle: boolean;
  theme: "light" | "dark";
  historyFolds: Record<string, string>;
};
export type Asset = { id: string; blob: Blob; createdAt: number };
export type Recipe = {
  id: string;
  createdAt: number;
  draft: StudioDraft;
  images: { asset: string; seed: number }[];
  request: Record<string, unknown>;
  requiredSourceMissing: boolean;
};
export type DesignReply = {
  sizePreset: "PORTRAIT" | "SQUARE" | "HORIZONTAL";
  baseCaption: string;
  characters: { caption: string }[];
};
export type Evidence = {
  scene: string;
  tags: Candidate[];
  codex: CodexEntry[];
  sceneFromPlanner: boolean;
};
export type DesignTurn = {
  id: string;
  text: string;
  modelId: string;
  target: ImageModel;
  natural: boolean;
  attachment?: DesignReply;
  image?: string;
  reverse?: boolean;
  reply?: DesignReply;
  raw: string;
  reasoning: string;
  status: "pending" | "complete" | "failed" | "cancelled";
  error?: string;
  evidence?: Evidence;
};
export type DesignConversation = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  extraRequirement: string;
  references: { name: string; prompt: string }[];
  turns: DesignTurn[];
};
export type Candidate = {
  name: string;
  translation: string;
  category: number;
  count: number;
  dictionary: boolean;
  query?: string;
};
export type CodexEntry = {
  matchedQueries?: string[];
  score?: number;
  id: string;
  title: string;
  prompt: string;
  kind: string;
  category: string;
  [key: string]: unknown;
};
export type Account = {
  anlas: number;
  tier: number;
  active: boolean;
  percent: number | null;
  exhausted: boolean;
};
export type Task = {
  id: string;
  kind: string;
  status: "running" | "interrupted";
  startedAt: number;
};
export const uid = () => crypto.randomUUID();
export const newCharacter = (): Character => ({
  enabled: true,
  id: uid(),
  prompt: "",
  negative: "",
  center: { x: 0.5, y: 0.5 },
});
export const generationDefaults = (): GenerationSettings => ({
  width: 832,
  height: 1216,
  steps: 28,
  guidance: 6,
  cfgRescale: 0,
  sampler: "k_euler_ancestral",
  count: 1,
  seed: 0,
  seedMode: "RANDOM",
  useCoords: false,
});
export const guidanceDefaults = (): Guidance => ({
  action: "generate",
  base: "",
  mask: "",
  strength: 0.7,
  noise: 0,
  inpaintStrength: 1,
  referenceMode: "none",
  precise: "",
  preciseType: "character&style",
  fidelity: 1,
  preciseStrength: 1,
  normalizeVibeStrengths: true,
  vibes: [],
});
export const draftDefaults = (negative: string): StudioDraft => ({
  style: "",
  base: "",
  extra: "",
  negative,
  characters: [],
  model: "V4_5_FULL",
  perModel: { V4_5_FULL: generationDefaults(), V5_FULL: generationDefaults() },
  guidance: guidanceDefaults(),
  continuous: false,
  targetCount: 10,
  revision: 0,
  folds: { style: true, extra: true, negative: true, parameters: false },
});
export const settingsDefaults = (negative: string): Settings => ({
  novelAiUrl: "https://image.novelai.net",
  defaultNegative: negative,
  stylePreviewTestPrompt: "",
  models: [],
  designModelId: "",
  naturalLanguage: false,
  extraRequirement: "",
  characterReferences: [],
  translate: true,
  remoteTranslationConsent: false,
  copyIgnoreStyle: true,
  theme: "light",
  historyFolds: {},
});
