import { useCallback, useEffect, useState } from "react";
import {
  detectCurrentDevicePushState,
  enableDevicePush,
  disableDevicePush,
  type DevicePushResult,
  type DevicePushState,
} from "./devicePush";

/**
 * React binding for the current device's push state.
 *
 * `state` is the device-level truth (null while the first probe runs), kept
 * separate from the account-level `pushEnabled` preference. `enable`/`disable`
 * mutate the browser subscription and re-probe so the UI reflects reality.
 */
export function useDevicePush() {
  const [state, setState] = useState<DevicePushState | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setState(await detectCurrentDevicePushState());
  }, []);

  useEffect(() => {
    if (typeof navigator === "undefined") return;
    void refresh();
  }, [refresh]);

  const enable = useCallback(async (): Promise<DevicePushResult> => {
    setBusy(true);
    try {
      const result = await enableDevicePush();
      await refresh();
      return result;
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const disable = useCallback(async (): Promise<boolean> => {
    setBusy(true);
    try {
      const ok = await disableDevicePush();
      await refresh();
      return ok;
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  return { state, busy, enable, disable, refresh };
}
