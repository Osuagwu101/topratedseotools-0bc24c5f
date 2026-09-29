type CacheEntry<T> = {
  value?: T;
  expiresAt: number;
  inFlight?: Promise<T>;
};

const store = new Map<string, CacheEntry<unknown>>();

export async function getPublicConfigCached<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const existing = store.get(key) as CacheEntry<T> | undefined;

  if (existing?.value !== undefined && existing.expiresAt > now) {
    return existing.value;
  }

  if (existing?.inFlight) {
    return existing.inFlight;
  }

  const inFlight = loader()
    .then((value) => {
      store.set(key, { value, expiresAt: Date.now() + ttlMs });
      return value;
    })
    .catch((error) => {
      store.delete(key);
      throw error;
    });

  store.set(key, {
    value: existing?.value,
    expiresAt: existing?.expiresAt ?? 0,
    inFlight,
  });

  return inFlight;
}

export function invalidatePublicConfigCache(...keys: string[]) {
  for (const key of keys) store.delete(key);
}

export function clearPublicConfigCacheForTests() {
  store.clear();
}
