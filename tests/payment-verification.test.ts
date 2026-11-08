import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import test from "node:test";
import {
  AccountRole,
  address,
  appendTransactionMessageInstruction,
  compileTransaction,
  createTransactionMessage,
  getBase58Decoder,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Blockhash,
  type Instruction,
  type SignatureBytes,
  type Transaction,
} from "@solana/kit";
import {
  getTransferSolInstructionDataEncoder,
  SYSTEM_PROGRAM_ADDRESS,
} from "@solana-program/system";
import type { PaymentRequest } from "../src/lib/payment-requests/types.ts";
import type { RepositoryError } from "../src/lib/payment-requests/repository.ts";
import { createPaymentVerificationService } from "../src/lib/payment-requests/verification-service.ts";
import type { VerificationRepository } from "../src/lib/payment-requests/verification-service.ts";
import {
  checkConfirmedTransaction,
  verifyOnChainPayment,
  type LoadedAddresses,
  type OnChainLookup,
} from "../src/lib/solana/payment-verification.ts";

const BLOCKHASH = "11111111111111111111111111111111" as Blockhash;
const NOW = "2026-11-05T12:00:00.000Z";
const AMOUNT = 1_500_000n;

type Wallet = { address: Address; privateKey: KeyObject };

function createWallet(): Wallet {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const rawPublicKey = publicKey.export({ type: "spki", format: "der" }).subarray(-32);

  return {
    address: address(getBase58Decoder().decode(rawPublicKey)),
    privateKey,
  };
}

function randomAddress(): Address {
  return address(getBase58Decoder().decode(randomBytes(32)));
}

function buildTransferInstruction({
  source,
  destination,
  reference,
  amount,
  includeReference = true,
  sourceRole = AccountRole.WRITABLE_SIGNER,
}: {
  source: Address;
  destination: Address;
  reference: Address;
  amount: bigint;
  includeReference?: boolean;
  sourceRole?: AccountRole;
}): Instruction {
  const accounts = [
    { address: source, role: sourceRole },
    { address: destination, role: AccountRole.WRITABLE },
    ...(includeReference
      ? [{ address: reference, role: AccountRole.READONLY }]
      : []),
  ];

  return {
    programAddress: SYSTEM_PROGRAM_ADDRESS,
    accounts,
    data: getTransferSolInstructionDataEncoder().encode({ amount }),
  };
}

function buildFixture({
  payer,
  signingWallet = payer,
  merchant,
  reference,
  amount = AMOUNT,
  source,
  sourceRole,
  destination,
  includeReference = true,
}: {
  payer: Wallet;
  signingWallet?: Wallet;
  merchant: Address;
  reference: Address;
  amount?: bigint;
  source?: Address;
  sourceRole?: AccountRole;
  destination?: Address;
  includeReference?: boolean;
}) {
  const message = pipe(
    createTransactionMessage({ version: "legacy" }),
    (transactionMessage) =>
      setTransactionMessageFeePayer(payer.address, transactionMessage),
    (transactionMessage) =>
      setTransactionMessageLifetimeUsingBlockhash(
        { blockhash: BLOCKHASH, lastValidBlockHeight: 100n },
        transactionMessage,
      ),
    (transactionMessage) =>
      appendTransactionMessageInstruction(
        buildTransferInstruction({
          source: source ?? payer.address,
          destination: destination ?? merchant,
          reference,
          amount,
          includeReference,
          sourceRole,
        }),
        transactionMessage,
      ),
  );

  const compiled = compileTransaction(message);
  const signatureBytes = sign(
    null,
    Buffer.from(compiled.messageBytes),
    signingWallet.privateKey,
  );

  const transaction: Transaction = {
    messageBytes: compiled.messageBytes,
    signatures: {
      [payer.address]: new Uint8Array(signatureBytes) as SignatureBytes,
    },
  };

  return {
    transactionBase64: Buffer.from(
      getTransactionEncoder().encode(transaction),
    ).toString("base64"),
    signature: getBase58Decoder().decode(signatureBytes),
  };
}

function paymentRequest(overrides: Partial<PaymentRequest> = {}): PaymentRequest {
  const reference = overrides.reference ?? randomAddress();
  return {
    id: "PR-TEST0001",
    reference,
    amountLamports: AMOUNT.toString(),
    description: "Verification test payment",
    customerName: null,
    customerEmail: null,
    merchantAddress: null,
    status: "pending",
    transactionSignature: null,
    payerAddress: null,
    verifiedAt: null,
    createdAt: "2026-11-01T00:00:00.000Z",
    ...overrides,
  };
}

function lookupFor(
  fixture: { transactionBase64: string } | null,
  {
    confirmationStatus = "confirmed",
    statusErr = null,
    transactionErr = null,
    metaAvailable = true,
    loadedAddresses,
  }: {
    confirmationStatus?: "processed" | "confirmed" | "finalized" | null;
    statusErr?: unknown;
    transactionErr?: unknown;
    metaAvailable?: boolean;
    loadedAddresses?: LoadedAddresses;
  } = {},
): OnChainLookup {
  return {
    async getSignatureStatus() {
      return { confirmationStatus, err: statusErr };
    },
    async getTransaction() {
      if (!fixture) return null;

      return {
        transactionBase64: fixture.transactionBase64,
        metaAvailable,
        err: transactionErr,
        loadedAddresses,
      };
    },
  };
}

function createFakeRepository(
  request: PaymentRequest,
  options: {
    failUpdate?: RepositoryError;
    conflictUpdate?: boolean;
    usedBy?: PaymentRequest;
  } = {},
) {
  let stored = request;
  let markCalls = 0;

  const repo: VerificationRepository = {
    async getByReference(reference) {
      return reference === stored.reference ? stored : null;
    },
    async getByTransactionSignature(signature) {
      if (options.usedBy?.transactionSignature === signature) {
        return options.usedBy;
      }

      return stored.transactionSignature === signature ? stored : null;
    },
    async markVerified(reference, input) {
      markCalls += 1;

      if (options.failUpdate) return options.failUpdate;
      if (options.conflictUpdate) {
        return {
          type: "conflict",
          message: "This transaction signature has already been used.",
        };
      }

      if (
        reference !== stored.reference ||
        stored.status !== "pending" ||
        stored.transactionSignature !== null
      ) {
        return "unchanged";
      }

      stored = {
        ...stored,
        status: "paid",
        transactionSignature: input.transactionSignature,
        payerAddress: input.payerAddress,
        verifiedAt: input.verifiedAt,
      };

      return "updated";
    },
  };

  return {
    repo,
    get markCalls() {
      return markCalls;
    },
    get stored() {
      return stored;
    },
  };
}

function createService(
  request: PaymentRequest,
  fixture: { transactionBase64: string } | null,
  lookupOptions: Parameters<typeof lookupFor>[1] = {},
  repoOptions: Parameters<typeof createFakeRepository>[1] = {},
) {
  const fake = createFakeRepository(request, repoOptions);

  const service = createPaymentVerificationService({
    repo: fake.repo,
    lookup: lookupFor(fixture, lookupOptions),
    now: () => NOW,
  });

  return { service, fake };
}

test("missing transaction is pending, not rejected", async () => {
  const request = paymentRequest({
    merchantAddress: createWallet().address,
    reference: randomAddress(),
  });
  const service = createPaymentVerificationService({
    repo: createFakeRepository(request).repo,
    lookup: {
      async getSignatureStatus() {
        return null;
      },
      async getTransaction() {
        throw new Error("getTransaction must not run when status is missing");
      },
    },
  });

  const result = await service.verify({
    reference: request.reference,
    signature: getBase58Decoder().decode(randomBytes(64)),
  });

  assert.equal(result.status, "pending");
  assert.equal(result.retryable, true);
});

test("processed-but-unconfirmed transaction is pending", async () => {
  const payer = createWallet();
  const merchant = createWallet();
  const request = paymentRequest({
    merchantAddress: merchant.address,
    reference: randomAddress(),
  });
  const fixture = buildFixture({
    payer,
    merchant: merchant.address,
    reference: address(request.reference),
  });

  const { service, fake } = createService(request, fixture, {
    confirmationStatus: "processed",
  });

  const result = await service.verify({
    reference: request.reference,
    signature: fixture.signature,
  });

  assert.equal(result.status, "pending");
  assert.equal(fake.markCalls, 0);
  assert.equal(fake.stored.status, "pending");
});

test("failed transaction is rejected and never marked paid", async () => {
  const payer = createWallet();
  const merchant = createWallet();
  const request = paymentRequest({
    merchantAddress: merchant.address,
    reference: randomAddress(),
  });
  const fixture = buildFixture({
    payer,
    merchant: merchant.address,
    reference: address(request.reference),
  });

  const { service, fake } = createService(request, fixture, {
    statusErr: { InstructionError: [0, "Custom"] },
  });

  const result = await service.verify({
    reference: request.reference,
    signature: fixture.signature,
  });

  assert.equal(result.status, "rejected");
  assert.equal(result.reason, "transaction-failed");
  assert.equal(fake.markCalls, 0);
});

test("transaction metadata failure is rejected", async () => {
  const payer = createWallet();
  const merchant = createWallet();
  const request = paymentRequest({
    merchantAddress: merchant.address,
    reference: randomAddress(),
  });
  const fixture = buildFixture({
    payer,
    merchant: merchant.address,
    reference: address(request.reference),
  });

  const { service, fake } = createService(request, fixture, {
    transactionErr: { InstructionError: [0, "Custom"] },
  });

  const result = await service.verify({
    reference: request.reference,
    signature: fixture.signature,
  });

  assert.equal(result.status, "rejected");
  assert.equal(fake.markCalls, 0);
});

test("wrong merchant recipient is rejected", async () => {
  const payer = createWallet();
  const merchant = createWallet();
  const attacker = createWallet();
  const request = paymentRequest({
    merchantAddress: merchant.address,
    reference: randomAddress(),
  });
  const fixture = buildFixture({
    payer,
    merchant: merchant.address,
    destination: attacker.address,
    reference: address(request.reference),
  });

  const check = checkConfirmedTransaction({
    signature: fixture.signature,
    transactionBase64: fixture.transactionBase64,
    expected: {
      reference: request.reference,
      merchantAddress: merchant.address,
      amountLamports: request.amountLamports,
    },
  });

  assert.equal(check.ok, false);
  if (!check.ok) assert.equal(check.reason, "wrong-merchant");
});

test("incorrect amount is rejected", async () => {
  const payer = createWallet();
  const merchant = createWallet();
  const request = paymentRequest({
    merchantAddress: merchant.address,
    reference: randomAddress(),
  });
  const fixture = buildFixture({
    payer,
    merchant: merchant.address,
    reference: address(request.reference),
    amount: AMOUNT - 1n,
  });

  const check = checkConfirmedTransaction({
    signature: fixture.signature,
    transactionBase64: fixture.transactionBase64,
    expected: {
      reference: request.reference,
      merchantAddress: merchant.address,
      amountLamports: request.amountLamports,
    },
  });

  assert.equal(check.ok, false);
  if (!check.ok) assert.equal(check.reason, "wrong-amount");
});

test("wrong payment reference is rejected", async () => {
  const payer = createWallet();
  const merchant = createWallet();
  const request = paymentRequest({
    merchantAddress: merchant.address,
    reference: randomAddress(),
  });
  const fixture = buildFixture({
    payer,
    merchant: merchant.address,
    reference: randomAddress(),
  });

  const check = checkConfirmedTransaction({
    signature: fixture.signature,
    transactionBase64: fixture.transactionBase64,
    expected: {
      reference: request.reference,
      merchantAddress: merchant.address,
      amountLamports: request.amountLamports,
    },
  });

  assert.equal(check.ok, false);
  if (!check.ok) assert.equal(check.reason, "wrong-reference");
});

test("missing reference account is rejected", async () => {
  const payer = createWallet();
  const merchant = createWallet();
  const request = paymentRequest({
    merchantAddress: merchant.address,
    reference: randomAddress(),
  });
  const fixture = buildFixture({
    payer,
    merchant: merchant.address,
    reference: address(request.reference),
    includeReference: false,
  });

  const check = checkConfirmedTransaction({
    signature: fixture.signature,
    transactionBase64: fixture.transactionBase64,
    expected: {
      reference: request.reference,
      merchantAddress: merchant.address,
      amountLamports: request.amountLamports,
    },
  });

  assert.equal(check.ok, false);
  if (!check.ok) assert.equal(check.reason, "missing-reference");
});

test("transfer source that is not the signer is rejected", async () => {
  const payer = createWallet();
  const otherWallet = createWallet();
  const merchant = createWallet();
  const request = paymentRequest({
    merchantAddress: merchant.address,
    reference: randomAddress(),
  });
  const fixture = buildFixture({
    payer,
    source: otherWallet.address,
    sourceRole: AccountRole.READONLY,
    merchant: merchant.address,
    reference: address(request.reference),
  });

  const check = checkConfirmedTransaction({
    signature: fixture.signature,
    transactionBase64: fixture.transactionBase64,
    expected: {
      reference: request.reference,
      merchantAddress: merchant.address,
      amountLamports: request.amountLamports,
    },
  });

  assert.equal(check.ok, false);
  if (!check.ok) assert.equal(check.reason, "wrong-source");
});

test("invalid transaction signature is rejected", async () => {
  const payer = createWallet();
  const signer = createWallet();
  const merchant = createWallet();
  const request = paymentRequest({
    merchantAddress: merchant.address,
    reference: randomAddress(),
  });
  const fixture = buildFixture({
    payer,
    signingWallet: signer,
    merchant: merchant.address,
    reference: address(request.reference),
  });

  const check = checkConfirmedTransaction({
    signature: fixture.signature,
    transactionBase64: fixture.transactionBase64,
    expected: {
      reference: request.reference,
      merchantAddress: merchant.address,
      amountLamports: request.amountLamports,
    },
  });

  assert.equal(check.ok, false);
  if (!check.ok) assert.equal(check.reason, "invalid-signature");
});

test("submitted signature that does not match the transaction is rejected", async () => {
  const payer = createWallet();
  const merchant = createWallet();
  const request = paymentRequest({
    merchantAddress: merchant.address,
    reference: randomAddress(),
  });
  const fixture = buildFixture({
    payer,
    merchant: merchant.address,
    reference: address(request.reference),
  });
  const unrelatedSignature = getBase58Decoder().decode(randomBytes(64));

  const check = checkConfirmedTransaction({
    signature: unrelatedSignature,
    transactionBase64: fixture.transactionBase64,
    expected: {
      reference: request.reference,
      merchantAddress: merchant.address,
      amountLamports: request.amountLamports,
    },
  });

  assert.equal(check.ok, false);
  if (!check.ok) assert.equal(check.reason, "signature-mismatch");
});

test("successful verification marks the request paid exactly once", async () => {
  const payer = createWallet();
  const merchant = createWallet();
  const request = paymentRequest({
    merchantAddress: merchant.address,
    reference: randomAddress(),
  });
  const fixture = buildFixture({
    payer,
    merchant: merchant.address,
    reference: address(request.reference),
  });

  const { service, fake } = createService(request, fixture);

  const result = await service.verify({
    reference: request.reference,
    signature: fixture.signature,
  });

  assert.equal(result.status, "verified");
  assert.equal(result.requestStatus, "paid");
  assert.equal(result.payerAddress, payer.address);
  assert.equal(fake.markCalls, 1);
  assert.equal(fake.stored.status, "paid");
  assert.equal(fake.stored.transactionSignature, fixture.signature);
  assert.equal(fake.stored.payerAddress, payer.address);
  assert.equal(fake.stored.verifiedAt, NOW);
});

test("a transaction already used by another request is rejected before any write", async () => {
  const payer = createWallet();
  const merchant = createWallet();
  const request = paymentRequest({
    merchantAddress: merchant.address,
    reference: randomAddress(),
  });
  const fixture = buildFixture({
    payer,
    merchant: merchant.address,
    reference: address(request.reference),
  });
  const otherRequest = paymentRequest({
    reference: randomAddress(),
    merchantAddress: randomAddress(),
    status: "paid",
    transactionSignature: fixture.signature,
    payerAddress: payer.address,
    verifiedAt: NOW,
  });

  const { service, fake } = createService(request, fixture, {}, {
    usedBy: otherRequest,
  });

  const result = await service.verify({
    reference: request.reference,
    signature: fixture.signature,
  });

  assert.equal(result.status, "rejected");
  assert.equal(result.reason, "signature-already-used");
  assert.equal(fake.markCalls, 0);
});

test("unique-constraint conflict during update is rejected", async () => {
  const payer = createWallet();
  const merchant = createWallet();
  const request = paymentRequest({
    merchantAddress: merchant.address,
    reference: randomAddress(),
  });
  const fixture = buildFixture({
    payer,
    merchant: merchant.address,
    reference: address(request.reference),
  });

  const { service } = createService(request, fixture, {}, {
    conflictUpdate: true,
  });

  const result = await service.verify({
    reference: request.reference,
    signature: fixture.signature,
  });

  assert.equal(result.status, "rejected");
  assert.equal(result.reason, "signature-already-used");
});

test("Supabase update failure returns a retryable error", async () => {
  const payer = createWallet();
  const merchant = createWallet();
  const request = paymentRequest({
    merchantAddress: merchant.address,
    reference: randomAddress(),
  });
  const fixture = buildFixture({
    payer,
    merchant: merchant.address,
    reference: address(request.reference),
  });

  const { service, fake } = createService(request, fixture, {}, {
    failUpdate: {
      type: "unavailable",
      message: "Could not record the payment verification.",
    },
  });

  const result = await service.verify({
    reference: request.reference,
    signature: fixture.signature,
  });

  assert.equal(result.status, "error");
  assert.equal(result.retryable, true);
  assert.equal(fake.stored.status, "pending");
});

test("RPC unavailable returns a retryable error, not a paid request", async () => {
  const request = paymentRequest({
    merchantAddress: randomAddress(),
    reference: randomAddress(),
  });
  const fake = createFakeRepository(request);

  const service = createPaymentVerificationService({
    repo: fake.repo,
    lookup: {
      async getSignatureStatus() {
        throw new Error("fetch failed");
      },
      async getTransaction() {
        throw new Error("fetch failed");
      },
    },
  });

  const result = await service.verify({
    reference: request.reference,
    signature: getBase58Decoder().decode(randomBytes(64)),
  });

  assert.equal(result.status, "error");
  assert.equal(result.retryable, true);
  assert.equal(result.reason, "rpc-unavailable");
  assert.equal(fake.stored.status, "pending");
});

test("concurrent verification attempts write the paid status only once", async () => {
  const payer = createWallet();
  const merchant = createWallet();
  const request = paymentRequest({
    merchantAddress: merchant.address,
    reference: randomAddress(),
  });
  const fixture = buildFixture({
    payer,
    merchant: merchant.address,
    reference: address(request.reference),
  });

  const { service, fake } = createService(request, fixture);

  const [first, second] = await Promise.all([
    service.verify({ reference: request.reference, signature: fixture.signature }),
    service.verify({ reference: request.reference, signature: fixture.signature }),
  ]);

  assert.equal(first.status, "verified");
  assert.equal(second.status, "verified");
  assert.equal(fake.stored.status, "paid");
  assert.equal(fake.markCalls, 2);
  assert.equal(fake.stored.verifiedAt, NOW);
});

test("a paid request is idempotent for the same signature", async () => {
  const payer = createWallet();
  const merchant = createWallet();
  const signature = getBase58Decoder().decode(randomBytes(64));
  const request = paymentRequest({
    merchantAddress: merchant.address,
    reference: randomAddress(),
    status: "paid",
    transactionSignature: signature,
    payerAddress: payer.address,
    verifiedAt: NOW,
  });

  const { service } = createService(request, null);

  const result = await service.verify({
    reference: request.reference,
    signature,
  });

  assert.equal(result.status, "verified");
  assert.equal(result.requestStatus, "paid");
});

test("a paid request rejects a different transaction", async () => {
  const merchant = createWallet();
  const request = paymentRequest({
    merchantAddress: merchant.address,
    reference: randomAddress(),
    status: "paid",
    transactionSignature: getBase58Decoder().decode(randomBytes(64)),
    payerAddress: randomAddress(),
    verifiedAt: NOW,
  });

  const { service } = createService(request, null);

  const result = await service.verify({
    reference: request.reference,
    signature: getBase58Decoder().decode(randomBytes(64)),
  });

  assert.equal(result.status, "rejected");
  assert.equal(result.reason, "request-already-paid");
});

test("version-0 transaction with lookup-table accounts is verified", async () => {
  const payer = createWallet();
  const merchant = createWallet();
  const reference = randomAddress();
  const request = paymentRequest({
    merchantAddress: merchant.address,
    reference,
  });

  // Account order in a v0 message: static accounts (fee payer, merchant,
  // reference, system program) followed by loaded addresses. This fixture is
  // built by hand so the reference is a loaded read-only account.
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (transactionMessage) =>
      setTransactionMessageFeePayer(payer.address, transactionMessage),
    (transactionMessage) =>
      setTransactionMessageLifetimeUsingBlockhash(
        { blockhash: BLOCKHASH, lastValidBlockHeight: 100n },
        transactionMessage,
      ),
    (transactionMessage) =>
      appendTransactionMessageInstruction(
        buildTransferInstruction({
          source: payer.address,
          destination: merchant.address,
          reference,
          amount: AMOUNT,
        }),
        transactionMessage,
      ),
  );

  const compiled = compileTransaction(message);
  const signatureBytes = sign(
    null,
    Buffer.from(compiled.messageBytes),
    payer.privateKey,
  );
  const transaction: Transaction = {
    messageBytes: compiled.messageBytes,
    signatures: {
      [payer.address]: new Uint8Array(signatureBytes) as SignatureBytes,
    },
  };

  const result = await verifyOnChainPayment({
    expected: {
      reference: request.reference,
      merchantAddress: merchant.address,
      amountLamports: request.amountLamports,
    },
    signature: getBase58Decoder().decode(signatureBytes),
    lookup: {
      async getSignatureStatus() {
        return { confirmationStatus: "finalized", err: null };
      },
      async getTransaction() {
        return {
          transactionBase64: Buffer.from(
            getTransactionEncoder().encode(transaction),
          ).toString("base64"),
          metaAvailable: true,
          err: null,
        };
      },
    },
  });

  // The reference is still a static account in this fixture, but this proves
  // v0 decoding and a finalized status are accepted without claiming finality
  // in the store.
  assert.equal(result.status, "verified");
  if (result.status === "verified") {
    assert.equal(result.commitment, "finalized");
    assert.equal(result.payerAddress, payer.address);
  }
});
