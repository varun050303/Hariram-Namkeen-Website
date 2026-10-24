-- Hariram Namkeen — first-party event table (Cloudflare D1)
-- Run once:  npx wrangler d1 execute hariram-analytics --remote --file=analytics/schema.sql
--
-- EXISTING database (table already created before bot-filtering)? CREATE TABLE IF NOT EXISTS below
-- will not add the new columns. Run these once, one at a time (a "duplicate column" error just
-- means it is already applied):
--   npx wrangler d1 execute hariram-analytics --remote --command "ALTER TABLE events ADD COLUMN asorg TEXT"
--   npx wrangler d1 execute hariram-analytics --remote --command "ALTER TABLE events ADD COLUMN is_bot INTEGER DEFAULT 0"
--   npx wrangler d1 execute hariram-analytics --remote --command "ALTER TABLE events ADD COLUMN vid TEXT"
--   npx wrangler d1 execute hariram-analytics --remote --command "ALTER TABLE events ADD COLUMN active_s INTEGER"
--   npx wrangler d1 execute hariram-analytics --remote --command "ALTER TABLE events ADD COLUMN depth INTEGER"
--   npx wrangler d1 execute hariram-analytics --remote --command "ALTER TABLE events ADD COLUMN input INTEGER"
--   npx wrangler d1 execute hariram-analytics --remote --command "ALTER TABLE leads ADD COLUMN sid TEXT"

CREATE TABLE IF NOT EXISTS events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ts           INTEGER NOT NULL,   -- milliseconds since epoch (UTC)
  event        TEXT    NOT NULL,   -- landing | whatsapp_click | section_view
  source       TEXT,               -- which button / section (e.g. hero, mobile_bar, product:Aloo Bhujia, hamper)
  path         TEXT,               -- page path
  ref          TEXT,               -- referrer hostname only (e.g. l.instagram.com, google.com)
  utm_source   TEXT,
  utm_medium   TEXT,
  utm_campaign TEXT,
  device       TEXT,               -- mobile | desktop
  country      TEXT,               -- 2-letter country from Cloudflare
  city         TEXT,               -- visitor city from Cloudflare (e.g. Prayagraj, Varanasi, Lucknow, New Delhi)
  region       TEXT,               -- state code/name from Cloudflare (e.g. UP, DL, MH)
  asorg        TEXT,               -- network owner from Cloudflare (e.g. Reliance Jio, Google Cloud) — no IP stored
  is_bot       INTEGER DEFAULT 0,  -- 1 = flagged by functions/api/track.js (crawler UA, datacenter network, webdriver)
  vid          TEXT,               -- random visitor id kept in the browser (localStorage) to tell new from returning; NULL = old tracker
  active_s     INTEGER,            -- engage events: seconds the tab was visible AND the person was interacting
  depth        INTEGER,            -- engage events: deepest scroll position reached, 0-100 (% of page)
  input        INTEGER,            -- 1 = a real touch/click/key/wheel happened before this event, 0 = none yet, NULL = old tracker (unknown)
  sid          TEXT                -- random id for one browser-tab session
);

CREATE INDEX IF NOT EXISTS idx_events_ts ON events (ts);
CREATE INDEX IF NOT EXISTS idx_events_ts_event_sid ON events (ts, event, sid);
CREATE INDEX IF NOT EXISTS idx_events_event_ts ON events (event, ts DESC);
CREATE INDEX IF NOT EXISTS idx_events_sid_event ON events (sid, event);
CREATE INDEX IF NOT EXISTS idx_events_event_sid_ts ON events (event, sid, ts);
CREATE INDEX IF NOT EXISTS idx_events_city ON events (city);
CREATE INDEX IF NOT EXISTS idx_events_vid ON events (vid);

-- Manual log of real WhatsApp conversations: the only place a "tap" becomes an order.
-- Filled from the dashboard ("Real orders" card). source = where they came from, using the
-- Ref: tag in their first WhatsApp message (GAds -> google_ads, instagram, ...).
CREATE TABLE IF NOT EXISTS leads (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  ts      INTEGER NOT NULL,        -- milliseconds since epoch (UTC)
  source  TEXT    NOT NULL,        -- google_ads | instagram | whatsapp | email | referral | direct | ...
  status  TEXT    NOT NULL,        -- chat | quote | paid | lost
  amount  REAL,                    -- rupees, when paid
  note    TEXT,
  sid     TEXT                     -- website session this chat was linked to by hand (optional)
);

CREATE INDEX IF NOT EXISTS idx_leads_ts ON leads (ts);
