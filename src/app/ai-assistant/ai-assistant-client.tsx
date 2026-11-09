"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import DashboardShell from "@/components/dashboard/dashboard-shell";
import { AssistantIcon, SendPlaneIcon, TrashIcon } from "@/components/dashboard/icons";
import {
  AssistantBubble,
  UserBubble,
} from "@/components/ai-chat/message-bubble";

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  timestamp: Date;
}

type ChatState =
  | { status: "empty" }
  | { status: "ready"; messages: readonly Message[] }
  | { status: "loading"; lastText: string; messages: readonly Message[] };

const FEATURED_PROMPTS = [
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4 text-[#9945FF]" aria-hidden="true">
        <path d="M14 3.5H7a1.8 1.8 0 0 0-1.8 1.8v13.4A1.8 1.8 0 0 0 7 20.5h10a1.8 1.8 0 0 0 1.8-1.8V8.3Z" />
        <path d="M14 3.5v4.8h4.8" />
        <path d="M8.8 13h6.4M8.8 16.4h4" />
      </svg>
    ),
    title: "Create a Payment Request",
    description: "How do I create and share a Solana Devnet payment link?",
    prompt: "How do I create a payment request?",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4 text-[#14F195]" aria-hidden="true">
        <path d="M12 3.5 18.5 6v5.2c0 4-2.7 7.7-6.5 8.8-3.8-1.1-6.5-4.8-6.5-8.8V6L12 3.5Z" />
        <path d="m9.2 11.8 1.9 1.9 3.7-3.7" />
      </svg>
    ),
    title: "On-Chain Verification",
    description: "How does Payproof independently verify Devnet transfers?",
    prompt: "How does Payproof verify transactions on Solana Devnet?",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4 text-[#00C2FF]" aria-hidden="true">
        <path d="M6 3.5h12v17l-2.4-1.6-2.1 1.6-1.5-1.6-1.5 1.6-2.1-1.6L6 20.5Z" />
        <path d="M9.2 8.2h5.6M9.2 11.8h5.6" />
      </svg>
    ),
    title: "Draft an Itemized Invoice",
    description: "Generate structured line items and totals for client billing.",
    prompt: "Can you draft an invoice for web development services?",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4 text-[#C14BF0]" aria-hidden="true">
        <path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
      </svg>
    ),
    title: "Invoices vs. Requests",
    description: "Compare lightweight checkouts with formal corporate billing.",
    prompt: "What is the difference between a payment request and an invoice?",
  },
];

function makeUserMessage(text: string): Message {
  return {
    id: `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    role: "user",
    text,
    timestamp: new Date(),
  };
}

function makeAssistantMessageFromText(text: string): Message {
  return {
    id: `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    role: "assistant",
    text,
    timestamp: new Date(),
  };
}

function makeAssistantErrorMessage(errorMessage: string): Message {
  return {
    id: `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    role: "assistant",
    text: `I hit a problem reaching the AI assistant: ${errorMessage}`,
    timestamp: new Date(),
  };
}

export default function AIAssistantClient() {
  const [state, setState] = useState<ChatState>({ status: "empty" });
  const [inputValue, setInputValue] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isComposing = useRef(false);

  const messages =
    state.status === "ready" || state.status === "loading"
      ? state.messages
      : [];

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [state]);

  const normalizedInput = inputValue.trim();

  // Auto-resize textarea based on content
  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
    }
  };

  const fetchAssistantReply = useCallback(
    async (conversation: readonly Message[]): Promise<string> => {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: conversation.map((message) => ({
            role: message.role,
            text: message.text,
          })),
        }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(data.error ?? "The AI assistant request failed.");
      }

      const data = (await response.json()) as { text?: string };
      return data.text ?? "";
    },
    [],
  );

  const sendMessage = useCallback(
    (textToSend: string) => {
      const cleanText = textToSend.trim();
      if (!cleanText) return;

      const userMessage = makeUserMessage(cleanText);
      setInputValue("");
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }

      const currentList =
        state.status === "ready" || state.status === "loading"
          ? state.messages
          : [];
      const updatedWithUser = [...currentList, userMessage];

      setState({
        status: "loading",
        lastText: cleanText,
        messages: updatedWithUser,
      });

      fetchAssistantReply(updatedWithUser)
        .then((text) => {
          if (!text) {
            setState({
              status: "ready",
              messages: updatedWithUser,
            });
            return;
          }

          const assistantMessage = makeAssistantMessageFromText(text);
          setState({
            status: "ready",
            messages: [...updatedWithUser, assistantMessage],
          });
        })
        .catch((error) => {
          const message =
            error instanceof Error
              ? error.message
              : "The AI assistant request failed.";
          const assistantMessage = makeAssistantErrorMessage(message);

          setState({
            status: "ready",
            messages: [...updatedWithUser, assistantMessage],
          });
        });
    },
    [state, fetchAssistantReply],
  );

  const handleSend = () => {
    sendMessage(normalizedInput);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!isComposing.current && normalizedInput) {
        handleSend();
      }
    }
  };

  const handleNewConversation = () => {
    setState({ status: "empty" });
    setInputValue("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleClearConversation = () => {
    setState({ status: "empty" });
  };

  return (
    <DashboardShell
      title="AI Assistant"
      description="Your intelligent payment and merchant assistant."
    >
      <div className="mx-auto flex h-[calc(100dvh-8.75rem)] max-w-5xl flex-col gap-4 sm:h-[calc(100dvh-8.5rem)] lg:h-[calc(100dvh-8rem)]">
        {/* Main Chat Console Card */}
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-surface/90 shadow-2xl backdrop-blur-md">
          {/* Header Bar */}
          <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] bg-[#121217]/80 px-3 py-2.5 sm:px-6 sm:py-3">
            <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
              <div className="relative flex size-8 shrink-0 items-center justify-center rounded-lg border border-[#9945FF]/30 bg-gradient-to-tr from-[#9945FF]/20 to-[#C14BF0]/20 shadow-[0_0_12px_rgba(153,69,255,0.25)]">
                <AssistantIcon className="size-4 text-[#C14BF0]" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="truncate text-sm font-semibold tracking-tight text-white">
                    Payproof AI
                  </h2>
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400 sm:px-2">
                    <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="hidden sm:inline">Online</span>
                  </span>
                </div>
                <p className="hidden text-[11px] text-neutral-400 sm:block">
                  Solana Devnet payment assistant &amp; analytics
                </p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
              <button
                type="button"
                onClick={handleClearConversation}
                disabled={messages.length === 0}
                className="flex size-9 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.03] text-neutral-300 transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:outline-2 focus-visible:outline-[#9945FF] disabled:cursor-not-allowed disabled:opacity-40 sm:h-8 sm:w-auto sm:gap-1.5 sm:px-3"
                title="Clear conversation"
                aria-label="Clear conversation"
              >
                <TrashIcon className="size-3.5 text-neutral-400" />
                <span className="hidden text-xs font-medium sm:inline">Clear</span>
              </button>

              <button
                type="button"
                onClick={handleNewConversation}
                className="flex size-9 items-center justify-center rounded-lg border border-[#9945FF]/30 bg-[#9945FF]/10 text-white transition-all hover:bg-[#9945FF]/20 focus-visible:outline-2 focus-visible:outline-[#9945FF] sm:h-8 sm:w-auto sm:gap-1.5 sm:px-3"
                title="New chat"
                aria-label="New chat"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-3.5" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                <span className="hidden text-xs font-medium sm:inline">New chat</span>
              </button>
            </div>
          </div>

          {/* Messages & Content Viewport */}
          <div className="flex-1 space-y-4 overflow-y-auto px-3 py-4 sm:space-y-6 sm:px-6 sm:py-6">
            {/* Empty State Welcome */}
            {messages.length === 0 && (
              <div className="mx-auto flex max-w-2xl flex-col items-center justify-center py-4 text-center sm:py-10">
                <div className="relative mb-3 flex size-12 items-center justify-center rounded-2xl border border-[#9945FF]/30 bg-gradient-to-tr from-[#9945FF]/20 to-[#14F195]/20 shadow-[0_0_24px_rgba(153,69,255,0.25)] sm:mb-4 sm:size-14">
                  <AssistantIcon className="size-6 text-[#C14BF0] sm:size-7" />
                </div>

                <h3 className="text-base font-bold tracking-tight text-white sm:text-xl">
                  How can I help?
                </h3>
                <p className="mt-1.5 max-w-md text-xs leading-relaxed text-neutral-400 sm:mt-2 sm:text-sm">
                  Ask about payment requests, on-chain verification, or invoices.
                </p>

                {/* Feature Suggestion Grid */}
                <div className="mt-5 grid w-full gap-2.5 text-left sm:mt-8 sm:grid-cols-2 sm:gap-3">
                  {FEATURED_PROMPTS.map((item) => (
                    <button
                      key={item.title}
                      type="button"
                      onClick={() => sendMessage(item.prompt)}
                      className="group flex items-start gap-3 rounded-xl border border-white/[0.08] bg-[#16161B]/80 p-3 text-left transition-all hover:border-[#9945FF]/40 hover:bg-[#1A1A22] focus-visible:outline-2 focus-visible:outline-[#9945FF] sm:flex-col sm:items-stretch sm:justify-between sm:gap-0 sm:p-4"
                    >
                      <div className="grid size-8 shrink-0 place-items-center rounded-lg border border-white/[0.08] bg-white/[0.05] sm:mb-3">
                        {item.icon}
                      </div>
                      <div className="min-w-0">
                        <h4 className="text-sm font-semibold text-white transition-colors group-hover:text-[#9945FF]">
                          {item.title}
                        </h4>
                        <p className="mt-0.5 text-xs leading-relaxed text-neutral-400 sm:mt-1">
                          {item.description}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Active Messages List */}
            {messages.map((message) => (
              <div key={message.id}>
                {message.role === "user" ? (
                  <UserBubble timestamp={message.timestamp}>
                    {message.text}
                  </UserBubble>
                ) : (
                  <AssistantBubble timestamp={message.timestamp}>
                    {message.text}
                  </AssistantBubble>
                )}
              </div>
            ))}

            {/* Thinking / Loading indicator */}
            {state.status === "loading" && (
              <div className="flex items-start gap-3 max-w-[80%]">
                <div className="grid size-7 shrink-0 place-items-center rounded-lg border border-[#9945FF]/30 bg-gradient-to-br from-[#9945FF]/20 to-[#C14BF0]/20 shadow-sm mt-1">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-3.5 text-[#C14BF0] animate-pulse" aria-hidden="true">
                    <path d="M12 3.8 13.5 8l4.2 1.5-4.2 1.5L12 15.2 10.5 11 6.3 9.5 10.5 8Z" />
                  </svg>
                </div>
                <div className="rounded-2xl rounded-tl-sm border border-white/[0.08] bg-[#16161B] px-4 py-3 shadow-sm flex items-center gap-2.5">
                  <div className="flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-[#9945FF] animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="size-2 rounded-full bg-[#C14BF0] animate-bounce" style={{ animationDelay: "150ms" }} />
                    <span className="size-2 rounded-full bg-[#14F195] animate-bounce" style={{ animationDelay: "300ms" }} />
                  </div>
                  <span className="text-xs text-neutral-400 font-medium">
                    Payproof AI is thinking…
                  </span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input Console Bar */}
          <div className="border-t border-white/[0.08] bg-[#121217]/95 p-2.5 backdrop-blur-md sm:p-4">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                handleSend();
              }}
              className="relative flex items-end gap-2 rounded-2xl border border-white/[0.12] bg-[#181820] p-1.5 shadow-inner transition-all focus-within:border-[#9945FF]/50 focus-within:ring-2 focus-within:ring-[#9945FF]/20 sm:gap-2.5 sm:p-2.5"
            >
              <label htmlFor="ai-chat-input" className="sr-only">
                Ask a question
              </label>

              <textarea
                ref={textareaRef}
                id="ai-chat-input"
                value={inputValue}
                onChange={handleTextareaChange}
                onKeyDown={handleKeyDown}
                onCompositionStart={() => {
                  isComposing.current = true;
                }}
                onCompositionEnd={() => {
                  isComposing.current = false;
                }}
                placeholder="Ask about payments, invoices, or transactions…"
                rows={1}
                className="max-h-32 min-h-[40px] flex-1 resize-none border-0 bg-transparent px-2.5 py-2 text-sm leading-relaxed text-white placeholder:text-neutral-500 focus:outline-none focus:ring-0 sm:max-h-40 sm:px-3"
              />

              {/* Plane Send Button */}
              <button
                type="submit"
                disabled={!normalizedInput || state.status === "loading"}
                aria-label="Send message"
                className={`grid size-10 shrink-0 place-items-center rounded-xl transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9945FF] ${
                  normalizedInput && state.status !== "loading"
                    ? "btn-brand-gradient cursor-pointer text-white shadow-[0_0_18px_rgba(153,69,255,0.45)] active:scale-95 sm:hover:scale-105"
                    : "cursor-not-allowed border border-white/[0.08] bg-white/[0.04] text-neutral-500"
                }`}
              >
                <SendPlaneIcon className="-translate-y-0.5 size-4.5 translate-x-0.5" />
              </button>
            </form>

            <p className="mt-2 hidden text-center text-[11px] text-neutral-500 sm:block">
              Press <kbd className="rounded bg-white/[0.08] px-1 py-0.5 font-mono text-[10px] text-neutral-400">Enter</kbd> to send • <kbd className="rounded bg-white/[0.08] px-1 py-0.5 font-mono text-[10px] text-neutral-400">Shift + Enter</kbd> for a new line • Powered by Solana Devnet
            </p>
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}
