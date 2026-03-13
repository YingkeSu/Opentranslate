import { getSecrets, getSettings, setSecrets, setSettings } from "../shared/storage";
import {
  ALL_PROVIDERS,
  PROVIDER_LABELS,
  PROVIDER_TEMPLATES,
  type ProviderName,
  type ProviderSecrets,
  type RuntimeResponse
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

function setStatus(node: HTMLElement, message: string, state: "default" | "error" | "ready" | "saved"): void {
  node.textContent = message;
  if (state === "default") {
    delete node.dataset.state;
    return;
  }
  node.dataset.state = state;
}

function renderProviderEditor(
  provider: ProviderName,
  secrets: ProviderSecrets,
  keyLabel: HTMLElement,
  keyInput: HTMLInputElement,
  note: HTMLElement
): void {
  const template = PROVIDER_TEMPLATES[provider];
  keyLabel.textContent = `${PROVIDER_LABELS[provider]} API key`;
  keyInput.placeholder = template.keyPlaceholder;
  keyInput.value = secrets[provider] ?? "";
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

  populateProviderSelect(primaryProvider);
  populateProviderSelect(configProvider);

  let settings = await getSettings();
  let secrets = await getSecrets();
  let activeConfigProvider = settings.providerPriority[0];

  const syncForm = () => {
    targetLanguage.value = settings.targetLanguage;
    primaryProvider.value = settings.providerPriority[0];
    configProvider.value = activeConfigProvider;
    renderProviderEditor(activeConfigProvider, secrets, providerKeyLabel, providerKey, providerTemplateNote);
  };

  const persistVisibleProviderDraft = () => {
    secrets = {
      ...secrets,
      [activeConfigProvider]: providerKey.value.trim()
    };
  };

  configProvider.addEventListener("change", () => {
    persistVisibleProviderDraft();
    activeConfigProvider = configProvider.value as ProviderName;
    renderProviderEditor(activeConfigProvider, secrets, providerKeyLabel, providerKey, providerTemplateNote);
  });

  syncForm();
  await checkBackground(status);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    persistVisibleProviderDraft();

    settings = {
      ...settings,
      targetLanguage: targetLanguage.value.trim() || "zh-CN",
      providerPriority: reorderProviders(primaryProvider.value as ProviderName)
    };

    await setSettings(settings);
    await setSecrets(secrets);

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
