-- Table: public.users

-- DROP TABLE IF EXISTS public.users;

CREATE TABLE IF NOT EXISTS public.users
(
    id serial NOT NULL,
    username character varying(50) COLLATE pg_catalog."default" NOT NULL,
    password_hash character varying(255) COLLATE pg_catalog."default" NOT NULL,
    role character varying(30) COLLATE pg_catalog."default" NOT NULL DEFAULT 'Secretariat Staff'::character varying,
    created_at timestamp without time zone NOT NULL DEFAULT now(),
    CONSTRAINT users_pkey PRIMARY KEY (id),
    CONSTRAINT users_username_key UNIQUE (username)
    )

    TABLESPACE pg_default;

ALTER TABLE IF EXISTS public.users
    OWNER to postgres;

-- Table: public.albums

-- DROP TABLE IF EXISTS public.albums;

CREATE TABLE IF NOT EXISTS public.albums
(
    id serial NOT NULL,
    title character varying(255) COLLATE pg_catalog."default" NOT NULL,
    event_date date NOT NULL,
    created_by integer,
    created_at timestamp without time zone NOT NULL DEFAULT now(),
    CONSTRAINT albums_pkey PRIMARY KEY (id),
    CONSTRAINT albums_created_by_fkey FOREIGN KEY (created_by)
    REFERENCES public.users (id) MATCH SIMPLE
                         ON UPDATE NO ACTION
                         ON DELETE SET NULL
    )

    TABLESPACE pg_default;

ALTER TABLE IF EXISTS public.albums
    OWNER to postgres;
-- Index: idx_albums_event_date

-- DROP INDEX IF EXISTS public.idx_albums_event_date;

CREATE INDEX IF NOT EXISTS idx_albums_event_date
    ON public.albums USING btree
    (event_date DESC NULLS FIRST)
    TABLESPACE pg_default;

-- Table: public.album_photos

-- DROP TABLE IF EXISTS public.album_photos;

CREATE TABLE IF NOT EXISTS public.album_photos
(
    id serial NOT NULL,
    album_id integer NOT NULL,
    photo_url character varying(500) COLLATE pg_catalog."default" NOT NULL,
    media_type character varying(10) NOT NULL DEFAULT 'image',
    display_order integer NOT NULL DEFAULT 0,
    created_at timestamp without time zone NOT NULL DEFAULT now(),
    CONSTRAINT album_photos_pkey PRIMARY KEY (id),
    CONSTRAINT album_photos_album_id_fkey FOREIGN KEY (album_id)
    REFERENCES public.albums (id) MATCH SIMPLE
                         ON UPDATE NO ACTION
                         ON DELETE CASCADE,
    CONSTRAINT album_photos_media_type_check CHECK (media_type::text = ANY (ARRAY['image'::character varying, 'video'::character varying]::text[]))
    )

    TABLESPACE pg_default;

ALTER TABLE IF EXISTS public.album_photos
    OWNER to postgres;
-- Index: idx_album_photos_album_id

-- DROP INDEX IF EXISTS public.idx_album_photos_album_id;

CREATE INDEX IF NOT EXISTS idx_album_photos_album_id
    ON public.album_photos USING btree
    (album_id ASC NULLS LAST)
    TABLESPACE pg_default;

-- Table: public.news

-- DROP TABLE IF EXISTS public.news;

CREATE TABLE IF NOT EXISTS public.news
(
    id serial NOT NULL,
    title character varying(255) COLLATE pg_catalog."default" NOT NULL,
    event_date date NOT NULL,
    summary text COLLATE pg_catalog."default",
    body text COLLATE pg_catalog."default" NOT NULL,
    source character varying(20) COLLATE pg_catalog."default" NOT NULL DEFAULT 'typed'::character varying,
    file_name character varying(255) COLLATE pg_catalog."default",
    photo_url character varying(500) COLLATE pg_catalog."default",
    news_type character varying(50) COLLATE pg_catalog."default" NOT NULL DEFAULT 'General News'::character varying,
    album_id integer,
    created_by integer,
    created_at timestamp without time zone NOT NULL DEFAULT now(),
    updated_at timestamp without time zone NOT NULL DEFAULT now(),
    CONSTRAINT news_pkey PRIMARY KEY (id),
    CONSTRAINT news_news_type_check CHECK (news_type::text = ANY (ARRAY['International Nurses Day'::character varying, 'Annual General Meeting'::character varying, 'General Meeting'::character varying, 'CPD Event'::character varying, 'General News'::character varying]::text[])),
    -- Soft reference: deleting an album (from the Add Photos/Albums page)
    -- clears album_id back to NULL instead of being blocked or deleting
    -- the news item; deleting the news item never touches the album.
    CONSTRAINT news_album_id_fkey FOREIGN KEY (album_id)
    REFERENCES public.albums (id) MATCH SIMPLE
                         ON UPDATE NO ACTION
                         ON DELETE SET NULL,
    CONSTRAINT news_created_by_fkey FOREIGN KEY (created_by)
    REFERENCES public.users (id) MATCH SIMPLE
                         ON UPDATE NO ACTION
                         ON DELETE SET NULL
    )

    TABLESPACE pg_default;

ALTER TABLE IF EXISTS public.news
    OWNER to postgres;

CREATE INDEX IF NOT EXISTS idx_news_event_date
    ON public.news USING btree
    (event_date DESC NULLS FIRST)
    TABLESPACE pg_default;

CREATE INDEX IF NOT EXISTS idx_news_album_id
    ON public.news USING btree
    (album_id ASC NULLS LAST)
    TABLESPACE pg_default;

-- Table: public.events

-- DROP TABLE IF EXISTS public.events;

CREATE TABLE IF NOT EXISTS public.events
(
    id serial NOT NULL,
    category text COLLATE pg_catalog."default" NOT NULL,
    event_type text COLLATE pg_catalog."default" NOT NULL,
    title text COLLATE pg_catalog."default" NOT NULL,
    event_date date NOT NULL,
    "time" text COLLATE pg_catalog."default" NOT NULL,
    location text COLLATE pg_catalog."default" NOT NULL,
    summary text COLLATE pg_catalog."default" NOT NULL,
    status text COLLATE pg_catalog."default" NOT NULL,
    photo_url text COLLATE pg_catalog."default",
    photo_filename text COLLATE pg_catalog."default",
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT events_pkey PRIMARY KEY (id),
    CONSTRAINT events_category_check CHECK (category = ANY (ARRAY['cpd'::text, 'other'::text]))
    )

    TABLESPACE pg_default;

ALTER TABLE IF EXISTS public.events
    OWNER to postgres;
-- Index: idx_events_category

-- DROP INDEX IF EXISTS public.idx_events_category;

CREATE INDEX IF NOT EXISTS idx_events_category
    ON public.events USING btree
    (category COLLATE pg_catalog."default" ASC NULLS LAST)
    TABLESPACE pg_default;
-- Index: idx_events_date

-- DROP INDEX IF EXISTS public.idx_events_date;

CREATE INDEX IF NOT EXISTS idx_events_date
    ON public.events USING btree
    (event_date ASC NULLS LAST)
    TABLESPACE pg_default;
-- Index: idx_events_status

-- DROP INDEX IF EXISTS public.idx_events_status;

CREATE INDEX IF NOT EXISTS idx_events_status
    ON public.events USING btree
    (status COLLATE pg_catalog."default" ASC NULLS LAST)
    TABLESPACE pg_default;

-- Table: public.cpd_events
-- Dedicated table for CPD Events (workshops, training, webinars, seminars,
-- study days, conferences). "Other Events" continue to use public.events.

-- DROP TABLE IF EXISTS public.cpd_events;

CREATE TABLE IF NOT EXISTS public.cpd_events
(
    id serial NOT NULL,
    event_type text COLLATE pg_catalog."default" NOT NULL,
    title text COLLATE pg_catalog."default" NOT NULL,
    event_date date NOT NULL,
    "time" text COLLATE pg_catalog."default" NOT NULL,
    location text COLLATE pg_catalog."default" NOT NULL,
    summary text COLLATE pg_catalog."default" NOT NULL,
    status text COLLATE pg_catalog."default" NOT NULL,
    audience text COLLATE pg_catalog."default" NOT NULL,
    fee_type text COLLATE pg_catalog."default" NOT NULL DEFAULT 'paid'::text,
    member_fee numeric(10,2) NOT NULL DEFAULT 0,
    non_member_fee numeric(10,2) NOT NULL DEFAULT 0,
    duration_number integer NOT NULL DEFAULT 1,
    duration_unit text COLLATE pg_catalog."default" NOT NULL DEFAULT 'day'::text,
    end_date date,
    photo_url text COLLATE pg_catalog."default",
    photo_filename text COLLATE pg_catalog."default",
    attachment_url text COLLATE pg_catalog."default",
    attachment_filename text COLLATE pg_catalog."default",
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT cpd_events_pkey PRIMARY KEY (id),
    CONSTRAINT cpd_events_audience_check CHECK (audience = ANY (ARRAY['Open for Public'::text, 'Members Only'::text])),
    CONSTRAINT cpd_events_fee_type_check CHECK (fee_type = ANY (ARRAY['paid'::text, 'free'::text, 'free_for_members'::text])),
    CONSTRAINT cpd_events_member_fee_check CHECK (member_fee >= 0),
    CONSTRAINT cpd_events_non_member_fee_check CHECK (non_member_fee >= 0),
    CONSTRAINT cpd_events_duration_number_check CHECK (duration_number > 0),
    CONSTRAINT cpd_events_duration_unit_check CHECK (duration_unit = ANY (ARRAY['day'::text, 'month'::text, 'year'::text]))
    )

    TABLESPACE pg_default;

ALTER TABLE IF EXISTS public.cpd_events
    OWNER to postgres;
-- Index: idx_cpd_events_date

-- DROP INDEX IF EXISTS public.idx_cpd_events_date;

CREATE INDEX IF NOT EXISTS idx_cpd_events_date
    ON public.cpd_events USING btree
    (event_date ASC NULLS LAST)
    TABLESPACE pg_default;
-- Index: idx_cpd_events_status

-- DROP INDEX IF EXISTS public.idx_cpd_events_status;

CREATE INDEX IF NOT EXISTS idx_cpd_events_status
    ON public.cpd_events USING btree
    (status COLLATE pg_catalog."default" ASC NULLS LAST)
    TABLESPACE pg_default;

-- Table: public.event_registrations
-- One shared table for registrations against any event category (currently
-- CPD events only). event_id/event_category are a logical reference, not a
-- database foreign key, since "cpd" and "other" events live in separate
-- tables. event_title/event_date are captured at registration time so the
-- record stays meaningful even if the event is later edited or removed.

-- DROP TABLE IF EXISTS public.event_registrations;

CREATE TABLE IF NOT EXISTS public.event_registrations
(
    id serial NOT NULL,
    event_category text COLLATE pg_catalog."default" NOT NULL DEFAULT 'cpd',
    event_id integer NOT NULL,
    event_title text COLLATE pg_catalog."default" NOT NULL,
    event_date date NOT NULL,
    registrant_type text COLLATE pg_catalog."default" NOT NULL,
    paid_amount numeric(10,2) NOT NULL DEFAULT 0,
    membership_number text COLLATE pg_catalog."default",
    nic text COLLATE pg_catalog."default" NOT NULL,
    full_name text COLLATE pg_catalog."default" NOT NULL,
    slnc_registration_number text COLLATE pg_catalog."default",
    email text COLLATE pg_catalog."default" NOT NULL,
    mobile text COLLATE pg_catalog."default" NOT NULL,
    certificate_issue_name text COLLATE pg_catalog."default" NOT NULL,
    postal_address text COLLATE pg_catalog."default" NOT NULL,
    workplace text COLLATE pg_catalog."default" NOT NULL,
    workplace_address text COLLATE pg_catalog."default" NOT NULL,
    pay_by text COLLATE pg_catalog."default",
    receipt_url text COLLATE pg_catalog."default",
    receipt_filename text COLLATE pg_catalog."default",
    status text COLLATE pg_catalog."default" NOT NULL DEFAULT 'Pending',
    rejection_reason text COLLATE pg_catalog."default",
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT event_registrations_pkey PRIMARY KEY (id),
    CONSTRAINT event_registrations_category_check CHECK (event_category = ANY (ARRAY['cpd'::text, 'other'::text])),
    CONSTRAINT event_registrations_registrant_type_check CHECK (registrant_type = ANY (ARRAY['Member'::text, 'Non-Member'::text])),
    CONSTRAINT event_registrations_pay_by_check CHECK (pay_by = ANY (ARRAY['Organization'::text, 'Individual'::text]))
    )

    TABLESPACE pg_default;

ALTER TABLE IF EXISTS public.event_registrations
    OWNER to postgres;

CREATE INDEX IF NOT EXISTS idx_event_registrations_event
    ON public.event_registrations USING btree
    (event_category COLLATE pg_catalog."default" ASC NULLS LAST, event_id ASC NULLS LAST)
    TABLESPACE pg_default;


-- Table: public.membership_applications

-- DROP TABLE IF EXISTS public.membership_applications;

CREATE TABLE IF NOT EXISTS public.membership_applications
(
    id bigserial NOT NULL,
    reference_number character varying(40) COLLATE pg_catalog."default" NOT NULL,
    membership_number character varying(50) COLLATE pg_catalog."default",
    membership_type character varying(30) COLLATE pg_catalog."default" NOT NULL DEFAULT 'lifetime'::character varying,
    application_status character varying(50) COLLATE pg_catalog."default" NOT NULL DEFAULT 'pending'::character varying,
    status_note text COLLATE pg_catalog."default",
    full_name character varying(255) COLLATE pg_catalog."default" NOT NULL,
    name_with_initials character varying(255) COLLATE pg_catalog."default" NOT NULL,
    title character varying(20) COLLATE pg_catalog."default",
    nic_number character varying(20) COLLATE pg_catalog."default",
    date_of_birth date,
    sex character varying(10) COLLATE pg_catalog."default",
    marital_status character varying(30) COLLATE pg_catalog."default",
    permanent_address text COLLATE pg_catalog."default",
    current_working_place character varying(255) COLLATE pg_catalog."default",
    official_address text COLLATE pg_catalog."default",
    mobile_number character varying(30) COLLATE pg_catalog."default",
    whatsapp_number character varying(30) COLLATE pg_catalog."default",
    residential_number character varying(30) COLLATE pg_catalog."default",
    office_number character varying(30) COLLATE pg_catalog."default",
    email_address character varying(255) COLLATE pg_catalog."default",
    slnc_registration_number character varying(100) COLLATE pg_catalog."default",
    slnc_registration_date date,
    designation character varying(255) COLLATE pg_catalog."default",
    first_appointment_date date,
    first_appointment_place character varying(255) COLLATE pg_catalog."default",
    nursing_school character varying(255) COLLATE pg_catalog."default",
    batch character varying(100) COLLATE pg_catalog."default",
    higher_educational_qualification text COLLATE pg_catalog."default",
    payment_reference character varying(255) COLLATE pg_catalog."default",
    transfer_date date,
    payment_receipt_path character varying(500) COLLATE pg_catalog."default",
    payment_receipt_original_name character varying(255) COLLATE pg_catalog."default",
    id_photo_path character varying(500) COLLATE pg_catalog."default",
    id_photo_original_name character varying(255) COLLATE pg_catalog."default",
    signature_photo_path character varying(500) COLLATE pg_catalog."default",
    signature_photo_original_name character varying(255) COLLATE pg_catalog."default",
    declaration_confirmed boolean NOT NULL DEFAULT false,
    reviewed_at timestamp with time zone,
    reviewed_by bigint,
    approved_at timestamp with time zone,
    rejected_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    admin_note text COLLATE pg_catalog."default",
    id_application_status character varying(20) COLLATE pg_catalog."default" NOT NULL DEFAULT 'pending'::character varying,
    id_application_created_at timestamp with time zone,
    id_application_created_by bigint,
    is_manual_entry boolean NOT NULL DEFAULT false,
    manual_entry_created_by bigint,
    manual_entry_created_at timestamp with time zone,
    is_active boolean NOT NULL DEFAULT true,
    deactivated_at timestamp with time zone,
    deactivated_by bigint,
    CONSTRAINT membership_applications_pkey PRIMARY KEY (id),
    CONSTRAINT membership_applications_membership_number_key UNIQUE (membership_number),
    CONSTRAINT membership_applications_reference_number_key UNIQUE (reference_number),
    CONSTRAINT membership_applications_sex_check CHECK (sex::text = ANY (ARRAY['Male'::character varying, 'Female'::character varying]::text[])),
    CONSTRAINT membership_applications_id_application_status_check CHECK (id_application_status::text = ANY (ARRAY['pending'::character varying, 'created'::character varying]::text[])),
    CONSTRAINT membership_applications_application_status_check CHECK (application_status::text = ANY (ARRAY['pending'::character varying::text, 'under_review'::character varying::text, 'approved'::character varying::text, 'rejected'::character varying::text, 'more_information_required'::character varying::text]))
    )

    TABLESPACE pg_default;

ALTER TABLE IF EXISTS public.membership_applications
    OWNER to postgres;
-- Index: idx_membership_applications_email

-- DROP INDEX IF EXISTS public.idx_membership_applications_email;

CREATE INDEX IF NOT EXISTS idx_membership_applications_email
    ON public.membership_applications USING btree
    (email_address COLLATE pg_catalog."default" ASC NULLS LAST)
    TABLESPACE pg_default;
-- Index: idx_membership_applications_nic

-- DROP INDEX IF EXISTS public.idx_membership_applications_nic;

CREATE INDEX IF NOT EXISTS idx_membership_applications_nic
    ON public.membership_applications USING btree
    (nic_number COLLATE pg_catalog."default" ASC NULLS LAST)
    TABLESPACE pg_default;
-- Index: idx_membership_applications_reference_number

-- DROP INDEX IF EXISTS public.idx_membership_applications_reference_number;

CREATE INDEX IF NOT EXISTS idx_membership_applications_reference_number
    ON public.membership_applications USING btree
    (reference_number COLLATE pg_catalog."default" ASC NULLS LAST)
    TABLESPACE pg_default;
-- Index: idx_membership_applications_status

-- DROP INDEX IF EXISTS public.idx_membership_applications_status;

CREATE INDEX IF NOT EXISTS idx_membership_applications_status
    ON public.membership_applications USING btree
    (application_status COLLATE pg_catalog."default" ASC NULLS LAST)
    TABLESPACE pg_default;

-- Table: public.contact_queries
-- Submissions from the Contact SLNA form (general inquiries, feedback,
-- membership queries, etc.).

-- DROP TABLE IF EXISTS public.contact_queries;

CREATE TABLE IF NOT EXISTS public.contact_queries
(
    id bigserial NOT NULL,
    full_name text COLLATE pg_catalog."default" NOT NULL,
    email text COLLATE pg_catalog."default" NOT NULL,
    mobile_number text COLLATE pg_catalog."default" NOT NULL,
    subject text COLLATE pg_catalog."default" NOT NULL,
    message text COLLATE pg_catalog."default" NOT NULL,
    status text COLLATE pg_catalog."default" NOT NULL DEFAULT 'new'::text,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    admin_reply text COLLATE pg_catalog."default",
    replied_at timestamp with time zone,
    replied_by bigint,
    CONSTRAINT contact_queries_pkey PRIMARY KEY (id),
    CONSTRAINT contact_queries_subject_check CHECK (subject = ANY (ARRAY['general'::text, 'feedback'::text, 'membership'::text, 'events'::text, 'other'::text])),
    CONSTRAINT contact_queries_status_check CHECK (status = ANY (ARRAY['new'::text, 'read'::text]))
    )

    TABLESPACE pg_default;

ALTER TABLE IF EXISTS public.contact_queries
    OWNER to postgres;

CREATE INDEX IF NOT EXISTS idx_contact_queries_status
    ON public.contact_queries USING btree
    (status COLLATE pg_catalog."default" ASC NULLS LAST)
    TABLESPACE pg_default;

CREATE INDEX IF NOT EXISTS idx_contact_queries_created_at
    ON public.contact_queries USING btree
    (created_at DESC NULLS LAST)
    TABLESPACE pg_default;

-- Table: public.membership_fee_settings
-- Admin-configurable membership fees shown on the public Membership
-- Categories & Fees page. amount stays NOT NULL (same convention as
-- cpd_events.fee_type / member_fee) -- "to be announced" is tracked via
-- is_tba rather than a nullable amount, so the column is never ambiguous
-- between "not set yet" and "deliberately TBA". The API layer still
-- reports amount as null to callers when is_tba is true.

-- DROP TABLE IF EXISTS public.membership_fee_settings;

CREATE TABLE IF NOT EXISTS public.membership_fee_settings
(
    key text COLLATE pg_catalog."default" NOT NULL,
    label text COLLATE pg_catalog."default" NOT NULL,
    amount numeric(10,2) NOT NULL DEFAULT 0,
    is_tba boolean NOT NULL DEFAULT false,
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT membership_fee_settings_pkey PRIMARY KEY (key),
    CONSTRAINT membership_fee_settings_key_check CHECK (key = ANY (ARRAY['associate'::text, 'lifetime'::text, 'upgrade'::text])),
    CONSTRAINT membership_fee_settings_amount_check CHECK (amount >= 0)
    )

    TABLESPACE pg_default;

ALTER TABLE IF EXISTS public.membership_fee_settings
    OWNER to postgres;

-- Table: public.exec_committee_members
-- The 10 Executive Committee seats are fixed by the SLNA constitution --
-- rows are seeded once (see db/migrate-exec-committee.js) and only ever
-- updated (name/designation/role_title/photo), never created or deleted.

-- DROP TABLE IF EXISTS public.exec_committee_members;

CREATE TABLE IF NOT EXISTS public.exec_committee_members
(
    slot_key character varying(40) COLLATE pg_catalog."default" NOT NULL,
    display_order integer NOT NULL,
    role_title character varying(100) COLLATE pg_catalog."default" NOT NULL,
    designation character varying(150) COLLATE pg_catalog."default",
    name character varying(255) COLLATE pg_catalog."default" NOT NULL,
    photo_url character varying(500) COLLATE pg_catalog."default",
    photo_filename character varying(255) COLLATE pg_catalog."default",
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT exec_committee_members_pkey PRIMARY KEY (slot_key),
    CONSTRAINT exec_committee_members_slot_key_check CHECK (slot_key::text = ANY (ARRAY['president'::character varying, 'general_secretary'::character varying, 'treasurer'::character varying, 'vp_hospital'::character varying, 'vp_education'::character varying, 'vp_public_health'::character varying, 'asst_secretary_1'::character varying, 'asst_secretary_2'::character varying, 'asst_treasurer'::character varying, 'librarian'::character varying]::text[]))
    )

    TABLESPACE pg_default;

ALTER TABLE IF EXISTS public.exec_committee_members
    OWNER to postgres;

-- Table: public.exec_committee_settings
-- Singleton row (id always 1) holding the term years and the Annual
-- General Meeting details shown above the Executive Committee roster.

-- DROP TABLE IF EXISTS public.exec_committee_settings;

CREATE TABLE IF NOT EXISTS public.exec_committee_settings
(
    id integer NOT NULL DEFAULT 1,
    term_start_year integer NOT NULL,
    term_end_year integer NOT NULL,
    agm_number integer NOT NULL,
    agm_date date NOT NULL,
    agm_venue text COLLATE pg_catalog."default",
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT exec_committee_settings_pkey PRIMARY KEY (id),
    CONSTRAINT exec_committee_settings_singleton_check CHECK (id = 1)
    )

    TABLESPACE pg_default;

ALTER TABLE IF EXISTS public.exec_committee_settings
    OWNER to postgres;

-- Table: public.sub_committees
-- The 7 Sub Committees are fixed -- rows are seeded once (see
-- db/migrate-sub-committees.js) and never created or deleted here.

-- DROP TABLE IF EXISTS public.sub_committees;

CREATE TABLE IF NOT EXISTS public.sub_committees
(
    slot_key character varying(40) COLLATE pg_catalog."default" NOT NULL,
    display_order integer NOT NULL,
    name character varying(255) COLLATE pg_catalog."default" NOT NULL,
    description text COLLATE pg_catalog."default",
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT sub_committees_pkey PRIMARY KEY (slot_key),
    CONSTRAINT sub_committees_slot_key_check CHECK (slot_key::text = ANY (ARRAY['nursing-education'::character varying, 'nursing-services'::character varying, 'development-planning'::character varying, 'publicity-public-relations'::character varying, 'nominations'::character varying, 'social-economic-welfare'::character varying, 'finance'::character varying]::text[]))
    )

    TABLESPACE pg_default;

ALTER TABLE IF EXISTS public.sub_committees
    OWNER to postgres;

-- Table: public.sub_committee_members
-- Each Sub Committee has exactly 5 fixed seats -- only name/designation
-- on a row is ever updated, never created or deleted.

-- DROP TABLE IF EXISTS public.sub_committee_members;

CREATE TABLE IF NOT EXISTS public.sub_committee_members
(
    id serial NOT NULL,
    committee_key character varying(40) COLLATE pg_catalog."default" NOT NULL,
    display_order integer NOT NULL,
    designation character varying(150) COLLATE pg_catalog."default",
    name character varying(255) COLLATE pg_catalog."default" NOT NULL,
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT sub_committee_members_pkey PRIMARY KEY (id),
    CONSTRAINT sub_committee_members_committee_key_fkey FOREIGN KEY (committee_key)
    REFERENCES public.sub_committees (slot_key) MATCH SIMPLE
                         ON UPDATE NO ACTION
                         ON DELETE CASCADE,
    CONSTRAINT sub_committee_members_committee_order_key UNIQUE (committee_key, display_order)
    )

    TABLESPACE pg_default;

ALTER TABLE IF EXISTS public.sub_committee_members
    OWNER to postgres;

-- Table: public.legacy_lifetime_members
-- The pre-digital lifetime membership roll (previously tracked only in a
-- spreadsheet). Only basic info columns -- no payment receipt / ID photo /
-- signature / declaration fields, since none of that was ever collected
-- for these members on paper. Everything besides membership_number and
-- full_name is nullable, since the spreadsheet only ever had name, working
-- place, and registration number -- the rest gets filled in over time from
-- the admin dashboard as members come forward with more details.

-- DROP TABLE IF EXISTS public.legacy_lifetime_members;

CREATE TABLE IF NOT EXISTS public.legacy_lifetime_members
(
    id bigserial NOT NULL,
    membership_number character varying(50) COLLATE pg_catalog."default" NOT NULL,
    full_name character varying(255) COLLATE pg_catalog."default" NOT NULL,
    name_with_initials character varying(255) COLLATE pg_catalog."default",
    title character varying(20) COLLATE pg_catalog."default",
    nic_number character varying(20) COLLATE pg_catalog."default",
    date_of_birth date,
    sex character varying(10) COLLATE pg_catalog."default",
    marital_status character varying(30) COLLATE pg_catalog."default",
    permanent_address text COLLATE pg_catalog."default",
    current_working_place character varying(255) COLLATE pg_catalog."default",
    official_address text COLLATE pg_catalog."default",
    mobile_number character varying(30) COLLATE pg_catalog."default",
    whatsapp_number character varying(30) COLLATE pg_catalog."default",
    residential_number character varying(30) COLLATE pg_catalog."default",
    office_number character varying(30) COLLATE pg_catalog."default",
    email_address character varying(255) COLLATE pg_catalog."default",
    slnc_registration_number character varying(100) COLLATE pg_catalog."default",
    slnc_registration_date date,
    designation character varying(255) COLLATE pg_catalog."default",
    first_appointment_date date,
    first_appointment_place character varying(255) COLLATE pg_catalog."default",
    nursing_school character varying(255) COLLATE pg_catalog."default",
    batch character varying(100) COLLATE pg_catalog."default",
    higher_educational_qualification text COLLATE pg_catalog."default",
    admin_note text COLLATE pg_catalog."default",
    source_row_no integer,
    is_active boolean NOT NULL DEFAULT true,
    deactivated_at timestamp with time zone,
    deactivated_by bigint,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT legacy_lifetime_members_pkey PRIMARY KEY (id),
    CONSTRAINT legacy_lifetime_members_membership_number_key UNIQUE (membership_number),
    CONSTRAINT legacy_lifetime_members_sex_check CHECK (sex IS NULL OR sex::text = ANY (ARRAY['Male'::character varying, 'Female'::character varying]::text[]))
    )

    TABLESPACE pg_default;

ALTER TABLE IF EXISTS public.legacy_lifetime_members
    OWNER to postgres;

-- ======================================================================
-- General (GM) and Associate (AM) memberships, renewals and upgrades.
-- Applied to existing databases by db/migrate-membership-categories.js
-- (which also backfills members from approved applications and the
-- legacy lifetime roll). Kept here so a fresh database matches.
-- ======================================================================
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

