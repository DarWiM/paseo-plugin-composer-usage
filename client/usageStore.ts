import type { UsageList } from "./matchReport";

export type UsageState =
  | { status: "loading" }
  | { status: "ready"; list: UsageList; refreshing: boolean }
  | { status: "error"; error: string; list: UsageList | null; refreshing: boolean };

export interface UsageStore {
  get(): UsageState;
  subscribe(listener: () => void): () => void;
  refresh(): Promise<void>;
  stop(): void;
}

// A closure, not a class: Hermes evaluates plugin bundles at runtime and rejects `class` syntax there.
// One usage list serves every pill; concurrent refreshes share a single request.
export function createUsageStore(load: () => Promise<UsageList>): UsageStore {
  let state: UsageState = { status: "loading" };
  const listeners = new Set<() => void>();
  let inFlight: Promise<void> | null = null;
  let stopped = false;

  const set = (next: UsageState) => {
    if (stopped) return;
    state = next;
    for (const listener of listeners) listener();
  };

  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    refresh() {
      if (inFlight) return inFlight;
      if (state.status !== "loading") set({ ...state, refreshing: true });
      inFlight = load()
        .then((list) => set({ status: "ready", list, refreshing: false }))
        .catch((error: unknown) => {
          const list = state.status === "loading" ? null : state.list;
          set({ status: "error", error: error instanceof Error ? error.message : String(error), list, refreshing: false });
        })
        .finally(() => {
          inFlight = null;
        });
      return inFlight;
    },
    stop() {
      stopped = true;
      listeners.clear();
    },
  };
}
