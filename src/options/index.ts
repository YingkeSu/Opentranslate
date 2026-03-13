import { getProviderMetrics, getSecrets, getSettings, setSecrets, setSettings } from "../shared/storage";
import {
  ALL_PROVIDERS,
  PROVIDER_LABELS,
  PROVIDER_TEMPLATES,
  type ExtensionSettings,
  type ProviderMetrics,
  type ProviderMetricsSnapshot,
  type ProviderName,
  type ProviderSecrets,
  type ProviderStatusResult,
  type QueryTrace,
  type RuntimeResponse
} from "../shared/types";

function configuredProviders(priority: ProviderName[]): ProviderName[] {
  return priority.filter((provider, index) => ALL_PROVIDERS.includes(provider) && priority.indexOf(provider) === index);
}

function unconfiguredProviders(priority: ProviderName[]): ProviderName[] {
  const configured = new Set(configuredProviders(priority));
  return ALL_PROVIDERS.filter((provider) => !configured.has(provider));
}

function populateProviderSelect(
  select: HTMLSelectElement,
  providers: ProviderName[],
  placeholder: string
): void {
  const options =
    providers.length === 0
      ? [Object.assign(document.createElement("option"), { value: "", textContent: placeholder })]
      : providers.map((provider) => {
          const option = document.createElement("option");
          option.value = provider;
          option.textContent = PROVIDER_LABELS[provider];
          return option;
        });

  select.replaceChildren(...options);
  select.disabled = providers.length === 0;
}

function reorderProviders(primary: ProviderName | null, providers: ProviderName[]): ProviderName[] {
  if (!primary || !providers.includes(primary)) {
    return [...providers];
  }
  return [primary, ...providers.filter((provider) => provider !== primary)];
}

function parseModelList(value: string, fallback: string[]): string[] {
  const models = value
    .split(/\r?\n|,/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  return models.length > 0 ? models : [...fallback];
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

function emptyCard(message: string): HTMLDivElement {
  const node = document.createElement("div");
  node.className = "empty-card";
  node.textContent = message;
  return node;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderProviderHealth(
  root: HTMLElement,
  providers: ProviderName[],
  snapshot: ProviderMetricsSnapshot,
  settings: ExtensionSettings
): void {
  if (providers.length === 0) {
    root.replaceChildren(emptyCard("No configured providers yet. Add one to start collecting health signals."));
    return;
  }

  root.replaceChildren(
    ...providers.map((provider) => {
      const metrics = snapshot[provider];
      const card = document.createElement("article");
      const successRate = metrics.attempts === 0 ? "-" : `${Math.round((metrics.successes / metrics.attempts) * 100)}%`;
      card.className = "health-card";
      card.dataset.state = healthState(metrics);
      card.dataset.provider = provider;
      card.innerHTML = `
        <div class="health-top">
          <div>
            <strong>${escapeHtml(PROVIDER_LABELS[provider])}</strong>
            <p class="health-meta">${settings.models[provider].length} model${settings.models[provider].length === 1 ? "" : "s"} configured</p>
          </div>
          <span data-field="badge">${healthState(metrics)}</span>
        </div>
        <p class="health-meta">TTFT <span data-field="ttft">${formatMs(metrics.avgTtftMs)}</span></p>
        <p class="health-meta">Latency <span data-field="latency">${formatMs(metrics.avgLatencyMs)}</span></p>
        <p class="health-meta">Success <span data-field="success">${successRate}</span></p>
        <p class="health-note" data-field="note">${escapeHtml(healthNote(metrics))}</p>
      `;
      return card;
    })
  );
}

function renderProviderEditor(
  provider: ProviderName | null,
  settings: ExtensionSettings,
  secrets: ProviderSecrets,
  modelLabel: HTMLElement,
  modelsInput: HTMLTextAreaElement,
  baseURLInput: HTMLInputElement,
  keyLabel: HTMLElement,
  keyInput: HTMLInputElement,
  note: HTMLElement,
  resetButton: HTMLButtonElement,
  removeButton: HTMLButtonElement
): void {
  if (!provider) {
    modelLabel.textContent = "Models";
    modelsInput.value = "";
    modelsInput.placeholder = "Add a provider first";
    modelsInput.disabled = true;
    baseURLInput.value = "";
    baseURLInput.placeholder = "https://api.example.com/v1";
    baseURLInput.disabled = true;
    keyLabel.textContent = "API Key";
    keyInput.value = "";
    keyInput.placeholder = "Add a provider first";
    keyInput.disabled = true;
    note.textContent = "No provider configured yet. Add a provider template above.";
    resetButton.disabled = true;
    removeButton.disabled = true;
    return;
  }

  const template = PROVIDER_TEMPLATES[provider];
  modelLabel.textContent = `${PROVIDER_LABELS[provider]} models`;
  modelsInput.value = settings.models[provider].join("\n");
  modelsInput.placeholder = template.defaultModel;
  modelsInput.disabled = false;
  baseURLInput.value = settings.baseURLs[provider];
  baseURLInput.placeholder = template.defaultBaseURL || "https://api.example.com/v1";
  baseURLInput.disabled = false;
  keyLabel.textContent = `${PROVIDER_LABELS[provider]} API Key`;
  keyInput.value = secrets[provider] ?? "";
  keyInput.placeholder = template.keyPlaceholder;
  keyInput.disabled = false;
  note.textContent = `${template.description} Protocol: ${template.protocol}.`;
  resetButton.disabled = false;
  removeButton.disabled = false;
}

function resetProviderToTemplate(provider: ProviderName, settings: ExtensionSettings): ExtensionSettings {
  const template = PROVIDER_TEMPLATES[provider];
  return {
    ...settings,
    baseURLs: {
      ...settings.baseURLs,
      [provider]: template.defaultBaseURL
    },
    models: {
      ...settings.models,
      [provider]: [template.defaultModel]
    }
  };
}

function formatTimestamp(value: number): string {
  return new Date(value).toLocaleString();
}

function renderProviderStatuses(root: HTMLElement, results: ProviderStatusResult[]): void {
  if (results.length === 0) {
    root.replaceChildren(emptyCard("No configured providers to test."));
    return;
  }

  root.replaceChildren(
    ...results.map((result) => {
      const card = document.createElement("article");
      card.className = "status-card";
      card.dataset.state = result.ok ? "healthy" : "failed";
      card.dataset.provider = result.provider;
      const models = result.models.length > 0 ? result.models.join(", ") : "No models saved";
      card.innerHTML = `
        <div class="status-top">
          <div>
            <strong>${escapeHtml(PROVIDER_LABELS[result.provider])}</strong>
            <p class="status-meta">${escapeHtml(models)}</p>
          </div>
          <span class="status-badge">${result.ok ? "ok" : "fail"}</span>
        </div>
        <p class="status-meta">${escapeHtml(result.message)}</p>
        <p class="status-meta">Checked at ${formatTimestamp(result.checkedAt)}${result.status ? ` · HTTP ${result.status}` : ""}</p>
      `;
      return card;
    })
  );
}

function renderQueryTraces(root: HTMLElement, traces: QueryTrace[]): void {
  if (traces.length === 0) {
    root.replaceChildren(emptyCard("No query traces captured yet."));
    return;
  }

  root.replaceChildren(
    ...traces.map((trace) => {
      const card = document.createElement("article");
      card.className = "trace-card";
      card.dataset.state = trace.ok ? "success" : "failed";
      if (trace.provider) {
        card.dataset.provider = trace.provider;
      }
      const providerLabel = trace.provider ? PROVIDER_LABELS[trace.provider] : "Unknown provider";
      const modelLabel = trace.model ?? "unknown model";
      const responseText = trace.ok ? trace.responseText || "(empty response)" : trace.errorMessage || "Unknown failure";

      card.innerHTML = `
        <div class="trace-top">
          <div>
            <strong>${escapeHtml(providerLabel)} / ${escapeHtml(modelLabel)}</strong>
            <p class="trace-meta">${formatTimestamp(trace.finishedAt)} · target ${escapeHtml(trace.targetLang)}${trace.cacheHit ? " · cache" : ""}</p>
          </div>
          <span class="trace-badge">${trace.ok ? "ok" : "fail"}</span>
        </div>
        <div class="trace-body">
          <div>
            <p class="trace-label">Request</p>
            <p class="trace-text">${escapeHtml(trace.requestText)}</p>
          </div>
          <div>
            <p class="trace-label">${escapeHtml(trace.ok ? "Response" : trace.errorCode || "Error")}</p>
            <p class="trace-text">${escapeHtml(responseText)}</p>
          </div>
        </div>
      `;
      return card;
    })
  );
}

async function fetchQueryTraces(root: HTMLElement): Promise<void> {
  try {
    const response = (await chrome.runtime.sendMessage({ type: "GET_QUERY_TRACES" })) as RuntimeResponse | undefined;
    if (response?.ok && response.type === "QUERY_TRACES") {
      renderQueryTraces(root, response.traces);
      return;
    }
  } catch {
    // Ignore and fall through to error state.
  }

  root.replaceChildren(emptyCard("Recent query traces are unavailable. Reload the extension background and try again."));
}

async function testSavedProviders(root: HTMLElement): Promise<void> {
  root.replaceChildren(emptyCard("Testing saved provider endpoints..."));

  try {
    const response = (await chrome.runtime.sendMessage({
      type: "TEST_PROVIDER_STATUS"
    })) as RuntimeResponse | undefined;
    if (response?.ok && response.type === "PROVIDER_STATUS") {
      renderProviderStatuses(root, response.results);
      return;
    }
  } catch {
    // Ignore and fall through to error state.
  }

  root.replaceChildren(emptyCard("Provider status test failed to run. Reload the extension background and try again."));
}

async function init(): Promise<void> {
  const form = document.getElementById("settings-form") as HTMLFormElement | null;
  if (!form) {
    return;
  }

  const targetLanguage = document.getElementById("target-language") as HTMLInputElement;
  const speedMode = document.getElementById("speed-mode") as HTMLSelectElement;
  const primaryProvider = document.getElementById("primary-provider") as HTMLSelectElement;
  const configuredProviderNote = document.getElementById("configured-provider-note") as HTMLParagraphElement;
  const addProviderTemplate = document.getElementById("add-provider-template") as HTMLSelectElement;
  const addProviderButton = document.getElementById("add-provider") as HTMLButtonElement;
  const configProvider = document.getElementById("config-provider") as HTMLSelectElement;
  const providerModelLabel = document.getElementById("provider-model-label") as HTMLSpanElement;
  const providerModels = document.getElementById("provider-models") as HTMLTextAreaElement;
  const providerBaseURL = document.getElementById("provider-base-url") as HTMLInputElement;
  const providerKeyLabel = document.getElementById("provider-key-label") as HTMLSpanElement;
  const providerKey = document.getElementById("provider-key") as HTMLInputElement;
  const providerTemplateNote = document.getElementById("provider-template-note") as HTMLParagraphElement;
  const resetProviderTemplate = document.getElementById("reset-provider-template") as HTMLButtonElement;
  const removeProvider = document.getElementById("remove-provider") as HTMLButtonElement;
  const testProviderStatus = document.getElementById("test-provider-status") as HTMLButtonElement;
  const refreshQueryTraces = document.getElementById("refresh-query-traces") as HTMLButtonElement;
  const providerHealth = document.getElementById("provider-health") as HTMLDivElement;
  const providerStatusResults = document.getElementById("provider-status-results") as HTMLDivElement;
  const queryTraces = document.getElementById("query-traces") as HTMLDivElement;
  const state = document.getElementById("saved-state") as HTMLParagraphElement;

  let settings = await getSettings();
  let secrets = await getSecrets();
  let activeConfigProvider: ProviderName | null = configuredProviders(settings.providerPriority)[0] ?? null;

  const persistDrafts = () => {
    const configured = configuredProviders(settings.providerPriority);
    const primary = primaryProvider.value ? (primaryProvider.value as ProviderName) : configured[0] ?? null;

    if (!activeConfigProvider) {
      settings = {
        ...settings,
        targetLanguage: targetLanguage.value.trim() || "zh-CN",
        speedMode: speedMode.value as ExtensionSettings["speedMode"],
        providerPriority: reorderProviders(primary, configured)
      };
      return;
    }

    settings = {
      ...settings,
      targetLanguage: targetLanguage.value.trim() || "zh-CN",
      speedMode: speedMode.value as ExtensionSettings["speedMode"],
      providerPriority: reorderProviders(primary, configured),
      baseURLs: {
        ...settings.baseURLs,
        [activeConfigProvider]: providerBaseURL.value.trim()
      },
      models: {
        ...settings.models,
        [activeConfigProvider]: parseModelList(providerModels.value, settings.models[activeConfigProvider])
      }
    };
    secrets = {
      ...secrets,
      [activeConfigProvider]: providerKey.value.trim()
    };
  };

  const syncForm = () => {
    const configured = configuredProviders(settings.providerPriority);
    const unconfigured = unconfiguredProviders(settings.providerPriority);

    if (!activeConfigProvider || !configured.includes(activeConfigProvider)) {
      activeConfigProvider = configured[0] ?? null;
    }

    populateProviderSelect(primaryProvider, configured, "No configured providers");
    populateProviderSelect(configProvider, configured, "No configured providers");
    populateProviderSelect(addProviderTemplate, unconfigured, "All provider templates already added");

    targetLanguage.value = settings.targetLanguage;
    speedMode.value = settings.speedMode;
    if (configured.length > 0) {
      primaryProvider.value = configured.includes(settings.providerPriority[0]) ? settings.providerPriority[0] : configured[0];
      if (activeConfigProvider) {
        configProvider.value = activeConfigProvider;
      }
    }

    addProviderButton.disabled = unconfigured.length === 0;
    configuredProviderNote.textContent =
      configured.length > 0
        ? "Only configured providers appear in selectors and diagnostics."
        : "No providers configured yet. Add a template to start.";

    renderProviderEditor(
      activeConfigProvider,
      settings,
      secrets,
      providerModelLabel,
      providerModels,
      providerBaseURL,
      providerKeyLabel,
      providerKey,
      providerTemplateNote,
      resetProviderTemplate,
      removeProvider
    );
  };

  const refreshHealth = async () => {
    renderProviderHealth(providerHealth, configuredProviders(settings.providerPriority), await getProviderMetrics(), settings);
  };

  const refreshAll = async () => {
    settings = await getSettings();
    secrets = await getSecrets();
    syncForm();
    await refreshHealth();
    await fetchQueryTraces(queryTraces);
  };

  syncForm();
  await refreshHealth();
  await fetchQueryTraces(queryTraces);
  renderProviderStatuses(providerStatusResults, []);

  configProvider.addEventListener("change", () => {
    persistDrafts();
    activeConfigProvider = (configProvider.value as ProviderName) || null;
    syncForm();
  });

  addProviderButton.addEventListener("click", () => {
    if (!addProviderTemplate.value) {
      return;
    }

    persistDrafts();
    const provider = addProviderTemplate.value as ProviderName;
    settings = {
      ...settings,
      providerPriority: [...configuredProviders(settings.providerPriority), provider]
    };
    activeConfigProvider = provider;
    syncForm();
    void refreshHealth();
  });

  resetProviderTemplate.addEventListener("click", () => {
    if (!activeConfigProvider) {
      return;
    }

    persistDrafts();
    settings = resetProviderToTemplate(activeConfigProvider, settings);
    syncForm();
  });

  removeProvider.addEventListener("click", () => {
    if (!activeConfigProvider) {
      return;
    }

    persistDrafts();
    settings = {
      ...settings,
      providerPriority: configuredProviders(settings.providerPriority).filter(
        (provider) => provider !== activeConfigProvider
      )
    };
    activeConfigProvider = configuredProviders(settings.providerPriority)[0] ?? null;
    syncForm();
    void refreshHealth();
  });

  testProviderStatus.addEventListener("click", async () => {
    testProviderStatus.disabled = true;
    await testSavedProviders(providerStatusResults);
    testProviderStatus.disabled = false;
  });

  refreshQueryTraces.addEventListener("click", async () => {
    refreshQueryTraces.disabled = true;
    await fetchQueryTraces(queryTraces);
    refreshQueryTraces.disabled = false;
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    persistDrafts();

    const configured = configuredProviders(settings.providerPriority);
    const primary = primaryProvider.value ? (primaryProvider.value as ProviderName) : configured[0] ?? null;
    settings = {
      ...settings,
      targetLanguage: targetLanguage.value.trim() || "zh-CN",
      speedMode: speedMode.value as ExtensionSettings["speedMode"],
      providerPriority: reorderProviders(primary, configured)
    };

    await setSettings(settings);
    await setSecrets(secrets);
    syncForm();
    await refreshHealth();
    state.textContent = `Saved at ${new Date().toLocaleTimeString()}`;
  });

  chrome.storage.onChanged.addListener((_changes, areaName) => {
    if (areaName === "local" || areaName === "session" || areaName === "sync") {
      void refreshAll();
    }
  });
}

void init();
