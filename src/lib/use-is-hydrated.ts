"use client";

import { useSyncExternalStore } from "react";

const noSubscription = () => () => {};

/**
 * `false` while server rendering and during the hydration render, `true` once
 * the browser has taken over.
 *
 * The wallet hooks use the live client store as their server snapshot too, so a
 * wallet registered before hydration (an extension injects at document start)
 * would otherwise render different text than the server HTML.
 */
export function useIsHydrated(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
}
