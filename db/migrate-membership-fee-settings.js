// db/migrate-membership-fee-settings.js
// Creates membership_fee_settings and seeds it with the fee values that
// were previously hardcoded on the Membership Categories & Fees page.
// ON CONFLICT DO NOTHING on the seed so re-running this after an admin has
// already edited a fee doesn't stomp their change.
//
// Run with: node db/migrate-membership-fee-settings.js

const pool = require('./pool');

async function main() {
  const client = await pool.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.membership_fee_settings
      (
          key text NOT NULL,
          label text NOT NULL,
          amount numeric(10,2) NOT NULL DEFAULT 0,
          is_tba boolean NOT NULL DEFAULT false,
          updated_at timestamp with time zone NOT NULL DEFAULT now(),
          CONSTRAINT membership_fee_settings_pkey PRIMARY KEY (key),
          CONSTRAINT membership_fee_settings_key_check CHECK (key = ANY (ARRAY['associate'::text, 'lifetime'::text, 'upgrade'::text])),
          CONSTRAINT membership_fee_settings_amount_check CHECK (amount >= 0)
      );
    `);

    await client.query(`
      INSERT INTO public.membership_fee_settings (key, label, amount, is_tba)
      VALUES
        ('associate', 'Associate Member Fee (LKR)', 3000, false),
        ('lifetime', 'Lifetime Member Fee (LKR)', 6000, false),
        ('upgrade', 'Associate -> Lifetime Upgrade Fee (LKR)', 0, true)
      ON CONFLICT (key) DO NOTHING;
    `);

    console.log('membership_fee_settings ready.');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
