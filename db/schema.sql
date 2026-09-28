-- Table: public.album_photos

-- DROP TABLE IF EXISTS public.album_photos;

CREATE TABLE IF NOT EXISTS public.album_photos
(
    id serial NOT NULL,
    album_id integer NOT NULL,
    photo_url character varying(500) COLLATE pg_catalog."default" NOT NULL,
    display_order integer NOT NULL DEFAULT 0,
    created_at timestamp without time zone NOT NULL DEFAULT now(),
    CONSTRAINT album_photos_pkey PRIMARY KEY (id),
    CONSTRAINT album_photos_album_id_fkey FOREIGN KEY (album_id)
    REFERENCES public.albums (id) MATCH SIMPLE
                         ON UPDATE NO ACTION
                         ON DELETE CASCADE
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
    member_fee numeric(10,2) NOT NULL DEFAULT 0,
    non_member_fee numeric(10,2) NOT NULL DEFAULT 0,
    photo_url text COLLATE pg_catalog."default",
    photo_filename text COLLATE pg_catalog."default",
    attachment_url text COLLATE pg_catalog."default",
    attachment_filename text COLLATE pg_catalog."default",
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT cpd_events_pkey PRIMARY KEY (id),
    CONSTRAINT cpd_events_audience_check CHECK (audience = ANY (ARRAY['Open for Public'::text, 'Members Only'::text])),
    CONSTRAINT cpd_events_member_fee_check CHECK (member_fee >= 0),
    CONSTRAINT cpd_events_non_member_fee_check CHECK (non_member_fee >= 0)
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
    slnc_registration_number text COLLATE pg_catalog."default" NOT NULL,
    email text COLLATE pg_catalog."default" NOT NULL,
    mobile text COLLATE pg_catalog."default" NOT NULL,
    certificate_issue_name text COLLATE pg_catalog."default" NOT NULL,
    postal_address text COLLATE pg_catalog."default" NOT NULL,
    workplace text COLLATE pg_catalog."default" NOT NULL,
    workplace_address text COLLATE pg_catalog."default" NOT NULL,
    pay_by text COLLATE pg_catalog."default" NOT NULL,
    receipt_url text COLLATE pg_catalog."default" NOT NULL,
    receipt_filename text COLLATE pg_catalog."default" NOT NULL,
    status text COLLATE pg_catalog."default" NOT NULL DEFAULT 'Pending',
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
    title character varying(20) COLLATE pg_catalog."default" NOT NULL,
    nic_number character varying(20) COLLATE pg_catalog."default" NOT NULL,
    date_of_birth date NOT NULL,
    sex character varying(10) COLLATE pg_catalog."default" NOT NULL,
    marital_status character varying(30) COLLATE pg_catalog."default" NOT NULL,
    permanent_address text COLLATE pg_catalog."default" NOT NULL,
    current_working_place character varying(255) COLLATE pg_catalog."default" NOT NULL,
    official_address text COLLATE pg_catalog."default",
    mobile_number character varying(30) COLLATE pg_catalog."default" NOT NULL,
    whatsapp_number character varying(30) COLLATE pg_catalog."default",
    residential_number character varying(30) COLLATE pg_catalog."default",
    office_number character varying(30) COLLATE pg_catalog."default",
    email_address character varying(255) COLLATE pg_catalog."default" NOT NULL,
    slnc_registration_number character varying(100) COLLATE pg_catalog."default" NOT NULL,
    slnc_registration_date date,
    designation character varying(255) COLLATE pg_catalog."default" NOT NULL,
    first_appointment_date date,
    first_appointment_place character varying(255) COLLATE pg_catalog."default",
    nursing_school character varying(255) COLLATE pg_catalog."default",
    batch character varying(100) COLLATE pg_catalog."default",
    higher_educational_qualification text COLLATE pg_catalog."default",
    payment_reference character varying(255) COLLATE pg_catalog."default",
    transfer_date date,
    payment_receipt_path character varying(500) COLLATE pg_catalog."default" NOT NULL,
    payment_receipt_original_name character varying(255) COLLATE pg_catalog."default" NOT NULL,
    id_photo_path character varying(500) COLLATE pg_catalog."default" NOT NULL,
    id_photo_original_name character varying(255) COLLATE pg_catalog."default" NOT NULL,
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
    title character varying(20) COLLATE pg_catalog."default" NOT NULL,
    nic_number character varying(20) COLLATE pg_catalog."default" NOT NULL,
    date_of_birth date NOT NULL,
    sex character varying(10) COLLATE pg_catalog."default" NOT NULL,
    marital_status character varying(30) COLLATE pg_catalog."default" NOT NULL,
    permanent_address text COLLATE pg_catalog."default" NOT NULL,
    current_working_place character varying(255) COLLATE pg_catalog."default" NOT NULL,
    official_address text COLLATE pg_catalog."default",
    mobile_number character varying(30) COLLATE pg_catalog."default" NOT NULL,
    whatsapp_number character varying(30) COLLATE pg_catalog."default",
    residential_number character varying(30) COLLATE pg_catalog."default",
    office_number character varying(30) COLLATE pg_catalog."default",
    email_address character varying(255) COLLATE pg_catalog."default" NOT NULL,
    slnc_registration_number character varying(100) COLLATE pg_catalog."default" NOT NULL,
    slnc_registration_date date,
    designation character varying(255) COLLATE pg_catalog."default" NOT NULL,
    first_appointment_date date,
    first_appointment_place character varying(255) COLLATE pg_catalog."default",
    nursing_school character varying(255) COLLATE pg_catalog."default",
    batch character varying(100) COLLATE pg_catalog."default",
    higher_educational_qualification text COLLATE pg_catalog."default",
    payment_reference character varying(255) COLLATE pg_catalog."default",
    transfer_date date,
    payment_receipt_path character varying(500) COLLATE pg_catalog."default" NOT NULL,
    payment_receipt_original_name character varying(255) COLLATE pg_catalog."default" NOT NULL,
    id_photo_path character varying(500) COLLATE pg_catalog."default" NOT NULL,
    id_photo_original_name character varying(255) COLLATE pg_catalog."default" NOT NULL,
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