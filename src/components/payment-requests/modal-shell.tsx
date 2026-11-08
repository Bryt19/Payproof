"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { CloseIcon } from "@/components/dashboard/icons";

/**
 * Shared overlay shell for payment-request flows: a centred dialog on desktop
 * and a bottom sheet on small screens. Handles Escape, focus hand-off, body
 * scroll locking and the enter transitions.
 */
export default function ModalShell({
  title,
  description,
  onClose,
  children,
  widthClassName = "max-w-md",
}: {
  title: string;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  widthClassName?: string;
}) {
  const headingId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previouslyFocused.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    panelRef.current?.focus();

    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = overflow;
      previouslyFocused.current?.focus();
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={headingId}
    >
      <button
        type="button"
        aria-label="Close dialog"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/75 backdrop-blur-sm animate-[payproof-fade-in_160ms_ease-out]"
      />

      <div
        ref={panelRef}
        tabIndex={-1}
        className={`relative max-h-[90dvh] w-full ${widthClassName} overflow-y-auto rounded-t-2xl border border-line bg-surface px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-2.5 shadow-[0_-12px_48px_rgba(0,0,0,0.7)] outline-none animate-[payproof-sheet-in_280ms_cubic-bezier(0.16,1,0.3,1)] sm:rounded-2xl sm:p-6 sm:pb-6 sm:shadow-[0_24px_64px_rgba(0,0,0,0.7)] sm:animate-[payproof-dialog-in_200ms_ease-out]`}
      >
        {/* Sheet grab handle (mobile only) */}
        <div aria-hidden="true" className="flex justify-center sm:hidden">
          <span className="h-1 w-10 rounded-full bg-white/15" />
        </div>

        <div className="flex items-start justify-between gap-4 pt-3 sm:pt-0">
          <div className="min-w-0">
            <h2 id={headingId} className="text-sm font-semibold text-ink">
              {title}
            </h2>
            {description && (
              <div className="mt-0.5 break-words text-xs text-muted">
                {description}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-11 shrink-0 items-center justify-center rounded-full border border-line bg-white/[0.04] text-neutral-400 transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:size-8"
          >
            <CloseIcon className="size-4" />
          </button>
        </div>

        <div className="pt-4">{children}</div>
      </div>
    </div>
  );
}
