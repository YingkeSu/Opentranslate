import { describe, expect, it } from "vitest";

import {
  ProviderHttpError,
  buildPrompt,
  readSseLines,
  throwProviderResponseError
} from "../../src/background/providers/base";

describe("provider base helpers", () => {
  it("builds a translation-only prompt", () => {
    const prompt = buildPrompt({
      requestId: "req_1",
      text: "hello",
      targetLang: "zh-CN",
      mode: "selection",
      createdAt: Date.now()
    });

    expect(prompt).toContain("Translate the following text to zh-CN.");
    expect(prompt).toContain("Return only translated text with no extra explanation.");
    expect(prompt).toContain("hello");
  });

  it("parses SSE data lines and ignores done sentinels", async () => {
    const response = new Response(
      [
        "event: message",
        'data: {"choices":[{"delta":{"content":"你"}}]}',
        "",
        'data: {"choices":[{"delta":{"content":"好"}}]}',
        "",
        "data: [DONE]",
        ""
      ].join("\n"),
      {
        headers: {
          "content-type": "text/event-stream"
        }
      }
    );

    const lines: string[] = [];
    for await (const line of readSseLines(response)) {
      lines.push(line);
    }

    expect(lines).toEqual([
      '{"choices":[{"delta":{"content":"你"}}]}',
      '{"choices":[{"delta":{"content":"好"}}]}'
    ]);
  });

  it("maps 429 and retry-after to a typed provider error", () => {
    const response = new Response("", {
      status: 429,
      headers: {
        "retry-after": "2"
      }
    });

    let error: unknown;
    try {
      throwProviderResponseError("openai", response);
    } catch (value) {
      error = value;
    }

    expect(error).toBeInstanceOf(ProviderHttpError);
    expect((error as ProviderHttpError).code).toBe("E_RATE_LIMIT");
    expect((error as ProviderHttpError).retryAfterMs).toBe(2000);
  });

  it("maps upstream 5xx failures to provider down", () => {
    const response = new Response("", {
      status: 502
    });

    let error: unknown;
    try {
      throwProviderResponseError("openrouter", response);
    } catch (value) {
      error = value;
    }

    expect(error).toBeInstanceOf(ProviderHttpError);
    expect((error as ProviderHttpError).code).toBe("E_PROVIDER_DOWN");
  });
});
