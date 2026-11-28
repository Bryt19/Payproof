import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  applyDraftEdits,
  buildDraftCardModel,
  canApproveDraft,
  canEditDraft,
  cancelDraftReview,
  formatDraftCountdown,
  getDraftReviewStatus,
  isDraftEdited,
  looksLikePaymentRequestAction,
  parseDraftPreparationResponse,
  shouldPreparePaymentDraft,
  toEditableDraft,
  type DraftReview,
} from "../src/lib/ai/draft-review.ts";

const SESSION_WALLET = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const NOW = Date.parse("2026-11-22T10:00:00.000Z");
const EXPIRES_AT = new Date(NOW + 10 * 60 * 1000).toISOString();

function draftPayload(overrides: Record<string, unknown> = {}) {
  return {
    status: "awaiting_confirmation",
    draft: {
      amountLamports: "500000000",
      amountSol: "0.5",
      description: "website development",
      customerName: null,
      customerEmail: null,
    },
    draftToken: "ppd1.eyJ2IjoxfQ.signature-not-verified-client-side",
    expiresAt: EXPIRES_AT,
    ...overrides,
  };
}

function reviewFrom(payload: unknown): DraftReview {
  const parsed = parseDraftPreparationResponse(payload);
  assert.equal(parsed.kind, "draft");
  if (parsed.kind !== "draft") throw new Error("expected a draft");
  return parsed.review;
}

// ---------------------------------------------------------------------------
// 1. Successful draft response renders the review card
// ---------------------------------------------------------------------------

test("a successful draft response produces review-card state", () => {
  const parsed = parseDraftPreparationResponse(draftPayload());

  assert.equal(parsed.kind, "draft");
  if (parsed.kind !== "draft") return;

  const model = buildDraftCardModel(parsed.review, SESSION_WALLET, NOW);

  assert.equal(model.heading, "Payment Request Preview");
  assert.equal(model.draft.amountSol, "0.5");
  assert.equal(model.draft.description, "website development");
  assert.equal(model.merchantWallet, SESSION_WALLET);
  assert.equal(model.statusLabel, "Pending Approval");
  assert.equal(model.canApprove, true);
  assert.equal(model.canEdit, true);
  assert.match(model.countdownLabel, /^Expires in \d+:\d{2}$/);
});

test("the review card exposes the branding, fields and Stage 2B approval interface", () => {
  const source = readFileSync(
    new URL("../src/components/ai-chat/payment-draft-card.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /PayproofLogo/);
  assert.match(source, /\{model\.heading\}/);
  assert.match(source, /\{draft\.amountSol\}/);
  assert.match(source, /\{draft\.description\}/);
  assert.match(source, /\{model\.merchantWallet/);
  assert.match(source, /Approve payment request/);
  assert.match(source, /Edit draft/);
  assert.match(source, /Cancel draft/);
  assert.match(source, /onApprove\?:/);
  assert.match(source, /DRAFT_APPROVAL_NOT_CONNECTED/);
  assert.match(source, /Payment Request Created/);
  assert.match(source, /approvalState === "success"/);
});

// ---------------------------------------------------------------------------
// 2. Ordinary AI messages render normally
// ---------------------------------------------------------------------------

test("ordinary conversation and help questions stay on the normal chat path", () => {
  for (const message of [
    "Hello",
    "What can you help me with?",
    "Explain blockchain in simple terms.",
    "How do I create a payment request?",
    "What is the difference between a payment request and an invoice?",
    "Can you explain how to create a payment request?",
  ]) {
    assert.equal(
      looksLikePaymentRequestAction(message),
      false,
      `expected normal chat for: ${message}`,
    );
  }
});

test("clear action requests are routed to draft preparation", () => {
  for (const message of [
    "Create a payment request for 0.5 SOL for website development.",
    "Please create a new payment request for GHS 500 for design work.",
    "Make a payment request for 1 SOL for consulting",
    "Draft a payment request for 2 SOL for logo design",
    "Generate a payment link for 0.25 SOL for support",
  ]) {
    assert.equal(
      looksLikePaymentRequestAction(message),
      true,
      `expected draft preparation for: ${message}`,
    );
  }
});

test("answers to a draft clarification continue the draft flow", () => {
  assert.equal(shouldPreparePaymentDraft("0.5", ["amount"]), true);
  assert.equal(shouldPreparePaymentDraft("0.5 SOL", ["amount"]), true);
  assert.equal(
    shouldPreparePaymentDraft("website development for Ama", ["description"]),
    true,
  );
  assert.equal(
    shouldPreparePaymentDraft("What can you help me with?", ["amount"]),
    false,
  );
  assert.equal(shouldPreparePaymentDraft("Hello", ["amount"]), false);
  assert.equal(shouldPreparePaymentDraft("0.5 SOL", []), false);
});

test("clarification responses parse as normal assistant text, not a card", () => {
  const parsed = parseDraftPreparationResponse({
    status: "clarification",
    missing: ["amount"],
    message: "What amount in SOL should this payment request be for?",
  });

  assert.equal(parsed.kind, "clarification");
  if (parsed.kind !== "clarification") return;
  assert.match(parsed.message, /amount in SOL/);
  assert.deepEqual(parsed.missing, ["amount"]);
});

test("the existing streaming chat path is still present for ordinary messages", () => {
  const source = readFileSync(
    new URL("../src/app/ai-assistant/ai-assistant-client.tsx", import.meta.url),
    "utf8",
  );

  // Stage 3 routes every message through the unified assistant endpoint, which
  // still streams General Assistance replies as text/plain.
  assert.match(source, /fetch\("\/api\/ai\/assistant"/);
  assert.match(source, /contentType\.includes\("text\/plain"\)/);
  assert.doesNotMatch(source, /setMode|mode ===/);
  assert.doesNotMatch(source, /looksLikePaymentRequestAction\(cleanText\)/);
  assert.match(source, /readonly Message\[\]/);
});

// ---------------------------------------------------------------------------
// 3. Missing customer information
// ---------------------------------------------------------------------------

test("a draft without customer details is valid and uses empty edit fields", () => {
  const review = reviewFrom(draftPayload());
  const editable = toEditableDraft(review.draft);

  assert.equal(review.draft.customerName, null);
  assert.equal(review.draft.customerEmail, null);
  assert.deepEqual(editable, {
    amount: "0.5",
    description: "website development",
    customerName: "",
    customerEmail: "",
  });

  const model = buildDraftCardModel(review, SESSION_WALLET, NOW);
  assert.equal(model.canApprove, true);
});

// ---------------------------------------------------------------------------
// 4-5. Editing updates local state and invalidates the original authorization
// ---------------------------------------------------------------------------

test("editing updates local review state without changing the token", () => {
  const review = reviewFrom(draftPayload());

  const result = applyDraftEdits(review, {
    amount: "0.75",
    description: "Website redesign",
    customerName: "Ama Mensah",
    customerEmail: "ama@example.com",
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.review.draft.amountSol, "0.75");
  assert.equal(result.review.draft.amountLamports, "750000000");
  assert.equal(result.review.draft.description, "Website redesign");
  assert.equal(result.review.draft.customerName, "Ama Mensah");
  assert.equal(result.review.draft.customerEmail, "ama@example.com");

  // The signed authorization is never rewritten in the browser.
  assert.equal(result.review.draftToken, review.draftToken);
  assert.equal(result.review.originalDraft.amountSol, "0.5");
});

test("editing invalidates the original authorization for approval", () => {
  const review = reviewFrom(draftPayload());

  const edited = applyDraftEdits(review, {
    amount: "0.75",
    description: "Website redesign",
    customerName: "",
    customerEmail: "",
  });

  assert.equal(edited.ok, true);
  if (!edited.ok) return;

  assert.equal(isDraftEdited(edited.review), true);
  assert.equal(getDraftReviewStatus(edited.review, NOW), "edited");
  assert.equal(canApproveDraft(edited.review, NOW), false);

  const model = buildDraftCardModel(edited.review, SESSION_WALLET, NOW);
  assert.equal(model.statusLabel, "Needs re-authorization");
  assert.equal(model.canApprove, false);
  assert.match(model.notice, /re-signed|server authorization/i);
});

test("reverting every field to the prepared values restores the valid state", () => {
  const review = reviewFrom(draftPayload());

  const edited = applyDraftEdits(review, {
    amount: "0.75",
    description: "Website redesign",
    customerName: "",
    customerEmail: "",
  });
  assert.equal(edited.ok, true);
  if (!edited.ok) return;

  const reverted = applyDraftEdits(edited.review, toEditableDraft(review.originalDraft));
  assert.equal(reverted.ok, true);
  if (!reverted.ok) return;

  assert.equal(isDraftEdited(reverted.review), false);
  assert.equal(canApproveDraft(reverted.review, NOW), true);
});

test("invalid edits are rejected and leave the review unchanged", () => {
  const review = reviewFrom(draftPayload());

  const result = applyDraftEdits(review, {
    amount: "0.5.5",
    description: "",
    customerName: "",
    customerEmail: "not-an-email",
  });

  assert.equal(result.ok, false);
  if (result.ok) return;

  assert.ok(result.errors.amount);
  assert.ok(result.errors.description);
  assert.ok(result.errors.customerEmail);
  assert.equal(review.draft.amountSol, "0.5");
});

// ---------------------------------------------------------------------------
// 6. Expiration
// ---------------------------------------------------------------------------

test("an expired draft cannot be approved or edited", () => {
  const review = reviewFrom(draftPayload());
  const afterExpiry = Date.parse(review.expiresAt) + 1;

  assert.equal(getDraftReviewStatus(review, afterExpiry), "expired");
  assert.equal(canApproveDraft(review, afterExpiry), false);
  assert.equal(canEditDraft(review, afterExpiry), false);

  const model = buildDraftCardModel(review, SESSION_WALLET, afterExpiry);
  assert.equal(model.statusLabel, "Expired");
  assert.equal(model.canApprove, false);
  assert.equal(model.countdownLabel, "Expired");
  assert.match(model.notice, /prepare it again/i);

  // The API-supplied expiry is authoritative and unchanged.
  assert.equal(review.expiresAt, EXPIRES_AT);
});

test("countdowns are derived from the remaining time only", () => {
  assert.equal(formatDraftCountdown(10 * 60 * 1000), "10:00");
  assert.equal(formatDraftCountdown(59_001), "1:00");
  assert.equal(formatDraftCountdown(0), "0:00");
  assert.equal(formatDraftCountdown(-5_000), "0:00");
});

// ---------------------------------------------------------------------------
// 7. Cancellation
// ---------------------------------------------------------------------------

test("cancelling removes the draft from the active review interface", () => {
  const review = reviewFrom(draftPayload());
  const cancelled = cancelDraftReview(review);

  assert.equal(getDraftReviewStatus(cancelled, NOW), "cancelled");
  assert.equal(canApproveDraft(cancelled, NOW), false);
  assert.equal(canEditDraft(cancelled, NOW), false);

  const model = buildDraftCardModel(cancelled, SESSION_WALLET, NOW);
  assert.equal(model.statusLabel, "Cancelled");
  assert.match(model.notice, /Nothing was saved/);
});

// ---------------------------------------------------------------------------
// 8. No database creation during review
// ---------------------------------------------------------------------------

test("the review UI contains no payment-request creation or database calls", () => {
  const sources = [
    readFileSync(
      new URL("../src/lib/ai/draft-review.ts", import.meta.url),
      "utf8",
    ),
    readFileSync(
      new URL("../src/components/ai-chat/payment-draft-card.tsx", import.meta.url),
      "utf8",
    ),
    readFileSync(
      new URL("../src/app/ai-assistant/ai-assistant-client.tsx", import.meta.url),
      "utf8",
    ),
  ];

  for (const source of sources) {
    assert.doesNotMatch(source, /createPaymentRequest(?:ForSession|Action)?\s*\(/);
    assert.doesNotMatch(source, /\.insert\s*\(/);
    assert.doesNotMatch(source, /createSupabaseClient|supabase/i);
    assert.doesNotMatch(source, /\/api\/payment-requests/);
  }

  const clientSource = sources[2];
  assert.match(clientSource, /fetch\("\/api\/ai\/assistant"/);
  assert.match(clientSource, /\/api\/ai\/payment-drafts\/execute/);
  assert.match(clientSource, /\/api\/ai\/payment-drafts\/reauthorize/);
  assert.doesNotMatch(clientSource, /createDraftToken/);
  assert.doesNotMatch(clientSource, /AI_DRAFT_TOKEN_SECRET/);
});

// ---------------------------------------------------------------------------
// 9. Malformed draft responses
// ---------------------------------------------------------------------------

test("malformed draft envelopes never produce review state", () => {
  const malformedPayloads: unknown[] = [
    null,
    {},
    "not-json",
    { status: "awaiting_confirmation" },
    draftPayload({ draftToken: "" }),
    draftPayload({ expiresAt: "not-a-date" }),
    draftPayload({ draft: null }),
    draftPayload({
      draft: {
        amountLamports: "500000000",
        amountSol: "1.0", // does not agree with lamports
        description: "website development",
        customerName: null,
        customerEmail: null,
      },
    }),
    draftPayload({
      draft: {
        amountLamports: "abc",
        amountSol: "0.5",
        description: "website development",
        customerName: null,
        customerEmail: null,
      },
    }),
  ];

  for (const payload of malformedPayloads) {
    const parsed = parseDraftPreparationResponse(payload);
    assert.ok(
      parsed.kind === "malformed" || parsed.kind === "error",
      `expected a safe non-draft result for ${JSON.stringify(payload)}`,
    );
    assert.notEqual(parsed.kind, "draft");
  }
});

test("server error responses become safe assistant text", () => {
  const parsed = parseDraftPreparationResponse({
    status: "error",
    code: "upstream_timeout",
    error: "The AI assistant took too long to respond. Please try again.",
  });

  assert.equal(parsed.kind, "error");
  if (parsed.kind !== "error") return;
  assert.match(parsed.message, /too long/i);
});

test("validation responses expose field errors without a token", () => {
  const parsed = parseDraftPreparationResponse({
    status: "invalid",
    errors: [
      { field: "amount", code: "amount_above_limit", message: "Amount must be 10 SOL or less." },
    ],
    message: "Amount must be 10 SOL or less.",
  });

  assert.equal(parsed.kind, "invalid");
  if (parsed.kind !== "invalid") return;
  assert.equal(parsed.errors[0].field, "amount");
  assert.match(parsed.errors[0].message, /10 SOL/);
});
