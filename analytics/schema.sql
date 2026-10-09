-- Hariram Namkeen — first-party event table (Cloudflare D1)
-- Run once:  npx wrangler d1 execute hariram-analytics --remote --file=analytics/schema.sql

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
  sid          TEXT                -- random id for one browser-tab session (no cookie, not persistent)
);

CREATE INDEX IF NOT EXISTS idx_events_ts ON events (ts);
