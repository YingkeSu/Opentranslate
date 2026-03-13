import {
  buildPrompt,
  readSseLines,
  throwProviderResponseError,
  type AdapterContext,
  type ProviderAdapter
} from "./base";
import type { TranslateRequest } from "../../shared/types";

function normalizeBaseURL(baseURL: string): string {
  return baseURL.replace(/\/+$/, "");
}

export class AnthropicAdapter implements ProviderAdapter {
  readonly name = "anthropic" as const;

  async *stream(req: TranslateRequest, context: AdapterContext): AsyncGenerator<string> {
    const response = await fetch(`${normalizeBaseURL(context.baseURL)}/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": context.apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: context.model,
        stream: true,
        max_tokens: 2048,
        messages: [{ role: "user", content: buildPrompt(req) }]
      }),
      signal: context.signal
    });

    if (!response.ok) {
      throwProviderResponseError(this.name, response);
    }

    for await (const line of readSseLines(response)) {
      const json = JSON.parse(line) as {
        type?: string;
        delta?: { text?: string };
      };
      if (json.type === "content_block_delta" && json.delta?.text) {
        yield json.delta.text;
      }
    }
  }
}
