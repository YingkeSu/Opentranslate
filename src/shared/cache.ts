const CACHE_PREFIX = "polyglot.cache.";
const TTL_MS = 24 * 60 * 60 * 1000;

type CacheValue = {
  text: string;
  expiresAt: number;
};

function cacheKey(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return `${CACHE_PREFIX}${Math.abs(hash)}`;
}

export function makeCacheIdentity(text: string, src: string | undefined, tgt: string, model: string): string {
  return `${text.trim()}::${src ?? "auto"}::${tgt}::${model}`;
}

export async function getCached(identity: string): Promise<string | null> {
  const key = cacheKey(identity);
  const result = await chrome.storage.local.get(key);
  const value = result[key] as CacheValue | undefined;
  if (!value) {
    return null;
  }
  if (value.expiresAt < Date.now()) {
    await chrome.storage.local.remove(key);
    return null;
  }
  return value.text;
}

export async function setCached(identity: string, text: string): Promise<void> {
  const key = cacheKey(identity);
  const value: CacheValue = {
    text,
    expiresAt: Date.now() + TTL_MS
  };
  await chrome.storage.local.set({ [key]: value });
}
