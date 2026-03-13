type StorageValue = Record<string, unknown>;
type ChangeRecord = Record<string, chrome.storage.StorageChange>;

type StorageAreaMock = Omit<chrome.storage.StorageArea, "get" | "set" | "remove" | "clear"> & {
  clear(): Promise<void>;
  dump(): StorageValue;
  get(keys?: string | string[] | Partial<Record<string, unknown>> | null): Promise<Record<string, unknown>>;
  remove(keys: string | string[]): Promise<void>;
  set(items: Record<string, unknown>): Promise<void>;
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function createStorageArea(
  areaName: chrome.storage.AreaName,
  listeners: Set<(changes: ChangeRecord, areaName: chrome.storage.AreaName) => void>,
  initial: StorageValue = {}
): StorageAreaMock {
  let store = clone(initial);

  const emitChanges = (changes: ChangeRecord) => {
    if (Object.keys(changes).length === 0) {
      return;
    }
    for (const listener of listeners) {
      listener(changes, areaName);
    }
  };

  const get = async (
    keys?: string | string[] | Partial<Record<string, unknown>> | null
  ): Promise<Record<string, unknown>> => {
    if (!keys) {
      return clone(store);
    }

    if (typeof keys === "string") {
      return { [keys]: clone(store[keys]) };
    }

    if (Array.isArray(keys)) {
      return keys.reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = clone(store[key]);
        return acc;
      }, {});
    }

    return Object.keys(keys).reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = key in store ? clone(store[key]) : clone(keys[key]);
      return acc;
    }, {});
  };

  const set = async (items: Record<string, unknown>): Promise<void> => {
    const changes = Object.entries(items).reduce<ChangeRecord>((acc, [key, value]) => {
      const oldValue = store[key];
      store[key] = clone(value);
      acc[key] = {
        oldValue: clone(oldValue),
        newValue: clone(value)
      };
      return acc;
    }, {});

    emitChanges(changes);
  };

  const remove = async (keys: string | string[]): Promise<void> => {
    const items = Array.isArray(keys) ? keys : [keys];
    const changes = items.reduce<ChangeRecord>((acc, key) => {
      if (!(key in store)) {
        return acc;
      }
      acc[key] = { oldValue: clone(store[key]), newValue: undefined };
      delete store[key];
      return acc;
    }, {});

    emitChanges(changes);
  };

  const clear = async (): Promise<void> => {
    const changes = Object.keys(store).reduce<ChangeRecord>((acc, key) => {
      acc[key] = { oldValue: clone(store[key]), newValue: undefined };
      return acc;
    }, {});
    store = {};
    emitChanges(changes);
  };

  return {
    get,
    set,
    remove,
    clear,
    dump: () => clone(store)
  } as StorageAreaMock;
}

export function installChromeMock(seed?: {
  local?: StorageValue;
  session?: StorageValue;
  sync?: StorageValue;
}): {
  local: StorageAreaMock;
  session: StorageAreaMock;
  sync: StorageAreaMock;
} {
  const listeners = new Set<(changes: ChangeRecord, areaName: chrome.storage.AreaName) => void>();
  const local = createStorageArea("local", listeners, seed?.local);
  const session = createStorageArea("session", listeners, seed?.session);
  const sync = createStorageArea("sync", listeners, seed?.sync);

  globalThis.chrome = {
    storage: {
      local,
      session,
      sync,
      onChanged: {
        addListener(listener: (changes: ChangeRecord, areaName: chrome.storage.AreaName) => void) {
          listeners.add(listener);
        },
        removeListener(listener: (changes: ChangeRecord, areaName: chrome.storage.AreaName) => void) {
          listeners.delete(listener);
        },
        hasListener(listener: (changes: ChangeRecord, areaName: chrome.storage.AreaName) => void) {
          return listeners.has(listener);
        },
        hasListeners() {
          return listeners.size > 0;
        }
      }
    }
  } as unknown as typeof chrome;

  return { local, session, sync };
}
