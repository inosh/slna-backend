-- Table: public.membership_applications

-- DROP TABLE IF EXISTS public.membership_applications;

CREATE TABLE IF NOT EXISTS public.membership_applications
(
    id bigserial NOT NULL,
    reference_number character varying(40) COLLATE pg_catalog."default" NOT NULL,
    membership_number character varying(50) COLLATE pg_catalog."default",
    membership_type character varying(30) COLLATE pg_catalog."default" NOT NULL DEFAULT 'lifetime'::character varying,
    application_status character varying(20) COLLATE pg_catalog."default" NOT NULL DEFAULT 'pending'::character varying,
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
    payment_reference character varying(255) COLLATE pg_catalog."default" NOT NULL,
    transfer_date date NOT NULL,
    payment_receipt_path character varying(500) COLLATE pg_catalog."default" NOT NULL,
    payment_receipt_original_name character varying(255) COLLATE pg_catalog."default" NOT NULL,
    id_photo_path character varying(500) COLLATE pg_catalog."default" NOT NULL,
    id_photo_original_name character varying(255) COLLATE pg_catalog."default" NOT NULL,
    signature_photo_path character varying(500) COLLATE pg_catalog."default" NOT NULL,
    signature_photo_original_name character varying(255) COLLATE pg_catalog."default" NOT NULL,
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
    CONSTRAINT membership_applications_application_status_check CHECK (application_status::text = ANY (ARRAY['pending'::character varying, 'under_review'::character varying, 'approved'::character varying, 'rejected'::character varying, 'more_information_required'::character varying]::text[])),
    CONSTRAINT membership_applications_id_application_status_check CHECK (id_application_status::text = ANY (ARRAY['pending'::character varying, 'created'::character varying]::text[])),
    CONSTRAINT membership_applications_sex_check CHECK (sex::text = ANY (ARRAY['Male'::character varying, 'Female'::character varying]::text[]))
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