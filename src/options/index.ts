import {
  getProviderMetrics,
  getSecrets,
  getSettings,
  setSecrets,
  setSettings
} from "../shared/storage";
import {
  ALL_PROVIDERS,
  type ProviderMetrics,
  type ProviderMetricsSnapshot,
  type ProviderName
} from "../shared/types";

function providerList(input: string): ProviderName[] {
  const values = input
    .split(",")
    .map((value) => value.trim())
    .filter((value): value is ProviderName => ALL_PROVIDERS.includes(value as ProviderName));

  return values.length ? values : [...ALL_PROVIDERS];
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

async function init(): Promise<void> {
  const form = document.getElementById("settings-form") as HTMLFormElement | null;
  if (!form) {
    return;
  }

  const targetLanguage = document.getElementById("target-language") as HTMLInputElement;
  const speedMode = document.getElementById("speed-mode") as HTMLSelectElement;
  const providerPriority = document.getElementById("provider-priority") as HTMLInputElement;
  const openrouterModel = document.getElementById("openrouter-model") as HTMLInputElement;
  const openaiModel = document.getElementById("openai-model") as HTMLInputElement;
  const anthropicModel = document.getElementById("anthropic-model") as HTMLInputElement;
  const openrouterKey = document.getElementById("openrouter-key") as HTMLInputElement;
  const openaiKey = document.getElementById("openai-key") as HTMLInputElement;
  const anthropicKey = document.getElementById("anthropic-key") as HTMLInputElement;
  const state = document.getElementById("saved-state") as HTMLParagraphElement;

  let settings = await getSettings();
  let secrets = await getSecrets();

  const syncForm = (nextSettings: typeof settings, nextSecrets: typeof secrets) => {
    targetLanguage.value = nextSettings.targetLanguage;
    speedMode.value = nextSettings.speedMode;
    providerPriority.value = nextSettings.providerPriority.join(",");
    openrouterModel.value = nextSettings.models.openrouter;
    openaiModel.value = nextSettings.models.openai;
    anthropicModel.value = nextSettings.models.anthropic;
    openrouterKey.value = nextSecrets.openrouter ?? "";
    openaiKey.value = nextSecrets.openai ?? "";
    anthropicKey.value = nextSecrets.anthropic ?? "";
  };

  const refresh = async () => {
    settings = await getSettings();
    secrets = await getSecrets();
    syncForm(settings, secrets);
    renderProviderHealth(await getProviderMetrics());
  };

  syncForm(settings, secrets);
  renderProviderHealth(await getProviderMetrics());

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    settings = {
      ...settings,
      targetLanguage: targetLanguage.value.trim() || "zh-CN",
      speedMode: speedMode.value as "fast" | "balanced" | "quality",
      providerPriority: providerList(providerPriority.value),
      models: {
        openrouter: openrouterModel.value.trim() || settings.models.openrouter,
        openai: openaiModel.value.trim() || settings.models.openai,
        anthropic: anthropicModel.value.trim() || settings.models.anthropic
      }
    };

    secrets = {
      openrouter: openrouterKey.value.trim(),
      openai: openaiKey.value.trim(),
      anthropic: anthropicKey.value.trim()
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
