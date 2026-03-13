import type { ErrorCode, ProviderName, TranslateRequest } from "../../shared/types";

export type AdapterContext = {
  apiKey: string;
  baseURL: string;
  model: string;
  signal: AbortSignal;
};

export interface ProviderAdapter {
  readonly name: ProviderName;
  stream(req: TranslateRequest, context: AdapterContext): AsyncGenerator<string>;
}

export class ProviderHttpError extends Error {
  readonly code: ErrorCode;
  readonly retryAfterMs?: number;
  readonly status: number;

  constructor(message: string, status: number, code: ErrorCode, retryAfterMs?: number) {
    super(message);
    this.name = "ProviderHttpError";
    this.status = status;
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

export function buildPrompt(req: TranslateRequest): string {
  return [
    `Translate the following text to ${req.targetLang}.`,
    "Return only translated text with no extra explanation.",
    req.text
  ].join("\n\n");
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return seconds * 1000;
  }

  const target = Date.parse(value);
  return Number.isNaN(target) ? undefined : Math.max(0, target - Date.now());
}

export function throwProviderResponseError(provider: ProviderName, response: Response): never {
  const code =
    response.status === 429
      ? "E_RATE_LIMIT"
      : response.status >= 500
        ? "E_PROVIDER_DOWN"
        : "E_PROVIDER_FAILED";

  throw new ProviderHttpError(
    `${provider} error ${response.status}`,
    response.status,
    code,
    parseRetryAfter(response.headers.get("retry-after"))
  );
}

export async function* readSseLines(response: Response): AsyncGenerator<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) {
        continue;
      }
      const data = line.slice(5).trim();
      if (data && data !== "[DONE]") {
        yield data;
      }
    }
  }
}
