import { PROVIDER_LABELS } from "../shared/types";
import type { ContentMessage, PortRequest, StreamEvent, TranslateRequest } from "../shared/types";
import { getSettings } from "../shared/storage";

const port = chrome.runtime.connect({ name: "polyglot-stream" });

let activeRequestId: string | null = null;
let activePanel: HTMLDivElement | null = null;
let selectionButton: HTMLButtonElement | null = null;
let currentText = "";

type UiState = {
  output: HTMLDivElement;
  status: HTMLDivElement;
  cancelButton: HTMLButtonElement;
  closeButton: HTMLButtonElement;
};

const uiMap = new Map<string, UiState>();

function ensureStyles(): void {
  if (document.getElementById("polyglot-style")) {
    return;
  }
  const style = document.createElement("style");
  style.id = "polyglot-style";
  style.textContent = `
    .polyglot-btn { position: absolute; z-index: 2147483646; border: none; border-radius: 8px; padding: 6px 10px; background: #2563eb; color: #fff; font: 12px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif; cursor: pointer; }
    .polyglot-panel { position: absolute; z-index: 2147483647; width: 360px; max-width: calc(100vw - 24px); border-radius: 12px; background: #111827; color: #f9fafb; box-shadow: 0 12px 28px rgba(0,0,0,.3); font: 13px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif; }
    .polyglot-head { display: flex; justify-content: space-between; align-items: center; padding: 8px 10px; border-bottom: 1px solid #374151; }
    .polyglot-head button { border: none; border-radius: 8px; background: #1f2937; color: #f9fafb; cursor: pointer; padding: 4px 8px; margin-left: 6px; }
    .polyglot-status { color: #9ca3af; font-size: 12px; }
    .polyglot-body { padding: 10px; max-height: 240px; overflow: auto; white-space: pre-wrap; }
  `;
  document.documentElement.appendChild(style);
}

function clearSelectionButton(): void {
  selectionButton?.remove();
  selectionButton = null;
}

function removePanel(): void {
  activePanel?.remove();
  activePanel = null;
}

function makeRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function send(message: PortRequest): void {
  port.postMessage(message);
}

function createPanel(anchorX: number, anchorY: number): { panel: HTMLDivElement; ui: UiState } {
  const panel = document.createElement("div");
  panel.className = "polyglot-panel";
  panel.style.left = `${Math.max(12, anchorX)}px`;
  panel.style.top = `${Math.max(12, anchorY + 12)}px`;

  const head = document.createElement("div");
  head.className = "polyglot-head";

  const status = document.createElement("div");
  status.className = "polyglot-status";
  status.textContent = "Loading...";

  const controls = document.createElement("div");
  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.textContent = "Cancel";

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.textContent = "Close";

  controls.append(cancelButton, closeButton);
  head.append(status, controls);

  const output = document.createElement("div");
  output.className = "polyglot-body";

  panel.append(head, output);
  document.documentElement.appendChild(panel);
  return { panel, ui: { output, status, cancelButton, closeButton } };
}

async function startTranslation(text: string, anchorX: number, anchorY: number): Promise<void> {
  if (!text.trim()) {
    return;
  }

  if (activeRequestId) {
    send({ type: "CANCEL_REQUEST", requestId: activeRequestId });
  }
  removePanel();

  const requestId = makeRequestId();
  activeRequestId = requestId;

  const { panel, ui } = createPanel(anchorX, anchorY);
  activePanel = panel;
  uiMap.set(requestId, ui);

  ui.cancelButton.addEventListener("click", () => {
    send({ type: "CANCEL_REQUEST", requestId });
  });
  ui.closeButton.addEventListener("click", () => {
    if (activeRequestId === requestId) {
      send({ type: "CANCEL_REQUEST", requestId });
      activeRequestId = null;
    }
    removePanel();
  });

  const settings = await getSettings();
  const request: TranslateRequest = {
    requestId,
    text,
    targetLang: settings.targetLanguage,
    mode: "selection",
    createdAt: Date.now()
  };

  send({ type: "TRANSLATE_REQUEST", payload: request });
}

function handleStreamEvent(event: StreamEvent): void {
  const ui = uiMap.get(event.requestId);
  if (!ui) {
    return;
  }

  if (event.type === "start") {
    ui.status.textContent = `Provider: ${PROVIDER_LABELS[event.provider]}/${event.model}`;
    ui.output.textContent = "";
    return;
  }

  if (event.type === "meta") {
    if (event.ttftMs !== undefined) {
      ui.status.textContent = `First token: ${event.ttftMs}ms`;
    }
    return;
  }

  if (event.type === "delta") {
    ui.output.textContent = (ui.output.textContent ?? "") + event.chunk;
    ui.output.scrollTop = ui.output.scrollHeight;
    return;
  }

  if (event.type === "done") {
    ui.status.textContent = `Done in ${event.latencyMs}ms${event.cacheHit ? " (cache)" : ""}`;
    if (activeRequestId === event.requestId) {
      activeRequestId = null;
    }
    return;
  }

  if (event.type === "error") {
    ui.status.textContent = `${event.code}: ${event.message}`;
    if (activeRequestId === event.requestId) {
      activeRequestId = null;
    }
  }
}

port.onMessage.addListener((message: StreamEvent) => {
  handleStreamEvent(message);
});

function selectedText(): string {
  return window.getSelection()?.toString().trim() ?? "";
}

function showSelectionButton(): void {
  clearSelectionButton();
  const selection = window.getSelection();
  const text = selection?.toString().trim() ?? "";
  if (!selection || !text || selection.rangeCount === 0) {
    return;
  }

  const rect = selection.getRangeAt(0).getBoundingClientRect();
  const btn = document.createElement("button");
  btn.className = "polyglot-btn";
  btn.type = "button";
  btn.textContent = "Translate";
  btn.style.left = `${window.scrollX + rect.right + 6}px`;
  btn.style.top = `${window.scrollY + rect.bottom + 6}px`;
  btn.addEventListener("click", () => {
    void startTranslation(text, window.scrollX + rect.left, window.scrollY + rect.bottom);
    clearSelectionButton();
  });
  document.documentElement.appendChild(btn);
  selectionButton = btn;
}

function translateCurrentSelection(): void {
  const text = selectedText();
  if (!text) {
    return;
  }
  const selection = window.getSelection();
  const rect = selection?.rangeCount ? selection.getRangeAt(0).getBoundingClientRect() : null;
  const x = rect ? window.scrollX + rect.left : 24;
  const y = rect ? window.scrollY + rect.bottom : 24;
  void startTranslation(text, x, y);
}

chrome.runtime.onMessage.addListener((message: ContentMessage) => {
  if (message.type === "TRIGGER_TRANSLATE_SELECTION") {
    translateCurrentSelection();
    return;
  }
  if (message.type === "CONTEXT_TRANSLATE") {
    currentText = message.text;
    void startTranslation(currentText, window.scrollX + 24, window.scrollY + 24);
  }
});

document.addEventListener("selectionchange", () => {
  const text = selectedText();
  if (text) {
    showSelectionButton();
  } else {
    clearSelectionButton();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.altKey && event.key.toLowerCase() === "t") {
    event.preventDefault();
    translateCurrentSelection();
  }
});

ensureStyles();
