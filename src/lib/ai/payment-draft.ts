import {
  AMOUNT_MAX_SOL,
  DESCRIPTION_MAX_LENGTH,
  DESCRIPTION_MIN_LENGTH,
  parseSolAmountToLamports,
  validatePaymentRequestForm,
  type PaymentRequestField,
} from "@/lib/payment-requests/validation";
import { LAMPORTS_PER_SOL, formatSolExact } from "@/lib/solana/units";

/**
 * Pure payment-request draft preparation.
 *
 * This module understands only *proposed* payment-request arguments. It never
 * touches Supabase, never opens the repository and never creates a payment
 * request record. Its only job is to normalize, validate and describe a draft
 * that a merchant can later review and explicitly confirm.
 *
 * PayProof payment requests are SOL-only. Fiat amounts are never converted
 * here, and no exchange rate is assumed.
 */

export const SUPPORTED_DRAFT_CURRENCY = "SOL";

/** Fiat / non-SOL currency codes that must trigger a clarification. */
const UNSUPPORTED_CURRENCY_CODES = [
  "GHS",
  "USD",
  "EUR",
  "GBP",
  "NGN",
  "KES",
  "ZAR",
  "CAD",
  "AUD",
  "XOF",
  "XAF",
  "MAD",
  "EGP",
  "INR",
  "CNY",
  "JPY",
  "RWF",
  "TZS",
  "UGX",
  "ZMW",
  "BRL",
] as const;

/** Currency symbols, including Cedi (₵), Naira (₦) and the usual majors. */
const CURRENCY_SYMBOL_PATTERN = /[$€£¥₵₦₹]/;

const CURRENCY_CODE_BEFORE_AMOUNT = new RegExp(
  `\\b(${UNSUPPORTED_CURRENCY_CODES.join("|")})\\b\\s*\\d`,
  "i",
);

const AMOUNT_BEFORE_CURRENCY_CODE = new RegExp(
  `\\d[\\d,.]*\\s*\\b(${UNSUPPORTED_CURRENCY_CODES.join("|")})\\b`,
  "i",
);

export type PaymentDraftErrorCode =
  | "missing_amount"
  | "missing_description"
  | "invalid_amount"
  | "amount_not_positive"
  | "amount_above_limit"
  | "description_too_short"
  | "description_too_long"
  | "invalid_customer_name"
  | "invalid_customer_email"
  | "unsupported_currency";

export type PaymentDraftValidationIssue = {
  field: PaymentRequestField;
  code: PaymentDraftErrorCode;
  message: string;
};

export type PaymentRequestDraft = {
  /** Exact amount in lamports as an integer string. */
  amountLamports: string;
  /** Exact amount in SOL, formatted for display/review. */
  amountSol: string;
  description: string;
  customerName: string | null;
  customerEmail: string | null;
};

export type PaymentDraftArguments = {
  amount?: unknown;
  description?: unknown;
  customerName?: unknown;
  customerEmail?: unknown;
  /** Defensive: a model may add a currency despite the strict tool schema. */
  currency?: unknown;
};

export type PreparePaymentDraftResult =
  | { status: "ready"; draft: PaymentRequestDraft }
  | {
      status: "clarification";
      missing: Array<"amount" | "description">;
      message: string;
    }
  | {
      status: "unsupported_currency";
      currency: string;
      message: string;
    }
  | {
      status: "invalid";
      errors: PaymentDraftValidationIssue[];
      message: string;
    };

const CLARIFY_AMOUNT =
  "What amount in SOL should this payment request be for?";
const CLARIFY_DESCRIPTION =
  "What is this payment request for? Add a short description.";
const CLARIFY_BOTH =
  "What amount in SOL, and what description, should this payment request have?";

export const UNSUPPORTED_CURRENCY_MESSAGE =
  "PayProof payment requests currently support SOL only. Please tell me the equivalent amount in SOL — I won't convert currencies or guess an exchange rate.";

/**
 * Detects an amount written in an unsupported currency, for example
 * "GHS 500", "500 GHS", "$25" or "₵500". Bare currency words without an
 * adjacent amount (for example "GHS compliance training") are not treated as
 * an amount so they can still appear in a description.
 */
export function detectUnsupportedCurrency(text: string): string | null {
  const symbolMatch = CURRENCY_SYMBOL_PATTERN.exec(text);
  if (symbolMatch) {
    return symbolMatch[0];
  }

  const codeBefore = CURRENCY_CODE_BEFORE_AMOUNT.exec(text);
  if (codeBefore) {
    return codeBefore[1].toUpperCase();
  }

  const codeAfter = AMOUNT_BEFORE_CURRENCY_CODE.exec(text);
  if (codeAfter) {
    return codeAfter[1].toUpperCase();
  }

  return null;
}

function amountTextFrom(raw: unknown): string | null {
  if (typeof raw === "string") {
    return raw.trim();
  }

  if (typeof raw === "number") {
    return Number.isFinite(raw) ? String(raw) : null;
  }

  return null;
}

function normalizeAmountText(raw: string): string {
  // The model sometimes includes the unit even though the schema asks for a
  // decimal string. Only a trailing "SOL" is stripped; any other suffix is
  // left in place so validation rejects it instead of silently reinterpreting
  // an unsupported currency as SOL.
  return raw.trim().replace(/\s*sol\s*$/i, "").trim();
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function invalid(
  field: PaymentRequestField,
  code: PaymentDraftErrorCode,
  message: string,
): PreparePaymentDraftResult {
  return {
    status: "invalid",
    errors: [{ field, code, message }],
    message,
  };
}

/**
 * Validates proposed arguments using the same rules as the existing creation
 * form. The result is a draft only — nothing is persisted.
 */
export function preparePaymentDraft(
  args: PaymentDraftArguments,
): PreparePaymentDraftResult {
  const currency =
    typeof args.currency === "string" ? args.currency.trim() : "";

  if (currency.length > 0 && currency.toUpperCase() !== SUPPORTED_DRAFT_CURRENCY) {
    return {
      status: "unsupported_currency",
      currency: currency.toUpperCase(),
      message: UNSUPPORTED_CURRENCY_MESSAGE,
    };
  }

  const rawAmount = amountTextFrom(args.amount);
  const rawDescription =
    typeof args.description === "string" ? args.description : "";

  const amountText = rawAmount ? normalizeAmountText(rawAmount) : "";
  const descriptionText = normalizeWhitespace(rawDescription);

  const missing: Array<"amount" | "description"> = [];
  if (!amountText) missing.push("amount");
  if (!descriptionText) missing.push("description");

  if (missing.length > 0) {
    return {
      status: "clarification",
      missing,
      message:
        missing.length === 2
          ? CLARIFY_BOTH
          : missing[0] === "amount"
            ? CLARIFY_AMOUNT
            : CLARIFY_DESCRIPTION,
    };
  }

  const amountCurrency = detectUnsupportedCurrency(amountText);
  if (amountCurrency) {
    return {
      status: "unsupported_currency",
      currency: amountCurrency,
      message: UNSUPPORTED_CURRENCY_MESSAGE,
    };
  }

  const lamports = parseSolAmountToLamports(amountText);

  if (lamports === null) {
    return invalid(
      "amount",
      "invalid_amount",
      "Enter a valid SOL amount using digits and up to 9 decimal places.",
    );
  }

  if (lamports <= 0n) {
    return invalid("amount", "amount_not_positive", "Amount must be greater than 0 SOL.");
  }

  if (lamports > AMOUNT_MAX_SOL * LAMPORTS_PER_SOL) {
    return invalid(
      "amount",
      "amount_above_limit",
      `Amount must be ${AMOUNT_MAX_SOL.toString()} SOL or less.`,
    );
  }

  if (descriptionText.length < DESCRIPTION_MIN_LENGTH) {
    return invalid(
      "description",
      "description_too_short",
      `Description must be at least ${DESCRIPTION_MIN_LENGTH} characters.`,
    );
  }

  if (descriptionText.length > DESCRIPTION_MAX_LENGTH) {
    return invalid(
      "description",
      "description_too_long",
      `Description must be ${DESCRIPTION_MAX_LENGTH} characters or fewer.`,
    );
  }

  if (
    args.customerName !== undefined &&
    args.customerName !== null &&
    typeof args.customerName !== "string"
  ) {
    return invalid(
      "customerName",
      "invalid_customer_name",
      "Customer name must be text.",
    );
  }

  if (
    args.customerEmail !== undefined &&
    args.customerEmail !== null &&
    typeof args.customerEmail !== "string"
  ) {
    return invalid(
      "customerEmail",
      "invalid_customer_email",
      "Customer email must be text.",
    );
  }

  // Authoritative validation: the same function used by the creation form and
  // the repository. It normalizes whitespace, validates the email and enforces
  // the exact lamport round-trip.
  const validated = validatePaymentRequestForm({
    amount: amountText,
    description: rawDescription,
    customerName:
      typeof args.customerName === "string" ? args.customerName : "",
    customerEmail:
      typeof args.customerEmail === "string" ? args.customerEmail : "",
  });

  if (!validated.ok) {
    const fieldOrder: PaymentRequestField[] = [
      "amount",
      "description",
      "customerName",
      "customerEmail",
    ];

    for (const field of fieldOrder) {
      const message = validated.errors[field];
      if (!message) continue;

      const code: PaymentDraftErrorCode =
        field === "amount"
          ? "invalid_amount"
          : field === "description"
            ? "description_too_short"
            : field === "customerEmail"
              ? "invalid_customer_email"
              : "invalid_customer_name";

      return invalid(field, code, message);
    }

    return {
      status: "invalid",
      errors: [],
      message: "The payment request draft is invalid.",
    };
  }

  return {
    status: "ready",
    draft: {
      amountLamports: validated.value.amountLamports,
      amountSol: formatSolExact(BigInt(validated.value.amountLamports)),
      description: validated.value.description,
      customerName: validated.value.customerName,
      customerEmail: validated.value.customerEmail,
    },
  };
}
