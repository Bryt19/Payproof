"use client";

import { useRef, useState, useEffect, type ReactNode } from "react";
import { CopyIcon } from "@/components/dashboard/icons";

type MessageBubbleProps = {
  role: "user" | "assistant";
  children: ReactNode;
  timestamp: Date;
  onCopy?: (text: string) => void;
};

function formatTimestamp(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

/**
 * Minimal markdown-lite renderer tuned for AI assistant responses.
 *
 * Supports paragraphs, line breaks, inline bold, inline code, and fenced
 * code blocks. It is intentionally limited so the assistant UI stays
 * predictable without pulling in a full markdown parser.
 */
function MarkdownLite({ children }: { children: ReactNode }): ReactNode {
  const source = typeof children === "string" ? children : "";

  if (!source) return <span className="text-neutral-400">—</span>;

  // Split into fenced code blocks and everything else.
  const parts = source.split(/(```[\s\S]*?```)/g);

  return (
    <>
      {parts.map((part, index) => {
        if (!part) return null;

        if (part.startsWith("```") && part.endsWith("```")) {
          const inner = part.slice(3, -3).trimEnd();
          const firstLine = inner.indexOf("\n");
          const language =
            firstLine >= 0
              ? inner.slice(0, firstLine).trim()
              : "";
          const code =
            firstLine >= 0
              ? inner.slice(firstLine + 1)
              : inner;

          return (
            <div key={index} className="my-3 rounded-xl border border-white/[0.08] bg-black/40 p-3.5 overflow-x-auto">
              {language && (
                <p className="mb-2 text-[10px] uppercase font-mono tracking-wider text-neutral-400">
                  {language}
                </p>
              )}
              <pre className="text-xs font-mono leading-relaxed text-neutral-200 whitespace-pre-wrap break-all">
                {code}
              </pre>
            </div>
          );
        }

        // Render inline markdown for prose segments.
        return (
          <div key={index} className="space-y-2 leading-relaxed text-sm">
            {renderInlineMarkdown(part)}
          </div>
        );
      })}
    </>
  );
}

function renderInlineMarkdown(text: string): ReactNode {
  // Protect code spans first by replacing them with placeholders.
  const codeSpans: string[] = [];
  let protectedText = text.replace(/`([^`]+)`/g, (_match, code) => {
    const slot = `CODE_SLOT_${codeSpans.length}`;
    codeSpans.push(code);
    return slot;
  });

  // Protect bold segments.
  const boldSpans: string[] = [];
  protectedText = protectedText.replace(/\*\*([^*]+)\*\*/g, (_match, bold) => {
    const slot = `BOLD_SLOT_${boldSpans.length}`;
    boldSpans.push(bold);
    return slot;
  });

  // Split on newlines; render each line as its own paragraph block when
  // there are multiple, otherwise keep inline flow.
  const lines = protectedText.split("\n");

  const restored = lines.map((line, lineIndex) => {
    // Restore code spans.
    let content: ReactNode = line;
    for (let i = 0; i < codeSpans.length; i += 1) {
      const slot = `CODE_SLOT_${i}`;
      if (typeof content === "string") {
        content = content.split(slot).reduce<ReactNode[]>(
          (acc, part, index) => {
            acc.push(part);
            acc.push(
              <code
                key={`${slot}-${index}`}
                className="rounded bg-white/[0.08] px-1.5 py-0.5 text-xs font-mono text-[#14F195]"
              >
                {codeSpans[i]}
              </code>,
            );
            return acc;
          },
          [],
        );
      }
    }

    if (typeof content === "string") {
      // Restore bold spans.
      for (let i = 0; i < boldSpans.length; i += 1) {
        const slot = `BOLD_SLOT_${i}`;
        if (typeof content === "string") {
          content = content.split(slot).reduce<ReactNode[]>(
            (acc, part, index) => {
              acc.push(part);
              acc.push(
                <strong
                  key={`${slot}-${index}`}
                  className="font-semibold text-white"
                >
                  {boldSpans[i]}
                </strong>,
              );
              return acc;
            },
            [],
          );
        }
      }
    }

    if (Array.isArray(content)) {
      content = content.filter((node) => node !== "");
    }

    if (line.trim() === "") {
      return <div key={lineIndex} className="h-2" />;
    }

    return (
      <p key={lineIndex} className="leading-relaxed">
        {content}
      </p>
    );
  });

  return restored;
}

export function UserBubble({
  children,
  timestamp,
}: Pick<MessageBubbleProps, "children" | "timestamp">) {
  return (
    <div className="flex flex-col items-end gap-1.5 max-w-[85%] sm:max-w-[75%] ml-auto">
      <div className="rounded-2xl rounded-tr-sm border border-[#9945FF]/30 bg-gradient-to-br from-[#9945FF]/15 to-[#C14BF0]/10 px-4 py-2.5 shadow-sm text-white">
        <p className="text-sm leading-relaxed break-words whitespace-pre-wrap">
          {children}
        </p>
      </div>
      <span className="text-[10px] text-neutral-500 font-mono pr-1">
        {formatTimestamp(timestamp)}
      </span>
    </div>
  );
}

export function AssistantBubble({
  children,
  timestamp,
  onCopy,
}: Pick<MessageBubbleProps, "children" | "timestamp" | "onCopy">) {
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    };
  }, []);

  const handleCopy = () => {
    const text =
      typeof children === "string" ? children : renderBubbleText(children);

    if (onCopy) {
      onCopy(text);
    } else {
      navigator.clipboard
        .writeText(text)
        .then(() => {
          setCopied("copied");
        })
        .catch(() => {
          setCopied("failed");
        });
    }

    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopied("idle"), 3000);
  };

  return (
    <div className="flex items-start gap-3 max-w-[90%] sm:max-w-[85%]">
      {/* Assistant Avatar */}
      <div className="mt-1 grid size-7 shrink-0 place-items-center rounded-lg border border-[#9945FF]/30 bg-gradient-to-br from-[#9945FF]/20 to-[#C14BF0]/20 shadow-sm">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-3.5 text-[#C14BF0]" aria-hidden="true">
          <path d="M12 3.8 13.5 8l4.2 1.5-4.2 1.5L12 15.2 10.5 11 6.3 9.5 10.5 8Z" />
        </svg>
      </div>

      <div className="flex flex-col gap-1.5 flex-1 min-w-0">
        <div className="group relative rounded-2xl rounded-tl-sm border border-white/[0.08] bg-[#16161B] px-4.5 py-3.5 shadow-sm">
          {/* Copy action */}
          <button
            type="button"
            onClick={handleCopy}
            className={`absolute right-3 top-3 flex size-7 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-neutral-400 transition-all hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9945FF] ${
              copied !== "idle" ? "opacity-100" : "opacity-0 group-hover:opacity-100"
            }`}
            aria-label={copied === "copied" ? "Copied" : copied === "failed" ? "Copy failed" : "Copy response"}
          >
            {copied === "copied" ? (
              <span className="text-[#14F195]">
                <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </span>
            ) : copied === "failed" ? (
              <span className="text-red-300">
                <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </span>
            ) : (
              <CopyIcon className="size-3.5" />
            )}
            <span className="sr-only">
              {copied === "copied"
                ? "Copied"
                : copied === "failed"
                ? "Copy failed"
                : "Copy response"}
            </span>
          </button>

          <div className="text-sm leading-relaxed text-neutral-200 pr-6">
            <MarkdownLite>{children}</MarkdownLite>
          </div>
        </div>

        <span className="text-[10px] text-neutral-500 font-mono pl-1">
          {formatTimestamp(timestamp)}
        </span>
      </div>
    </div>
  );
}

function renderBubbleText(children: ReactNode): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) {
    return children.map(renderBubbleText).join("");
  }
  if (children && typeof children === "object" && "props" in children) {
    const node = children as { props: { children?: ReactNode } };
    return renderBubbleText(node.props.children ?? "");
  }
  return "";
}
