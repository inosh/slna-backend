// db/migrate-legacy-members.js
// Creates legacy_lifetime_members: the pre-digital lifetime membership
// roll (previously tracked only in a spreadsheet). Only basic info columns
// -- no payment receipt / ID photo / signature / declaration fields, since
// none of that was ever collected for these members on paper. Everything
// besides membership_number and full_name is nullable, since the
// spreadsheet only ever had name, working place, and registration number
// -- the rest gets filled in over time from the admin dashboard as members
// come forward with more details.
//
// Safe to re-run -- CREATE TABLE IF NOT EXISTS.
//
// Run with: node db/migrate-legacy-members.js

const pool = require('./pool');

async function main() {
  const client = await pool.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.legacy_lifetime_members
      (
          id bigserial NOT NULL,
          membership_number character varying(50) NOT NULL,
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
          admin_note text,
          source_row_no integer,
          is_active boolean NOT NULL DEFAULT true,
          deactivated_at timestamp with time zone,
          deactivated_by bigint,
          created_at timestamp with time zone NOT NULL DEFAULT now(),
          updated_at timestamp with time zone NOT NULL DEFAULT now(),
          CONSTRAINT legacy_lifetime_members_pkey PRIMARY KEY (id),
          CONSTRAINT legacy_lifetime_members_membership_number_key UNIQUE (membership_number),
          CONSTRAINT legacy_lifetime_members_sex_check CHECK (sex IS NULL OR sex::text = ANY (ARRAY['Male'::character varying, 'Female'::character varying]::text[]))
      );
    `);

    console.log('legacy_lifetime_members table ready.');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
