# PayProof merchant auth

This package provides wallet-signature-based merchant authentication for server API routes.

## Phases

- Phase 1 — read-only inspection
- Phase 2 — server-side merchant route protection
- Phase 3 — runtime validation checks
- Phase 4.1 — rate limiting on `/api/auth/challenge` and `/api/auth/verify`

This file is a placeholder for the Phase 2/3 boundary.

## Rate limiting: trusted proxy assumptions

Counters live in Postgres (`auth_rate_limits`) and are incremented by the
`consume_auth_rate_limit` SQL function, which is atomic across every serverless
instance. Limits and windows are in `rate-limit-policy.ts`; key hashing, IP trust
and response shaping are in `rate-limit.ts`.

Client IPs are only trusted when `VERCEL=1`, i.e. the request arrived through
Vercel's edge. In that case:

1. `x-vercel-forwarded-for` is used first (a single sanitised value that survives
   an upstream proxy overwriting `x-forwarded-for`);
2. otherwise the leftmost `x-forwarded-for` entry is used, which is the real
   client while Vercel's edge is outermost;
3. every candidate must parse as an IPv4/IPv6 address before it becomes a key.

Anywhere else — local `next dev`, a self-hosted server, or an unconfigured proxy
— those headers are attacker controlled and are ignored. Such requests are not
exempt: they share one stricter `unknown-ip` bucket, so removing or spoofing a
header never buys extra attempts.

**Deployment requirement:** behind another proxy (e.g. Cloudflare in front of
Vercel), do not rely on the current behaviour. Either configure that proxy so
Vercel still sees the client connection, or add an explicitly reviewed trusted
header setting before enabling merchant traffic.

Failure policy is fail-closed: if the counter store or the HMAC pepper is
unavailable, the endpoint returns a generic `503`, never an unlimited window.
The `auth_rate_limits` table must exist and the migration must be applied before
merchant login works.
