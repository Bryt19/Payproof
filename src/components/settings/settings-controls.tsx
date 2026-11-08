"use client";

import { useCallback, useRef, useState } from "react";

interface ToggleProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}

export function Toggle({
  label,
  description,
  checked,
  onChange,
  disabled = false,
}: ToggleProps) {
  const [focused, setFocused] = useState(false);

  const id =
    "toggle-" +
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/-+$/, "");

  const handleToggle = () => {
    if (!disabled) {
      onChange(!checked);
    }
  };

  return (
    <div
      onClick={handleToggle}
      className={`group flex items-start gap-3 rounded-xl px-4 py-3 border transition-colors select-none ${
        disabled
          ? "border-white/[0.06] bg-white/[0.02] opacity-60 cursor-not-allowed"
          : focused
            ? "border-[#9945FF]/40 bg-[#9945FF]/[0.05] cursor-pointer"
            : "border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12] cursor-pointer"
      }`}
    >
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          handleToggle();
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className={`shrink-0 relative flex h-[28px] w-[50px] items-center rounded-full border p-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9945FF] disabled:cursor-not-allowed disabled:opacity-50 ${
          checked
            ? "border-[#9945FF] bg-[#9945FF]/20"
            : "border-white/10 bg-black/50"
        }`}
      >
        <span
          className={`block size-5 rounded-full shadow-sm transition-transform ${
            checked
              ? "translate-x-[22px] bg-[#9945FF]"
              : "translate-x-0.5 bg-white/40"
          }`}
        />
      </button>
      <div className="flex-1">
        <p
          className={`text-sm font-medium ${
            disabled ? "text-white/70" : "text-white"
          }`}
          style={{ fontFamily: "'DM Sans', sans-serif" }}
        >
          {label}
        </p>
        {description && (
          <p
            className={`mt-0.5 text-xs ${
              disabled ? "text-white/40" : "text-neutral-400"
            }`}
          >
            {description}
          </p>
        )}
      </div>
    </div>
  );
}

interface SelectOption {
  value: string;
  label: string;
  description?: string;
}

interface SelectFieldProps {
  label: string;
  description?: string;
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function SelectField({
  label,
  description,
  value,
  options,
  onChange,
  disabled = false,
}: SelectFieldProps) {
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const id =
    "select-" +
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/-+$/, "");
  const selected = options.find((option) => option.value === value);

  function handleChoose(option: SelectOption) {
    onChange(option.value);
    setOpen(false);
  }

  return (
    <div className="relative">
      <label
        htmlFor={id}
        className={`block text-sm font-medium pb-1.5 ${
          disabled ? "text-white/70" : "text-white"
        }`}
        style={{ fontFamily: "'DM Sans', sans-serif" }}
      >
        {label}
        {description && (
          <span
            className={`ml-2 text-xs ${
              disabled ? "text-white/40" : "text-neutral-400"
            }`}
          >
            {description}
          </span>
        )}
      </label>
      <button
        id={id}
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((next) => !next)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className={`mt-0.5 w-full flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9945FF] ${
          disabled
            ? "border-white/[0.06] bg-white/[0.02] opacity-60 cursor-not-allowed"
            : open || focused
              ? "border-[#9945FF]/40 bg-[#9945FF]/[0.05]"
              : "border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12]"
        }`}
      >
        <span
          className={`truncate ${
            selected ? "font-medium text-white" : "text-white/70"
          }`}
        >
          {selected ? selected.label : "Not set"}
        </span>
        <svg
          className={`shrink-0 size-4 text-neutral-400 transition-transform ${
            open ? "rotate-180" : ""
          }`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m6.5 9.5 5.5 5.5 5.5-5.5" />
        </svg>
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute z-50 mt-2 max-h-64 w-full overflow-y-auto rounded-xl border border-white/[0.12] bg-[#16161B] p-1 shadow-2xl shadow-black/60">
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                disabled={disabled}
                onClick={() => handleChoose(option)}
                className={`flex w-full items-start gap-3 rounded-lg px-4 py-2.5 text-left transition-colors ${
                  option.value === value
                    ? "bg-[#9945FF]/15 text-white"
                    : "hover:bg-white/[0.04] text-neutral-200"
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {option.value === value && (
                  <span className="mt-1 shrink-0 size-2 rounded-full bg-[#9945FF] shadow-[0_0_8px_#9945FF]" />
                )}
                <span className="leading-5">
                  <span className="block text-sm font-medium">{option.label}</span>
                  {option.description && (
                    <span className="mt-0.5 block text-xs text-neutral-400">
                      {option.description}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

interface CopyableValueProps {
  label: string;
  value: string;
  description?: string;
}

export function CopyableValue({
  label,
  value,
  description,
}: CopyableValueProps) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      setState("failed");
    }

    timerRef.current && clearTimeout(timerRef.current);

    const timer = setTimeout(() => setState("idle"), 4000);
    timerRef.current = timer;
  }, [value]);

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
      <p
        className="text-xs font-medium uppercase tracking-wider text-neutral-400"
        style={{ fontFamily: "'DM Sans', sans-serif" }}
      >
        {label}
      </p>
      {description && (
        <p className="mt-1 text-xs text-neutral-500">{description}</p>
      )}
      <div className="mt-3 flex items-center gap-2">
        <code className="flex-1 min-w-0 break-all rounded-lg bg-black/40 px-3 py-2 text-sm font-mono text-neutral-100 select-all">
          {value}
        </code>
        <button
          type="button"
          onClick={copy}
          className={`shrink-0 rounded-lg border px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9945FF] ${
            state === "copied"
              ? "border-green-500/40 text-green-300 hover:bg-green-500/10"
              : state === "failed"
                ? "border-red-400/40 text-red-300 hover:bg-red-400/10"
                : "border-white/[0.1] text-neutral-300 hover:bg-white/[0.04] hover:text-white"
          }`}
        >
          {state === "copied"
            ? "Copied"
            : state === "failed"
              ? "Copy failed"
              : "Copy"}
        </button>
      </div>
    </div>
  );
}

interface RadioFieldProps {
  label: string;
  description?: string;
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function RadioField({
  label,
  description,
  value,
  options,
  onChange,
  disabled = false,
}: RadioFieldProps) {
  return (
    <div>
      <p
        className={`text-sm font-medium mb-2 ${
          disabled ? "text-white/70" : "text-white"
        }`}
        style={{ fontFamily: "'DM Sans', sans-serif" }}
      >
        {label}
        {description && (
          <span
            className={`ml-2 text-xs ${
              disabled ? "text-white/40" : "text-neutral-400"
            }`}
          >
            {description}
          </span>
        )}
      </p>
      <fieldset disabled={disabled} className="space-y-1.5">
        {options.map((option) => (
          <label
            key={option.value}
            className={`flex items-center gap-3 rounded-xl border border-white/[0.06] px-4 py-3 text-sm transition-colors hover:bg-white/[0.03] ${
              disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"
            } ${
              option.value === value
                ? "border-[#9945FF]/30 bg-[#9945FF]/[0.06]"
                : ""
            }`}
          >
            <input
              type="radio"
              name={label}
              value={option.value}
              checked={option.value === value}
              onChange={() => onChange(option.value)}
              className="size-4 accent-[#9945FF]"
            />
            <span
              className={
                option.value === value ? "font-medium text-white" : "text-neutral-300"
              }
            >
              {option.label}
            </span>
            {option.description && (
              <span className="ml-auto text-xs text-neutral-500">
                {option.description}
              </span>
            )}
          </label>
        ))}
      </fieldset>
    </div>
  );
}
