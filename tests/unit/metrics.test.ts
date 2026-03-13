import { beforeEach, describe, expect, it, vi } from "vitest";

import { recordProviderFailure, recordProviderSuccess } from "../../src/background/metrics";
import { getProviderMetrics } from "../../src/shared/storage";
import { installChromeMock } from "./support/mockChrome";

describe("provider metrics", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-13T09:00:00.000Z"));
    installChromeMock();
  });

  it("records success counts and moving averages", async () => {
    await recordProviderSuccess("openai", 400, 1200);
    await recordProviderSuccess("openai", 800, 2000);

    const metrics = await getProviderMetrics();

    expect(metrics.openai.attempts).toBe(2);
    expect(metrics.openai.successes).toBe(2);
    expect(metrics.openai.avgTtftMs).toBe(540);
    expect(metrics.openai.avgLatencyMs).toBe(1480);
    expect(metrics.openai.lastSuccessAt).toBe(Date.now());
  });

  it("records failures and error classes", async () => {
    await recordProviderFailure("anthropic", "E_TIMEOUT");
    await recordProviderFailure("anthropic", "E_RATE_LIMIT");

    const metrics = await getProviderMetrics();

    expect(metrics.anthropic.attempts).toBe(2);
    expect(metrics.anthropic.failures).toBe(2);
    expect(metrics.anthropic.timeoutCount).toBe(1);
    expect(metrics.anthropic.rateLimitCount).toBe(1);
    expect(metrics.anthropic.lastErrorCode).toBe("E_RATE_LIMIT");
    expect(metrics.anthropic.lastErrorAt).toBe(Date.now());
  });
});
