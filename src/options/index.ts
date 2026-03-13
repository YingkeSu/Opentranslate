import {
  getProviderMetrics,
  getSecrets,
  getSettings,
  setSecrets,
  setSettings
} from "../shared/storage";
import {
  ALL_PROVIDERS,
  PROVIDER_LABELS,
  PROVIDER_TEMPLATES,
  type ProviderMetrics,
  type ProviderMetricsSnapshot,
  type ProviderName,
  type ProviderSecrets
} from "../shared/types";

function populateProviderSelect(select: HTMLSelectElement): void {
  select.replaceChildren(
    ...ALL_PROVIDERS.map((provider) => {
      const option = document.createElement("option");
      option.value = provider;
      option.textContent = PROVIDER_LABELS[provider];
      return option;
    })
  );
}

function reorderProviders(primary: ProviderName): ProviderName[] {
  return [primary, ...ALL_PROVIDERS.filter((provider) => provider !== primary)];
}

function formatMs(value: number | undefined): string {
  return value === undefined ? "-" : `${Math.round(value)}ms`;
}

function healthState(metrics: ProviderMetrics): "cold" | "degraded" | "down" | "healthy" {
  if (metrics.attempts === 0) {
    return "cold";
  }

  const successRate = metrics.successes / metrics.attempts;
  if (successRate < 0.35) {
    return "down";
  }
  if (successRate < 0.75 || metrics.lastErrorCode === "E_RATE_LIMIT" || metrics.lastErrorCode === "E_TIMEOUT") {
    return "degraded";
  }
  return "healthy";
}

function healthNote(metrics: ProviderMetrics): string {
  if (metrics.attempts === 0) {
    return "No local samples yet.";
  }

  if (!metrics.lastErrorCode) {
    return "Recent attempts look stable.";
  }

  return `Last error: ${metrics.lastErrorCode}`;
}

function renderProviderHealth(snapshot: ProviderMetricsSnapshot): void {
  for (const provider of ALL_PROVIDERS) {
    const card = document.querySelector<HTMLElement>(`.health-card[data-provider="${provider}"]`);
    if (!card) {
      continue;
    }

    const metrics = snapshot[provider];
    const state = healthState(metrics);
    const successRate = metrics.attempts === 0 ? "-" : `${Math.round((metrics.successes / metrics.attempts) * 100)}%`;

    card.dataset.state = state;
    const badge = card.querySelector<HTMLElement>('[data-field="badge"]');
    const ttft = card.querySelector<HTMLElement>('[data-field="ttft"]');
    const latency = card.querySelector<HTMLElement>('[data-field="latency"]');
    const success = card.querySelector<HTMLElement>('[data-field="success"]');
    const note = card.querySelector<HTMLElement>('[data-field="note"]');

    if (badge) {
      badge.textContent = state;
    }
    if (ttft) {
      ttft.textContent = formatMs(metrics.avgTtftMs);
    }
    if (latency) {
      latency.textContent = formatMs(metrics.avgLatencyMs);
    }
    if (success) {
      success.textContent = successRate;
    }
    if (note) {
      note.textContent = healthNote(metrics);
    }
  }
}

function renderProviderEditor(
  provider: ProviderName,
  settings: Awaited<ReturnType<typeof getSettings>>,
  secrets: ProviderSecrets,
  modelLabel: HTMLElement,
  modelInput: HTMLInputElement,
  baseURLInput: HTMLInputElement,
  keyLabel: HTMLElement,
  keyInput: HTMLInputElement,
  note: HTMLElement
): void {
  const template = PROVIDER_TEMPLATES[provider];
  modelLabel.textContent = `${PROVIDER_LABELS[provider]} model`;
  keyLabel.textContent = `${PROVIDER_LABELS[provider]} API key`;
  modelInput.placeholder = template.defaultModel;
  modelInput.value = settings.models[provider];
  baseURLInput.placeholder = template.defaultBaseURL || "https://api.example.com/v1";
  baseURLInput.value = settings.baseURLs[provider];
  keyInput.placeholder = template.keyPlaceholder;
  keyInput.value = secrets[provider] ?? "";
  note.textContent = `${template.description} Protocol: ${template.protocol}.`;
}

function resetProviderToTemplate(
  provider: ProviderName,
  settings: Awaited<ReturnType<typeof getSettings>>
): Awaited<ReturnType<typeof getSettings>> {
  const template = PROVIDER_TEMPLATES[provider];
  return {
    ...settings,
    baseURLs: {
      ...settings.baseURLs,
      [provider]: template.defaultBaseURL
    },
    models: {
      ...settings.models,
      [provider]: template.defaultModel
    }
  };
}

async function init(): Promise<void> {
  const form = document.getElementById("settings-form") as HTMLFormElement | null;
  if (!form) {
    return;
  }

  const targetLanguage = document.getElementById("target-language") as HTMLInputElement;
  const speedMode = document.getElementById("speed-mode") as HTMLSelectElement;
  const primaryProvider = document.getElementById("primary-provider") as HTMLSelectElement;
  const configProvider = document.getElementById("config-provider") as HTMLSelectElement;
  const providerModelLabel = document.getElementById("provider-model-label") as HTMLSpanElement;
  const providerModel = document.getElementById("provider-model") as HTMLInputElement;
  const providerBaseURL = document.getElementById("provider-base-url") as HTMLInputElement;
  const providerKeyLabel = document.getElementById("provider-key-label") as HTMLSpanElement;
  const providerKey = document.getElementById("provider-key") as HTMLInputElement;
  const providerTemplateNote = document.getElementById("provider-template-note") as HTMLParagraphElement;
  const resetProviderTemplate = document.getElementById("reset-provider-template") as HTMLButtonElement;
  const state = document.getElementById("saved-state") as HTMLParagraphElement;

  populateProviderSelect(primaryProvider);
  populateProviderSelect(configProvider);

  let settings = await getSettings();
  let secrets = await getSecrets();
  let activeConfigProvider = settings.providerPriority[0];

  const persistVisibleProviderDraft = () => {
    settings = {
      ...settings,
      baseURLs: {
        ...settings.baseURLs,
        [activeConfigProvider]: providerBaseURL.value.trim()
      },
      models: {
        ...settings.models,
        [activeConfigProvider]: providerModel.value.trim() || settings.models[activeConfigProvider]
      }
    };
    secrets = {
      ...secrets,
      [activeConfigProvider]: providerKey.value.trim()
    };
  };

  const syncForm = (nextSettings: typeof settings, nextSecrets: typeof secrets) => {
    targetLanguage.value = nextSettings.targetLanguage;
    speedMode.value = nextSettings.speedMode;
    primaryProvider.value = nextSettings.providerPriority[0];
    configProvider.value = activeConfigProvider;
    renderProviderEditor(
      activeConfigProvider,
      nextSettings,
      nextSecrets,
      providerModelLabel,
      providerModel,
      providerBaseURL,
      providerKeyLabel,
      providerKey,
      providerTemplateNote
    );
  };

  const refresh = async () => {
    settings = await getSettings();
    secrets = await getSecrets();
    if (!ALL_PROVIDERS.includes(activeConfigProvider)) {
      activeConfigProvider = settings.providerPriority[0];
    }
    syncForm(settings, secrets);
    renderProviderHealth(await getProviderMetrics());
  };

  configProvider.addEventListener("change", () => {
    persistVisibleProviderDraft();
    activeConfigProvider = configProvider.value as ProviderName;
    renderProviderEditor(
      activeConfigProvider,
      settings,
      secrets,
      providerModelLabel,
      providerModel,
      providerBaseURL,
      providerKeyLabel,
      providerKey,
      providerTemplateNote
    );
  });

  resetProviderTemplate.addEventListener("click", () => {
    persistVisibleProviderDraft();
    settings = resetProviderToTemplate(activeConfigProvider, settings);
    renderProviderEditor(
      activeConfigProvider,
      settings,
      secrets,
      providerModelLabel,
      providerModel,
      providerBaseURL,
      providerKeyLabel,
      providerKey,
      providerTemplateNote
    );
  });

  syncForm(settings, secrets);
  renderProviderHealth(await getProviderMetrics());

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    persistVisibleProviderDraft();

    settings = {
      ...settings,
      targetLanguage: targetLanguage.value.trim() || "zh-CN",
      speedMode: speedMode.value as "fast" | "balanced" | "quality",
      providerPriority: reorderProviders(primaryProvider.value as ProviderName)
    };

    await setSettings(settings);
    await setSecrets(secrets);

    state.textContent = `Saved at ${new Date().toLocaleTimeString()}`;
    await refresh();
  });

  chrome.storage.onChanged.addListener((_changes, areaName) => {
    if (areaName === "local" || areaName === "session" || areaName === "sync") {
      void refresh();
    }
  });
}

void init();
