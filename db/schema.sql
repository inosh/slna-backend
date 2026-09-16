-- ============================================================
-- SLNA Backend Database Schema
-- Run this once against your local PostgreSQL database (slna_db)
-- to create all required tables.
--
-- To run: open pgAdmin, connect to slna_db, open Query Tool,
-- paste this entire file, and click Execute (F5).
-- ============================================================

-- Drop existing tables if re-running this script during development
DROP TABLE IF EXISTS album_photos CASCADE;
DROP TABLE IF EXISTS albums CASCADE;
DROP TABLE IF EXISTS news CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- ============================================================
-- USERS TABLE
-- Stores admin/staff accounts. Passwords are hashed with bcrypt
-- (never stored in plain text).
-- ============================================================
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(30) NOT NULL DEFAULT 'Secretariat Staff',
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ============================================================
-- NEWS TABLE
-- One row per news item. photo_url stores the path/URL to the
-- uploaded image (nullable, since photos are optional).
-- ============================================================
CREATE TABLE news (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    event_date DATE NOT NULL,
    summary TEXT,
    body TEXT NOT NULL,
    source VARCHAR(20) NOT NULL DEFAULT 'typed',   -- 'typed' or 'file'
    file_name VARCHAR(255),                          -- original uploaded document name, if any
    photo_url VARCHAR(500),                          -- path to uploaded photo, if any
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_news_event_date ON news(event_date DESC);

-- ============================================================
-- ALBUMS TABLE
-- One row per photo album (e.g. "Annual Conference 2026").
-- ============================================================
CREATE TABLE albums (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    event_date DATE NOT NULL,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_albums_event_date ON albums(event_date DESC);

-- ============================================================
-- ALBUM_PHOTOS TABLE
-- One row per photo within an album (one-to-many with albums).
-- display_order lets you control the sequence photos appear in.
-- ============================================================
CREATE TABLE album_photos (
    id SERIAL PRIMARY KEY,
    album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
    photo_url VARCHAR(500) NOT NULL,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_album_photos_album_id ON album_photos(album_id);

-- ============================================================
-- SEED DATA (optional) -- matches the demo news items from the
-- static prototype, so the site looks populated immediately.
-- Replace/delete these once real content is added.
-- ============================================================
INSERT INTO news (title, event_date, summary, body, source) VALUES
('SLNA Annual Conference 2026 - Registrations Open', '2026-09-05',
 'Join nurses from across Sri Lanka for this year''s flagship conference focused on clinical excellence and leadership.',
 'Registrations are now open for the SLNA Annual Conference 2026. The conference will feature keynote addresses, research presentations, and networking sessions with healthcare leaders from across the country.',
 'typed'),
('New CPD Webinar Series Launched', '2026-08-12',
 'A new series of CPD-accredited webinars is now available for members through the e-learning portal.',
 'SLNA has launched a new series of CPD-accredited webinars covering clinical practice updates, ethics, and professional development.',
 'typed'),
('SLNA Position Statement on Nurse Staffing Ratios', '2026-07-20',
 'SLNA has released a formal position statement addressing safe staffing standards in public and private hospitals.',
 'Following extensive consultation with members and healthcare institutions, SLNA has issued a formal position statement calling for safe minimum nurse-to-patient staffing ratios.',
 'typed');
