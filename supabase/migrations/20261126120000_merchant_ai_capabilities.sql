-- PayProof: per-merchant AI capability preferences (wallet-scoped).
--
-- Source of truth: src/lib/ai/capabilities.ts. This is Stage 0 only: it creates
-- the persistent store and nothing consults it yet.
--
-- Product defaults, which are also the read contract for a merchant with no row:
--   general_assistance        TRUE   general merchant AI assistance on
--   agentic_payments          FALSE  merchant-initiated outbound SOL payments off
--   agentic_payment_requests  FALSE  AI-prepared incoming payment requests off
--
-- No backfill on purpose. A row is written only when a merchant saves a setting;
-- an absent row means "never configured", which resolves to exactly the
-- TRUE / FALSE / FALSE values above. There is therefore no per-merchant seed
-- job and no migration that has to know which wallet addresses already exist.
--
-- Fail-closed contract (implemented in src/lib/ai/capabilities.ts):
--   * a missing row is NOT an error: it returns the defaults above;
--   * a database read error is reported as "unavailable", never as an explicit
--     merchant preference and never as "enabled";
--   * because general assistance defaults on and the two agentic capabilities
--     default off, an unreadable state must deny the agentic capabilities.
--
-- Additive and idempotent: nothing here alters merchant_auth, payment_requests,
-- notifications, agent_payment_intents, or any AI draft authorization object.
-- Safe to re-run: the table, RLS, revokes, grants and policy are all guarded.
--
-- Apply manually in the Supabase SQL editor, or with `supabase db push`.
-- Wrapped in one transaction so a partial run can never leave the table without
-- its access-control block.

BEGIN;

create table if not exists public.merchant_ai_capabilities (
  -- The Solana wallet that owns the merchant session. One row per merchant.
  merchant_address text primary key,

  -- Capability switches, not payment authorizations. Shape matches the service:
  -- `not null` plus a default means "row present" and "row absent" both resolve
  -- to a complete, explicit answer.
  general_assistance boolean not null default true,
  agentic_payments boolean not null default false,
  agentic_payment_requests boolean not null default false,

  -- `updated_at` is written by the application on every upsert (there are no
  -- triggers in this schema). `created_at` is set once by the default.
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Wallet addresses are stored exactly as the session reports them: trimmed,
  -- non-empty, and in the base58 shape of a 32-byte Solana public key.
  constraint merchant_ai_capabilities_address_trimmed
    check (
      merchant_address = btrim(merchant_address)
      and length(merchant_address) > 0
    ),
  constraint merchant_ai_capabilities_address_base58
    check (merchant_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$')
);

-- Note: the constraints are declared inline, so they are applied when this
-- migration creates the table. Re-running is a no-op; a pre-existing table of
-- the same name is not re-validated by this script.

comment on table public.merchant_ai_capabilities is
  'Per-merchant AI capability switches. Service-role only; the merchant wallet is always taken from the validated session. A missing row means the documented defaults: general TRUE, agentic_payments FALSE, agentic_payment_requests FALSE.';

comment on column public.merchant_ai_capabilities.merchant_address is
  'Solana wallet address of the merchant, taken only from the authenticated merchant_auth session.';

comment on column public.merchant_ai_capabilities.general_assistance is
  'General merchant AI assistance (explanations, analytics questions, PayProof guidance). Default TRUE.';

comment on column public.merchant_ai_capabilities.agentic_payments is
  'Merchant-initiated outbound SOL payment intent preparation. Default FALSE; an unreadable capability state must deny this.';

comment on column public.merchant_ai_capabilities.agentic_payment_requests is
  'AI-assisted creation of incoming merchant payment requests. Default FALSE; an unreadable capability state must deny this.';

comment on column public.merchant_ai_capabilities.updated_at is
  'Set by the application on every upsert. The schema has no triggers.';

-- ---------------------------------------------------------------------------
-- Access control
-- ---------------------------------------------------------------------------
-- Settings must never be reachable from a browser, including with the
-- publishable anon key: a merchant could otherwise rewrite another merchant's
-- capabilities. RLS plus a deny-all policy means an accidentally permissive
-- policy added elsewhere still cannot expose these rows, and revoking the
-- client grants means a role cannot act through a policy at all.
--
-- No DELETE grant: the row is retained, matching agent_payment_intents.

alter table public.merchant_ai_capabilities enable row level security;

revoke all on table public.merchant_ai_capabilities from public;
revoke all on table public.merchant_ai_capabilities from anon;
revoke all on table public.merchant_ai_capabilities from authenticated;

grant select, insert, update on table public.merchant_ai_capabilities to service_role;

drop policy if exists "no client access to merchant ai capabilities"
  on public.merchant_ai_capabilities;

create policy "no client access to merchant ai capabilities"
  on public.merchant_ai_capabilities
  for all
  to anon, authenticated
  using (false)
  with check (false);

COMMIT;
