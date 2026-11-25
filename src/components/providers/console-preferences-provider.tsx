"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  CONSOLE_PREFERENCES_KEY,
  DEFAULT_CONSOLE_PREFERENCES,
  applyConsolePreferences,
  readConsolePreferences,
  sanitizeConsolePreferences,
  writeConsolePreferences,
  type ConsolePreferences,
  type NotificationPreferenceKey,
} from "@/lib/preferences/console-preferences";

export type ConsolePreferencesPatch = Partial<
  Omit<ConsolePreferences, "notifications">
> & {
  notifications?: Partial<Record<NotificationPreferenceKey, boolean>>;
};

type ConsolePreferencesContextValue = {
  preferences: ConsolePreferences;
  updatePreferences: (patch: ConsolePreferencesPatch) => void;
  setNotificationPreference: (
    key: NotificationPreferenceKey,
    enabled: boolean,
  ) => void;
  resetPreferences: () => void;
  savePreferences: () => void;
};

const ConsolePreferencesContext =
  createContext<ConsolePreferencesContextValue | null>(null);

function applyToDocument(preferences: ConsolePreferences): void {
  if (typeof document === "undefined") return;
  applyConsolePreferences(preferences, document.documentElement);
}

// ---------------------------------------------------------------------------
// Small external store
//
// `useSyncExternalStore` gives a hydration-safe initial snapshot (the server
// uses defaults, the client switches to storage after hydration) without a
// setState-in-effect cascade. Every provider instance shares this snapshot, so
// there is exactly one preference value in a tab; the `storage` event keeps
// other tabs in sync.
// ---------------------------------------------------------------------------

let snapshot: ConsolePreferences | null = null;
let globalsAttached = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function getClientSnapshot(): ConsolePreferences {
  if (snapshot === null) {
    snapshot = readConsolePreferences(window.localStorage);
  }
  return snapshot;
}

function getServerSnapshot(): ConsolePreferences {
  return DEFAULT_CONSOLE_PREFERENCES;
}

function ensureGlobalListeners(): void {
  if (globalsAttached || typeof window === "undefined") return;
  globalsAttached = true;

  window.addEventListener("storage", (event) => {
    if (event.key !== CONSOLE_PREFERENCES_KEY) return;
    snapshot = readConsolePreferences(window.localStorage);
    applyToDocument(snapshot);
    emit();
  });
}

function subscribe(listener: () => void): () => void {
  ensureGlobalListeners();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function commit(next: ConsolePreferences): void {
  snapshot = next;
  applyToDocument(next);
  writeConsolePreferences(next, window.localStorage);
  emit();
}

/**
 * Single client source of truth for console preferences. Appearance values are
 * persisted per browser and applied to <html> (the root layout also runs an
 * inline bootstrap script so compact/reduced-motion state is correct before
 * first paint).
 */
export function ConsolePreferencesProvider({
  children,
}: {
  children: ReactNode;
}) {
  const preferences = useSyncExternalStore(
    subscribe,
    getClientSnapshot,
    getServerSnapshot,
  );

  const updatePreferences = useCallback((patch: ConsolePreferencesPatch) => {
    const current = getClientSnapshot();
    commit(
      sanitizeConsolePreferences({
        ...current,
        ...patch,
        notifications: {
          ...current.notifications,
          ...(patch.notifications ?? {}),
        },
      }),
    );
  }, []);

  const setNotificationPreference = useCallback(
    (key: NotificationPreferenceKey, enabled: boolean) => {
      updatePreferences({ notifications: { [key]: enabled } });
    },
    [updatePreferences],
  );

  const resetPreferences = useCallback(() => {
    commit(DEFAULT_CONSOLE_PREFERENCES);
  }, []);

  const savePreferences = useCallback(() => {
    commit(getClientSnapshot());
  }, []);

  const value = useMemo<ConsolePreferencesContextValue>(
    () => ({
      preferences,
      updatePreferences,
      setNotificationPreference,
      resetPreferences,
      savePreferences,
    }),
    [
      preferences,
      updatePreferences,
      setNotificationPreference,
      resetPreferences,
      savePreferences,
    ],
  );

  return (
    <ConsolePreferencesContext.Provider value={value}>
      {children}
    </ConsolePreferencesContext.Provider>
  );
}

export function useConsolePreferences(): ConsolePreferencesContextValue {
  const context = useContext(ConsolePreferencesContext);
  if (!context) {
    throw new Error(
      "useConsolePreferences must be used inside ConsolePreferencesProvider",
    );
  }
  return context;
}
