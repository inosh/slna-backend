// db/migrate-cpd-events.js
// One-time migration: creates the new cpd_events table and moves any
// existing category = 'cpd' rows out of the shared events table into it.
// Existing rows get default values for the new audience/fee columns
// since that data didn't exist before this migration.
//
// Run with: node db/migrate-cpd-events.js

const pool = require('./pool');

const DEFAULT_AUDIENCE = 'Open for Public';
const DEFAULT_FEE = 0;

async function main() {
  const client = await pool.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.cpd_events
      (
          id serial NOT NULL,
          event_type text NOT NULL,
          title text NOT NULL,
          event_date date NOT NULL,
          "time" text NOT NULL,
          location text NOT NULL,
          summary text NOT NULL,
          status text NOT NULL,
          audience text NOT NULL,
          member_fee numeric(10,2) NOT NULL DEFAULT 0,
          non_member_fee numeric(10,2) NOT NULL DEFAULT 0,
          photo_url text,
          photo_filename text,
          created_at timestamp with time zone NOT NULL DEFAULT now(),
          updated_at timestamp with time zone NOT NULL DEFAULT now(),
          CONSTRAINT cpd_events_pkey PRIMARY KEY (id),
          CONSTRAINT cpd_events_audience_check CHECK (audience = ANY (ARRAY['Open for Public'::text, 'Members Only'::text])),
          CONSTRAINT cpd_events_member_fee_check CHECK (member_fee >= 0),
          CONSTRAINT cpd_events_non_member_fee_check CHECK (non_member_fee >= 0)
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_cpd_events_date
        ON public.cpd_events (event_date ASC);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_cpd_events_status
        ON public.cpd_events (status);
    `);

    console.log('cpd_events table is ready.');

    await client.query('BEGIN');

    const legacyRows = await client.query(
      "SELECT * FROM events WHERE category = 'cpd' ORDER BY id ASC"
    );

    if (!legacyRows.rows.length) {
      console.log('No legacy CPD rows found in events table. Nothing to migrate.');
      await client.query('COMMIT');
      return;
    }

    console.log(
      `Migrating ${legacyRows.rows.length} existing CPD event(s) from events -> cpd_events...`
    );

    for (const row of legacyRows.rows) {
      await client.query(
        `INSERT INTO cpd_events (
          id, event_type, title, event_date, time, location, summary, status,
          audience, member_fee, non_member_fee, photo_url, photo_filename,
          created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        ON CONFLICT (id) DO NOTHING`,
        [
          row.id,
          row.event_type,
          row.title,
          row.event_date,
          row.time,
          row.location,
          row.summary,
          row.status,
          DEFAULT_AUDIENCE,
          DEFAULT_FEE,
          DEFAULT_FEE,
          row.photo_url,
          row.photo_filename,
          row.created_at,
          row.updated_at
        ]
      );
    }

    await client.query(
      "SELECT setval('cpd_events_id_seq', (SELECT COALESCE(MAX(id), 1) FROM cpd_events))"
    );

    const deleted = await client.query(
      "DELETE FROM events WHERE category = 'cpd'"
    );

    await client.query('COMMIT');

    console.log(
      `Migration complete: moved ${legacyRows.rows.length} row(s) into cpd_events and removed ${deleted.rowCount} row(s) from events.`
    );
    console.log(
      `Note: migrated rows were given default audience "${DEFAULT_AUDIENCE}" and fees of ${DEFAULT_FEE} since that data did not previously exist -- update them from the admin dashboard if needed.`
    );
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Migration failed, rolled back:', error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
