-- PayProof: persistent merchant auth state for wallet-signature login.

-- This table stores short-lived, single-use auth challenges and the resulting
-- merchant sessions. It is the persistent counterpart to the server-side wallet
-- signature verification path introduced for merchant authentication.
--
-- Merchant identity is the Solana wallet address that signed the authentication
-- challenge. That address is the same one PayProof already records on payment
-- requests as `merchant_address`, so this keeps the existing ownership model
-- intact while replacing "client-reported wallet address" with "verified wallet
-- ownership".
--
-- Signed comparison is used for expiry and token matching so filters can use
-- indexed range/delete predicates safely. `token` is a URL-safe random value
-- and is matchable with Postgres `=`/`eq`.

create table if not exists merchant_auth (
  id              uuid primary key default gen_random_uuid(),

  -- auth challenges
  challenge_nonce text,                 -- random bytes base58, 32
  domain         text not null,         -- application origin this challenge was issued for
  issued_at      timestamptz not null default now(),
  expires_at     timestamptz not null,

  -- verification result: a verified session, not just "this address signed"
  session_token  text unique,           -- single-use session token issued after successful verification
  session_expires_at timestamptz,       -- session expiry

  -- the wallet that completed authentication
  wallet_address text,

  -- lifecycle
  created_at     timestamptz not null default now(),
  deleted_at     timestamptz,

  -- a challenge is unique by nonce, and a session is unique by token
  unique (challenge_nonce),
  unique (session_token)
);

create index if not exists idx_merchant_auth_session_lookup
  on merchant_auth (session_token)
  where deleted_at is null;

create index if not exists idx_merchant_auth_active_sessions_by_wallet
  on merchant_auth (wallet_address, session_expires_at)
  where deleted_at is null
    and session_token is not null
    and session_expires_at > now();

create index if not exists idx_merchant_auth unexpired_and_expired_challenges
  on merchant_auth (expires_at)
  where deleted_at is null
    and challenge_nonce is not null;

-- Application constraints
alter table merchant_auth
  add constraint merchant_auth_challenge_requires_nonce
    check (challenge_nonce is not null or session_token is not null);

alter table merchant_auth
  add constraint merchant_auth_challenge_requires_expiry
    check (expires_at is not null);

alter table merchant_auth
  add constraint merchant_auth_session_requires_token
    check (session_token is null or (session_token is not null and session_expires_at is not null));

alter table merchant_auth
  add constraint merchant_auth_wallet_or_null
    check (wallet_address is null or wallet_address = trim(wallet_address));
