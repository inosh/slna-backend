// db/migrate-album-media-type.js
// One-time migration: adds album_photos.media_type ('image' | 'video') so
// the Photos/Albums admin page can publish videos alongside photos within
// the same album. Existing rows default to 'image'.
//
// Run with: node db/migrate-album-media-type.js

const pool = require('./pool');

async function main() {
  const client = await pool.connect();

  try {
    await client.query(`
      ALTER TABLE public.album_photos
        ADD COLUMN IF NOT EXISTS media_type character varying(10) NOT NULL DEFAULT 'image';
    `);

    await client.query(`
      ALTER TABLE public.album_photos
        DROP CONSTRAINT IF EXISTS album_photos_media_type_check;
    `);
    await client.query(`
      ALTER TABLE public.album_photos
        ADD CONSTRAINT album_photos_media_type_check
        CHECK (media_type::text = ANY (ARRAY['image'::character varying, 'video'::character varying]::text[]));
    `);

    console.log('album_photos.media_type ready.');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
