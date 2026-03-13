import {
  ALL_PROVIDERS,
  DEFAULT_SETTINGS,
  type ExtensionSettings,
  type ProviderMetrics,
  type ProviderMetricsSnapshot,
  type ProviderSecrets
} from "./types";

const SETTINGS_KEY = "polyglot.settings";
const SECRETS_KEY = "polyglot.secrets";
const METRICS_KEY = "polyglot.metrics";

function mergeSettings(stored: Partial<ExtensionSettings> | undefined): ExtensionSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    providerPriority: stored?.providerPriority?.length ? stored.providerPriority : [...DEFAULT_SETTINGS.providerPriority],
    models: {
      ...DEFAULT_SETTINGS.models,
      ...(stored?.models ?? {})
    }
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
  return {
    openrouter: { ...emptyMetrics(), ...(stored?.openrouter ?? {}) },
    openai: { ...emptyMetrics(), ...(stored?.openai ?? {}) },
    anthropic: { ...emptyMetrics(), ...(stored?.anthropic ?? {}) }
  };
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
