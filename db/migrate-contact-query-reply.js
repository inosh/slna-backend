// db/migrate-contact-query-reply.js
//
// Adds admin reply support to contact_queries: the reply text sent back to
// the sender, when it was sent, and which admin sent it. A query can only
// hold one reply at a time (re-replying overwrites it and re-sends the
// email) -- this is a quick contact-form inbox, not a threaded conversation.
//
// Run with: node db/migrate-contact-query-reply.js

const pool = require('./pool');

async function main() {
  const client = await pool.connect();

  try {
    await client.query(`
      ALTER TABLE public.contact_queries
        ADD COLUMN IF NOT EXISTS admin_reply text,
        ADD COLUMN IF NOT EXISTS replied_at timestamp with time zone,
        ADD COLUMN IF NOT EXISTS replied_by bigint;
    `);

    console.log('contact_queries now supports admin replies.');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
