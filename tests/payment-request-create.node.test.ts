import assert from "node:assert/strict";
import test from "node:test";
import {
  CREATE_UNAUTHENTICATED_MESSAGE,
  createPaymentRequestForSession,
  type CreatePaymentRequestDependencies,
  type CreatePaymentRequestResult,
} from "../src/lib/payment-requests/create-for-session.ts";
import {
  describeRepositoryInitializationFailure,
  type PaymentRequestRepository,
  type RepositoryError,
} from "../src/lib/payment-requests/repository.ts";
import type { MerchantSessionState } from "../src/lib/auth/session-validation.ts";
import type {
  NewPaymentRequestInput,
  PaymentRequest,
} from "../src/lib/payment-requests/types.ts";
import { validatePaymentRequestForm } from "../src/lib/payment-requests/validation.ts";

const MERCHANT_A = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const MERCHANT_B = "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1";
const PHANTOM = "7YttLkHDoNj9wyDur5pM1ejNaAvT9X4eqaYcHQqtj2G5";

const INPUT: NewPaymentRequestInput = {
  amountLamports: "1500000",
  description: "Invoice 42",
  customerName: "Ada",
  customerEmail: "ada@example.com",
};

function session(walletAddress: string): MerchantSessionState {
  return { authenticated: true, walletAddress };
}

function unauthenticated(reason: "no-session" | "invalid-session" | "expired-session" | "configuration-error"): MerchantSessionState {
  return { authenticated: false, reason, message: "Server-side reason string." };
}

function requestOwnedBy(merchantAddress: string | null): PaymentRequest {
  return {
    id: "PR-4F9A2C71",
    reference: "Fk9Q1uZ8m2",
    amountLamports: INPUT.amountLamports,
    description: INPUT.description,
    customerName: INPUT.customerName,
    customerEmail: INPUT.customerEmail,
    merchantAddress,
    status: "pending",
    transactionSignature: null,
    payerAddress: null,
    verifiedAt: null,
    createdAt: "2026-11-17T10:00:00.000Z",
  };
}

/**
 * Repository stub that records what the create path was asked to persist. Only
 * `create` is exercised here; the other members are outside this test's scope.
 */
function repositorySpy(
  onCreate: (
    input: NewPaymentRequestInput,
    merchantAddress: string | null,
  ) => PaymentRequest | RepositoryError,
) {
  const calls: Array<{ input: NewPaymentRequestInput; merchantAddress: string | null }> = [];

  const repo = {
    async create(input: NewPaymentRequestInput, merchantAddress: string | null) {
      calls.push({ input, merchantAddress });
      return onCreate(input, merchantAddress);
    },
  } as unknown as PaymentRequestRepository;

  return { repo, calls };
}

function deps(
  overrides: Partial<CreatePaymentRequestDependencies>,
): CreatePaymentRequestDependencies {
  return {
    resolveSession: async () => session(MERCHANT_A),
    openRepository: () => repositorySpy(() => requestOwnedBy(MERCHANT_A)).repo,
    ...overrides,
  };
}

function assertUnauthenticated(result: CreatePaymentRequestResult) {
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "unauthenticated");
  assert.equal(result.error, CREATE_UNAUTHENTICATED_MESSAGE);
}

test("an unauthenticated create is rejected before the repository is opened", async () => {
  let opened = false;

  const result = await createPaymentRequestForSession(
    INPUT,
    deps({
      resolveSession: async () => unauthenticated("no-session"),
      openRepository: () => {
        opened = true;
        return repositorySpy(() => requestOwnedBy(MERCHANT_A)).repo;
      },
    }),
  );

  assertUnauthenticated(result);
  assert.equal(opened, false, "no database access without a session");
});

test("an invalid or expired session is rejected with the same safe message", async () => {
  for (const reason of ["invalid-session", "expired-session", "configuration-error"] as const) {
    const result = await createPaymentRequestForSession(
      INPUT,
      deps({ resolveSession: async () => unauthenticated(reason) }),
    );

    assertUnauthenticated(result);
    if (result.ok) continue;
    assert.doesNotMatch(result.error, /invalid-session|expired|configuration/i);
  }
});

test("a session resolver that throws fails closed", async () => {
  const { repo, calls } = repositorySpy(() => requestOwnedBy(MERCHANT_A));

  const result = await createPaymentRequestForSession(
    INPUT,
    deps({
      resolveSession: async () => {
        throw new Error("session store unavailable");
      },
      openRepository: () => repo,
    }),
  );

  assertUnauthenticated(result);
  assert.equal(calls.length, 0);
});

test("merchant A's create stores A as the owner", async () => {
  const { repo, calls } = repositorySpy(() => requestOwnedBy(MERCHANT_A));

  const result = await createPaymentRequestForSession(
    INPUT,
    deps({ resolveSession: async () => session(MERCHANT_A), openRepository: () => repo }),
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.request.merchantAddress, MERCHANT_A);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].merchantAddress, MERCHANT_A);
});

test("a client-supplied merchant B address cannot become the stored owner", async () => {
  const { repo, calls } = repositorySpy(() => requestOwnedBy(MERCHANT_A));

  // The old vulnerability shape: an attacker smuggles an owner into the payload.
  const forged = { ...INPUT, merchantAddress: MERCHANT_B } as unknown as NewPaymentRequestInput;

  const result = await createPaymentRequestForSession(
    forged,
    deps({ resolveSession: async () => session(MERCHANT_A), openRepository: () => repo }),
  );

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].merchantAddress, MERCHANT_A);
  assert.notEqual(calls[0].merchantAddress, MERCHANT_B);
  if (result.ok) assert.equal(result.request.merchantAddress, MERCHANT_A);
});

test("a connected wallet different from the session cannot override ownership", async () => {
  const { repo, calls } = repositorySpy(() => requestOwnedBy(MERCHANT_A));

  // The browser may have a Phantom wallet connected that is not the wallet the
  // session was issued for. That address never reaches the insert.
  const withConnectedWallet = { ...INPUT, merchantAddress: PHANTOM } as unknown as NewPaymentRequestInput;

  await createPaymentRequestForSession(
    withConnectedWallet,
    deps({ resolveSession: async () => session(MERCHANT_A), openRepository: () => repo }),
  );

  assert.equal(calls[0].merchantAddress, MERCHANT_A);
  assert.notEqual(calls[0].merchantAddress, PHANTOM);
});

test("the session address is trimmed before it is persisted", async () => {
  const { repo, calls } = repositorySpy(() => requestOwnedBy(MERCHANT_A));

  await createPaymentRequestForSession(
    INPUT,
    deps({
      resolveSession: async () => session(`  ${MERCHANT_A}  `),
      openRepository: () => repo,
    }),
  );

  assert.equal(calls[0].merchantAddress, MERCHANT_A);
});

test("blank session identity is treated as unauthenticated", async () => {
  const { repo, calls } = repositorySpy(() => requestOwnedBy(MERCHANT_A));

  const result = await createPaymentRequestForSession(
    INPUT,
    deps({ resolveSession: async () => session("   "), openRepository: () => repo }),
  );

  assertUnauthenticated(result);
  assert.equal(calls.length, 0);
});

test("repository validation errors are still returned unchanged", async () => {
  const message = "Amount must be greater than 0 SOL.";
  const { repo } = repositorySpy(() => ({ type: "invalid", message }));

  const result = await createPaymentRequestForSession(
    INPUT,
    deps({ openRepository: () => repo }),
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "rejected");
  assert.equal(result.error, message);
});

test("a missing server configuration is reported without leaking internals", async () => {
  const cause = new Error("SUPABASE_URL is not set");
  const result = await createPaymentRequestForSession(
    INPUT,
    deps({
      openRepository: () => {
        throw cause;
      },
    }),
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "unavailable");
  assert.equal(result.error, describeRepositoryInitializationFailure(cause));
});

test("successful creation returns the persisted request unchanged", async () => {
  const persisted = requestOwnedBy(MERCHANT_A);
  const { repo, calls } = repositorySpy(() => persisted);

  const result = await createPaymentRequestForSession(
    INPUT,
    deps({ openRepository: () => repo }),
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.request, persisted);
  assert.equal(result.request.status, "pending");
  assert.equal(calls[0].input, INPUT, "the validated payload is forwarded untouched");
});

test("existing payment-request validation still rejects and accepts the same values", () => {
  const valid = validatePaymentRequestForm({
    amount: "0.0015",
    description: "Invoice 42",
    customerName: "Ada",
    customerEmail: "ada@example.com",
  });

  assert.equal(valid.ok, true);
  if (!valid.ok) return;
  assert.deepEqual(valid.value, INPUT);

  const invalid = validatePaymentRequestForm({
    amount: "0",
    description: "",
    customerName: "",
    customerEmail: "not-an-email",
  });

  assert.equal(invalid.ok, false);
  if (invalid.ok) return;
  assert.ok(invalid.errors.amount);
  assert.ok(invalid.errors.description);
});
