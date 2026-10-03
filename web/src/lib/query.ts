import { useCallback, useEffect, useRef, useState } from "react";

// A small data cache. Each query lists the kinds of change ("tags") that make
// it stale; the live stream calls invalidate(tag) and the query refetches.

interface Entry {
  // Kept on the device so the page can be shown without a signal.
  persist: boolean;
  data: unknown;
  error: unknown;
  loadedAt: number;
  promise: Promise<void> | null;
  tags: string[];
  fetcher: () => Promise<unknown>;
  listeners: Set<() => void>;
}

const cache = new Map<string, Entry>();

function notify(entry: Entry) {
  for (const listener of entry.listeners) listener();
}

function load(key: string): Promise<void> {
  const entry = cache.get(key);
  if (!entry) return Promise.resolve();
  if (entry.promise) return entry.promise;
  entry.promise = entry
    .fetcher()
    .then((data) => {
      entry.data = data;
      entry.error = null;
      entry.loadedAt = Date.now();
      if (entry.persist) writeStored(key, data);
    })
    .catch((error) => {
      entry.error = error;
    })
    .finally(() => {
      entry.promise = null;
      notify(entry);
    });
  return entry.promise;
}

export function invalidate(tag?: string): void {
  for (const [key, entry] of cache) {
    if (tag && !entry.tags.includes(tag)) continue;
    if (entry.listeners.size === 0) {
      // Nobody is looking: keep what we have (it is still better than nothing
      // if the signal is gone) but fetch again the next time it is shown.
      entry.loadedAt = 0;
      continue;
    }
    void load(key);
  }
}

const STORE_PREFIX = "hub-cache:";

function readStored(key: string): unknown {
  try {
    const raw = localStorage.getItem(STORE_PREFIX + key);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

function writeStored(key: string, data: unknown): void {
  try {
    localStorage.setItem(STORE_PREFIX + key, JSON.stringify(data));
  } catch {
    // Storage is full or blocked; the page still works while it is open.
  }
}

export function clearQueries(): void {
  cache.clear();
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(STORE_PREFIX)) localStorage.removeItem(key);
    }
  } catch {
    // Nothing stored.
  }
}

export interface QueryResult<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  refresh: () => void;
}

export function useQuery<T>(key: string | null, fetcher: () => Promise<T>, tags: string[] = [], options: { persist?: boolean } = {}): QueryResult<T> {
  const [, setTick] = useState(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    if (!key) return;
    let entry = cache.get(key);
    if (!entry) {
      const persist = options.persist ?? false;
      entry = { persist, data: persist ? readStored(key) : undefined, error: null, loadedAt: 0, promise: null, tags, fetcher: () => fetcherRef.current(), listeners: new Set() };
      cache.set(key, entry);
    }
    entry.fetcher = () => fetcherRef.current();
    entry.tags = tags;
    const listener = () => setTick((n) => n + 1);
    entry.listeners.add(listener);
    if (entry.loadedAt === 0 || Date.now() - entry.loadedAt > 30_000) void load(key);
    else listener();
    return () => {
      entry.listeners.delete(listener);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tags.join("|")]);

  const refresh = useCallback(() => {
    if (key) void load(key);
  }, [key]);

  const entry = key ? cache.get(key) : undefined;
  return {
    data: entry?.data as T | undefined,
    error: entry?.error ?? null,
    loading: !!key && (!entry || (entry.loadedAt === 0 && !entry.error && entry.data === undefined)),
    refresh,
  };
}
