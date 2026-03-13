import { describe, expect, it } from "vitest";

import {
  ALL_PROVIDERS,
  DEFAULT_SETTINGS,
  type ProviderMetrics,
  type ProviderMetricsSnapshot
} from "../../src/shared/types";
import { getAttemptBudget, orderedProviders } from "../../src/background/router";

function metrics(
  partial: Partial<Record<keyof ProviderMetricsSnapshot, Partial<ProviderMetrics>>>
): ProviderMetricsSnapshot {
  return ALL_PROVIDERS.reduce<ProviderMetricsSnapshot>((acc, provider) => {
    acc[provider] = {
      attempts: 0,
      successes: 0,
      failures: 0,
      timeoutCount: 0,
      rateLimitCount: 0,
      ...(partial[provider] ?? {})
    };
    return acc;
  }, {} as ProviderMetricsSnapshot);
}

describe("router", () => {
  it("reorders providers when health data outweighs static priority", () => {
    const result = orderedProviders(
      DEFAULT_SETTINGS,
      {
        openrouter: "or-key",
        openai: "oa-key",
        anthropic: "an-key"
      },
      metrics({
        openrouter: {
          attempts: 12,
          successes: 5,
          failures: 7,
          timeoutCount: 3,
          rateLimitCount: 2,
          avgTtftMs: 2600,
          avgLatencyMs: 9200,
          lastErrorAt: Date.now()
        },
        openai: {
          attempts: 16,
          successes: 15,
          failures: 1,
          avgTtftMs: 620,
          avgLatencyMs: 2100,
          lastSuccessAt: Date.now()
        },
        anthropic: {
          attempts: 8,
          successes: 6,
          failures: 2,
          avgTtftMs: 1400,
          avgLatencyMs: 3300
        }
      })
    );

    expect(result).toEqual(["openai", "anthropic", "openrouter"]);
  });

  it("filters out providers without configured secrets", () => {
    const result = orderedProviders(
      DEFAULT_SETTINGS,
      {
        openai: "oa-key"
      },
      metrics({})
    );

    expect(result).toEqual(["openai"]);
  });

  it("adjusts timeout budget by speed mode and text size", () => {
    const fast = getAttemptBudget({ ...DEFAULT_SETTINGS, speedMode: "fast" }, 120);
    const quality = getAttemptBudget({ ...DEFAULT_SETTINGS, speedMode: "quality" }, 680);

    expect(fast.retryCount).toBe(0);
    expect(fast.firstChunkTimeoutMs).toBeLessThan(quality.firstChunkTimeoutMs);
    expect(fast.totalTimeoutMs).toBeLessThan(quality.totalTimeoutMs);
    expect(quality.retryCount).toBe(1);
  });
});
