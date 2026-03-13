import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getCached, makeCacheIdentity, setCached } from "../../src/shared/cache";
import { getProviderMetrics, getSettings, setProviderMetrics, setSettings } from "../../src/shared/storage";
import { ALL_PROVIDERS, DEFAULT_SETTINGS, type ProviderMetricsSnapshot } from "../../src/shared/types";
import { installChromeMock } from "./support/mockChrome";

function providerMetrics(
  partial: Partial<ProviderMetricsSnapshot>
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

describe("storage and cache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-13T09:00:00.000Z"));
    installChromeMock({
      sync: {
        "polyglot.settings": {
          targetLanguage: "ja",
          models: {
            openai: "gpt-4.1-mini"
          }
        }
      },
      local: {
        "polyglot.metrics": {
          openai: {
            attempts: 2,
            successes: 2,
            avgTtftMs: 480
          }
        }
      }
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("merges partial settings with defaults instead of dropping model entries", async () => {
    const settings = await getSettings();

    expect(settings.targetLanguage).toBe("ja");
    expect(settings.models.openai).toBe("gpt-4.1-mini");
    expect(settings.models.openrouter).toBe(DEFAULT_SETTINGS.models.openrouter);
    expect(settings.baseURLs.groq).toBe(DEFAULT_SETTINGS.baseURLs.groq);
    expect(settings.providerPriority).toEqual(DEFAULT_SETTINGS.providerPriority);
  });

  it("sanitizes provider metrics for all providers", async () => {
    const metrics = await getProviderMetrics();

    expect(metrics.openai.avgTtftMs).toBe(480);
    expect(metrics.openrouter.attempts).toBe(0);
    expect(metrics.anthropic.failures).toBe(0);
  });

  it("persists updated settings and metrics", async () => {
    await setSettings({
      ...DEFAULT_SETTINGS,
      targetLanguage: "fr",
      models: {
        ...DEFAULT_SETTINGS.models,
        anthropic: "claude-3-7-sonnet-latest"
      }
    });

    await setProviderMetrics(providerMetrics({
      openrouter: {
        attempts: 1,
        successes: 1,
        failures: 0,
        timeoutCount: 0,
        rateLimitCount: 0,
        avgTtftMs: 300,
        avgLatencyMs: 1200
      },
      openai: {
        attempts: 0,
        successes: 0,
        failures: 0,
        timeoutCount: 0,
        rateLimitCount: 0
      },
      anthropic: {
        attempts: 1,
        successes: 0,
        failures: 1,
        timeoutCount: 1,
        rateLimitCount: 0,
        lastErrorCode: "E_TIMEOUT"
      }
    }));

    const settings = await getSettings();
    const metrics = await getProviderMetrics();

    expect(settings.targetLanguage).toBe("fr");
    expect(settings.models.anthropic).toBe("claude-3-7-sonnet-latest");
    expect(metrics.openrouter.avgLatencyMs).toBe(1200);
    expect(metrics.anthropic.lastErrorCode).toBe("E_TIMEOUT");
  });

  it("expires cached translations after ttl", async () => {
    const identity = makeCacheIdentity(
      "hello world",
      undefined,
      "zh-CN",
      "openai",
      "https://api.openai.com/v1",
      "gpt-4o-mini"
    );
    await setCached(identity, "你好，世界");

    expect(await getCached(identity)).toBe("你好，世界");

    vi.advanceTimersByTime(24 * 60 * 60 * 1000 + 1);

    await expect(getCached(identity)).resolves.toBeNull();
  });
});
