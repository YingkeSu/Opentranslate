import { recordProviderFailure, recordProviderSuccess, loadProviderMetrics } from "./metrics";
import { ProviderHttpError } from "./providers/base";
import { getAdapter, getAttemptBudget, orderedProviders } from "./router";
import { getCached, makeCacheIdentity, setCached } from "../shared/cache";
import { getSecrets, getSettings } from "../shared/storage";
import type {
  ContentMessage,
  ErrorCode,
  PortRequest,
  ProviderName,
  RuntimeMessage,
  RuntimeResponse,
  StreamEvent,
  TranslateRequest
} from "../shared/types";

const controllers = new Map<string, AbortController>();

type AttemptAbortReason = "total_timeout" | "ttft_timeout" | "user_abort";
type AttemptFailure = {
  code: ErrorCode;
  message: string;
  retryAfterMs?: number;
  retryable: boolean;
};

function emit(port: chrome.runtime.Port, event: StreamEvent): void {
  port.postMessage(event);
}

function invalidRequest(req: TranslateRequest): boolean {
  return !req.requestId.trim() || !req.text.trim() || !req.targetLang.trim();
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Request aborted", "AbortError"));
    };

    if (signal.aborted) {
      onAbort();
      return;
    }

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function* replayCached(text: string, signal: AbortSignal): AsyncGenerator<string> {
  const words = text.split(/(\s+)/);
  for (const word of words) {
    if (!word) {
      continue;
    }
    if (signal.aborted) {
      throw new DOMException("Request aborted", "AbortError");
    }
    yield word;
    await sleep(20, signal);
  }
}

function createAttemptController(
  parentSignal: AbortSignal,
  firstChunkTimeoutMs: number,
  totalTimeoutMs: number
): {
  cleanup: () => void;
  markFirstChunk: () => void;
  reason: () => AttemptAbortReason | null;
  signal: AbortSignal;
} {
  const controller = new AbortController();
  let abortReason: AttemptAbortReason | null = null;
  let firstChunkTimer: ReturnType<typeof setTimeout> | null = null;
  let totalTimer: ReturnType<typeof setTimeout> | null = null;

  const abort = (reason: AttemptAbortReason) => {
    if (controller.signal.aborted) {
      return;
    }
    abortReason = reason;
    controller.abort(reason);
  };

  const onParentAbort = () => abort("user_abort");

  if (parentSignal.aborted) {
    onParentAbort();
  } else {
    parentSignal.addEventListener("abort", onParentAbort, { once: true });
  }

  firstChunkTimer = setTimeout(() => abort("ttft_timeout"), firstChunkTimeoutMs);
  totalTimer = setTimeout(() => abort("total_timeout"), totalTimeoutMs);

  return {
    signal: controller.signal,
    markFirstChunk: () => {
      if (firstChunkTimer) {
        clearTimeout(firstChunkTimer);
        firstChunkTimer = null;
      }
    },
    cleanup: () => {
      if (firstChunkTimer) {
        clearTimeout(firstChunkTimer);
      }
      if (totalTimer) {
        clearTimeout(totalTimer);
      }
      parentSignal.removeEventListener("abort", onParentAbort);
    },
    reason: () => abortReason
  };
}

function classifyAttemptFailure(error: unknown, abortReason: AttemptAbortReason | null): AttemptFailure {
  if (abortReason === "user_abort") {
    return {
      code: "E_ABORTED",
      message: "Request aborted",
      retryable: false
    };
  }

  if (abortReason === "ttft_timeout" || abortReason === "total_timeout") {
    return {
      code: "E_TIMEOUT",
      message:
        abortReason === "ttft_timeout"
          ? "Timed out waiting for first token"
          : "Timed out waiting for provider response",
      retryable: true
    };
  }

  if (error instanceof ProviderHttpError) {
    return {
      code: error.code,
      message: error.message,
      retryAfterMs: error.retryAfterMs,
      retryable: error.code === "E_RATE_LIMIT" || error.code === "E_PROVIDER_DOWN"
    };
  }

  if (error instanceof DOMException && error.name === "AbortError") {
    return {
      code: "E_ABORTED",
      message: "Request aborted",
      retryable: false
    };
  }

  if (error instanceof TypeError) {
    return {
      code: "E_NETWORK",
      message: error.message || "Network error",
      retryable: true
    };
  }

  return {
    code: "E_PROVIDER_FAILED",
    message: error instanceof Error ? error.message : "Provider error",
    retryable: false
  };
}

async function runProviderAttempt(
  port: chrome.runtime.Port,
  req: TranslateRequest,
  provider: ProviderName,
  apiKey: string,
  baseURL: string,
  model: string,
  parentSignal: AbortSignal,
  budgets: ReturnType<typeof getAttemptBudget>
): Promise<{ latencyMs: number; text: string; ttftMs: number }> {
  const adapter = getAdapter(provider);
  const attempt = createAttemptController(
    parentSignal,
    budgets.firstChunkTimeoutMs,
    budgets.totalTimeoutMs
  );
  const startedAt = Date.now();
  let ttftMs = 0;
  let ttftSent = false;
  let seq = 0;
  let fullText = "";

  emit(port, { type: "start", requestId: req.requestId, provider, model });

  try {
    for await (const chunk of adapter.stream(req, { apiKey, baseURL, model, signal: attempt.signal })) {
      if (!ttftSent) {
        attempt.markFirstChunk();
        ttftMs = Date.now() - startedAt;
        ttftSent = true;
        emit(port, { type: "meta", requestId: req.requestId, ttftMs });
      }

      fullText += chunk;
      emit(port, { type: "delta", requestId: req.requestId, chunk, seq });
      seq += 1;
    }
  } catch (error) {
    attempt.cleanup();
    throw classifyAttemptFailure(error, attempt.reason());
  }

  attempt.cleanup();

  if (!fullText.trim()) {
    throw {
      code: "E_PROVIDER_FAILED",
      message: "Provider returned empty translation",
      retryable: true
    } satisfies AttemptFailure;
  }

  return {
    text: fullText,
    ttftMs: ttftSent ? ttftMs : Date.now() - startedAt,
    latencyMs: Date.now() - startedAt
  };
}

async function processRequest(port: chrome.runtime.Port, req: TranslateRequest): Promise<void> {
  if (invalidRequest(req)) {
    emit(port, {
      type: "error",
      requestId: req.requestId,
      code: "E_INVALID_REQUEST",
      message: "Request payload is invalid",
      retryable: false
    });
    return;
  }

  const requestController = new AbortController();
  controllers.set(req.requestId, requestController);

  const settings = await getSettings();
  const secrets = await getSecrets();
  const metrics = await loadProviderMetrics();
  const route = orderedProviders(settings, secrets, metrics);

  if (route.length === 0) {
    emit(port, {
      type: "error",
      requestId: req.requestId,
      code: "E_NO_PROVIDER",
      message: "No complete provider configuration found",
      retryable: false
    });
    return;
  }

  const budgets = getAttemptBudget(settings, req.text.length);
  let lastFailure: AttemptFailure | null = null;

  try {
    for (const provider of route) {
      const key = secrets[provider];
      if (!key) {
        continue;
      }

      const model = settings.models[provider];
      const baseURL = settings.baseURLs[provider].trim();
      if (!baseURL) {
        continue;
      }
      const identity = makeCacheIdentity(req.text, req.sourceLang, req.targetLang, provider, baseURL, model);
      const cached = await getCached(identity);

      if (cached) {
        const startedAt = Date.now();
        emit(port, { type: "start", requestId: req.requestId, provider, model });
        emit(port, { type: "meta", requestId: req.requestId, ttftMs: 1 });

        let seq = 0;
        for await (const chunk of replayCached(cached, requestController.signal)) {
          emit(port, { type: "delta", requestId: req.requestId, chunk, seq });
          seq += 1;
        }

        emit(port, {
          type: "done",
          requestId: req.requestId,
          text: cached,
          latencyMs: Date.now() - startedAt,
          cacheHit: true
        });
        return;
      }

      for (let attempt = 0; attempt <= budgets.retryCount; attempt += 1) {
        try {
          const result = await runProviderAttempt(
            port,
            req,
            provider,
            key,
            baseURL,
            model,
            requestController.signal,
            budgets
          );
          await setCached(identity, result.text);
          await recordProviderSuccess(provider, result.ttftMs, result.latencyMs);
          emit(port, {
            type: "done",
            requestId: req.requestId,
            text: result.text,
            latencyMs: result.latencyMs,
            cacheHit: false
          });
          return;
        } catch (error) {
          const failure = error as AttemptFailure;
          lastFailure = failure;

          if (failure.code !== "E_ABORTED") {
            await recordProviderFailure(provider, failure.code);
          }

          if (failure.code === "E_ABORTED") {
            emit(port, {
              type: "error",
              requestId: req.requestId,
              code: failure.code,
              message: failure.message,
              retryable: false
            });
            return;
          }

          const canRetryCurrentProvider =
            failure.retryable &&
            attempt < budgets.retryCount &&
            (failure.code === "E_NETWORK" ||
              failure.code === "E_PROVIDER_DOWN" ||
              failure.code === "E_RATE_LIMIT" ||
              failure.code === "E_TIMEOUT");

          if (canRetryCurrentProvider) {
            const backoffMs =
              failure.retryAfterMs ?? budgets.retryBaseDelayMs * (attempt + 1) * (attempt + 1);
            await sleep(backoffMs, requestController.signal);
            continue;
          }

          break;
        }
      }
    }

    emit(port, {
      type: "error",
      requestId: req.requestId,
      code: lastFailure?.code ?? "E_PROVIDER_FAILED",
      message: lastFailure?.message ?? "All providers failed",
      retryable: Boolean(lastFailure?.retryable)
    });
  } catch (error) {
    const failure = classifyAttemptFailure(error, requestController.signal.aborted ? "user_abort" : null);
    emit(port, {
      type: "error",
      requestId: req.requestId,
      code: failure.code,
      message: failure.message,
      retryable: failure.retryable
    });
  } finally {
    controllers.delete(req.requestId);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "polyglot.translate.selection",
    title: "Translate selected text",
    contexts: ["selection"]
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "polyglot.translate.selection" || !tab?.id || !info.selectionText) {
    return;
  }
  const msg: ContentMessage = { type: "CONTEXT_TRANSLATE", text: info.selectionText };
  await chrome.tabs.sendMessage(tab.id, msg);
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "translate-selection") {
    return;
  }
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const active = tabs[0];
  if (!active?.id) {
    return;
  }
  const msg: ContentMessage = { type: "TRIGGER_TRANSLATE_SELECTION" };
  await chrome.tabs.sendMessage(active.id, msg);
});

chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  if (message.type === "PING") {
    const response: RuntimeResponse = { ok: true, type: "PONG" };
    sendResponse(response);
  }
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "polyglot-stream") {
    return;
  }

  port.onMessage.addListener((message: PortRequest) => {
    if (message.type === "TRANSLATE_REQUEST") {
      void processRequest(port, message.payload);
      return;
    }

    if (message.type === "CANCEL_REQUEST") {
      const controller = controllers.get(message.requestId);
      controller?.abort();
      controllers.delete(message.requestId);
    }
  });
});
