import assert from "node:assert/strict";
import test from "node:test";

import { performMerchantSignIn } from "../src/lib/auth/merchant-sign-in.ts";

const WALLET = "9xQeWvG816bUx9EPjHmaT23yvVM4p8n1sF5V5xX5xX5";
const OTHER_WALLET = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const DOMAIN = "payproof.invalid";

function freshChallenge(nonce = "nonce-1") {
  return {
    nonce,
    domain: DOMAIN,
    message: `PayProof\n${DOMAIN}\n${nonce}`,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
}

test("reuses an existing session for the same wallet without a signature", async () => {
  let challenges = 0;
  let signatures = 0;
  let submissions = 0;
  const phases: string[] = [];

  const result = await performMerchantSignIn({
    address: WALLET,
    getSessionStatus: async () => ({
      authenticated: true,
      walletAddress: WALLET,
    }),
    requestChallenge: async () => {
      challenges += 1;
      return { ok: true, challenge: freshChallenge() };
    },
    signMessage: async () => {
      signatures += 1;
      return new Uint8Array([1]);
    },
    submitSignature: async () => {
      submissions += 1;
      return { ok: true, walletAddress: WALLET };
    },
    onPhase: (phase) => phases.push(phase),
  });

  assert.equal(result.ok, true);
  assert.equal(result.ok === true && result.alreadySignedIn, true);
  assert.equal(challenges, 0);
  assert.equal(signatures, 0);
  assert.equal(submissions, 0);
  assert.deepEqual(phases, []);
});

test("signs the exact server message once and submits the signature", async () => {
  const challenge = freshChallenge("nonce-abc");
  const signedMessages: string[] = [];
  const submissions: Array<{
    nonce: string;
    domain: string;
    walletAddress: string;
    signature: string;
  }> = [];
  const phases: string[] = [];

  const result = await performMerchantSignIn({
    address: WALLET,
    getSessionStatus: async () => ({
      authenticated: false,
      walletAddress: null,
    }),
    requestChallenge: async () => ({ ok: true, challenge }),
    signMessage: async (message) => {
      signedMessages.push(new TextDecoder().decode(message));
      return new Uint8Array([1, 2, 3]);
    },
    submitSignature: async (payload) => {
      submissions.push(payload);
      return { ok: true, walletAddress: WALLET };
    },
    onPhase: (phase) => phases.push(phase),
  });

  assert.equal(result.ok, true);
  assert.equal(result.ok === true && result.alreadySignedIn, false);
  assert.deepEqual(signedMessages, [challenge.message]);
  assert.equal(submissions.length, 1);
  assert.equal(submissions[0].nonce, "nonce-abc");
  assert.equal(submissions[0].domain, DOMAIN);
  assert.equal(submissions[0].walletAddress, WALLET);
  // base64 of the bytes 0x01 0x02 0x03
  assert.equal(submissions[0].signature, "AQID");
  assert.deepEqual(phases, ["requesting", "signing", "verifying"]);
});

test("does not reuse a session that belongs to a different wallet", async () => {
  let challenges = 0;

  const result = await performMerchantSignIn({
    address: WALLET,
    getSessionStatus: async () => ({
      authenticated: true,
      walletAddress: OTHER_WALLET,
    }),
    requestChallenge: async () => {
      challenges += 1;
      return { ok: true, challenge: freshChallenge() };
    },
    signMessage: async () => new Uint8Array([1]),
    submitSignature: async () => ({ ok: true, walletAddress: WALLET }),
  });

  assert.equal(result.ok, true);
  assert.equal(challenges, 1);
});

test("still signs in when the session probe fails", async () => {
  const result = await performMerchantSignIn({
    address: WALLET,
    getSessionStatus: async () => {
      throw new Error("network error");
    },
    requestChallenge: async () => ({ ok: true, challenge: freshChallenge() }),
    signMessage: async () => new Uint8Array([1]),
    submitSignature: async () => ({ ok: true, walletAddress: WALLET }),
  });

  assert.equal(result.ok, true);
});

test("rejects an expired challenge before asking the wallet to sign", async () => {
  let signatures = 0;

  const result = await performMerchantSignIn({
    address: WALLET,
    getSessionStatus: async () => ({
      authenticated: false,
      walletAddress: null,
    }),
    requestChallenge: async () => ({
      ok: true,
      challenge: {
        ...freshChallenge(),
        expiresAt: new Date(Date.now() - 1_000).toISOString(),
      },
    }),
    signMessage: async () => {
      signatures += 1;
      return new Uint8Array([1]);
    },
    submitSignature: async () => ({ ok: true, walletAddress: WALLET }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.failure.retryable, true);
  assert.equal(result.ok === false && result.failure.kind, "expired-challenge");
  assert.equal(signatures, 0);
});

test("maps a wallet rejection to a retryable failure and never submits", async () => {
  let submissions = 0;

  const result = await performMerchantSignIn({
    address: WALLET,
    getSessionStatus: async () => ({
      authenticated: false,
      walletAddress: null,
    }),
    requestChallenge: async () => ({ ok: true, challenge: freshChallenge() }),
    signMessage: async () => {
      throw new Error("User rejected the request");
    },
    submitSignature: async () => {
      submissions += 1;
      return { ok: true, walletAddress: WALLET };
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.failure.retryable, true);
  assert.equal(
    result.ok === false && /rejected/i.test(result.failure.message),
    true,
  );
  assert.equal(submissions, 0);
});

test("propagates a server verification failure", async () => {
  const result = await performMerchantSignIn({
    address: WALLET,
    getSessionStatus: async () => ({
      authenticated: false,
      walletAddress: null,
    }),
    requestChallenge: async () => ({ ok: true, challenge: freshChallenge() }),
    signMessage: async () => new Uint8Array([1]),
    submitSignature: async () => ({
      ok: false,
      failure: {
        message: "Signature verification failed.",
        retryable: false,
      },
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(
    result.ok === false && result.failure.message,
    "Signature verification failed.",
  );
  assert.equal(result.ok === false && result.failure.retryable, false);
});
