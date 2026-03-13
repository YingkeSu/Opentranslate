import { getSecrets, getSettings, setSecrets, setSettings } from "../shared/storage";
import {
  ALL_PROVIDERS,
  PROVIDER_LABELS,
  PROVIDER_TEMPLATES,
  type ProviderName,
  type ProviderSecrets,
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

function setStatus(node: HTMLElement, message: string, state: "default" | "error" | "ready" | "saved"): void {
  node.textContent = message;
  if (state === "default") {
    delete node.dataset.state;
    return;
  }
  node.dataset.state = state;
}

function renderProviderEditor(
  provider: ProviderName | null,
  secrets: ProviderSecrets,
  keyLabel: HTMLElement,
  keyInput: HTMLInputElement,
  note: HTMLElement
): void {
  if (!provider) {
    keyLabel.textContent = "API key";
    keyInput.value = "";
    keyInput.placeholder = "Add a provider first";
    keyInput.disabled = true;
    note.textContent = "No provider configured yet. Add a provider template below.";
    return;
  }

  const template = PROVIDER_TEMPLATES[provider];
  keyLabel.textContent = `${PROVIDER_LABELS[provider]} API key`;
  keyInput.placeholder = template.keyPlaceholder;
  keyInput.value = secrets[provider] ?? "";
  keyInput.disabled = false;
  note.textContent = template.description;
}

async function checkBackground(status: HTMLElement): Promise<boolean> {
  try {
    const response = (await chrome.runtime.sendMessage({ type: "PING" })) as RuntimeResponse | undefined;
    if (response?.ok) {
      setStatus(status, "Background service ready.", "ready");
      return true;
    }
    setStatus(status, "Background service did not respond. Reload the extension in chrome://extensions.", "error");
    return false;
  } catch {
    setStatus(status, "Background service unavailable. Reload the extension in chrome://extensions.", "error");
    return false;
  }
}

async function init(): Promise<void> {
  const form = document.getElementById("quick-settings") as HTMLFormElement | null;
  const status = document.getElementById("status") as HTMLParagraphElement | null;
  const optionsButton = document.getElementById("open-options") as HTMLButtonElement | null;

  if (!form || !status || !optionsButton) {
    return;
  }

  const targetLanguage = document.getElementById("target-language") as HTMLInputElement;
  const primaryProvider = document.getElementById("primary-provider") as HTMLSelectElement;
  const configProvider = document.getElementById("config-provider") as HTMLSelectElement;
  const providerKeyLabel = document.getElementById("provider-key-label") as HTMLSpanElement;
  const providerKey = document.getElementById("provider-key") as HTMLInputElement;
  const providerTemplateNote = document.getElementById("provider-template-note") as HTMLParagraphElement;
  const configuredProviderNote = document.getElementById("configured-provider-note") as HTMLParagraphElement;
  const addProviderTemplate = document.getElementById("add-provider-template") as HTMLSelectElement;
  const addProviderButton = document.getElementById("add-provider") as HTMLButtonElement;

  let settings = await getSettings();
  let secrets = await getSecrets();
  let activeConfigProvider: ProviderName | null = configuredProviders(settings.providerPriority)[0] ?? null;

  const persistDrafts = () => {
    const configured = configuredProviders(settings.providerPriority);
    const primary = primaryProvider.value ? (primaryProvider.value as ProviderName) : configured[0] ?? null;

    settings = {
      ...settings,
      targetLanguage: targetLanguage.value.trim() || "zh-CN",
      providerPriority:
        configured.length > 0
          ? reorderProviders(primary, configured)
          : []
    };

    if (!activeConfigProvider) {
      return;
    }

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
    populateProviderSelect(addProviderTemplate, unconfigured, "All templates already added");

    targetLanguage.value = settings.targetLanguage;
    if (configured.length > 0) {
      primaryProvider.value = configured[0];
      if (activeConfigProvider) {
        configProvider.value = activeConfigProvider;
      }
    }

    configuredProviderNote.textContent =
      configured.length > 0
        ? "Edit one configured provider at a time."
        : "No providers configured yet. Add one below to start.";

    renderProviderEditor(activeConfigProvider, secrets, providerKeyLabel, providerKey, providerTemplateNote);
  };

  configProvider.addEventListener("change", () => {
    persistDrafts();
    activeConfigProvider = (configProvider.value as ProviderName) || null;
    renderProviderEditor(activeConfigProvider, secrets, providerKeyLabel, providerKey, providerTemplateNote);
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
  });

  syncForm();
  await checkBackground(status);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    persistDrafts();

    await setSettings(settings);
    await setSecrets(secrets);
    syncForm();

    const ready = await chrome.runtime
      .sendMessage({ type: "PING" })
      .then((response) => Boolean((response as RuntimeResponse | undefined)?.ok))
      .catch(() => false);

    setStatus(
      status,
      ready
        ? `Saved quick setup at ${new Date().toLocaleTimeString()}. Background service ready.`
        : `Saved quick setup at ${new Date().toLocaleTimeString()}. Reload the extension to recover the background service.`,
      ready ? "saved" : "error"
    );
  });

  optionsButton.addEventListener("click", () => {
    void chrome.runtime.openOptionsPage();
  });
}

void init();
