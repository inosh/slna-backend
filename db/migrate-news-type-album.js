// db/migrate-news-type-album.js
// One-time migration:
//   - adds news.news_type (required category dropdown, defaults existing
//     rows to 'General News')
//   - adds news.album_id, a soft reference to albums(id): deleting a news
//     item never touches its album, and deleting that album (from the
//     Add Photos/Albums page) clears album_id back to NULL via
//     ON DELETE SET NULL rather than being blocked or cascading.
//
// Run with: node db/migrate-news-type-album.js

const pool = require('./pool');

const NEWS_TYPES = [
  'International Nurses Day',
  'Annual General Meeting',
  'General Meeting',
  'CPD Event',
  'General News',
];

async function main() {
  const client = await pool.connect();

  try {
    await client.query(`
      ALTER TABLE public.news
        ADD COLUMN IF NOT EXISTS news_type character varying(50) NOT NULL DEFAULT 'General News';
    `);

    await client.query(`
      ALTER TABLE public.news
        DROP CONSTRAINT IF EXISTS news_news_type_check;
    `);
    await client.query(
      `ALTER TABLE public.news
         ADD CONSTRAINT news_news_type_check CHECK (news_type::text = ANY (ARRAY[${NEWS_TYPES
           .map((t) => `'${t}'::character varying`)
           .join(', ')}]::text[]));`
    );

    await client.query(`
      ALTER TABLE public.news
        ADD COLUMN IF NOT EXISTS album_id integer;
    `);

    await client.query(`
      ALTER TABLE public.news
        DROP CONSTRAINT IF EXISTS news_album_id_fkey;
    `);
    await client.query(`
      ALTER TABLE public.news
        ADD CONSTRAINT news_album_id_fkey FOREIGN KEY (album_id)
        REFERENCES public.albums (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE SET NULL;
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_news_album_id
        ON public.news (album_id);
    `);

    console.log('news.news_type and news.album_id ready.');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
