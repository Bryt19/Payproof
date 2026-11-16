-- PayProof: merchant wallet-signature authentication — final schema.
--
-- Source of truth: src/lib/auth/merchant-auth-service.ts. Every column and every
-- predicate below maps to a query that service actually issues:
--
--   createChallenge    insert(challenge_nonce, domain, issued_at, expires_at,
--                             wallet_address)
--   consumeChallenge   select(eq challenge_nonce, is session_token null,
--                             is deleted_at null, gte expires_at)
--                      update(set session_token, session_expires_at)
--                             .eq(id).is(session_token null).is(deleted_at null)
--   validateSession    select(eq session_token, is deleted_at null)
--   invalidateSession  update(set deleted_at)
--                             .eq(session_token).is(deleted_at null)
--
-- Raw session tokens never reach the database: `session_token` holds the
-- lowercase SHA-256 hex digest produced by hashSessionToken(), and the raw token
-- only ever lives in the HttpOnly `pp_merchant_session` cookie.
--
-- Safety contract of this file:
--   * no DROP TABLE, no DELETE, no UPDATE, no rewriting of existing rows;
--   * safe on a fresh database (creates the complete table, indexes, policies);
--   * safe to re-run (every statement is guarded or naturally idempotent);
--   * an existing table is validated, not assumed: missing optional columns are
--     added, but anything that would weaken authentication is a hard error;
--   * the migration NEVER reports success while a required column is nullable,
--     while required uniqueness is missing, or while `id` is unusable. Those
--     cases raise an exception with the manual remediation required.
--
-- If any check raises, the script aborts and you must not enable merchant login
-- until it is resolved. Run it as one script: the Supabase SQL editor sends pasted
-- contents in a single transaction, so nothing is half-applied. If your tool
-- applies statements individually, the access-control block is deliberately first
-- so an aborted run can never leave the table readable by a browser role.
--
-- Apply manually in the Supabase SQL editor, or via `supabase db push` once the
-- project is linked. Nothing here touches payment_requests, notifications or any
-- other table.

-- ---------------------------------------------------------------------------
-- Session-local helper: compare constraint/index definitions ignoring the
-- formatting PostgreSQL adds (schema qualification, casts, parentheses,
-- whitespace, keyword case).
-- ---------------------------------------------------------------------------

create or replace function pg_temp.normalize_sql_definition(input text)
returns text
language sql
immutable
as $$
  select regexp_replace(
           regexp_replace(
             regexp_replace(
               regexp_replace(lower(coalesce(input, '')), '::[a-z_]+', '', 'g'),
               'public\.', '', 'g'
             ),
             'using[[:space:]]*[a-z]+', '', 'g'
           ),
           '[\s()"]', '', 'g'
         );
$$;

-- ---------------------------------------------------------------------------
-- Table (fresh database)
-- ---------------------------------------------------------------------------

create table if not exists merchant_auth (
  id                  uuid primary key default gen_random_uuid(),

  -- Challenge, issued by createChallenge().
  challenge_nonce     text not null,          -- 32 random bytes, base64url, server-generated
  domain              text not null,          -- NEXT_PUBLIC_WALLET_SIGN_DOMAIN at issue time
  issued_at           timestamptz not null default now(),
  expires_at          timestamptz not null,   -- issued_at + 5 minutes

  -- Session, written once when the challenge is redeemed.
  session_token       text,                   -- sha256 hex of the cookie token, never the token
  session_expires_at  timestamptz,            -- session issue time + 15 minutes

  -- Wallet that requested the challenge and owns the resulting session.
  wallet_address      text not null,

  -- Lifecycle.
  created_at          timestamptz not null default now(),
  deleted_at          timestamptz,            -- logout / revocation marker

  -- A challenge is identified by its nonce; a session by its token hash.
  -- Both stay unique across deleted rows so a nonce can never be replayed.
  constraint merchant_auth_challenge_nonce_key unique (challenge_nonce),
  constraint merchant_auth_session_token_key unique (session_token),

  constraint merchant_auth_expiry_after_issue
    check (expires_at > issued_at),
  constraint merchant_auth_session_token_is_sha256_hex
    check (session_token is null or session_token ~ '^[0-9a-f]{64}$'),
  constraint merchant_auth_session_requires_expiry
    check (session_token is null or session_expires_at is not null),
  constraint merchant_auth_wallet_address_trimmed
    check (wallet_address = btrim(wallet_address) and length(wallet_address) > 0),
  constraint merchant_auth_challenge_fields_present
    check (length(challenge_nonce) > 0 and length(domain) > 0)
);

-- ---------------------------------------------------------------------------
-- Access control (applied first, before anything that can fail)
-- ---------------------------------------------------------------------------
-- Auth records must never be reachable from a browser, including with the
-- publishable anon key. Enabling RLS and stripping client grants before the
-- validation steps means a run that aborts part-way can never leave a freshly
-- created table exposed. Revoking the grants also means an accidentally
-- permissive policy added elsewhere cannot expose these rows. Unlike
-- notifications, no wallet-claim policy is used: this table is what proves
-- wallet ownership, so it must not authorize itself.

alter table merchant_auth enable row level security;

revoke all on table merchant_auth from public;
revoke all on table merchant_auth from anon;
revoke all on table merchant_auth from authenticated;

grant select, insert, update, delete on table merchant_auth to service_role;

drop policy if exists "no client access to auth records" on merchant_auth;

create policy "no client access to auth records"
  on merchant_auth for all
  to anon, authenticated
  using (false)
  with check (false);

-- ---------------------------------------------------------------------------
-- 1. Columns: presence and type
-- ---------------------------------------------------------------------------
-- An existing table must have the columns the service selects and updates, with
-- the types the service sends. Missing optional session columns are added (they
-- are nullable by design). A missing required column is added only when the
-- table is empty; with rows present the migration stops, because inventing a
-- backfill value is a data decision, not a schema decision.

do $$
declare
  expected record;
  actual_type text;
  row_count bigint;
begin
  select count(*) into row_count from merchant_auth;

  for expected in
    select * from (values
      ('id',                 'uuid',                     true),
      ('challenge_nonce',    'text',                     true),
      ('domain',             'text',                     true),
      ('issued_at',          'timestamp with time zone', true),
      ('expires_at',         'timestamp with time zone', true),
      ('wallet_address',     'text',                     true),
      ('created_at',         'timestamp with time zone', true),
      ('session_token',      'text',                     false),
      ('session_expires_at', 'timestamp with time zone', false),
      ('deleted_at',         'timestamp with time zone', false)
    ) as t(column_name, data_type, is_required)
  loop
    select c.data_type
      into actual_type
      from information_schema.columns c
     where c.table_schema = 'public'
       and c.table_name = 'merchant_auth'
       and c.column_name = expected.column_name;

    if actual_type is null then
      -- `id` is never added automatically: atomic redemption updates one row by
      -- id, so identifiers must be chosen deliberately, not invented here.
      if expected.column_name = 'id' then
        raise exception
          'merchant_auth exists without the required UUID column "id".'
          using hint = 'Merchant auth redeems a challenge with "update ... where id = $1", so a usable key is mandatory. '
                       'Remediate manually, then re-run: alter table merchant_auth add column id uuid; '
                       'populate one unique value per row; alter column id set not null; add a primary key (id). '
                       'This migration never invents identifiers or edits rows.';
      end if;

      if expected.is_required and row_count > 0 then
        raise exception
          'merchant_auth is missing required column "%" and already holds % row(s).',
          expected.column_name, row_count
          using hint = format(
            'Add it yourself with a backfill value you choose, then re-run this migration: '
            'alter table merchant_auth add column %I %s; update merchant_auth set %I = <value>; '
            'This migration never edits rows.',
            expected.column_name, expected.data_type, expected.column_name
          );
      end if;

      execute format(
        'alter table merchant_auth add column %I %s',
        expected.column_name, expected.data_type
      );
      raise notice 'merchant_auth: added missing column "%" (%).', expected.column_name, expected.data_type;
    elsif actual_type <> expected.data_type then
      raise exception
        'merchant_auth.% has type "%", but the auth service requires "%".',
        expected.column_name, actual_type, expected.data_type
        using hint = 'Alter the column type manually after reviewing existing data, then re-run this migration.';
    end if;
  end loop;
end $$;

-- Defaults required by the service: it never supplies id, issued_at or created_at.
alter table merchant_auth alter column id set default gen_random_uuid();
alter table merchant_auth alter column issued_at set default now();
alter table merchant_auth alter column created_at set default now();

-- ---------------------------------------------------------------------------
-- 2. NOT NULL on every required column (blocking)
-- ---------------------------------------------------------------------------
-- A nullable required column is unsafe: CHECK constraints evaluate to NULL for
-- NULL input and therefore pass. If existing rows contain NULLs, the migration
-- stops instead of leaving the column nullable, and never rewrites the rows.

do $$
declare
  required_columns text[] := array[
    'id', 'challenge_nonce', 'domain', 'issued_at', 'expires_at', 'wallet_address', 'created_at'
  ];
  target_column text;
  null_rows bigint;
  blocked text[] := '{}';
  still_nullable text[] := '{}';
begin
  foreach target_column in array required_columns
  loop
    execute format('select count(*) from merchant_auth where %I is null', target_column)
      into null_rows;

    if null_rows > 0 then
      blocked := blocked || format('%s (%s rows)', target_column, null_rows);
    else
      execute format('alter table merchant_auth alter column %I set not null', target_column);
    end if;
  end loop;

  if array_length(blocked, 1) is not null then
    raise exception
      'merchant_auth has NULLs in required columns: %. NOT NULL cannot be enforced.',
      array_to_string(blocked, ', ')
      using hint = 'Backfill these columns yourself with values you choose, then re-run. '
                   'This migration never edits rows. Until then merchant login must not be enabled.';
  end if;

  -- Defence in depth: never report success while a required column is nullable.
  foreach target_column in array required_columns
  loop
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'merchant_auth'
        and column_name = target_column
        and is_nullable = 'YES'
    ) then
      still_nullable := still_nullable || target_column;
    end if;
  end loop;

  if array_length(still_nullable, 1) is not null then
    raise exception
      'merchant_auth required columns are still nullable after repair: %.',
      array_to_string(still_nullable, ', ')
      using hint = 'Investigate column privileges/ownership: the migration must be run by a role allowed to alter this table.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. `id` must be a usable key (blocking)
-- ---------------------------------------------------------------------------
-- Concurrent redemption relies on `update ... where id = $1`: `id` must be a
-- UUID and must be the sole key, otherwise two rows could answer one update.

do $$
declare
  primary_key_columns text;
  duplicate_ids bigint;
  conflicting_constraint text;
begin
  select string_agg(a.attname, ',' order by k.ord)
    into primary_key_columns
    from pg_constraint c
    join unnest(c.conkey) with ordinality as k(attnum, ord) on true
    join pg_attribute a
      on a.attrelid = c.conrelid
     and a.attnum = k.attnum
   where c.conrelid = 'merchant_auth'::regclass
     and c.contype = 'p';

  if primary_key_columns = 'id' then
    return;
  end if;

  if primary_key_columns is not null then
    raise exception
      'merchant_auth primary key is (%), but merchant auth requires the UUID column "id" to be the primary key.',
      primary_key_columns
      using hint = 'Drop and recreate the primary key manually so it covers (id) only, then re-run this migration.';
  end if;

  select conname
    into conflicting_constraint
    from pg_constraint
   where conrelid = 'merchant_auth'::regclass
     and conname = 'merchant_auth_pkey';

  if conflicting_constraint is not null then
    raise exception
      'Constraint "merchant_auth_pkey" already exists on merchant_auth but is not the primary key.'
      using hint = 'Inspect it with \d merchant_auth, rename or drop it manually if it is wrong, then re-run.';
  end if;

  select count(*)
    into duplicate_ids
    from (select id from merchant_auth group by id having count(*) > 1) duplicates;

  if duplicate_ids > 0 then
    raise exception
      'merchant_auth.id is not unique (% duplicate group(s)). Challenge redemption updates a single row by id and would be ambiguous.',
      duplicate_ids
      using hint = 'Resolve duplicate ids manually (this migration does not modify rows), then re-run.';
  end if;

  alter table merchant_auth add constraint merchant_auth_pkey primary key (id);
  raise notice 'merchant_auth: added primary key (id).';
end $$;

-- ---------------------------------------------------------------------------
-- 4. Required uniqueness (blocking)
-- ---------------------------------------------------------------------------
-- A nonce may only be redeemed once and a session token hash may only identify
-- one row. An existing constraint is accepted only when its definition matches;
-- a same-named constraint with a different definition stops the migration.
-- Multiple NULL session_token values remain valid (unredeemed challenges).

do $$
declare
  spec record;
  existing_definition text;
  duplicate_groups bigint;
  conflicting_index boolean;
begin
  for spec in
    select * from (values
      ('merchant_auth_challenge_nonce_key', 'challenge_nonce', 'UNIQUE (challenge_nonce)'),
      ('merchant_auth_session_token_key',   'session_token',   'UNIQUE (session_token)')
    ) as t(constraint_name, column_name, expected_definition)
  loop
    select pg_get_constraintdef(c.oid)
      into existing_definition
      from pg_constraint c
     where c.conrelid = 'merchant_auth'::regclass
       and c.conname = spec.constraint_name;

    if existing_definition is not null then
      if pg_temp.normalize_sql_definition(existing_definition)
         <> pg_temp.normalize_sql_definition(spec.expected_definition) then
        raise exception
          'Constraint % exists with an unexpected definition: %. Required: %.',
          spec.constraint_name, existing_definition, spec.expected_definition
          using hint = 'Drop the conflicting constraint manually and re-run; merchant auth must not run without the required uniqueness.';
      end if;

      continue;
    end if;

    select exists (
      select 1
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relname = spec.constraint_name
         and c.relkind = 'i'
    ) into conflicting_index;

    if conflicting_index then
      raise exception
        'An index named % already exists but is not the required unique constraint on (%).',
        spec.constraint_name, spec.column_name
        using hint = 'Inspect it with \d merchant_auth; drop it manually if it is wrong, then re-run.';
    end if;

    execute format(
      'select count(*) from (select %I from merchant_auth where %I is not null group by %I having count(*) > 1) duplicates',
      spec.column_name, spec.column_name, spec.column_name
    ) into duplicate_groups;

    if duplicate_groups > 0 then
      raise exception
        'merchant_auth.% contains duplicate values (% duplicate group(s)); uniqueness cannot be established.',
        spec.column_name, duplicate_groups
        using hint = 'Resolve the duplicates manually (this migration never edits rows), then re-run. '
                     'Without this constraint a challenge could be redeemed twice or a session matched to several rows.';
    end if;

    execute format(
      'alter table merchant_auth add constraint %I unique (%I)',
      spec.constraint_name, spec.column_name
    );
    raise notice 'merchant_auth: added unique constraint % on (%).', spec.constraint_name, spec.column_name;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Check constraints (blocking)
-- ---------------------------------------------------------------------------
-- Same rule: an existing constraint is accepted only if its definition matches.
-- Missing constraints are added and then validated; if existing rows violate a
-- rule, the migration stops with an explanation instead of leaving bad data in
-- place or silently flagging the constraint NOT VALID.

do $$
declare
  spec record;
  existing_definition text;
  existing_validated boolean;
begin
  for spec in
    select * from (values
      (
        'merchant_auth_expiry_after_issue',
        'expires_at > issued_at',
        'challenge expiry must be after its issue time',
        'CHECK (expires_at > issued_at)'
      ),
      (
        'merchant_auth_session_token_is_sha256_hex',
        'session_token is null or session_token ~ ''^[0-9a-f]{64}$''',
        'session_token must be NULL or a lowercase SHA-256 hex digest',
        'CHECK (session_token IS NULL OR session_token ~ ''^[0-9a-f]{64}$'')'
      ),
      (
        'merchant_auth_session_requires_expiry',
        'session_token is null or session_expires_at is not null',
        'a session must always carry an expiry',
        'CHECK (session_token IS NULL OR session_expires_at IS NOT NULL)'
      ),
      (
        'merchant_auth_wallet_address_trimmed',
        'wallet_address = btrim(wallet_address) and length(wallet_address) > 0',
        'wallet_address must be trimmed and non-empty',
        'CHECK (wallet_address = btrim(wallet_address) AND length(wallet_address) > 0)'
      ),
      (
        'merchant_auth_challenge_fields_present',
        'length(challenge_nonce) > 0 and length(domain) > 0',
        'challenge nonce and domain must be non-empty',
        'CHECK (length(challenge_nonce) > 0 AND length(domain) > 0)'
      )
    ) as t(constraint_name, expression, expectation, expected_definition)
  loop
    select pg_get_constraintdef(c.oid), c.convalidated
      into existing_definition, existing_validated
      from pg_constraint c
     where c.conrelid = 'merchant_auth'::regclass
       and c.conname = spec.constraint_name;

    if existing_definition is not null then
      if pg_temp.normalize_sql_definition(existing_definition)
         <> pg_temp.normalize_sql_definition(spec.expected_definition) then
        raise exception
          'Constraint % exists with an unexpected definition: %. Required: %.',
          spec.constraint_name, existing_definition, spec.expected_definition
          using hint = 'Drop the conflicting constraint manually and re-run; merchant auth depends on this rule.';
      end if;

      -- A matching but unvalidated constraint only guards new writes; validate it
      -- so existing rows are proven to obey the rule too.
      if not existing_validated then
        begin
          execute format('alter table merchant_auth validate constraint %I', spec.constraint_name);
        exception
          when check_violation then
            raise exception
              'Existing rows violate constraint % (%): %.',
              spec.constraint_name, spec.expectation, sqlerrm
              using hint = 'Correct the offending rows manually (this migration never edits rows), then re-run. '
                           'Until then merchant login must not be enabled.';
        end;

        raise notice 'merchant_auth: validated pre-existing constraint %.', spec.constraint_name;
      end if;

      continue;
    end if;

    execute format(
      'alter table merchant_auth add constraint %I check (%s) not valid',
      spec.constraint_name, spec.expression
    );

    begin
      execute format('alter table merchant_auth validate constraint %I', spec.constraint_name);
    exception
      when check_violation then
        raise exception
          'Existing rows violate constraint % (%): %.',
          spec.constraint_name, spec.expectation, sqlerrm
          using hint = 'Correct the offending rows manually (this migration never edits rows), then re-run. '
                       'Until then merchant login must not be enabled.';
    end;

    raise notice 'merchant_auth: added and validated constraint %.', spec.constraint_name;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Indexes (blocking when a same-named index has a different definition)
-- ---------------------------------------------------------------------------
-- Challenge and session equality lookups use the unique indexes backing the two
-- constraints above. The partial indexes below serve expiry cleanup and
-- wallet-scoped session queries; every predicate is immutable (no now()).

do $$
declare
  spec record;
  existing_definition text;
  index_is_valid boolean;
begin
  for spec in
    select * from (values
      (
        'merchant_auth_open_challenges_expires_at',
        'CREATE INDEX merchant_auth_open_challenges_expires_at ON merchant_auth USING btree (expires_at) '
        'WHERE (session_token IS NULL AND deleted_at IS NULL)'
      ),
      (
        'merchant_auth_active_sessions_expires_at',
        'CREATE INDEX merchant_auth_active_sessions_expires_at ON merchant_auth USING btree (session_expires_at) '
        'WHERE (session_token IS NOT NULL AND deleted_at IS NULL)'
      ),
      (
        'merchant_auth_wallet_sessions',
        'CREATE INDEX merchant_auth_wallet_sessions ON merchant_auth USING btree (wallet_address, session_expires_at DESC) '
        'WHERE (session_token IS NOT NULL AND deleted_at IS NULL)'
      )
    ) as t(index_name, expected_definition)
  loop
    select pg_get_indexdef(c.oid), i.indisvalid
      into existing_definition, index_is_valid
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_index i on i.indexrelid = c.oid
     where n.nspname = 'public'
       and c.relname = spec.index_name
       and c.relkind = 'i';

    if existing_definition is null then
      execute spec.expected_definition;
      raise notice 'merchant_auth: created index %.', spec.index_name;
    elsif not index_is_valid then
      raise exception
        'Index % exists but is marked invalid by PostgreSQL (a previous CREATE INDEX CONCURRENTLY likely failed).',
        spec.index_name
        using hint = 'Drop and recreate that index manually, then re-run this migration.';
    elsif pg_temp.normalize_sql_definition(existing_definition)
          <> pg_temp.normalize_sql_definition(spec.expected_definition) then
      raise exception
        'Index % exists with an unexpected definition: %. Required: %.',
        spec.index_name, existing_definition, spec.expected_definition
        using hint = 'Drop or rename the conflicting index manually, then re-run. Auth lookups and expiry cleanup rely on this shape.';
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Documentation
-- ---------------------------------------------------------------------------
-- Access control was applied right after CREATE TABLE (section above) so that an
-- aborted run can never leave the table readable by a browser role.

comment on table merchant_auth is
  'Short-lived merchant auth challenges and the sessions they produce. Service-role only.';
comment on column merchant_auth.challenge_nonce is
  'Server-generated single-use nonce embedded in the signed challenge message.';
comment on column merchant_auth.domain is
  'Application origin the challenge was issued for; must match on redemption.';
comment on column merchant_auth.wallet_address is
  'Base58 Solana address that requested the challenge and owns the session.';
comment on column merchant_auth.session_token is
  'SHA-256 hex digest of the session token. The raw token exists only in the HttpOnly cookie.';
comment on column merchant_auth.session_expires_at is
  'Session expiry; validation rejects rows past this timestamp.';
comment on column merchant_auth.deleted_at is
  'Set on logout. Deleted rows are excluded from every service query.';
