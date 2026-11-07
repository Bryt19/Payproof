"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type CopyState = "idle" | "copied" | "failed";

/**
 * Writes text to the clipboard, falling back to the legacy execCommand path
 * when the async Clipboard API is missing or blocked (older Safari, non-secure
 * origins, or a denied permission).
 */
async function writeToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the textarea fallback below.
  }

  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "0";
    area.style.left = "0";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(area);
    return copied;
  } catch {
    return false;
  }
}

/**
 * Copy-to-clipboard with a transient confirmation state, so buttons can show a
 * live "Copied" response and then reset on their own.
 */
export function useCopyFeedback(resetMs = 2000) {
  const [state, setState] = useState<CopyState>("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );

  const copy = useCallback(
    async (text: string) => {
      const copied = await writeToClipboard(text);

      setState(copied ? "copied" : "failed");

      if (resetTimer.current) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setState("idle"), resetMs);
    },
    [resetMs],
  );

  return { state, copy };
}
