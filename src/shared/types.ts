export type ProviderName = "openai" | "anthropic" | "openrouter";
export type SpeedMode = "fast" | "balanced" | "quality";
export type ErrorCode =
  | "E_ABORTED"
  | "E_INVALID_REQUEST"
  | "E_NETWORK"
  | "E_NO_PROVIDER"
  | "E_PROVIDER_DOWN"
  | "E_PROVIDER_FAILED"
  | "E_RATE_LIMIT"
  | "E_TIMEOUT";

export const ALL_PROVIDERS: ProviderName[] = ["openrouter", "openai", "anthropic"];

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

export type ExtensionSettings = {
  targetLanguage: string;
  speedMode: SpeedMode;
  providerPriority: ProviderName[];
  models: Record<ProviderName, string>;
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
  providerPriority: [...ALL_PROVIDERS],
  models: {
    openrouter: "openai/gpt-4o-mini",
    openai: "gpt-4o-mini",
    anthropic: "claude-3-5-haiku-latest"
  }
};
