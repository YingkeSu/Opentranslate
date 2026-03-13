import { getProviderMetrics, setProviderMetrics } from "../shared/storage";
import type { ErrorCode, ProviderMetrics, ProviderMetricsSnapshot, ProviderName } from "../shared/types";

const EWMA_ALPHA = 0.35;

function updateAverage(current: number | undefined, next: number): number {
  return current === undefined ? next : Math.round(current * (1 - EWMA_ALPHA) + next * EWMA_ALPHA);
}

async function mutateMetrics(
  provider: ProviderName,
  updater: (entry: ProviderMetrics) => ProviderMetrics
): Promise<void> {
  const snapshot = await getProviderMetrics();
  snapshot[provider] = updater(snapshot[provider]);
  await setProviderMetrics(snapshot);
}

export async function loadProviderMetrics(): Promise<ProviderMetricsSnapshot> {
  return getProviderMetrics();
}

export async function recordProviderSuccess(
  provider: ProviderName,
  ttftMs: number,
  latencyMs: number
): Promise<void> {
  await mutateMetrics(provider, (entry) => ({
    ...entry,
    attempts: entry.attempts + 1,
    successes: entry.successes + 1,
    avgTtftMs: updateAverage(entry.avgTtftMs, ttftMs),
    avgLatencyMs: updateAverage(entry.avgLatencyMs, latencyMs),
    lastSuccessAt: Date.now()
  }));
}

export async function recordProviderFailure(provider: ProviderName, code: ErrorCode): Promise<void> {
  await mutateMetrics(provider, (entry) => ({
    ...entry,
    attempts: entry.attempts + 1,
    failures: entry.failures + 1,
    timeoutCount: entry.timeoutCount + (code === "E_TIMEOUT" ? 1 : 0),
    rateLimitCount: entry.rateLimitCount + (code === "E_RATE_LIMIT" ? 1 : 0),
    lastErrorCode: code,
    lastErrorAt: Date.now()
  }));
}
