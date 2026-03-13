import {
  ALL_PROVIDERS,
  DEFAULT_SETTINGS,
  type ExtensionSettings,
  type ProviderMetrics,
  type ProviderMetricsSnapshot,
  type QueryTrace,
  type ProviderSecrets
} from "./types";

const SETTINGS_KEY = "polyglot.settings";
const SECRETS_KEY = "polyglot.secrets";
const METRICS_KEY = "polyglot.metrics";
const QUERY_TRACE_KEY = "polyglot.query-traces";
const MAX_QUERY_TRACES = 12;

function normalizeModelList(value: unknown, fallback: string[]): string[] {
  if (Array.isArray(value)) {
    const models = value.map((entry) => String(entry).trim()).filter(Boolean);
    return models.length ? models : [...fallback];
  }

  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }

  return [...fallback];
}

function mergeSettings(stored: Partial<ExtensionSettings> | undefined): ExtensionSettings {
  const storedModels = stored?.models as Partial<Record<keyof ExtensionSettings["models"], unknown>> | undefined;
  const models = ALL_PROVIDERS.reduce<ExtensionSettings["models"]>((acc, provider) => {
    acc[provider] = normalizeModelList(storedModels?.[provider], DEFAULT_SETTINGS.models[provider]);
    return acc;
  }, {} as ExtensionSettings["models"]);
  const providerPriority = Array.isArray(stored?.providerPriority)
    ? Array.from(
        new Set(
          stored.providerPriority.filter((provider): provider is (typeof ALL_PROVIDERS)[number] =>
            ALL_PROVIDERS.includes(provider)
          )
        )
      )
    : [...DEFAULT_SETTINGS.providerPriority];

  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    providerPriority,
    baseURLs: {
      ...DEFAULT_SETTINGS.baseURLs,
      ...(stored?.baseURLs ?? {})
    },
    models
  };
}

function emptyMetrics(): ProviderMetrics {
  return {
    attempts: 0,
    successes: 0,
    failures: 0,
    timeoutCount: 0,
    rateLimitCount: 0
  };
}

function mergeMetrics(
  stored: Partial<Record<keyof ProviderMetricsSnapshot, Partial<ProviderMetrics>>> | undefined
): ProviderMetricsSnapshot {
  return ALL_PROVIDERS.reduce<ProviderMetricsSnapshot>((acc, provider) => {
    acc[provider] = { ...emptyMetrics(), ...(stored?.[provider] ?? {}) };
    return acc;
  }, {} as ProviderMetricsSnapshot);
}

export async function getSettings(): Promise<ExtensionSettings> {
  const result = await chrome.storage.sync.get(SETTINGS_KEY);
  return mergeSettings(result[SETTINGS_KEY] as Partial<ExtensionSettings> | undefined);
}

export async function setSettings(settings: ExtensionSettings): Promise<void> {
  await chrome.storage.sync.set({ [SETTINGS_KEY]: settings });
}

export async function getSecrets(): Promise<ProviderSecrets> {
  const result = await chrome.storage.session.get(SECRETS_KEY);
  return (result[SECRETS_KEY] as ProviderSecrets | undefined) ?? {};
}

export async function setSecrets(secrets: ProviderSecrets): Promise<void> {
  await chrome.storage.session.set({ [SECRETS_KEY]: secrets });
}

export async function getProviderMetrics(): Promise<ProviderMetricsSnapshot> {
  const result = await chrome.storage.local.get(METRICS_KEY);
  return mergeMetrics(result[METRICS_KEY] as Partial<ProviderMetricsSnapshot> | undefined);
}

export async function setProviderMetrics(metrics: ProviderMetricsSnapshot): Promise<void> {
  const sanitized = ALL_PROVIDERS.reduce<ProviderMetricsSnapshot>((acc, provider) => {
    acc[provider] = { ...emptyMetrics(), ...metrics[provider] };
    return acc;
  }, {} as ProviderMetricsSnapshot);

  await chrome.storage.local.set({ [METRICS_KEY]: sanitized });
}

export async function getQueryTraces(): Promise<QueryTrace[]> {
  const result = await chrome.storage.local.get(QUERY_TRACE_KEY);
  const traces = result[QUERY_TRACE_KEY];
  return Array.isArray(traces) ? (traces as QueryTrace[]) : [];
}

export async function appendQueryTrace(trace: QueryTrace): Promise<void> {
  const traces = await getQueryTraces();
  const next = [trace, ...traces].slice(0, MAX_QUERY_TRACES);
  await chrome.storage.local.set({ [QUERY_TRACE_KEY]: next });
}
