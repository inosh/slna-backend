// db/migrate-sub-committees.js
// Creates sub_committees and sub_committee_members, and seeds them with
// the 7 fixed Sub Committees and their 5 members each (previously
// hardcoded in js/committees.js in the frontend repo). Committees and
// seats are fixed -- only name/designation on a member row is ever
// updated afterwards, never created or deleted.
// Safe to re-run -- seeded rows are skipped if they already exist.
//
// Run with: node db/migrate-sub-committees.js

const pool = require('./pool');

const COMMITTEES = [
  {
    slot_key: 'nursing-education',
    display_order: 1,
    name: 'Nursing Education Committee',
    description: 'The Nursing Education Committee supports the advancement of nursing education, continuing professional development, and initiatives that strengthen the knowledge and clinical skills of nurses across Sri Lanka.',
    members: [
      { designation: 'Professor', name: 'Prof. Thamara Amarasekara' },
      { designation: 'Sp. Gr. Nursing Tutor', name: 'Ms. I. D. T. N. K. Thilakarathne' },
      { designation: 'Nursing Sister', name: 'Ms. Ganga Mulleriyawa' },
      { designation: 'Nursing Director', name: 'Ms. Dayani Perera' },
      { designation: 'Sp. Gr. Nursing Tutor', name: 'Ms. N. P. Dullewa' },
    ],
  },
  {
    slot_key: 'nursing-services',
    display_order: 2,
    name: 'Nursing Services Committee',
    description: 'The Nursing Services Committee considers matters affecting nursing service delivery, professional practice, quality of care, and the working conditions of nurses in clinical and public health settings.',
    members: [
      { designation: 'Professor', name: 'Prof. S. S. P. Warnakulasuriya' },
      { designation: 'Nursing Officer', name: 'Ms. Samudra Gunarathne' },
      { designation: 'Nursing Officer', name: 'Mr. Keerthi Weerakoon' },
      { designation: 'Nursing Sister (Public Health)', name: 'Ms. R. S. Abeyrama' },
      { designation: 'Nursing Sister', name: 'Ms. Lasanthi Nagasinghe' },
    ],
  },
  {
    slot_key: 'development-planning',
    display_order: 3,
    name: 'Development and Planning Committee',
    description: 'The Development and Planning Committee plans and coordinates the Association’s conferences, workshops, seminars, and other member programmes and events, and supports strategic development initiatives for the Association.',
    members: [
      { designation: 'Nursing Sister (Public Health)', name: 'Ms. R. Dharmika' },
      { designation: 'Nursing Officer', name: 'Ms. C. U. Erawwala' },
      { designation: 'Nursing Officer', name: 'Ms. R. M. P. B. Senavirathna' },
      { designation: 'Nursing Officer', name: 'Mr. A. G. H. Lahiru Siriwardana' },
      { designation: 'Nursing Officer', name: 'Mrs. K. A. A. N. Damayanthi' },
    ],
  },
  {
    slot_key: 'publicity-public-relations',
    display_order: 4,
    name: 'Publicity and Public Relations Committee',
    description: 'The Publicity and Public Relations Committee oversees SLNA publicity, publications, and communications, and promotes public awareness of the nursing profession and the Association’s work.',
    members: [
      { designation: 'Nursing Sister (Public Health)', name: 'Ms. Manohari' },
      { designation: 'Nursing Sister', name: 'Ms. K. A. D. P. Vidyarathna' },
      { designation: 'Nursing Officer', name: 'Ms. D. M. A. S. Dissanayaka' },
      { designation: 'Sp. Gr. Nursing Tutor', name: 'Ms. G. B. Rohini' },
      { designation: 'Nursing Officer', name: 'Mr. K. H. D. Madushanka' },
    ],
  },
  {
    slot_key: 'nominations',
    display_order: 5,
    name: 'Nominations Committee',
    description: 'The Nominations Committee conducts and oversees the Association’s elections, including nominations, balloting, and the proper administration of election procedures in accordance with the SLNA constitution.',
    members: [
      { designation: 'Sp. Gr. Nursing Officer', name: 'Ms. Chamari Perera' },
      { designation: 'Sp. Gr. Nursing Tutor', name: 'Ms. K. M. D. G. Krishanthi' },
      { designation: 'Sp. Gr. Nursing Officer', name: 'Ms. T. A. D. R. G. Thalagala' },
      { designation: 'Nursing Sister (Public Health)', name: 'Ms. A. N. Palliyaguru' },
      { designation: 'Sp. Gr. Nursing Tutor', name: 'Ms. R. M. P. S. K. Rupasinghe' },
    ],
  },
  {
    slot_key: 'social-economic-welfare',
    display_order: 6,
    name: 'Social and Economic Welfare Committee',
    description: 'The Social and Economic Welfare Committee supports member welfare, social welfare initiatives, and programmes that advance the economic wellbeing of nurses and their communities.',
    members: [
      { designation: 'Nursing Officer', name: 'Ms. B. G. S. C. K. Ariyadas' },
      { designation: 'Nursing Sister (Public Health)', name: 'Ms. Lahiru Subha Rodrigo' },
      { designation: 'Nursing Officer', name: 'Mr. S. M. D. D. Senanayake' },
      { designation: 'Nursing Officer', name: 'Ms. P. R. Chamudi Lalindika' },
      { designation: 'Nursing Officer', name: 'Mrs. K. A. A. Udayangani' },
    ],
  },
  {
    slot_key: 'finance',
    display_order: 7,
    name: 'Finance Committee',
    description: 'The Finance Committee supports responsible financial planning, budget oversight, income and expenditure review, and the sustainable use of Association resources.',
    members: [
      { designation: 'Nursing Officer', name: 'Ms. A. M. C. Niroshika' },
      { designation: 'Nursing Officer', name: 'Ms. P. A. D. Nimali' },
      { designation: 'Nursing Sister (Public Health)', name: 'Ms. Lahiru Subhashini' },
      { designation: 'Nursing Officer', name: 'Mr. C. Madhushan Abeywickrama' },
      { designation: 'Nursing Officer', name: 'Ms. H. P. N. Hansika Jayasinghe' },
    ],
  },
];

async function main() {
  const client = await pool.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.sub_committees
      (
          slot_key character varying(40) NOT NULL,
          display_order integer NOT NULL,
          name character varying(255) NOT NULL,
          description text,
          updated_at timestamp with time zone NOT NULL DEFAULT now(),
          CONSTRAINT sub_committees_pkey PRIMARY KEY (slot_key),
          CONSTRAINT sub_committees_slot_key_check CHECK (slot_key = ANY (ARRAY[
            'nursing-education','nursing-services','development-planning',
            'publicity-public-relations','nominations','social-economic-welfare','finance'
          ]))
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS public.sub_committee_members
      (
          id serial NOT NULL,
          committee_key character varying(40) NOT NULL,
          display_order integer NOT NULL,
          designation character varying(150),
          name character varying(255) NOT NULL,
          updated_at timestamp with time zone NOT NULL DEFAULT now(),
          CONSTRAINT sub_committee_members_pkey PRIMARY KEY (id),
          CONSTRAINT sub_committee_members_committee_key_fkey FOREIGN KEY (committee_key)
              REFERENCES public.sub_committees (slot_key) MATCH SIMPLE
              ON UPDATE NO ACTION
              ON DELETE CASCADE,
          CONSTRAINT sub_committee_members_committee_order_key UNIQUE (committee_key, display_order)
      );
    `);

    for (const committee of COMMITTEES) {
      const existingCommittee = await client.query(
        'SELECT 1 FROM sub_committees WHERE slot_key = $1',
        [committee.slot_key]
      );

      if (existingCommittee.rows.length) {
        console.log(`  ${committee.slot_key} already seeded, skipping.`);
        continue;
      }

      await client.query(
        `INSERT INTO sub_committees (slot_key, display_order, name, description)
         VALUES ($1, $2, $3, $4)`,
        [committee.slot_key, committee.display_order, committee.name, committee.description]
      );

      for (let i = 0; i < committee.members.length; i++) {
        const member = committee.members[i];

        await client.query(
          `INSERT INTO sub_committee_members (committee_key, display_order, designation, name)
           VALUES ($1, $2, $3, $4)`,
          [committee.slot_key, i + 1, member.designation, member.name]
        );
      }
    }

    console.log('sub_committees and sub_committee_members ready.');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
