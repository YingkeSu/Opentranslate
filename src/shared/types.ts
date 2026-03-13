export type ProviderName =
  | "openai"
  | "anthropic"
  | "openrouter"
  | "groq"
  | "together"
  | "fireworks"
  | "custom-openai";
export type SpeedMode = "fast" | "balanced" | "quality";
export type ProviderProtocol = "openai-chat" | "anthropic-messages";
export type ErrorCode =
  | "E_ABORTED"
  | "E_INVALID_REQUEST"
  | "E_NETWORK"
  | "E_NO_PROVIDER"
  | "E_PROVIDER_DOWN"
  | "E_PROVIDER_FAILED"
  | "E_RATE_LIMIT"
  | "E_TIMEOUT";

export const ALL_PROVIDERS: ProviderName[] = [
  "openrouter",
  "openai",
  "anthropic",
  "groq",
  "together",
  "fireworks",
  "custom-openai"
];
export const PROVIDER_LABELS: Record<ProviderName, string> = {
  openrouter: "OpenRouter",
  openai: "OpenAI",
  anthropic: "Anthropic",
  groq: "Groq",
  together: "Together AI",
  fireworks: "Fireworks AI",
  "custom-openai": "Custom OpenAI-Compatible"
};
export const PROVIDER_KEY_PLACEHOLDERS: Record<ProviderName, string> = {
  openrouter: "sk-or-...",
  openai: "sk-...",
  anthropic: "sk-ant-...",
  groq: "gsk_...",
  together: "together-...",
  fireworks: "fw_...",
  "custom-openai": "provider-specific key"
};

export type ProviderTemplate = {
  defaultBaseURL: string;
  defaultModel: string;
  description: string;
  docsUrl?: string;
  keyPlaceholder: string;
  protocol: ProviderProtocol;
};

export const PROVIDER_TEMPLATES: Record<ProviderName, ProviderTemplate> = {
  openrouter: {
    protocol: "openai-chat",
    defaultBaseURL: "https://openrouter.ai/api/v1",
    defaultModel: "openai/gpt-4o-mini",
    keyPlaceholder: PROVIDER_KEY_PLACEHOLDERS.openrouter,
    description: "OpenAI-compatible router for multi-model fallback and provider routing.",
    docsUrl: "https://openrouter.ai/docs/api-reference/authentication"
  },
  openai: {
    protocol: "openai-chat",
    defaultBaseURL: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    keyPlaceholder: PROVIDER_KEY_PLACEHOLDERS.openai,
    description: "Official OpenAI chat completions endpoint.",
    docsUrl: "https://platform.openai.com/docs/api-reference/chat"
  },
  anthropic: {
    protocol: "anthropic-messages",
    defaultBaseURL: "https://api.anthropic.com/v1",
    defaultModel: "claude-3-5-haiku-latest",
    keyPlaceholder: PROVIDER_KEY_PLACEHOLDERS.anthropic,
    description: "Anthropic Messages API with streaming deltas.",
    docsUrl: "https://docs.anthropic.com/en/api/messages"
  },
  groq: {
    protocol: "openai-chat",
    defaultBaseURL: "https://api.groq.com/openai/v1",
    defaultModel: "openai/gpt-oss-20b",
    keyPlaceholder: PROVIDER_KEY_PLACEHOLDERS.groq,
    description: "Groq OpenAI-compatible endpoint for fast inference.",
    docsUrl: "https://console.groq.com/docs/openai"
  },
  together: {
    protocol: "openai-chat",
    defaultBaseURL: "https://api.together.xyz/v1",
    defaultModel: "openai/gpt-oss-20b",
    keyPlaceholder: PROVIDER_KEY_PLACEHOLDERS.together,
    description: "Together AI OpenAI-compatible endpoint for open-weight models.",
    docsUrl: "https://docs.together.ai/docs/openai-api-compatibility"
  },
  fireworks: {
    protocol: "openai-chat",
    defaultBaseURL: "https://api.fireworks.ai/inference/v1",
    defaultModel: "accounts/fireworks/models/llama-v3p1-8b-instruct",
    keyPlaceholder: PROVIDER_KEY_PLACEHOLDERS.fireworks,
    description: "Fireworks AI OpenAI-compatible inference endpoint.",
    docsUrl: "https://fireworks.ai/docs/tools-sdks/openai-compatibility"
  },
  "custom-openai": {
    protocol: "openai-chat",
    defaultBaseURL: "",
    defaultModel: "your-model-id",
    keyPlaceholder: PROVIDER_KEY_PLACEHOLDERS["custom-openai"],
    description: "Bring any OpenAI-compatible provider by setting base URL and model ID.",
    docsUrl: "https://opencode.ai/docs/providers"
  }
};

export type TranslateRequest = {
  requestId: string;
  text: string;
  sourceLang?: string;
  targetLang: string;
  mode: "selection" | "manual";
  createdAt: number;
};

export type StreamEvent =
  | { type: "start"; requestId: string; provider: ProviderName; model: string }
  | { type: "delta"; requestId: string; chunk: string; seq: number }
  | { type: "meta"; requestId: string; ttftMs?: number }
  | { type: "done"; requestId: string; text: string; latencyMs: number; cacheHit: boolean }
  | { type: "error"; requestId: string; code: ErrorCode; message: string; retryable: boolean };

export type PortRequest =
  | { type: "TRANSLATE_REQUEST"; payload: TranslateRequest }
  | { type: "CANCEL_REQUEST"; requestId: string };

export type ContentMessage =
  | { type: "TRIGGER_TRANSLATE_SELECTION" }
  | { type: "CONTEXT_TRANSLATE"; text: string };

export type ProviderStatusResult = {
  checkedAt: number;
  models: string[];
  ok: boolean;
  provider: ProviderName;
  status?: number;
  message: string;
};

export type QueryTrace = {
  id: string;
  provider?: ProviderName;
  model?: string;
  requestText: string;
  responseText?: string;
  targetLang: string;
  createdAt: number;
  finishedAt: number;
  cacheHit: boolean;
  ok: boolean;
  errorCode?: ErrorCode;
  errorMessage?: string;
};

export type RuntimeMessage =
  | { type: "PING" }
  | { type: "GET_QUERY_TRACES" }
  | { type: "TEST_PROVIDER_STATUS" };

export type RuntimeResponse =
  | { ok: true; type: "PONG" }
  | { ok: true; type: "QUERY_TRACES"; traces: QueryTrace[] }
  | { ok: true; type: "PROVIDER_STATUS"; results: ProviderStatusResult[] };

export type ExtensionSettings = {
  targetLanguage: string;
  speedMode: SpeedMode;
  providerPriority: ProviderName[];
  baseURLs: Record<ProviderName, string>;
  models: Record<ProviderName, string[]>;
};

export type ProviderSecrets = Partial<Record<ProviderName, string>>;

export type ProviderMetrics = {
  attempts: number;
  successes: number;
  failures: number;
  timeoutCount: number;
  rateLimitCount: number;
  avgTtftMs?: number;
  avgLatencyMs?: number;
  lastErrorCode?: ErrorCode;
  lastErrorAt?: number;
  lastSuccessAt?: number;
};

export type ProviderMetricsSnapshot = Record<ProviderName, ProviderMetrics>;

export const DEFAULT_SETTINGS: ExtensionSettings = {
  targetLanguage: "zh-CN",
  speedMode: "fast",
  providerPriority: [],
  baseURLs: {
    openrouter: PROVIDER_TEMPLATES.openrouter.defaultBaseURL,
    openai: PROVIDER_TEMPLATES.openai.defaultBaseURL,
    anthropic: PROVIDER_TEMPLATES.anthropic.defaultBaseURL,
    groq: PROVIDER_TEMPLATES.groq.defaultBaseURL,
    together: PROVIDER_TEMPLATES.together.defaultBaseURL,
    fireworks: PROVIDER_TEMPLATES.fireworks.defaultBaseURL,
    "custom-openai": PROVIDER_TEMPLATES["custom-openai"].defaultBaseURL
  },
  models: {
    openrouter: [PROVIDER_TEMPLATES.openrouter.defaultModel],
    openai: [PROVIDER_TEMPLATES.openai.defaultModel],
    anthropic: [PROVIDER_TEMPLATES.anthropic.defaultModel],
    groq: [PROVIDER_TEMPLATES.groq.defaultModel],
    together: [PROVIDER_TEMPLATES.together.defaultModel],
    fireworks: [PROVIDER_TEMPLATES.fireworks.defaultModel],
    "custom-openai": [PROVIDER_TEMPLATES["custom-openai"].defaultModel]
  }
};
