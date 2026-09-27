// db/migrate-event-attachments.js
// One-time migration: adds attachment columns to cpd_events and creates
// the event_registrations table.
//
// Run with: node db/migrate-event-attachments.js

const pool = require('./pool');

async function main() {
  const client = await pool.connect();

  try {
    await client.query(`
      ALTER TABLE public.cpd_events
        ADD COLUMN IF NOT EXISTS attachment_url text,
        ADD COLUMN IF NOT EXISTS attachment_filename text;
    `);

    console.log('cpd_events.attachment_url / attachment_filename ready.');

    await client.query(`
      CREATE TABLE IF NOT EXISTS public.event_registrations
      (
          id serial NOT NULL,
          event_category text NOT NULL DEFAULT 'cpd',
          event_id integer NOT NULL,
          event_title text NOT NULL,
          event_date date NOT NULL,
          registrant_type text NOT NULL,
          membership_number text,
          nic text NOT NULL,
          full_name text NOT NULL,
          slnc_registration_number text NOT NULL,
          email text NOT NULL,
          mobile text NOT NULL,
          certificate_issue_name text NOT NULL,
          postal_address text NOT NULL,
          workplace text NOT NULL,
          workplace_address text NOT NULL,
          pay_by text NOT NULL,
          receipt_url text NOT NULL,
          receipt_filename text NOT NULL,
          status text NOT NULL DEFAULT 'Pending',
          created_at timestamp with time zone NOT NULL DEFAULT now(),
          updated_at timestamp with time zone NOT NULL DEFAULT now(),
          CONSTRAINT event_registrations_pkey PRIMARY KEY (id),
          CONSTRAINT event_registrations_category_check CHECK (event_category = ANY (ARRAY['cpd'::text, 'other'::text])),
          CONSTRAINT event_registrations_registrant_type_check CHECK (registrant_type = ANY (ARRAY['Member'::text, 'Non-Member'::text])),
          CONSTRAINT event_registrations_pay_by_check CHECK (pay_by = ANY (ARRAY['Organization'::text, 'Individual'::text]))
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_event_registrations_event
        ON public.event_registrations (event_category, event_id);
    `);

    console.log('event_registrations table ready.');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
