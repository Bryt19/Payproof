-- PayProof: merchant authentication rate limiting
-- Stage 4.1: counters, atomic consumption, and retention.
--
-- PREPARED ONLY. This migration has NOT been applied.
--
-- Adds:
--   1. public.auth_rate_limits
--   2. public.consume_auth_rate_limit(...)
--   3. public.purge_auth_rate_limits(...)
--   4. Optional hourly pg_cron retention schedule.
--
-- Safety:
--   * No table or existing row data is dropped, truncated, or rewritten.
--   * The only DELETE is inside the separately callable, bounded purge function.
--     This migration does not invoke that function.
--   * No existing payment, merchant-auth, or notification table is modified.
--   * Existing table columns and constraints are checked before use.
--   * Incompatible existing definitions cause an exception, not an automatic
--     replacement.
--   * RLS and browser-role grant revocations are applied immediately after
--     table creation.
--   * SECURITY DEFINER functions use a pinned search_path and qualified table
--     references.
--
-- Application compatibility:
--   src/lib/auth/rate-limit.ts calls consume_auth_rate_limit using:
--     p_bucket, p_key_hash, p_limit, p_window_seconds
--   Keep the function name, parameter names, and return columns unchanged
--   unless the application code is updated too.

-- ---------------------------------------------------------------------------
-- 1. Counter table
-- ---------------------------------------------------------------------------

create table if not exists public.auth_rate_limits (
  bucket        text        not null,
  key_hash      text        not null,
  window_start  timestamptz not null,
  hits          integer     not null default 0,
  created_at    timestamptz not null default now(),

  constraint auth_rate_limits_pkey
    primary key (bucket, key_hash, window_start),

  constraint auth_rate_limits_key_hash_is_hmac_sha256
    check (key_hash ~ '^[0-9a-f]{64}$'),

  constraint auth_rate_limits_bucket_present
    check (length(bucket) between 1 and 64),

  constraint auth_rate_limits_hits_non_negative
    check (hits >= 0)
);

-- ---------------------------------------------------------------------------
-- 2. Access control
-- ---------------------------------------------------------------------------

alter table public.auth_rate_limits enable row level security;

revoke all on table public.auth_rate_limits from public;
revoke all on table public.auth_rate_limits from anon;
revoke all on table public.auth_rate_limits from authenticated;

grant select, insert, update, delete
  on table public.auth_rate_limits
  to service_role;

-- Add a restrictive deny policy for browser roles. A restrictive policy
-- combines with permissive policies using AND, so another permissive policy
-- cannot accidentally expose these rows.
--
-- A separately named policy avoids dropping or replacing an existing policy.
-- If this policy already exists, its actual definition must be correct.

do $policy$
declare
  policy_exists boolean;
  policy_is_safe boolean;
begin
  select exists (
    select 1
      from pg_policy p
     where p.polrelid = 'public.auth_rate_limits'::regclass
       and p.polname = 'payproof_auth_rate_limits_deny_clients'
  )
  into policy_exists;

  if policy_exists then
    select exists (
      select 1
        from pg_policy p
       where p.polrelid = 'public.auth_rate_limits'::regclass
         and p.polname = 'payproof_auth_rate_limits_deny_clients'
         and p.polcmd = '*'
         and p.polpermissive = false
         and pg_get_expr(p.polqual, p.polrelid) = 'false'
         and pg_get_expr(p.polwithcheck, p.polrelid) = 'false'
         and (
           select oid from pg_roles where rolname = 'anon'
         ) = any(p.polroles)
         and (
           select oid from pg_roles where rolname = 'authenticated'
         ) = any(p.polroles)
    )
    into policy_is_safe;

    if not policy_is_safe then
      raise exception
        'Existing policy payproof_auth_rate_limits_deny_clients is not the required restrictive deny policy.'
        using hint =
          'Inspect the policy on public.auth_rate_limits and correct it manually. This migration will not drop or replace it.';
    end if;

    raise notice
      'Existing restrictive browser-deny policy is correct; left unchanged.';
  else
    create policy payproof_auth_rate_limits_deny_clients
      on public.auth_rate_limits
      as restrictive
      for all
      to anon, authenticated
      using (false)
      with check (false);

    raise notice 'Created restrictive browser-deny policy.';
  end if;
end
$policy$;

-- ---------------------------------------------------------------------------
-- 3. Supporting retention index
-- ---------------------------------------------------------------------------

create index if not exists auth_rate_limits_window_start
  on public.auth_rate_limits (window_start);

-- ---------------------------------------------------------------------------
-- 4. Existing-table reconciliation
-- ---------------------------------------------------------------------------
-- This section never changes existing column types or nullability.
-- Incompatible structures stop the migration and require manual review.

do $reconcile$
declare
  required_columns text[] :=
    array['bucket', 'key_hash', 'window_start', 'hits', 'created_at'];

  missing_columns text[];
  incompatible_columns text[];

  pk_columns text;
  conflicting_name text;
  duplicate_groups bigint;

  existing_definition text;
  existing_validated boolean;

  spec record;
begin
  -- 4a. Verify required columns exist.

  select coalesce(array_agg(required.column_name), '{}')
    into missing_columns
    from unnest(required_columns) as required(column_name)
   where not exists (
     select 1
       from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name = 'auth_rate_limits'
        and c.column_name = required.column_name
   );

  if cardinality(missing_columns) > 0 then
    raise exception
      'public.auth_rate_limits is missing required column(s): %.',
      array_to_string(missing_columns, ', ')
      using hint =
        'Inspect the existing table and add the missing columns manually. This migration does not invent or rewrite row data.';
  end if;

  -- 4b. Verify exact built-in PostgreSQL types and NOT NULL properties.
  --
  -- udt_name values:
  --   text        -> text
  --   timestamptz -> timestamp with time zone
  --   int4        -> integer

  select array_agg(
           format(
             '%s: expected %s NOT NULL; found %s, nullable=%s',
             expected.column_name,
             expected.expected_type,
             coalesce(c.udt_name, 'missing'),
             coalesce(c.is_nullable, 'unknown')
           )
           order by expected.column_name
         )
    into incompatible_columns
    from (
      values
        ('bucket',       'text'),
        ('key_hash',     'text'),
        ('window_start', 'timestamptz'),
        ('hits',         'int4'),
        ('created_at',   'timestamptz')
    ) as expected(column_name, expected_type)
    left join information_schema.columns c
      on c.table_schema = 'public'
     and c.table_name = 'auth_rate_limits'
     and c.column_name = expected.column_name
   where c.column_name is null
      or c.udt_schema <> 'pg_catalog'
      or c.udt_name <> expected.expected_type
      or c.is_nullable <> 'NO';

  if incompatible_columns is not null then
    raise exception
      'public.auth_rate_limits has incompatible column definitions: %.',
      array_to_string(incompatible_columns, '; ')
      using hint =
        'Review and correct the table manually. This migration will not alter column types, nullability, or existing row data.';
  end if;

  -- 4c. Verify the primary key has the required identity columns.

  select string_agg(a.attname, ',' order by k.ord)
    into pk_columns
    from pg_constraint c
    join unnest(c.conkey) with ordinality as k(attnum, ord)
      on true
    join pg_attribute a
      on a.attrelid = c.conrelid
     and a.attnum = k.attnum
   where c.conrelid = 'public.auth_rate_limits'::regclass
     and c.contype = 'p';

  if pk_columns is null then
    select conname
      into conflicting_name
      from pg_constraint
     where conrelid = 'public.auth_rate_limits'::regclass
       and conname = 'auth_rate_limits_pkey';

    if conflicting_name is not null then
      raise exception
        'Constraint auth_rate_limits_pkey exists but is not a primary key.'
        using hint =
          'Inspect the existing constraint and resolve it manually before rerunning this migration.';
    end if;

    if exists (
      select 1
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relname = 'auth_rate_limits_pkey'
         and c.relkind in ('i', 'I')
    ) then
      raise exception
        'An index named auth_rate_limits_pkey already exists but is not the required primary key.'
        using hint =
          'Inspect the existing index and resolve it manually before rerunning this migration.';
    end if;

    select count(*)
      into duplicate_groups
      from (
        select 1
          from public.auth_rate_limits
         group by bucket, key_hash, window_start
        having count(*) > 1
      ) duplicates;

    if duplicate_groups > 0 then
      raise exception
        'public.auth_rate_limits contains % duplicate counter identity group(s).',
        duplicate_groups
        using hint =
          'Resolve duplicate rows manually. This migration does not edit or delete existing rows.';
    end if;

    alter table public.auth_rate_limits
      add constraint auth_rate_limits_pkey
      primary key (bucket, key_hash, window_start);

    raise notice
      'Added the required primary key.';
  elsif pk_columns <> 'bucket,key_hash,window_start' then
    raise exception
      'public.auth_rate_limits has primary key (%), but requires (bucket, key_hash, window_start).',
      pk_columns
      using hint =
        'Review and correct the primary key manually. This migration will not replace it.';
  end if;

  -- 4d. Verify check constraints.
  --
  -- Deliberately use strict comparison against PostgreSQL's canonical
  -- pg_get_constraintdef output. No lowercasing or transformation of string
  -- literals is performed. A semantically equivalent but differently rendered
  -- expression may require manual review rather than being accepted here.

  for spec in
    select *
      from (
        values
          (
            'auth_rate_limits_key_hash_is_hmac_sha256',
            $expr$key_hash ~ '^[0-9a-f]{64}$'$expr$,
            $expr$CHECK ((key_hash ~ '^[0-9a-f]{64}$'::text))$expr$,
            'key_hash must be exactly 64 lowercase hexadecimal characters'
          ),
          (
            'auth_rate_limits_bucket_present',
            $expr$length(bucket) between 1 and 64$expr$,
            $expr$CHECK (((length(bucket) >= 1) AND (length(bucket) <= 64)))$expr$,
            'bucket length must be between 1 and 64 characters'
          ),
          (
            'auth_rate_limits_hits_non_negative',
            $expr$hits >= 0$expr$,
            $expr$CHECK ((hits >= 0))$expr$,
            'hits must be greater than or equal to zero'
          )
      ) as definitions(
        constraint_name,
        expression,
        expected_definition,
        expectation
      )
  loop
    select pg_get_constraintdef(c.oid), c.convalidated
      into existing_definition, existing_validated
      from pg_constraint c
     where c.conrelid = 'public.auth_rate_limits'::regclass
       and c.conname = spec.constraint_name;

    if existing_definition is not null then
      if existing_definition <> spec.expected_definition then
        raise exception
          'Constraint % has an unexpected definition. Found: %. Required: %.',
          spec.constraint_name,
          existing_definition,
          spec.expected_definition
          using hint =
            'Inspect the constraint manually. This migration will not drop, replace, or accept a potentially weaker definition.';
      end if;

      if not existing_validated then
        begin
          execute format(
            'alter table public.auth_rate_limits validate constraint %I',
            spec.constraint_name
          );
        exception
          when check_violation then
            raise exception
              'Existing rows violate constraint % (%): %.',
              spec.constraint_name,
              spec.expectation,
              sqlerrm
              using hint =
                'Inspect and correct offending rows manually. This migration does not rewrite or delete existing rows.';
        end;

        raise notice
          'Validated existing constraint %.',
          spec.constraint_name;
      else
        raise notice
          'Existing constraint % is exact and validated; left unchanged.',
          spec.constraint_name;
      end if;

      continue;
    end if;

    execute format(
      'alter table public.auth_rate_limits add constraint %I check (%s) not valid',
      spec.constraint_name,
      spec.expression
    );

    begin
      execute format(
        'alter table public.auth_rate_limits validate constraint %I',
        spec.constraint_name
      );
    exception
      when check_violation then
        raise exception
          'Existing rows violate constraint % (%): %.',
          spec.constraint_name,
          spec.expectation,
          sqlerrm
          using hint =
            'Inspect and correct offending rows manually. This migration does not rewrite or delete existing rows.';
    end;

    raise notice
      'Added and validated constraint %.',
      spec.constraint_name;
  end loop;
end
$reconcile$;

-- Restore documented defaults. SET DEFAULT changes metadata and does not
-- rewrite existing rows.

alter table public.auth_rate_limits
  alter column hits set default 0;

alter table public.auth_rate_limits
  alter column created_at set default now();

-- ---------------------------------------------------------------------------
-- 5. Table and column documentation
-- ---------------------------------------------------------------------------

comment on table public.auth_rate_limits is
  'Fixed-window authentication rate-limit counters. Server-side access only; keys are HMAC digests, never raw IPs or wallet addresses.';

comment on column public.auth_rate_limits.key_hash is
  'HMAC-SHA256 hexadecimal digest of the client identity within its bucket, peppered server-side.';

comment on column public.auth_rate_limits.window_start is
  'Fixed-window start timestamp aligned to the Unix epoch by the consumer function.';

-- ---------------------------------------------------------------------------
-- 6. Atomic counter update and decision
-- ---------------------------------------------------------------------------
--
-- One atomic INSERT ... ON CONFLICT DO UPDATE statement serializes concurrent
-- increments for the same primary key.
--
-- The counter is clamped at p_limit + 1. The expression uses
-- least(existing_hits, p_limit) + 1 to avoid integer overflow even if an
-- unexpected pre-existing counter value is very large.
--
-- now() is transaction-stable. Each PostgREST RPC call is its own transaction.

create or replace function public.consume_auth_rate_limit(
  p_bucket          text,
  p_key_hash        text,
  p_limit           integer,
  p_window_seconds  integer
)
returns table (
  allowed boolean,
  retry_after_seconds integer
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_now          timestamptz := now();
  v_window_start timestamptz;
  v_hits         integer;
begin
  if p_bucket is null
     or length(p_bucket) < 1
     or length(p_bucket) > 64 then
    raise exception 'consume_auth_rate_limit: invalid bucket';
  end if;

  if p_key_hash is null
     or p_key_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'consume_auth_rate_limit: invalid key hash';
  end if;

  if p_limit is null
     or p_limit < 1
     or p_limit > 1000000 then
    raise exception 'consume_auth_rate_limit: invalid limit';
  end if;

  if p_window_seconds is null
     or p_window_seconds < 1
     or p_window_seconds > 86400 then
    raise exception 'consume_auth_rate_limit: invalid window';
  end if;

  v_window_start := to_timestamp(
    (
      floor(
        extract(epoch from v_now) / p_window_seconds
      ) * p_window_seconds
    )::double precision
  );

  insert into public.auth_rate_limits as counters (
    bucket,
    key_hash,
    window_start,
    hits
  )
  values (
    p_bucket,
    p_key_hash,
    v_window_start,
    1
  )
  on conflict (bucket, key_hash, window_start)
  do update
     set hits = least(counters.hits, p_limit) + 1
  returning counters.hits into v_hits;

  allowed := v_hits <= p_limit;

  if allowed then
    retry_after_seconds := 0;
  else
    retry_after_seconds := greatest(
      1,
      ceil(
        extract(
          epoch from (
            v_window_start
            + make_interval(secs => p_window_seconds)
            - v_now
          )
        )
      )
    )::integer;
  end if;

  return next;
end;
$fn$;

comment on function public.consume_auth_rate_limit(
  text, text, integer, integer
) is
  'Atomically increments a fixed-window authentication counter and returns whether the request is allowed.';

revoke all on function public.consume_auth_rate_limit(
  text, text, integer, integer
) from public;

revoke all on function public.consume_auth_rate_limit(
  text, text, integer, integer
) from anon;

revoke all on function public.consume_auth_rate_limit(
  text, text, integer, integer
) from authenticated;

grant execute on function public.consume_auth_rate_limit(
  text, text, integer, integer
) to service_role;

-- ---------------------------------------------------------------------------
-- 7. Bounded retention
-- ---------------------------------------------------------------------------
--
-- This function is not called by the authentication request path.
-- It removes at most p_max_rows counters older than 24 hours per invocation.

create or replace function public.purge_auth_rate_limits(
  p_max_rows integer default 5000
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_retention constant interval := interval '24 hours';
  v_deleted integer := 0;
begin
  if p_max_rows is null
     or p_max_rows < 1
     or p_max_rows > 100000 then
    raise exception
      'purge_auth_rate_limits: p_max_rows must be between 1 and 100000';
  end if;

  delete from public.auth_rate_limits
   where ctid in (
     select candidate.ctid
       from public.auth_rate_limits as candidate
      where candidate.window_start < now() - v_retention
      order by candidate.window_start
      limit p_max_rows
   );

  get diagnostics v_deleted = row_count;

  return v_deleted;
end;
$fn$;

comment on function public.purge_auth_rate_limits(integer) is
  'Deletes at most p_max_rows authentication counter rows older than 24 hours.';

revoke all on function public.purge_auth_rate_limits(integer)
  from public;

revoke all on function public.purge_auth_rate_limits(integer)
  from anon;

revoke all on function public.purge_auth_rate_limits(integer)
  from authenticated;

grant execute on function public.purge_auth_rate_limits(integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- 8. Optional hourly pg_cron schedule
-- ---------------------------------------------------------------------------
--
-- This block does not create or enable pg_cron.
--
-- If pg_cron is already enabled:
--   * create the job if it does not exist;
--   * leave an identical job untouched;
--   * update a different existing job only if cron.alter_job is available;
--   * otherwise report a NOTICE and leave the existing job untouched.
--
-- Any cron setup error is reported as a NOTICE. It does not undo the completed
-- table/function setup.

do $cron$
declare
  v_job_id bigint;
  v_schedule text := '17 * * * *';
  v_command text := 'select public.purge_auth_rate_limits();';
  v_existing_schedule text;
  v_existing_command text;
begin
  if to_regprocedure('cron.schedule(text, text, text)') is null then
    raise notice
      'pg_cron is not enabled. No automatic retention job was created. Run public.purge_auth_rate_limits() hourly from an external scheduler.';
    return;
  end if;

  select jobid, schedule, command
    into v_job_id, v_existing_schedule, v_existing_command
    from cron.job
   where jobname = 'payproof-auth-rate-limit-purge'
   order by jobid
   limit 1;

  if v_job_id is null then
    perform cron.schedule(
      'payproof-auth-rate-limit-purge',
      v_schedule,
      v_command
    );

    raise notice
      'Scheduled payproof-auth-rate-limit-purge hourly at minute 17.';
    return;
  end if;

  if v_existing_command = v_command
     and v_existing_schedule = v_schedule then
    raise notice
      'payproof-auth-rate-limit-purge already has the expected schedule; unchanged.';
    return;
  end if;

  if to_regprocedure(
    'cron.alter_job(bigint, text, text, text, text, boolean)'
  ) is not null then
    perform cron.alter_job(
      v_job_id,
      v_schedule,
      v_command,
      null::text,
      null::text,
      null::boolean
    );

    raise notice
      'Updated payproof-auth-rate-limit-purge to the expected hourly schedule.';
  else
    raise notice
      'A job with this name exists but cron.alter_job is unavailable. Review and update the job manually.';
  end if;
exception
  when others then
    raise notice
      'Could not configure automatic retention (%). Configure an hourly scheduler to run public.purge_auth_rate_limits().',
      sqlerrm;
end;
$cron$;
