import { AnthropicAdapter } from "./providers/anthropic";
import { OpenAiCompatibleAdapter } from "./providers/openai";
import type { ProviderAdapter } from "./providers/base";
import type {
  ExtensionSettings,
  ProviderMetricsSnapshot,
  ProviderName,
  ProviderSecrets
} from "../shared/types";

const providers: Record<ProviderName, ProviderAdapter> = {
  openai: new OpenAiCompatibleAdapter("openai"),
  anthropic: new AnthropicAdapter(),
  openrouter: new OpenAiCompatibleAdapter("openrouter"),
  groq: new OpenAiCompatibleAdapter("groq"),
  together: new OpenAiCompatibleAdapter("together"),
  fireworks: new OpenAiCompatibleAdapter("fireworks"),
  "custom-openai": new OpenAiCompatibleAdapter("custom-openai")
};

export type AttemptBudget = {
  firstChunkTimeoutMs: number;
  totalTimeoutMs: number;
  retryCount: number;
  retryBaseDelayMs: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function providerScore(
  provider: ProviderName,
  settings: ExtensionSettings,
  metrics: ProviderMetricsSnapshot
): number {
  const stats = metrics[provider];
  const priorityIndex = settings.providerPriority.indexOf(provider);
  const priorityScore = priorityIndex === -1 ? 0 : 100 - priorityIndex * 18;
  const successRate = stats.attempts === 0 ? 0.78 : stats.successes / stats.attempts;
  const reliabilityScore = successRate * 35;
  const recentFailurePenalty =
    stats.lastErrorAt && Date.now() - stats.lastErrorAt < 5 * 60 * 1000 ? 18 : 0;
  const timeoutPenalty = Math.min(12, stats.timeoutCount * 2);
  const rateLimitPenalty = Math.min(12, stats.rateLimitCount * 3);

  const ttftBaseline = settings.speedMode === "fast" ? 1200 : settings.speedMode === "balanced" ? 1800 : 2500;
  const latencyBaseline =
    settings.speedMode === "fast" ? 4500 : settings.speedMode === "balanced" ? 7000 : 11000;
  const ttftScore =
    stats.avgTtftMs === undefined ? 8 : clamp((ttftBaseline - stats.avgTtftMs) / 120, -12, 16);
  const latencyScore =
    stats.avgLatencyMs === undefined
      ? 6
      : clamp((latencyBaseline - stats.avgLatencyMs) / 240, -10, 14);

  return priorityScore + reliabilityScore + ttftScore + latencyScore - recentFailurePenalty - timeoutPenalty - rateLimitPenalty;
}

export function orderedProviders(
  settings: ExtensionSettings,
  secrets: ProviderSecrets,
  metrics: ProviderMetricsSnapshot
): ProviderName[] {
  return settings.providerPriority
    .filter((provider) => Boolean(secrets[provider]) && Boolean(settings.baseURLs[provider]?.trim()))
    .sort((left, right) => providerScore(right, settings, metrics) - providerScore(left, settings, metrics));
}

export function getAttemptBudget(settings: ExtensionSettings, textLength: number): AttemptBudget {
  const sizeBump = Math.min(2500, Math.max(0, textLength - 180) * 9);

  if (settings.speedMode === "quality") {
    return {
      firstChunkTimeoutMs: 3200,
      totalTimeoutMs: 11000 + sizeBump,
      retryCount: 1,
      retryBaseDelayMs: 500
    };
  }

  if (settings.speedMode === "balanced") {
    return {
      firstChunkTimeoutMs: 2300,
      totalTimeoutMs: 8500 + sizeBump,
      retryCount: 1,
      retryBaseDelayMs: 350
    };
  }

  return {
    firstChunkTimeoutMs: 1600,
    totalTimeoutMs: 6500 + Math.min(1800, sizeBump),
    retryCount: 0,
    retryBaseDelayMs: 250
  };
}

export function getAdapter(provider: ProviderName): ProviderAdapter {
  return providers[provider];
}
