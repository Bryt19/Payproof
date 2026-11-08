import { LAMPORTS_PER_SOL } from "@/lib/solana/units";

export const DESCRIPTION_MIN_LENGTH = 3;
export const DESCRIPTION_MAX_LENGTH = 200;
export const CUSTOMER_NAME_MAX_LENGTH = 80;
export const CUSTOMER_EMAIL_MAX_LENGTH = 254;
export const AMOUNT_MAX_SOL = 10n;

const AMOUNT_MAX_LAMPORTS = AMOUNT_MAX_SOL * LAMPORTS_PER_SOL;
const AMOUNT_PATTERN = /^\d+(\.\d{1,9})?$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export type PaymentRequestField =
  | "amount"
  | "description"
  | "customerName"
  | "customerEmail";

export type PaymentRequestFieldErrors = Partial<
  Record<PaymentRequestField, string>
>;

export type PaymentRequestFormValues = {
  amount: string;
  description: string;
  customerName: string;
  customerEmail: string;
};

export type ValidatedPaymentRequest = {
  amountLamports: string;
  description: string;
  customerName: string | null;
  customerEmail: string | null;
};

export type PaymentRequestValidation =
  | { ok: true; value: ValidatedPaymentRequest }
  | { ok: false; errors: PaymentRequestFieldErrors };

function normaliseWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/**
 * Parses a decimal SOL string into lamports using integer string math only.
 * Returns `null` when the text is not a plain positive decimal amount.
 */
export function parseSolAmountToLamports(raw: string): bigint | null {
  const trimmed = raw.trim();

  if (!AMOUNT_PATTERN.test(trimmed)) {
    return null;
  }

  const [whole, fraction = ""] = trimmed.split(".");
  const lamports =
    BigInt(whole) * LAMPORTS_PER_SOL +
    BigInt(fraction.padEnd(9, "0") || "0");

  return lamports;
}

export function validatePaymentRequestForm(
  values: PaymentRequestFormValues,
): PaymentRequestValidation {
  const errors: PaymentRequestFieldErrors = {};

  const amountRaw = values.amount.trim();
  let amountLamports: bigint | null = null;

  if (!amountRaw) {
    errors.amount = "Enter an amount in SOL.";
  } else if (!AMOUNT_PATTERN.test(amountRaw)) {
    errors.amount =
      "Enter a valid amount using digits and up to 9 decimal places.";
  } else {
    amountLamports = parseSolAmountToLamports(amountRaw);

    if (amountLamports === null || amountLamports <= 0n) {
      errors.amount = "Amount must be greater than 0 SOL.";
    } else if (amountLamports > AMOUNT_MAX_LAMPORTS) {
      errors.amount = "Amount must be 10 SOL or less.";
    }
  }

  const description = normaliseWhitespace(values.description);

  if (!description) {
    errors.description = "Enter a description so the payer knows what this is for.";
  } else if (description.length < DESCRIPTION_MIN_LENGTH) {
    errors.description = `Description must be at least ${DESCRIPTION_MIN_LENGTH} characters.`;
  } else if (description.length > DESCRIPTION_MAX_LENGTH) {
    errors.description = `Description must be ${DESCRIPTION_MAX_LENGTH} characters or fewer.`;
  }

  const customerName = values.customerName.trim()
    ? normaliseWhitespace(values.customerName)
    : null;

  if (customerName && customerName.length > CUSTOMER_NAME_MAX_LENGTH) {
    errors.customerName = `Customer name must be ${CUSTOMER_NAME_MAX_LENGTH} characters or fewer.`;
  }

  const emailRaw = values.customerEmail.trim();
  const customerEmail = emailRaw ? emailRaw : null;

  if (customerEmail) {
    if (customerEmail.length > CUSTOMER_EMAIL_MAX_LENGTH) {
      errors.customerEmail = `Email must be ${CUSTOMER_EMAIL_MAX_LENGTH} characters or fewer.`;
    } else if (!EMAIL_PATTERN.test(customerEmail)) {
      errors.customerEmail =
        "Enter a valid email address, for example name@example.com.";
    }
  }

  if (Object.keys(errors).length > 0 || amountLamports === null) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      amountLamports: amountLamports.toString(),
      description,
      customerName,
      customerEmail,
    },
  };
}
