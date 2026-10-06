import { useCallback, useState } from "react";

const read = (key: string, fallback: boolean) => {
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? fallback : value === "1";
  } catch {
    return fallback;
  }
};

/** A yes/no preference remembered in this browser (e.g. «сохранять сканы»). */
export function usePersistentFlag(key: string, fallback: boolean) {
  const [value, setValue] = useState(() => read(key, fallback));
  const update = useCallback(
    (next: boolean) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, next ? "1" : "0");
      } catch {
        /* private mode: keep it for this page only */
      }
    },
    [key]
  );
  return [value, update] as const;
}

export const KEEP_SCANS_KEY = "usm.keepContractScans";
