// React hooks over the sync runtime. useSyncExternalStore re-renders when the engine changes.

import { useSyncExternalStore } from "react";
import type { SyncState } from "./engine";
import { getAccountSnapshot, subscribeAccount, syncEngine } from "./runtime";
import type { AccountSnapshot } from "./runtime";

export function useSyncState(): SyncState {
  return useSyncExternalStore(syncEngine.subscribe, syncEngine.getState);
}

export function useAccount(): AccountSnapshot {
  return useSyncExternalStore(subscribeAccount, getAccountSnapshot);
}
