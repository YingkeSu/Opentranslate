import {
  buildPrompt,
  readSseLines,
  throwProviderResponseError,
  type AdapterContext,
  type ProviderAdapter
} from "./base";
import type { TranslateRequest } from "../../shared/types";

export class OpenRouterAdapter implements ProviderAdapter {
  readonly name = "openrouter" as const;

  async *stream(req: TranslateRequest, context: AdapterContext): AsyncGenerator<string> {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${context.apiKey}`
      },
      body: JSON.stringify({
        model: context.model,
        stream: true,
        messages: [{ role: "user", content: buildPrompt(req) }],
        temperature: 0.2
      }),
      signal: context.signal
    });

    if (!response.ok) {
      throwProviderResponseError(this.name, response);
    }

    for await (const line of readSseLines(response)) {
      const json = JSON.parse(line) as { choices?: Array<{ delta?: { content?: string } }> };
      const chunk = json.choices?.[0]?.delta?.content;
      if (chunk) {
        yield chunk;
      }
    }
  }
}
