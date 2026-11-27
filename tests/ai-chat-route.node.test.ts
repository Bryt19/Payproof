import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";

import { GoogleGenAI } from "@google/genai";
import { NextRequest, NextResponse } from "next/server";

import {
  AI_CHAT_ROUTE_REQUIRED_CODE,
  AI_CHAT_RATE_LIMIT_MESSAGE,
  createAiChatPostHandler,
} from "../src/app/api/ai/chat/route.ts";
import {
  CAPABILITY_DISABLED_CODE,
  CAPABILITY_DISABLED_MESSAGES,
  CAPABILITY_UNAVAILABLE_CODE,
  CAPABILITY_UNAVAILABLE_MESSAGE,
} from "../src/lib/ai/capability-guard.ts";

/**
 * General Assistance is authenticated, rate limited and capability-gated as of
 * Stage 3. The Gemini single-attempt behaviour must survive unchanged:
 *
 * The installed @google/genai 3.6.1 retries by cloning the outgoing Request, and
 * under Node 22 + Undici a collected attempt clone can cancel the original request
 * body branch, so the next retry throws `TypeError: unusable`. These tests pin the
 * request options that prevent that retry, exercise a real retryable response
 * through the installed SDK against a local HTTP server, and verify the route's
 * existing streaming and error classification behavior.
 */

process.env.GEMINI_API_KEY = "test-gemini-key-not-real";

const ROUTE_SOURCE = readFileSync(
  new URL("../src/app/api/ai/chat/route.ts", import.meta.url),
  "utf8",
);

const GENERAL_MESSAGE = "Hello there, how are you today?";
const SESSION_WALLET = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const OTHER_WALLET = "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1";

function chatRequest(
  message: string = GENERAL_MESSAGE,
  extra: Record<string, unknown> = {},
): NextRequest {
  return new NextRequest("http://localhost/api/ai/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", text: message }],
      ...extra,
    }),
  });
}

type ChatOverrides = {
  resolveMerchant?: () => Promise<string | NextResponse>;
  checkRateLimit?: () => Promise<
    | { ok: true }
    | { ok: false; kind: "limited"; retryAfterSeconds: number }
    | { ok: false; kind: "unavailable" }
  >;
  checkCapability?: (
    wallet: string,
  ) => Promise<
    { ok: true } | { ok: false; reason: "disabled" | "unavailable" }
  >;
};

/** The authenticated, allowed baseline; each test overrides one seam. */
function handler(overrides: ChatOverrides = {}) {
  return createAiChatPostHandler({
    resolveMerchant: async () => SESSION_WALLET,
    checkRateLimit: async () => ({ ok: true }),
    checkCapability: async () => ({ ok: true }),
    ...overrides,
  });
}

/** Replaces global fetch for one test and counts upstream attempts. */
async function withStubbedFetch<T>(
  handler: (call: number) => Response | Promise<Response>,
  run: (calls: () => number) => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch;
  let calls = 0;

  globalThis.fetch = (async () => {
    calls += 1;
    return handler(calls);
  }) as typeof fetch;

  try {
    return await run(() => calls);
  } finally {
    globalThis.fetch = original;
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function sseResponse(): Response {
  const body = [
    "event: step.delta",
    'data: {"event_type":"step.delta","delta":{"type":"text","text":"Hello"}}',
    "",
    "event: step.delta",
    'data: {"event_type":"step.delta","delta":{"type":"text","text":" there"}}',
    "",
    "event: interaction.completed",
    'data: {"event_type":"interaction.completed"}',
    "",
  ].join("\n");

  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

// ---------------------------------------------------------------------------
// 1-2. SDK request options
// ---------------------------------------------------------------------------

test("the chat route disables SDK retries and sets a 20s request timeout", () => {
  assert.match(ROUTE_SOURCE, /maxRetries:\s*0/);
  assert.match(ROUTE_SOURCE, /timeout:\s*20_000/);

  // The streaming request itself is unchanged.
  assert.match(ROUTE_SOURCE, /model:\s*GEMINI_MODEL/);
  assert.match(ROUTE_SOURCE, /input:\s*transcript/);
  assert.match(ROUTE_SOURCE, /system_instruction:\s*SYSTEM_INSTRUCTION/);
  assert.match(ROUTE_SOURCE, /stream:\s*true/);
});

// ---------------------------------------------------------------------------
// 3. SDK-level: a retryable 429 does not trigger an internal retry
// ---------------------------------------------------------------------------

test("the SDK makes one attempt for a 429 against a local HTTP server", async () => {
  let hits = 0;

  const server = http.createServer((request, response) => {
    hits += 1;
    request.resume();
    request.on("end", () => {
      response.writeHead(429, {
        "content-type": "application/json",
        "retry-after-ms": "100",
      });
      response.end(
        JSON.stringify({ error: { code: 429, message: "rate limit exceeded" } }),
      );
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const { port } = server.address() as AddressInfo;
    const ai = new GoogleGenAI({
      apiKey: "test-gemini-key-not-real",
      httpOptions: { baseUrl: `http://127.0.0.1:${port}` },
    });

    await assert.rejects(
      ai.interactions.create(
        { model: "test-model", input: "hi", stream: true },
        { maxRetries: 0, timeout: 20_000 },
      ),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        assert.doesNotMatch(message, /unusable/);
        assert.match(message, /429|rate limit/i);
        return true;
      },
    );

    assert.equal(hits, 1, "a retryable status must not be retried");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

// ---------------------------------------------------------------------------
// 4. Authentication: session-only identity, no provider call
// ---------------------------------------------------------------------------

test("an unauthenticated request is refused before any provider call", async () => {
  const result = await withStubbedFetch(
    () => sseResponse(),
    async (calls) => {
      const response = await handler({
        resolveMerchant: async () =>
          NextResponse.json(
            { error: "Authentication required." },
            { status: 401 },
          ),
      })(chatRequest());

      return { response, calls: calls(), body: await response.json() };
    },
  );

  assert.equal(result.response.status, 401);
  assert.equal(result.calls, 0);
  assert.equal(result.response.headers.get("cache-control"), "no-store");
});

test("a throwing auth dependency fails closed with 503", async () => {
  const result = await withStubbedFetch(
    () => sseResponse(),
    async (calls) => {
      const response = await handler({
        resolveMerchant: async () => {
          throw new Error("auth store unreachable");
        },
      })(chatRequest());

      return { status: response.status, calls: calls() };
    },
  );

  assert.equal(result.status, 503);
  assert.equal(result.calls, 0);
});

test("the capability gate uses the session wallet, not a body wallet", async () => {
  const wallets: string[] = [];

  await withStubbedFetch(
    () => jsonResponse(500, { error: { message: "internal" } }),
    async () => {
      await handler({
        checkCapability: async (wallet) => {
          wallets.push(wallet);
          return { ok: false, reason: "disabled" };
        },
      })(
        chatRequest(GENERAL_MESSAGE, {
          merchantWallet: OTHER_WALLET,
          walletAddress: OTHER_WALLET,
        }),
      );
    },
  );

  assert.deepEqual(wallets, [SESSION_WALLET]);
});

// ---------------------------------------------------------------------------
// 5. Rate limiting
// ---------------------------------------------------------------------------

test("rate limiting runs before the capability gate and the provider", async () => {
  const wallets: string[] = [];

  const result = await withStubbedFetch(
    () => sseResponse(),
    async (calls) => {
      const response = await handler({
        checkRateLimit: async () => ({
          ok: false,
          kind: "limited",
          retryAfterSeconds: 42,
        }),
        checkCapability: async (wallet) => {
          wallets.push(wallet);
          return { ok: true };
        },
      })(chatRequest());

      return {
        response,
        body: await response.json(),
        calls: calls(),
      };
    },
  );

  assert.equal(result.response.status, 429);
  assert.equal(result.response.headers.get("retry-after"), "42");
  assert.equal(result.body.error, AI_CHAT_RATE_LIMIT_MESSAGE);
  assert.equal(result.calls, 0);
  assert.equal(wallets.length, 0);
});

test("an unreadable rate-limit store fails closed with 503", async () => {
  const result = await withStubbedFetch(
    () => sseResponse(),
    async (calls) => {
      const response = await handler({
        checkRateLimit: async () => ({ ok: false, kind: "unavailable" }),
      })(chatRequest());

      return { status: response.status, calls: calls() };
    },
  );

  assert.equal(result.status, 503);
  assert.equal(result.calls, 0);
});

// ---------------------------------------------------------------------------
// 6. General Assistance capability enforcement
// ---------------------------------------------------------------------------

test("General Assistance disabled returns 403 capability_disabled and calls no provider", async () => {
  const result = await withStubbedFetch(
    () => sseResponse(),
    async (calls) => {
      const response = await handler({
        checkCapability: async () => ({ ok: false, reason: "disabled" }),
      })(chatRequest("What is Solana? "));

      return {
        response,
        body: await response.json(),
        calls: calls(),
      };
    },
  );

  assert.equal(result.response.status, 403);
  assert.equal(result.response.headers.get("cache-control"), "no-store");
  assert.equal(result.body.status, CAPABILITY_DISABLED_CODE);
  assert.equal(result.body.code, CAPABILITY_DISABLED_CODE);
  assert.equal(
    result.body.error,
    CAPABILITY_DISABLED_MESSAGES.generalAssistance,
  );
  assert.equal(result.calls, 0);
});

test("unreadable capability storage returns 503 and calls no provider", async () => {
  const result = await withStubbedFetch(
    () => sseResponse(),
    async (calls) => {
      const response = await handler({
        checkCapability: async () => ({ ok: false, reason: "unavailable" }),
      })(chatRequest());

      return { response, body: await response.json(), calls: calls() };
    },
  );

  assert.equal(result.response.status, 503);
  assert.equal(result.body.status, CAPABILITY_UNAVAILABLE_CODE);
  assert.equal(result.body.error, CAPABILITY_UNAVAILABLE_MESSAGE);
  assert.equal(result.calls, 0);
});

test("a throwing capability dependency fails closed", async () => {
  const result = await withStubbedFetch(
    () => sseResponse(),
    async (calls) => {
      const response = await handler({
        checkCapability: async () => {
          throw new Error("capability store unreachable");
        },
      })(chatRequest());

      return {
        status: response.status,
        body: await response.json(),
        calls: calls(),
      };
    },
  );

  assert.equal(result.status, 503);
  assert.equal(JSON.stringify(result.body).includes("capability store"), false);
  assert.equal(result.calls, 0);
});

test("a payment instruction is refused here instead of being answered as general help", async () => {
  const result = await withStubbedFetch(
    () => sseResponse(),
    async (calls) => {
      const response = await handler()(
        chatRequest("Send 0.1 SOL to this wallet."),
      );

      return { response, body: await response.json(), calls: calls() };
    },
  );

  assert.equal(result.response.status, 409);
  assert.equal(result.body.code, AI_CHAT_ROUTE_REQUIRED_CODE);
  assert.equal(result.calls, 0);
});

// ---------------------------------------------------------------------------
// 7. Route-level 429 classification, without retries
// ---------------------------------------------------------------------------

test("an upstream 429 becomes the existing quota response after one attempt", async () => {
  const result = await withStubbedFetch(
    () => jsonResponse(429, { error: { code: 429, message: "rate limit exceeded" } }),
    async (calls) => {
      const response = await handler()(chatRequest());
      return { response, body: await response.json(), calls: calls() };
    },
  );

  assert.equal(result.response.status, 503);
  assert.equal(result.body.code, "quota_exceeded");
  assert.equal(result.calls, 1);
  assert.doesNotMatch(JSON.stringify(result.body), /unusable/);
});

// ---------------------------------------------------------------------------
// 8. Streaming success is unchanged
// ---------------------------------------------------------------------------

test("a successful Gemini stream is relayed as plain text", async () => {
  const result = await withStubbedFetch(
    () => sseResponse(),
    async (calls) => {
      const response = await handler()(chatRequest());
      return {
        status: response.status,
        contentType: response.headers.get("content-type") ?? "",
        text: await response.text(),
        calls: calls(),
      };
    },
  );

  assert.equal(result.status, 200);
  assert.match(result.contentType, /text\/plain/);
  assert.equal(result.text, "Hello there");
  assert.equal(result.calls, 1);
});

// ---------------------------------------------------------------------------
// 9. Existing error classification and timeouts are intact
// ---------------------------------------------------------------------------

test("a 401 is still classified as an invalid API key", async () => {
  const result = await withStubbedFetch(
    () => jsonResponse(401, { error: { code: 401, message: "unauthenticated" } }),
    async () => {
      const response = await handler()(chatRequest());
      return { status: response.status, body: await response.json() };
    },
  );

  assert.equal(result.status, 502);
  assert.equal(result.body.code, "invalid_api_key");
});

test("a 500 keeps its existing gateway-error classification", async () => {
  const result = await withStubbedFetch(
    () => jsonResponse(500, { error: { code: 500, message: "internal" } }),
    async () => {
      const response = await handler()(chatRequest());
      return { status: response.status, body: await response.json() };
    },
  );

  assert.equal(result.status, 502);
  assert.equal(result.body.code, "upstream_error");
});

test("the route keeps its application-level timeout constants", () => {
  assert.match(ROUTE_SOURCE, /REQUEST_TIMEOUT_MS\s*=\s*25_000/);
  assert.match(ROUTE_SOURCE, /STREAM_IDLE_TIMEOUT_MS\s*=\s*30_000/);
});
