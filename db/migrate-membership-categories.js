// db/migrate-membership-categories.js
// General (GM) and Associate (AM) memberships, renewals and upgrades.
//
// Adds (never removes or rewrites existing data):
//   - membership_applications: membership_type CHECK (lifetime | general |
//     associate) and the student / payment / start-date columns
//   - membership_fee_settings: a "general" fee and an is_annual flag
//   - members: one row per member, the source of truth for the Member
//     Directory, renewals and upgrades
//   - renewal_requests, renewal_tokens, reminder_log,
//     retired_membership_numbers, membership_settings
// and backfills members from the existing approved applications and the
// legacy lifetime roll. The old tables are left exactly as they are.
//
// Safe to run more than once: the backfill only adds members that aren't
// there yet (matched on application_id / legacy_member_id), so running it
// again after the new backend is deployed picks up anything approved in
// between.
//
// Dry run (default): does everything inside a transaction, prints what it
// would do, then rolls back.
//   node db/migrate-membership-categories.js
// Apply:
//   node db/migrate-membership-categories.js --apply

const pool = require('./pool');

const APPLY = process.argv.includes('--apply');

const SCHEMA_SQL = `
  -- membership_applications --------------------------------------------
  ALTER TABLE public.membership_applications
    DROP CONSTRAINT IF EXISTS membership_applications_membership_type_check;
  ALTER TABLE public.membership_applications
    ADD CONSTRAINT membership_applications_membership_type_check
    CHECK (membership_type::text = ANY (ARRAY['lifetime', 'general', 'associate']::text[]));

  ALTER TABLE public.membership_applications
    ADD COLUMN IF NOT EXISTS student_number character varying(100),
    ADD COLUMN IF NOT EXISTS institute_registration_date date,
    ADD COLUMN IF NOT EXISTS payment_amount numeric(10,2),
    ADD COLUMN IF NOT EXISTS joined_on date;

  -- membership_fee_settings --------------------------------------------
  ALTER TABLE public.membership_fee_settings
    DROP CONSTRAINT IF EXISTS membership_fee_settings_key_check;
  ALTER TABLE public.membership_fee_settings
    ADD CONSTRAINT membership_fee_settings_key_check
    CHECK (key = ANY (ARRAY['associate', 'lifetime', 'general', 'upgrade']::text[]));

  ALTER TABLE public.membership_fee_settings
    ADD COLUMN IF NOT EXISTS is_annual boolean NOT NULL DEFAULT false;

  INSERT INTO public.membership_fee_settings (key, label, amount, is_tba, is_annual)
  VALUES ('general', 'General Member Fee (LKR)', 1200, false, true)
  ON CONFLICT (key) DO NOTHING;

  UPDATE public.membership_fee_settings
     SET is_annual = (key IN ('associate', 'general'))
   WHERE is_annual IS DISTINCT FROM (key IN ('associate', 'general'));

  -- members --------------------------------------------------------------
  CREATE TABLE IF NOT EXISTS public.members
  (
      id bigserial NOT NULL,
      membership_number character varying(50) NOT NULL,
      category character varying(2) NOT NULL,
      full_name character varying(255) NOT NULL,
      name_with_initials character varying(255),
      title character varying(20),
      nic_number character varying(20),
      date_of_birth date,
      sex character varying(10),
      marital_status character varying(30),
      permanent_address text,
      current_working_place character varying(255),
      official_address text,
      mobile_number character varying(30),
      whatsapp_number character varying(30),
      residential_number character varying(30),
      office_number character varying(30),
      email_address character varying(255),
      slnc_registration_number character varying(100),
      slnc_registration_date date,
      designation character varying(255),
      first_appointment_date date,
      first_appointment_place character varying(255),
      nursing_school character varying(255),
      batch character varying(100),
      higher_educational_qualification text,
      student_number character varying(100),
      institute_registration_date date,
      joined_on date,
      category_since date,
      valid_until date,
      is_active boolean NOT NULL DEFAULT true,
      deactivated_at timestamp with time zone,
      deactivated_by bigint,
      deactivated_reason text,
      source character varying(12) NOT NULL,
      application_id bigint,
      legacy_member_id bigint,
      admin_note text,
      created_at timestamp with time zone NOT NULL DEFAULT now(),
      updated_at timestamp with time zone NOT NULL DEFAULT now(),
      CONSTRAINT members_pkey PRIMARY KEY (id),
      CONSTRAINT members_membership_number_key UNIQUE (membership_number),
      CONSTRAINT members_application_id_key UNIQUE (application_id),
      CONSTRAINT members_legacy_member_id_key UNIQUE (legacy_member_id),
      CONSTRAINT members_application_id_fkey FOREIGN KEY (application_id)
          REFERENCES public.membership_applications (id) ON DELETE SET NULL,
      CONSTRAINT members_legacy_member_id_fkey FOREIGN KEY (legacy_member_id)
          REFERENCES public.legacy_lifetime_members (id) ON DELETE SET NULL,
      CONSTRAINT members_category_check CHECK (category::text = ANY (ARRAY['LT', 'GM', 'AM']::text[])),
      CONSTRAINT members_source_check CHECK (source::text = ANY (ARRAY['application', 'manual', 'legacy']::text[])),
      CONSTRAINT members_sex_check CHECK (sex IS NULL OR sex::text = ANY (ARRAY['Male', 'Female']::text[])),
      -- Lifetime members, and only they, have no expiry date.
      CONSTRAINT members_valid_until_check CHECK ((category = 'LT') = (valid_until IS NULL))
  );

  CREATE INDEX IF NOT EXISTS idx_members_category ON public.members (category);
  CREATE INDEX IF NOT EXISTS idx_members_valid_until ON public.members (valid_until);
  CREATE INDEX IF NOT EXISTS idx_members_nic ON public.members (upper(replace(nic_number, ' ', '')));

  -- renewal_requests -----------------------------------------------------
  CREATE TABLE IF NOT EXISTS public.renewal_requests
  (
      id bigserial NOT NULL,
      member_id bigint NOT NULL,
      kind character varying(10) NOT NULL,
      from_category character varying(2) NOT NULL,
      to_category character varying(2) NOT NULL,
      amount numeric(10,2) NOT NULL DEFAULT 0,
      discount_amount numeric(10,2) NOT NULL DEFAULT 0,
      payment_date date,
      payment_reference character varying(100),
      receipt_key character varying(500),
      receipt_original_name character varying(255),
      status character varying(10) NOT NULL DEFAULT 'pending',
      status_note text,
      email_address character varying(255),
      mobile_number character varying(30),
      current_working_place character varying(255),
      previous_valid_until date,
      new_valid_until date,
      previous_membership_number character varying(50),
      new_membership_number character varying(50),
      recorded_by_admin boolean NOT NULL DEFAULT false,
      reviewed_by bigint,
      reviewed_at timestamp with time zone,
      created_at timestamp with time zone NOT NULL DEFAULT now(),
      CONSTRAINT renewal_requests_pkey PRIMARY KEY (id),
      CONSTRAINT renewal_requests_member_id_fkey FOREIGN KEY (member_id)
          REFERENCES public.members (id) ON DELETE CASCADE,
      CONSTRAINT renewal_requests_kind_check CHECK (kind::text = ANY (ARRAY['renewal', 'upgrade']::text[])),
      CONSTRAINT renewal_requests_status_check CHECK (status::text = ANY (ARRAY['pending', 'verified', 'rejected']::text[])),
      CONSTRAINT renewal_requests_amount_check CHECK (amount >= 0 AND discount_amount >= 0)
  );

  CREATE INDEX IF NOT EXISTS idx_renewal_requests_status ON public.renewal_requests (status, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_renewal_requests_member ON public.renewal_requests (member_id);

  -- renewal_tokens (only the SHA-256 hash is stored) -----------------------
  CREATE TABLE IF NOT EXISTS public.renewal_tokens
  (
      id bigserial NOT NULL,
      member_id bigint NOT NULL,
      token_hash character(64) NOT NULL,
      expires_at timestamp with time zone NOT NULL,
      via_lookup boolean NOT NULL DEFAULT false,
      created_at timestamp with time zone NOT NULL DEFAULT now(),
      CONSTRAINT renewal_tokens_pkey PRIMARY KEY (id),
      CONSTRAINT renewal_tokens_token_hash_key UNIQUE (token_hash),
      CONSTRAINT renewal_tokens_member_id_fkey FOREIGN KEY (member_id)
          REFERENCES public.members (id) ON DELETE CASCADE
  );

  -- reminder_log -----------------------------------------------------------
  CREATE TABLE IF NOT EXISTS public.reminder_log
  (
      id bigserial NOT NULL,
      member_id bigint NOT NULL,
      kind character varying(20) NOT NULL,
      period_key date NOT NULL,
      status character varying(10) NOT NULL,
      detail text,
      created_at timestamp with time zone NOT NULL DEFAULT now(),
      CONSTRAINT reminder_log_pkey PRIMARY KEY (id),
      CONSTRAINT reminder_log_member_id_fkey FOREIGN KEY (member_id)
          REFERENCES public.members (id) ON DELETE CASCADE,
      CONSTRAINT reminder_log_status_check CHECK (status::text = ANY (ARRAY['sent', 'skipped', 'failed']::text[]))
  );

  CREATE UNIQUE INDEX IF NOT EXISTS reminder_log_sent_once
    ON public.reminder_log (member_id, kind, period_key) WHERE status = 'sent';

  -- retired_membership_numbers (old numbers after an upgrade) --------------
  CREATE TABLE IF NOT EXISTS public.retired_membership_numbers
  (
      id bigserial NOT NULL,
      membership_number character varying(50) NOT NULL,
      member_id bigint,
      reason character varying(30) NOT NULL DEFAULT 'upgrade',
      retired_at timestamp with time zone NOT NULL DEFAULT now(),
      CONSTRAINT retired_membership_numbers_pkey PRIMARY KEY (id),
      CONSTRAINT retired_membership_numbers_member_id_fkey FOREIGN KEY (member_id)
          REFERENCES public.members (id) ON DELETE SET NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS retired_membership_numbers_compact
    ON public.retired_membership_numbers (regexp_replace(upper(membership_number), '[^A-Z0-9]', '', 'g'));

  -- membership_settings ----------------------------------------------------
  CREATE TABLE IF NOT EXISTS public.membership_settings
  (
      key text NOT NULL,
      value jsonb NOT NULL,
      updated_at timestamp with time zone NOT NULL DEFAULT now(),
      CONSTRAINT membership_settings_pkey PRIMARY KEY (key)
  );

  INSERT INTO public.membership_settings (key, value) VALUES
    ('grace_days', '30'::jsonb),
    ('notice_days', '30'::jsonb),
    ('upgrade_discounts', '{}'::jsonb)
  ON CONFLICT (key) DO NOTHING;
`;

// Columns copied as-is from both source tables into members.
const SHARED_COLUMNS = [
  'membership_number', 'full_name', 'name_with_initials', 'title', 'nic_number',
  'date_of_birth', 'sex', 'marital_status', 'permanent_address',
  'current_working_place', 'official_address', 'mobile_number',
  'whatsapp_number', 'residential_number', 'office_number', 'email_address',
  'slnc_registration_number', 'slnc_registration_date', 'designation',
  'first_appointment_date', 'first_appointment_place', 'nursing_school',
  'batch', 'higher_educational_qualification', 'is_active', 'deactivated_at',
  'deactivated_by'
];

const COLS = SHARED_COLUMNS.join(', ');
const SRC_COLS = SHARED_COLUMNS.map((c) => 's.' + c).join(', ');

// Approved applications -> members. Every existing application is Lifetime;
// the CASE keeps this correct if it's re-run after GM/AM approvals exist
// (though the new backend creates those members itself on approval).
const BACKFILL_APPLICATIONS = `
  INSERT INTO public.members (${COLS}, category, joined_on, category_since,
                              valid_until, source, application_id, admin_note)
  SELECT ${SRC_COLS},
         CASE s.membership_type WHEN 'general' THEN 'GM' WHEN 'associate' THEN 'AM' ELSE 'LT' END,
         COALESCE(s.joined_on, (COALESCE(s.approved_at, s.created_at) AT TIME ZONE 'Asia/Colombo')::date),
         COALESCE(s.joined_on, (COALESCE(s.approved_at, s.created_at) AT TIME ZONE 'Asia/Colombo')::date),
         CASE WHEN s.membership_type IN ('general', 'associate')
              THEN (COALESCE(s.joined_on, (COALESCE(s.approved_at, s.created_at) AT TIME ZONE 'Asia/Colombo')::date) + interval '1 year')::date
              ELSE NULL END,
         CASE WHEN s.is_manual_entry THEN 'manual' ELSE 'application' END,
         s.id,
         s.admin_note
    FROM public.membership_applications s
   WHERE s.application_status = 'approved'
     AND s.membership_number IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.members m WHERE m.application_id = s.id)
  RETURNING id
`;

// Legacy lifetime roll -> members (joined date unknown).
const BACKFILL_LEGACY = `
  INSERT INTO public.members (${COLS}, category, source, legacy_member_id, admin_note)
  SELECT ${SRC_COLS}, 'LT', 'legacy', s.id, s.admin_note
    FROM public.legacy_lifetime_members s
   WHERE NOT EXISTS (SELECT 1 FROM public.members m WHERE m.legacy_member_id = s.id)
  RETURNING id
`;

// Membership numbers that would clash in members (compared ignoring case,
// spaces and punctuation, the same way the app compares them).
const NUMBER_CLASHES = `
  WITH incoming AS (
    SELECT membership_number, 'application ' || reference_number AS origin
      FROM public.membership_applications s
     WHERE application_status = 'approved' AND membership_number IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.members m WHERE m.application_id = s.id)
    UNION ALL
    SELECT membership_number, 'legacy id ' || id
      FROM public.legacy_lifetime_members s
     WHERE NOT EXISTS (SELECT 1 FROM public.members m WHERE m.legacy_member_id = s.id)
    UNION ALL
    SELECT membership_number, 'member id ' || id FROM public.members
  )
  SELECT regexp_replace(upper(membership_number), '[^A-Z0-9]', '', 'g') AS compact,
         string_agg(membership_number || ' (' || origin || ')', ', ') AS rows
    FROM incoming
   GROUP BY 1
  HAVING count(*) > 1
`;

async function counts(client) {
  const { rows: [row] } = await client.query(`
    SELECT
      (SELECT count(*) FROM public.membership_applications
        WHERE application_status = 'approved' AND membership_number IS NOT NULL)::int AS approved_applications,
      (SELECT count(*) FROM public.legacy_lifetime_members)::int AS legacy_members,
      (SELECT count(*) FROM public.members)::int AS members,
      (SELECT count(*) FROM public.members WHERE is_active)::int AS active_members,
      -- Every member in the old tables must now have a members row, with
      -- the same active / deactivated state.
      (SELECT count(*) FROM public.membership_applications s
        WHERE s.application_status = 'approved' AND s.membership_number IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM public.members m
                           WHERE m.application_id = s.id AND m.is_active = s.is_active))::int AS unmatched_applications,
      (SELECT count(*) FROM public.legacy_lifetime_members s
        WHERE NOT EXISTS (SELECT 1 FROM public.members m
                           WHERE m.legacy_member_id = s.id AND m.is_active = s.is_active))::int AS unmatched_legacy
  `);
  return row;
}

async function main() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(SCHEMA_SQL);

    const clashes = await client.query(NUMBER_CLASHES);
    if (clashes.rowCount > 0) {
      console.error('Stopped: these membership numbers would clash in the members table.');
      clashes.rows.forEach((r) => console.error('  ' + r.rows));
      console.error('Fix them in the admin dashboard (or the old tables), then run this again.');
      await client.query('ROLLBACK');
      process.exitCode = 1;
      return;
    }

    const fromApplications = await client.query(BACKFILL_APPLICATIONS);
    const fromLegacy = await client.query(BACKFILL_LEGACY);
    const after = await counts(client);

    console.log(`Members added from approved applications: ${fromApplications.rowCount}`);
    console.log(`Members added from the legacy lifetime roll: ${fromLegacy.rowCount}`);
    console.log('Totals after this run:', after);

    if (after.unmatched_applications > 0 || after.unmatched_legacy > 0) {
      console.error(`Stopped: ${after.unmatched_applications} approved application(s) and ${after.unmatched_legacy} legacy member(s) have no matching members row (or a different active state).`);
      await client.query('ROLLBACK');
      process.exitCode = 1;
      return;
    }

    if (APPLY) {
      await client.query('COMMIT');
      console.log('Applied.');
    } else {
      await client.query('ROLLBACK');
      console.log('Dry run only, nothing was changed. Run again with --apply to apply.');
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Migration failed, nothing was changed:', error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
