import { mkdtemp, readFile, rm } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse
} from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chromium, expect, test, type BrowserContext, type Page, type Worker } from "@playwright/test";
import type { ExtensionSettings, ProviderSecrets } from "../../src/shared/types";

type MockFetchResponse = {
  body?: string;
  delayMs?: number;
  headers?: Record<string, string>;
  match: string;
  sse?: string[];
  status?: number;
};

const DIST_DIR = join(process.cwd(), "dist");

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let extensionId: string;
let serviceWorker: Worker;
let server: Server;
let serverUrl: string;
let userDataDir: string;

async function waitForServiceWorker(targetContext: BrowserContext): Promise<Worker> {
  const existing = targetContext.serviceWorkers()[0];
  if (existing) {
    return existing;
  }
  return targetContext.waitForEvent("serviceworker");
}

async function clearExtensionStorage(): Promise<void> {
  await serviceWorker.evaluate(async () => {
    await chrome.storage.local.clear();
    await chrome.storage.sync.clear();
    await chrome.storage.session.clear();
  });
}

async function seedExtensionStorage(): Promise<void> {
  await serviceWorker.evaluate(async () => {
    await chrome.storage.sync.set({
      "polyglot.settings": {
        targetLanguage: "zh-CN",
        speedMode: "fast",
        providerPriority: ["openrouter", "openai"],
        models: {
          openrouter: ["openai/gpt-4o-mini"],
          openai: ["gpt-4o-mini"]
        },
        baseURLs: {
          openrouter: "https://openrouter.ai/api/v1",
          openai: "https://api.openai.com/v1"
        }
      }
    });
    await chrome.storage.session.set({
      "polyglot.secrets": {
        openrouter: "or-key",
        openai: "oa-key"
      }
    });
  });
}

async function installFetchMock(responses: MockFetchResponse[]): Promise<void> {
  await serviceWorker.evaluate(async (mockResponses: MockFetchResponse[]) => {
    const scope = globalThis as typeof globalThis & {
      __polyglotMockCalls?: string[];
      __polyglotMockFetch?: typeof fetch;
      __polyglotMockResponses?: MockFetchResponse[];
    };

    if (!scope.__polyglotMockFetch) {
      scope.__polyglotMockFetch = scope.fetch.bind(scope);
    }

    scope.__polyglotMockCalls = [];
    scope.__polyglotMockResponses = [...mockResponses];

    scope.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const signal =
        init?.signal ??
        (typeof input === "string" || input instanceof URL ? undefined : input.signal);
      const index = scope.__polyglotMockResponses?.findIndex((entry) => url.includes(entry.match)) ?? -1;

      if (index === -1 || !scope.__polyglotMockResponses) {
        return scope.__polyglotMockFetch!(input, init);
      }

      const [entry] = scope.__polyglotMockResponses.splice(index, 1);
      scope.__polyglotMockCalls?.push(url);

      const headers = entry.headers ?? {
        "content-type": "text/event-stream"
      };

      if (entry.sse) {
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            const abort = () => {
              controller.error(new DOMException("Request aborted", "AbortError"));
            };

            if (signal?.aborted) {
              abort();
              return;
            }

            signal?.addEventListener("abort", abort, { once: true });

            void (async () => {
              try {
                for (const chunk of entry.sse ?? []) {
                  if (signal?.aborted) {
                    abort();
                    return;
                  }
                  if (entry.delayMs) {
                    await new Promise((resolve) => setTimeout(resolve, entry.delayMs));
                  }
                  if (signal?.aborted) {
                    abort();
                    return;
                  }
                  controller.enqueue(encoder.encode(chunk));
                }
                controller.close();
              } finally {
                signal?.removeEventListener("abort", abort);
              }
            })();
          }
        });

        return new Response(stream, {
          status: entry.status ?? 200,
          headers
        });
      }

      return new Response(entry.body ?? "", {
        status: entry.status ?? 200,
        headers
      });
    };
  }, responses);
}

async function mockCalls(): Promise<string[]> {
  return serviceWorker.evaluate(() => {
    const scope = globalThis as typeof globalThis & { __polyglotMockCalls?: string[] };
    return scope.__polyglotMockCalls ?? [];
  });
}

async function selectParagraph(page: Page, selector: string): Promise<void> {
  await page.evaluate((target) => {
    const element = document.querySelector(target);
    if (!element) {
      throw new Error(`Missing element ${target}`);
    }

    const range = document.createRange();
    range.selectNodeContents(element);

    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  }, selector);
}

test.beforeAll(async () => {
  userDataDir = await mkdtemp(join(tmpdir(), "polyglot-playwright-"));
  server = createServer(async (_request: IncomingMessage, response: ServerResponse<IncomingMessage>) => {
    const body = await readFile(join(process.cwd(), "tests/e2e/fixtures/page.html"), "utf8");
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8"
    });
    response.end(body);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve test server address");
  }
  serverUrl = `http://127.0.0.1:${address.port}`;

  context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${DIST_DIR}`, `--load-extension=${DIST_DIR}`]
  });

  serviceWorker = await waitForServiceWorker(context);
  extensionId = new URL(serviceWorker.url()).host;
});

test.afterAll(async () => {
  await context.close();
  await new Promise<void>((resolve, reject) =>
    server.close((error?: Error) => (error ? reject(error) : resolve()))
  );
  await rm(userDataDir, { recursive: true, force: true });
});

test.beforeEach(async () => {
  await clearExtensionStorage();
  await seedExtensionStorage();
  await installFetchMock([]);
});

test("configures provider and api keys from the popup", async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);

  await expect(page.locator("#status")).toContainText("Background service ready.");
  await expect(page.locator("#primary-provider option")).toHaveCount(2);
  expect(await page.locator("#primary-provider option").allTextContents()).toEqual(["OpenRouter", "OpenAI"]);

  await page.getByLabel("Target language").fill("fr");
  await page.getByLabel("Primary provider").selectOption("openai");
  await page.getByLabel("Provider to configure").selectOption("openai");
  await page.getByLabel("OpenAI API key").fill("updated-openai-key");
  await page.getByLabel("Provider to configure").selectOption("openrouter");
  await page.getByLabel("OpenRouter API key").fill("updated-openrouter-key");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.locator("#status")).toContainText("Saved quick setup");

  const snapshot = (await serviceWorker.evaluate(async () => {
    const settings = await chrome.storage.sync.get("polyglot.settings");
    const secrets = await chrome.storage.session.get("polyglot.secrets");
    return {
      settings: settings["polyglot.settings"] as ExtensionSettings,
      secrets: secrets["polyglot.secrets"] as ProviderSecrets
    };
  })) as { secrets: ProviderSecrets; settings: ExtensionSettings };

  expect(snapshot.settings.targetLanguage).toBe("fr");
  expect(snapshot.settings.providerPriority[0]).toBe("openai");
  expect(snapshot.secrets.openai).toBe("updated-openai-key");
  expect(snapshot.secrets.openrouter).toBe("updated-openrouter-key");
  await page.close();
});

test("saves settings through the extension options page", async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);

  await expect(page.locator("#primary-provider option")).toHaveCount(2);
  expect(await page.locator("#primary-provider option").allTextContents()).toEqual(["OpenRouter", "OpenAI"]);

  await page.getByLabel("Default Target Language").fill("fr");
  await page.getByLabel("Speed Mode").selectOption("quality");
  await page.getByLabel("Primary Provider").selectOption("openai");
  await page.getByLabel("Add Provider Template").selectOption("groq");
  await page.getByRole("button", { name: "Add" }).click();
  await page.getByLabel("Provider to Configure").selectOption("groq");
  await expect(page.getByLabel("Base URL")).toHaveValue("https://api.groq.com/openai/v1");
  await page.getByLabel("Groq models").fill("openai/gpt-oss-20b\nllama-3.3-70b-versatile");
  await page.getByLabel("Groq API Key").fill("updated-groq-key");
  await page.getByLabel("Provider to Configure").selectOption("openai");
  await page.getByLabel("OpenAI models").fill("gpt-4.1-mini\ngpt-4o-mini");
  await page.getByLabel("OpenAI API key").fill("updated-openai-key");
  await page.getByRole("button", { name: "Save Settings" }).click();

  await expect(page.locator("#saved-state")).toContainText("Saved at");

  const snapshot = (await serviceWorker.evaluate(async () => {
    const settings = await chrome.storage.sync.get("polyglot.settings");
    const secrets = await chrome.storage.session.get("polyglot.secrets");
    return {
      settings: settings["polyglot.settings"] as ExtensionSettings,
      secrets: secrets["polyglot.secrets"] as ProviderSecrets
    };
  })) as { secrets: ProviderSecrets; settings: ExtensionSettings };

  expect(snapshot.settings.targetLanguage).toBe("fr");
  expect(snapshot.settings.speedMode).toBe("quality");
  expect(snapshot.settings.providerPriority).toEqual(["openai", "openrouter", "groq"]);
  expect(snapshot.settings.models.openai).toEqual(["gpt-4.1-mini", "gpt-4o-mini"]);
  expect(snapshot.settings.models.groq).toEqual(["openai/gpt-oss-20b", "llama-3.3-70b-versatile"]);
  expect(snapshot.secrets.openai).toBe("updated-openai-key");
  expect(snapshot.secrets.groq).toBe("updated-groq-key");

  await serviceWorker.evaluate(async () => {
    await chrome.storage.local.set({
      "polyglot.metrics": {
        openrouter: {
          attempts: 0,
          successes: 0,
          failures: 0,
          timeoutCount: 0,
          rateLimitCount: 0
        },
        openai: {
          attempts: 3,
          successes: 3,
          failures: 0,
          timeoutCount: 0,
          rateLimitCount: 0,
          avgTtftMs: 420,
          avgLatencyMs: 1600
        },
        groq: {
          attempts: 2,
          successes: 1,
          failures: 1,
          timeoutCount: 1,
          rateLimitCount: 0,
          avgTtftMs: 310,
          avgLatencyMs: 1100,
          lastErrorCode: "E_TIMEOUT"
        }
      }
    });
  });

  await expect(page.locator('.health-card[data-provider="openai"] [data-field="badge"]')).toHaveText("healthy");
  await expect(page.locator('.health-card[data-provider="openai"] [data-field="ttft"]')).toHaveText("420ms");
  await expect(page.locator('.health-card[data-provider="groq"] [data-field="badge"]')).toHaveText("degraded");

  await serviceWorker.evaluate(async () => {
    await chrome.storage.local.set({
      "polyglot.query-traces": [
        {
          id: "trace-1",
          provider: "openai",
          model: "gpt-4.1-mini",
          requestText: "hello world",
          responseText: "bonjour le monde",
          targetLang: "fr",
          createdAt: Date.now(),
          finishedAt: Date.now(),
          cacheHit: false,
          ok: true
        }
      ]
    });
  });

  await expect(page.locator('.trace-card[data-provider="openai"]')).toContainText("bonjour le monde");

  await installFetchMock([
    {
      match: "openrouter.ai/api/v1/models",
      body: '{"data":[]}',
      headers: {
        "content-type": "application/json"
      }
    },
    {
      match: "api.openai.com/v1/models",
      body: '{"data":[]}',
      headers: {
        "content-type": "application/json"
      }
    },
    {
      match: "api.groq.com/openai/v1/models",
      status: 503,
      body: '{"error":"temporary outage"}',
      headers: {
        "content-type": "application/json"
      }
    }
  ]);

  await page.getByRole("button", { name: "Test Saved Providers" }).click();

  await expect(page.locator('.status-card[data-provider="openai"] .status-badge')).toHaveText("ok");
  await expect(page.locator('.status-card[data-provider="groq"]')).toContainText("HTTP 503");
  await page.close();
});

test("translates selected text from the floating action button", async () => {
  await installFetchMock([
    {
      match: "openrouter.ai/api/v1/chat/completions",
      sse: [
        'data: {"choices":[{"delta":{"content":"你好"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"，世界"}}]}\n\n',
        "data: [DONE]\n\n"
      ],
      delayMs: 30
    }
  ]);

  const page = await context.newPage();
  await page.goto(serverUrl);
  await selectParagraph(page, "#selection-source");

  await expect(page.locator(".polyglot-btn")).toHaveText("Translate");
  await page.locator(".polyglot-btn").click();

  await expect(page.locator(".polyglot-body")).toHaveText("你好，世界");
  await expect(page.locator(".polyglot-status")).toContainText("Done in");
  await page.close();
});

test("falls back to the next provider when the primary provider fails", async () => {
  await installFetchMock([
    {
      match: "openrouter.ai/api/v1/chat/completions",
      status: 502,
      body: "upstream failure",
      headers: {
        "content-type": "text/plain"
      }
    },
    {
      match: "api.openai.com/v1/chat/completions",
      sse: [
        'data: {"choices":[{"delta":{"content":"后备"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"翻译"}}]}\n\n',
        "data: [DONE]\n\n"
      ]
    }
  ]);

  const page = await context.newPage();
  await page.goto(serverUrl);
  await selectParagraph(page, "#selection-source");
  await page.keyboard.press("Alt+T");

  await expect(page.locator(".polyglot-body")).toHaveText("后备翻译");
  await expect(page.locator(".polyglot-status")).toContainText("Done in");
  await expect.poll(mockCalls).toEqual([
    "https://openrouter.ai/api/v1/chat/completions",
    "https://api.openai.com/v1/chat/completions"
  ]);
  await page.close();
});

test("allows the user to cancel an in-flight translation", async () => {
  await installFetchMock([
    {
      match: "openrouter.ai/api/v1/chat/completions",
      sse: [
        'data: {"choices":[{"delta":{"content":"第"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"一"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"段"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"完成"}}]}\n\n',
        "data: [DONE]\n\n"
      ],
      delayMs: 180
    }
  ]);

  const page = await context.newPage();
  await page.goto(serverUrl);
  await selectParagraph(page, "#selection-source");
  await page.locator(".polyglot-btn").click();

  await expect(page.locator(".polyglot-body")).toContainText("第");
  await page.getByRole("button", { name: "Cancel" }).click();

  await expect(page.locator(".polyglot-status")).toContainText("E_ABORTED");
  await expect(page.locator(".polyglot-body")).not.toHaveText("第一段完成");
  await page.close();
});
