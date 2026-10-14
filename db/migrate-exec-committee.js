// db/migrate-exec-committee.js
// Creates exec_committee_members and exec_committee_settings, and seeds
// them with the Executive Committee's current roster and term/AGM details
// (previously hardcoded on pages/executive-committee.html in the frontend
// repo). Uploads the existing roster photos to R2 so the admin can replace
// them later from the dashboard without touching local image files.
// Safe to re-run -- seeded rows are skipped if they already exist.
//
// Run with: node db/migrate-exec-committee.js

const fs = require('fs');
const path = require('path');
const pool = require('./pool');
const { putPublicObject } = require('../lib/r2');

// The frontend repo (slna) is expected to be a sibling of this repo
// (slna-backend) -- matches the local dev checkout layout. Adjust this if
// your checkout differs.
const FRONTEND_IMAGES_DIR = path.join(__dirname, '..', '..', 'slna', 'images');

const MEMBERS = [
  { slot_key: 'president', display_order: 1, role_title: 'President', name: 'Mr. W. A. Keerthirathna', photo: 'exec-president.jpg' },
  { slot_key: 'general_secretary', display_order: 2, role_title: 'General Secretary', name: 'Mr. Shalith Athurupana', photo: 'exec-general-secretary.jpg' },
  { slot_key: 'treasurer', display_order: 3, role_title: 'Treasurer', name: 'Ms. Deepani Karunarathna', photo: 'exec-treasurer.jpg' },
  { slot_key: 'vp_hospital', display_order: 4, role_title: 'Vice President - Hospital Services', name: 'Ms. S. K. S. S. Karunadasa', photo: 'exec-vp-hospital.jpg' },
  { slot_key: 'vp_education', display_order: 5, role_title: 'Vice President - Education', name: 'Mr. D. M. Wimalarathna', photo: 'exec-vp-education.jpg' },
  { slot_key: 'vp_public_health', display_order: 6, role_title: 'Vice President - Public Health', name: 'Ms. P. M. A. K. Samarasekara', photo: 'exec-vp-public.jpg' },
  { slot_key: 'asst_secretary_1', display_order: 7, role_title: 'Assistant Secretary 01', name: 'Mr. Dayashantha Ilandara', photo: 'exec-vice-secretary-2.jpg' },
  { slot_key: 'asst_secretary_2', display_order: 8, role_title: 'Assistant Secretary 02', name: 'Mr. K. H. N. Prasandajith', photo: 'exec-vice-secretary-1.jpg' },
  { slot_key: 'asst_treasurer', display_order: 9, role_title: 'Assistant Treasurer', name: 'Ms. R. N. Rajapakshe', photo: 'exec-vice-treasurer.jpg' },
  { slot_key: 'librarian', display_order: 10, role_title: 'Librarian', name: 'Ms. D. B. J. Serum', photo: 'exec-librarian.jpg' },
];

const SETTINGS = {
  term_start_year: 2025,
  term_end_year: 2027,
  agm_number: 82,
  agm_date: '2025-07-05',
  agm_venue: 'Post Basic College of Nursing, Colombo',
};

function contentTypeFor(filename) {
  return filename.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
}

async function uploadPhoto(filename) {
  const localPath = path.join(FRONTEND_IMAGES_DIR, filename);

  if (!fs.existsSync(localPath)) {
    console.warn(`  Photo not found locally, skipping upload: ${localPath}`);
    return { photo_url: null, photo_filename: null };
  }

  const key = `exec-committee/${Date.now()}-${filename}`;
  const body = fs.readFileSync(localPath);
  await putPublicObject(key, body, contentTypeFor(filename));

  return { photo_url: `/uploads/${key}`, photo_filename: filename };
}

async function main() {
  const client = await pool.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.exec_committee_members
      (
          slot_key character varying(40) NOT NULL,
          display_order integer NOT NULL,
          role_title character varying(100) NOT NULL,
          designation character varying(150),
          name character varying(255) NOT NULL,
          photo_url character varying(500),
          photo_filename character varying(255),
          updated_at timestamp with time zone NOT NULL DEFAULT now(),
          CONSTRAINT exec_committee_members_pkey PRIMARY KEY (slot_key),
          CONSTRAINT exec_committee_members_slot_key_check CHECK (slot_key = ANY (ARRAY[
            'president','general_secretary','treasurer','vp_hospital','vp_education',
            'vp_public_health','asst_secretary_1','asst_secretary_2','asst_treasurer','librarian'
          ]))
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS public.exec_committee_settings
      (
          id integer NOT NULL DEFAULT 1,
          term_start_year integer NOT NULL,
          term_end_year integer NOT NULL,
          agm_number integer NOT NULL,
          agm_date date NOT NULL,
          agm_venue text,
          updated_at timestamp with time zone NOT NULL DEFAULT now(),
          CONSTRAINT exec_committee_settings_pkey PRIMARY KEY (id),
          CONSTRAINT exec_committee_settings_singleton_check CHECK (id = 1)
      );
    `);

    for (const member of MEMBERS) {
      const existing = await client.query(
        'SELECT 1 FROM exec_committee_members WHERE slot_key = $1',
        [member.slot_key]
      );

      if (existing.rows.length) {
        console.log(`  ${member.slot_key} already seeded, skipping.`);
        continue;
      }

      console.log(`  Uploading photo for ${member.slot_key}...`);
      const { photo_url, photo_filename } = await uploadPhoto(member.photo);

      await client.query(
        `INSERT INTO exec_committee_members
          (slot_key, display_order, role_title, designation, name, photo_url, photo_filename)
         VALUES ($1, $2, $3, NULL, $4, $5, $6)`,
        [member.slot_key, member.display_order, member.role_title, member.name, photo_url, photo_filename]
      );
    }

    await client.query(
      `INSERT INTO exec_committee_settings (id, term_start_year, term_end_year, agm_number, agm_date, agm_venue)
       VALUES (1, $1, $2, $3, $4, $5)
       ON CONFLICT (id) DO NOTHING`,
      [SETTINGS.term_start_year, SETTINGS.term_end_year, SETTINGS.agm_number, SETTINGS.agm_date, SETTINGS.agm_venue]
    );

    console.log('exec_committee_members and exec_committee_settings ready.');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
