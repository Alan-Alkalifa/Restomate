import { INITIAL_STATE, type WizardState } from "./types";

const KEY = "restomate:onboarding:v1";
const listeners = new Set<() => void>();

export function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Raw JSON string (stable between calls, as useSyncExternalStore requires). */
export function getSnapshot(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return memory;
  }
}
export const getServerSnapshot = () => null;

let memory: string | null = null;

export function parse(raw: string | null): WizardState {
  if (!raw) return INITIAL_STATE;
  try {
    return { ...INITIAL_STATE, ...(JSON.parse(raw) as Partial<WizardState>) };
  } catch {
    return INITIAL_STATE;
  }
}

export function save(state: WizardState) {
  const raw = JSON.stringify(state);
  memory = raw;
  try {
    sessionStorage.setItem(KEY, raw);
  } catch {
    /* storage unavailable: keep in memory only */
  }
  listeners.forEach((l) => l());
}

export function clear() {
  memory = null;
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}
