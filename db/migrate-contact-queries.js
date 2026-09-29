// db/migrate-contact-queries.js
// One-time migration: creates the contact_queries table, which stores
// submissions from the Contact SLNA form (general inquiries, feedback,
// membership queries, etc.).
//
// Run with: node db/migrate-contact-queries.js

const pool = require('./pool');

async function main() {
  const client = await pool.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.contact_queries
      (
          id bigserial NOT NULL,
          full_name text NOT NULL,
          email text NOT NULL,
          mobile_number text NOT NULL,
          subject text NOT NULL,
          message text NOT NULL,
          status text NOT NULL DEFAULT 'new',
          created_at timestamp with time zone NOT NULL DEFAULT now(),
          updated_at timestamp with time zone NOT NULL DEFAULT now(),
          CONSTRAINT contact_queries_pkey PRIMARY KEY (id),
          CONSTRAINT contact_queries_subject_check CHECK (subject = ANY (ARRAY['general'::text, 'feedback'::text, 'membership'::text, 'events'::text, 'other'::text])),
          CONSTRAINT contact_queries_status_check CHECK (status = ANY (ARRAY['new'::text, 'read'::text]))
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_contact_queries_status
        ON public.contact_queries (status);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_contact_queries_created_at
        ON public.contact_queries (created_at DESC);
    `);

    console.log('contact_queries table ready.');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
