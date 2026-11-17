// React glue for the data layer: one hook that loads data and reloads it after any write.
//
// Why a hook instead of calling the repository in each screen? Every screen needs the same
// three things: load on mount, reload when inputs change, and reload when ANY screen wrote
// something (a word added in the form must update the inbox list and the tab badge). Writing
// that once here keeps the screens short and the timing bugs in one place.

import { useCallback, useEffect, useRef, useState } from "react";
import { repository } from "./index";
import type { Repository } from "./repository";

export function useRepoData<T>(
  load: (repo: Repository) => Promise<T>,
  deps: unknown[],
): { data: T | undefined; error: unknown; reload: () => void } {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<unknown>(undefined);
  // Bumping this number re-runs the effect. It is how `reload` and repository writes trigger a load.
  const [tick, setTick] = useState(0);

  // Keep the latest `load` in a ref so callers may pass an inline function without the effect
  // re-running on every render. Only `deps` and `tick` decide when to reload.
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  const reload = useCallback(() => setTick((value) => value + 1), []);

  // Any write anywhere in the app asks every mounted hook to reload.
  useEffect(() => repository.subscribe(reload), [reload]);

  useEffect(() => {
    // `cancelled` flips when the effect is cleaned up (unmount, or deps changed). A slow older
    // response then sees `cancelled === true` and is dropped, so it can never overwrite a newer
    // one (out-of-order responses) and never calls setState after unmount.
    let cancelled = false;
    loadRef.current(repository).then(
      (result) => {
        if (cancelled) return;
        setData(result);
        setError(undefined);
      },
      (failure: unknown) => {
        if (cancelled) return;
        setError(failure);
      },
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps are chosen by the caller on purpose
  }, [tick, ...deps]);

  return { data, error, reload };
}
