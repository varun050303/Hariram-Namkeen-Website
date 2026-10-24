#!/usr/bin/env node
// Hariram Namkeen — local analytics dashboard (reads Cloudflare D1 via wrangler)
//
//   npm run analytics            → http://localhost:43210
//   PORT=5000 npm run analytics  → custom port
//   D1_NAME=my-db npm run analytics
//
// Needs: `npx wrangler login` once, and the tables from analytics/schema.sql
// (existing databases: run the two ALTER TABLE lines at the top of that file once).
// Serves on 127.0.0.1 only. See analytics/README.md for what each event means.
//
// How the numbers are built (this is what makes them trustworthy):
//   • One row per SESSION: a browser-tab visit that fired a `landing` event. Events without a sid, or
//     sessions we never saw land, are never counted as sessions.
//   • Scope (top-right toggle):
//       "India · humans" (default) = not flagged is_bot AND country = IN
//       "All humans"               = not flagged is_bot
//       "Raw"                      = everything, including bots — use it to audit what is being hidden
//   • "Engaged" = scrolled to at least one section OR tapped Order. Landing-only sessions are the
//     bot / mis-click bucket.
//   • We count PEOPLE who tapped (sessions with ≥1 tap), not raw taps.
//   • A tap is not an order. The "Real orders" card (leads table) is the manual log of actual chats.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 43210;
const HOST = '127.0.0.1';
const DB_NAME = process.env.D1_NAME || 'hariram-analytics';

const RANGES = [7, 30, 90];
const DEFAULT_DAYS = 7;
const SCOPES = ['in', 'all', 'raw'];
const DEFAULT_SCOPE = 'in';
const LEAD_STATUSES = ['chat', 'quote', 'paid', 'lost'];
const CACHE_TTL_MS = 60_000; // wrangler is slow (3-6s per call), so cache
const MIN_FORCE_GAP_MS = 10_000; // "Refresh" can't hammer D1 more than once per 10s
const DAY = 86_400_000;
const IST_OFFSET_MIN = 330;
const IST = `+${IST_OFFSET_MIN} minutes`;

// ───────────────────────────── D1 access ─────────────────────────────

function explain(message) {
  const m = String(message || '');
  if (/not authenticated|not logged in|wrangler login|CLOUDFLARE_API_TOKEN|OAuth/i.test(m)) {
    return 'Wrangler is not logged in. Run: npx wrangler login';
  }
  if (/no such table.*leads/i.test(m)) {
    return 'Table "leads" not found. Run: npx wrangler d1 execute hariram-analytics --remote --file=analytics/schema.sql';
  }
  if (/no such table/i.test(m)) {
    return 'Table "events" not found. Run the schema step in analytics/README.md';
  }
  if (/no such column.*(is_bot|asorg|vid|active_s|depth|input|l\.sid)/i.test(m)) {
    return 'D1 is missing analytics columns. Run the ALTER TABLE lines at the top of analytics/schema.sql (one at a time).';
  }
  if (/no such column.*(city|region)/i.test(m)) {
    return 'D1 table is missing city/region columns. Run: npx wrangler d1 execute hariram-analytics --remote --command "ALTER TABLE events ADD COLUMN city TEXT; ALTER TABLE events ADD COLUMN region TEXT;"';
  }
  if (/no such column/i.test(m)) {
    return `D1 schema mismatch: ${m.trim()}. Run migrations in analytics/schema.sql`;
  }
  if (/database.*(not found|does not exist)|(not found|does not exist).*database/i.test(m)) {
    return `D1 database "${DB_NAME}" was not found in this Cloudflare account`;
  }
  return m.trim().split('\n').filter(Boolean).slice(-4).join(' ').slice(0, 400) || 'Unknown wrangler error';
}

const CF_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const CF_D1_DATABASE_ID = process.env.D1_DATABASE_ID || process.env.CLOUDFLARE_DATABASE_ID;

async function runD1Api(sql) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/d1/database/${CF_D1_DATABASE_ID}/query`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${CF_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sql }),
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    const msg = data.errors?.map((e) => e.message).join(', ') || `HTTP ${res.status}`;
    throw new Error(`D1 API error: ${msg}`);
  }
  return data.result;
}

function runD1Cli(sql) {
  const local = path.join(ROOT, 'node_modules', '.bin', 'wrangler');
  const [bin, pre] = fs.existsSync(local) ? [local, []] : ['npx', ['--yes', 'wrangler']];
  const args = [...pre, 'd1', 'execute', DB_NAME, '--remote', '--json', '--command', sql];

  return new Promise((resolve, reject) => {
    execFile(
      bin,
      args,
      { cwd: ROOT, maxBuffer: 20 * 1024 * 1024, timeout: 90_000, env: { ...process.env, NO_COLOR: '1' } },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(explain(stderr || stdout || err.message)));
        const match = stdout.match(/^\s*\[\s*[\{\]]/m);
        const jsonText = match ? stdout.slice(match.index) : stdout;
        try {
          resolve(JSON.parse(jsonText));
        } catch {
          reject(new Error('Could not parse wrangler output'));
        }
      },
    );
  });
}

function runD1(sql) {
  if (CF_API_TOKEN && CF_ACCOUNT_ID && CF_D1_DATABASE_ID) {
    return runD1Api(sql).catch((err) => {
      console.warn(`[analytics] Direct D1 API failed (${err.message}), falling back to wrangler CLI`);
      return runD1Cli(sql);
    });
  }
  return runD1Cli(sql);
}

// ───────────────────────────── Queries ─────────────────────────────
// All times are bucketed in IST (the business's timezone), not UTC.
// Every metric except the raw event stream is computed from `sess`: ONE ROW PER SESSION.

// Which events may count, per scope. `sid <> ''` always: an event with no session id can't be a session.
function baseFilter(scope) {
  const parts = ["sid <> ''"];
  if (scope !== 'raw') parts.push('COALESCE(is_bot, 0) = 0');
  if (scope === 'in') parts.push("UPPER(country) = 'IN'");
  return parts.join(' AND ');
}

// Collapse events into sessions. A session exists only if we saw its `landing`.
// Events are limited to ts >= since, so a session that landed before `since` has no landing here
// and drops out — which is correct (it belongs to an earlier period).
function sessCte(since, base) {
  const first = (col) => `COALESCE(MAX(CASE WHEN event = 'landing' THEN NULLIF(${col}, '') END), MAX(NULLIF(${col}, '')))`;
  return `WITH sess AS (
  SELECT sid,
         MIN(CASE WHEN event = 'landing' THEN ts END) AS t0,
         MIN(CASE WHEN event = 'whatsapp_click' THEN ts END) AS tap_ts,
         MAX(event = 'section_view') AS scrolled,
         SUM(event = 'whatsapp_click') AS taps,
         MAX(input IS NOT NULL) AS inst,
         MAX(COALESCE(input, 0)) AS human,
         MAX(active_s) AS active_s,
         MAX(depth) AS depth,
         MAX(NULLIF(vid, '')) AS vid,
         MAX(COALESCE(is_bot, 0)) AS is_bot,
         MAX(CASE WHEN event = 'landing' THEN device END) AS device,
         MAX(country) AS country, MAX(city) AS city, MAX(region) AS region,
         ${first('utm_source')} AS utm_source,
         ${first('utm_medium')} AS utm_medium,
         ${first('utm_campaign')} AS utm_campaign,
         ${first('ref')} AS ref
  FROM events
  WHERE ts >= ${since} AND ${base}
  GROUP BY sid
  HAVING SUM(event = 'landing') > 0
)`;
}

function buildQueries(now, days, scope) {
  const todayStart = Math.floor((now + IST_OFFSET_MIN * 60_000) / DAY) * DAY - IST_OFFSET_MIN * 60_000;
  const S = Math.floor(todayStart - (days - 1) * DAY); // start of range (IST midnight)
  const P_START = S - days * DAY; // shifted window: exact same hours of day & days of week
  const P_END = now - days * DAY;
  const base = baseFilter(scope);
  const sess = (since) => sessCte(since, base);
  const engaged = '(scrolled = 1 OR taps > 0)';
  const inSessions = `sid IN (SELECT sid FROM sess WHERE t0 >= ${S})`;

  const queries = [
    [
      'overview',
      `${sess(P_START)}
      SELECT
        SUM(t0 >= ${S}) AS sessions,
        SUM(t0 >= ${S} AND ${engaged}) AS engaged,
        SUM(t0 >= ${S} AND taps > 0) AS tappers,
        SUM(CASE WHEN t0 >= ${S} THEN taps ELSE 0 END) AS taps,
        SUM(t0 < ${P_END}) AS prev_sessions,
        SUM(t0 < ${P_END} AND ${engaged}) AS prev_engaged,
        SUM(t0 < ${P_END} AND taps > 0) AS prev_tappers,
        SUM(CASE WHEN t0 < ${P_END} THEN taps ELSE 0 END) AS prev_taps
      FROM sess`,
    ],
    [
      'allTime',
      `${sess(0)}
      SELECT COUNT(*) AS sessions, SUM(taps > 0) AS tappers, (SELECT MIN(ts) FROM events) AS first_ts
      FROM sess`,
    ],
    [
      // What the scope is hiding, so the filter itself is auditable (always computed on raw landings).
      'filtered',
      `SELECT COUNT(*) AS raw_sessions,
              SUM(is_bot = 1) AS bots,
              SUM(is_bot = 0 AND UPPER(country) <> 'IN') AS non_india
       FROM (
         SELECT sid, MAX(COALESCE(is_bot, 0)) AS is_bot, MAX(country) AS country
         FROM events
         WHERE event = 'landing' AND sid <> '' AND ts >= ${S}
         GROUP BY sid
       )`,
    ],
    [
      'daily',
      `${sess(S)}
      SELECT date(t0/1000, 'unixepoch', '${IST}') AS day,
             COUNT(*) AS sessions,
             SUM(${engaged}) AS engaged,
             SUM(taps > 0) AS tappers,
             SUM(taps) AS taps
      FROM sess WHERE t0 >= ${S}
      GROUP BY day ORDER BY day`,
    ],
    [
      // Sessions bucketed by landing hour; tappers bucketed by the hour of their first tap.
      'hourly',
      `${sess(S)}
      SELECT hour, SUM(s) AS sessions, SUM(t) AS tappers FROM (
        SELECT CAST(strftime('%H', t0/1000, 'unixepoch', '${IST}') AS INTEGER) AS hour, 1 AS s, 0 AS t
        FROM sess WHERE t0 >= ${S}
        UNION ALL
        SELECT CAST(strftime('%H', tap_ts/1000, 'unixepoch', '${IST}') AS INTEGER) AS hour, 0 AS s, 1 AS t
        FROM sess WHERE tap_ts >= ${S}
      ) GROUP BY hour ORDER BY hour`,
    ],
    [
      'devices',
      `${sess(S)}
      SELECT COALESCE(device, 'unknown') AS device, COUNT(*) AS sessions, SUM(taps > 0) AS tappers
      FROM sess WHERE t0 >= ${S}
      GROUP BY 1 ORDER BY sessions DESC`,
    ],
    [
      'cities',
      `${sess(S)}
      SELECT COALESCE(NULLIF(city, ''), 'Unknown') AS city,
             COALESCE(NULLIF(region, ''), '') AS region,
             'IN' AS country,
             COUNT(*) AS sessions,
             SUM(taps > 0) AS tappers
      FROM sess WHERE t0 >= ${S} AND UPPER(country) = 'IN'
      GROUP BY 1, 2 ORDER BY sessions DESC LIMIT 15`,
    ],
    [
      'countries',
      `${sess(S)}
      SELECT COALESCE(NULLIF(country, ''), '??') AS country, COUNT(*) AS sessions, SUM(taps > 0) AS tappers
      FROM sess WHERE t0 >= ${S}
      GROUP BY 1 ORDER BY sessions DESC LIMIT 15`,
    ],
    [
      'origins',
      `${sess(S)}
      SELECT COALESCE(utm_source, ref, 'direct') AS origin,
             COUNT(*) AS sessions,
             SUM(${engaged}) AS engaged,
             SUM(taps > 0) AS tappers
      FROM sess WHERE t0 >= ${S}
      GROUP BY 1 ORDER BY sessions DESC, origin LIMIT 12`,
    ],
    [
      'campaigns',
      `${sess(S)}
      SELECT utm_source,
             COALESCE(utm_medium, '—') AS utm_medium,
             COALESCE(utm_campaign, '—') AS utm_campaign,
             COUNT(*) AS sessions,
             SUM(taps > 0) AS tappers
      FROM sess WHERE t0 >= ${S} AND utm_source IS NOT NULL
      GROUP BY 1, 2, 3 ORDER BY sessions DESC LIMIT 10`,
    ],
    [
      'buttons',
      `${sess(S)}
      SELECT COALESCE(NULLIF(source, ''), 'other') AS source, COUNT(*) AS taps, COUNT(DISTINCT sid) AS people
      FROM events
      WHERE event = 'whatsapp_click' AND ts >= ${S} AND ${inSessions}
      GROUP BY 1 ORDER BY taps DESC LIMIT 15`,
    ],
    [
      // Scroll funnel over the same qualified sessions; "Landed" is overview.sessions, so it always reconciles.
      'funnel',
      `${sess(S)}
      SELECT COALESCE(source, '') AS source, COUNT(DISTINCT sid) AS sessions
      FROM events
      WHERE event = 'section_view' AND ts >= ${S} AND ${inSessions}
      GROUP BY source`,
    ],
    [
      'recentTaps',
      `SELECT datetime(c.ts/1000,'unixepoch','${IST}') AS time,
              COALESCE(NULLIF(c.source,''),'other') AS source,
              COALESCE(NULLIF(l.utm_source,''), NULLIF(l.ref,''), NULLIF(c.utm_source,''), NULLIF(c.ref,''), 'direct') AS origin,
              COALESCE(NULLIF(l.utm_campaign,''), NULLIF(c.utm_campaign,''), '') AS campaign,
              c.device AS device, c.country AS country, c.city AS city, c.region AS region,
              c.asorg AS asorg, substr(c.sid,1,6) AS sid
       FROM (
         SELECT * FROM events
         WHERE event = 'whatsapp_click' AND ${base}
         ORDER BY ts DESC, id DESC LIMIT 30
       ) c
       LEFT JOIN events l ON l.id = (
         SELECT id FROM events
         WHERE sid = c.sid AND sid <> '' AND event = 'landing'
         ORDER BY ts ASC, id ASC LIMIT 1
       )
       ORDER BY c.ts DESC, c.id DESC`,
    ],
    [
      // Always unfiltered, with the bot flag and network visible: this is the audit trail.
      'recentEvents',
      `SELECT datetime(ts/1000,'unixepoch','${IST}') AS time, event, source, path, ref,
              device, country, city, region, asorg, COALESCE(is_bot, 0) AS is_bot, substr(sid,1,6) AS sid
       FROM events ORDER BY ts DESC, id DESC LIMIT 40`,
    ],
    [
      // One row per session recorded by the new tracker (inst = 1). Old sessions are NOT guessed at:
      // they have no input/active/depth/vid, so they are left out of these numbers on purpose.
      'engagement',
      `${sess(S)}
      SELECT s.human AS human, s.active_s AS active_s, s.depth AS depth, s.taps AS taps,
             CASE WHEN s.tap_ts IS NULL THEN NULL ELSE (s.tap_ts - s.t0) / 1000.0 END AS tap_secs,
             CASE WHEN s.vid IS NULL THEN NULL
                  WHEN EXISTS (SELECT 1 FROM events e WHERE e.vid = s.vid AND e.event = 'landing' AND e.ts < s.t0 - 1800000) THEN 1
                  ELSE 0 END AS is_returning
      FROM sess s WHERE s.t0 >= ${S} AND s.inst = 1
      ORDER BY s.t0 DESC LIMIT 3000`,
    ],
    [
      'sessionList',
      `${sess(S)}
      SELECT datetime(s.t0/1000,'unixepoch','${IST}') AS time,
             COALESCE(s.utm_source, s.ref, 'direct') AS origin,
             s.device AS device, s.country AS country, s.city AS city, s.region AS region,
             s.taps AS taps, s.inst AS inst, s.human AS human, s.active_s AS active_s, s.depth AS depth,
             s.is_bot AS is_bot, s.sid AS sid_full, substr(s.sid,1,6) AS sid,
             CASE WHEN s.vid IS NULL THEN NULL
                  WHEN EXISTS (SELECT 1 FROM events e WHERE e.vid = s.vid AND e.event = 'landing' AND e.ts < s.t0 - 1800000) THEN 1
                  ELSE 0 END AS is_returning
      FROM sess s WHERE s.t0 >= ${S}
      ORDER BY s.t0 DESC LIMIT 60`,
    ],
    [
      // Ordered events for those same 60 sessions; the journey text is assembled in JS (guaranteed order).
      'sessionEvents',
      `${sess(S)}
      SELECT sid, event, source FROM events
      WHERE event IN ('landing', 'section_view', 'whatsapp_click')
        AND sid IN (SELECT sid FROM sess WHERE t0 >= ${S} ORDER BY t0 DESC LIMIT 60)
      ORDER BY ts, id`,
    ],
    [
      // Recent taps to pick from when logging a chat (links a real conversation to a real visit).
      'tapChoices',
      `SELECT c.sid AS sid, datetime(c.ts/1000,'unixepoch','${IST}') AS time,
              COALESCE(NULLIF(c.source,''),'other') AS source,
              COALESCE(NULLIF(c.utm_source,''), NULLIF(c.ref,''), 'direct') AS origin,
              c.device AS device,
              EXISTS (SELECT 1 FROM leads l WHERE l.sid = c.sid) AS linked
       FROM events c
       WHERE c.event = 'whatsapp_click' AND ${base} AND c.ts >= ${now - 14 * DAY}
       ORDER BY c.ts DESC, c.id DESC LIMIT 40`,
    ],
    [
      // Is the pipeline alive, and since when does each signal exist? Always computed on every event.
      'health',
      `SELECT COUNT(*) AS events, MAX(ts) AS last_ts,
              SUM(ts >= ${now - DAY}) AS last_24h,
              SUM(city IS NOT NULL AND city <> '') AS with_city,
              MIN(CASE WHEN city IS NOT NULL AND city <> '' THEN ts END) AS city_since,
              MIN(CASE WHEN asorg IS NOT NULL THEN ts END) AS flag_since,
              MIN(CASE WHEN input IS NOT NULL THEN ts END) AS measure_since,
              SUM(is_bot = 1) AS flagged
       FROM events`,
    ],
    [
      'leadSummary',
      `SELECT COALESCE(NULLIF(source,''),'unknown') AS source,
              COUNT(*) AS chats,
              SUM(status IN ('quote','paid')) AS quotes,
              SUM(status = 'paid') AS paid,
              COALESCE(SUM(CASE WHEN status = 'paid' THEN amount END), 0) AS revenue
       FROM leads WHERE ts >= ${S}
       GROUP BY 1 ORDER BY chats DESC`,
    ],
    [
      'leads',
      `SELECT l.id AS id, datetime(l.ts/1000,'unixepoch','${IST}') AS time, l.source AS source, l.status AS status,
              l.amount AS amount, l.note AS note, l.sid AS sid,
              (SELECT COALESCE(NULLIF(e.utm_source,''), NULLIF(e.ref,''), 'direct') || ' · ' || COALESCE(e.device,'?')
                 FROM events e WHERE e.sid = l.sid AND e.event = 'landing' ORDER BY e.ts LIMIT 1) AS linked,
              (SELECT group_concat(DISTINCT e.source) FROM events e WHERE e.sid = l.sid AND e.event = 'whatsapp_click') AS tapped
       FROM leads l ORDER BY l.ts DESC, l.id DESC LIMIT 15`,
    ],
  ];

  return { queries, S };
}

const FUNNEL_ORDER = ['oil-truth', 'products', 'hamper', 'story'];
const istDay = (ms) => new Date(ms + IST_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
const n = (v) => Number(v) || 0;

async function fetchAnalytics(days, scope) {
  const now = Date.now();
  const { queries, S } = buildQueries(now, days, scope);

  const raw = await runD1(queries.map(([, sql]) => sql).join(';\n'));
  if (!Array.isArray(raw) || raw.length !== queries.length) {
    throw new Error(`Unexpected D1 response (expected ${queries.length} result sets, got ${Array.isArray(raw) ? raw.length : 'none'})`);
  }
  const r = {};
  queries.forEach(([name], i) => {
    r[name] = raw[i]?.results || [];
  });

  const ov = r.overview[0] || {};
  const all = r.allTime[0] || {};
  const fl = r.filtered[0] || {};
  const overview = {
    sessions: n(ov.sessions),
    engaged: n(ov.engaged),
    tappers: n(ov.tappers),
    taps: n(ov.taps),
    prev: {
      sessions: n(ov.prev_sessions),
      engaged: n(ov.prev_engaged),
      tappers: n(ov.prev_tappers),
      taps: n(ov.prev_taps),
    },
  };

  // Fill days with no traffic so the trend line isn't misleading.
  const byDay = new Map(r.daily.map((d) => [d.day, d]));
  const daily = Array.from({ length: days }, (_, i) => {
    const day = istDay(now - (days - 1 - i) * DAY);
    const d = byDay.get(day) || {};
    return { day, sessions: n(d.sessions), engaged: n(d.engaged), tappers: n(d.tappers), taps: n(d.taps) };
  });

  const byHour = new Map(r.hourly.map((h) => [n(h.hour), h]));
  const hourly = Array.from({ length: 24 }, (_, hour) => {
    const h = byHour.get(hour) || {};
    return { hour, sessions: n(h.sessions), tappers: n(h.tappers) };
  });

  // Funnel: landed → each section scrolled into view (page order) → tapped WhatsApp.
  // Every step is a subset of the same qualified sessions, so no step can exceed "Landed".
  const sections = r.funnel
    .map((f) => ({ label: f.source || 'unknown', sessions: n(f.sessions) }))
    .sort((a, b) => {
      const ia = FUNNEL_ORDER.indexOf(a.label);
      const ib = FUNNEL_ORDER.indexOf(b.label);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || b.sessions - a.sessions;
    });
  const funnel = [
    { label: 'Landed', sessions: overview.sessions },
    ...sections,
    { label: 'Tapped WhatsApp', sessions: overview.tappers, final: true },
  ];

  const median = (arr) => {
    if (!arr.length) return null;
    const a = [...arr].sort((x, y) => x - y);
    const m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  };
  // Visitor-quality numbers come only from sessions the new tracker measured (never guessed for older ones).
  const eng = r.engagement;
  const humanRows = eng.filter((e) => n(e.human) === 1);
  const activeVals = humanRows.filter((e) => e.active_s != null).map((e) => n(e.active_s));
  const depthVals = humanRows.filter((e) => e.depth != null).map((e) => n(e.depth));
  const tapVals = eng.filter((e) => e.tap_secs != null).map((e) => Number(e.tap_secs)).filter((x) => x >= 0);
  const known = eng.filter((e) => e.is_returning != null);
  const visitors = {
    measured: eng.length,
    human: humanRows.length,
    activeN: activeVals.length,
    activeMedian: median(activeVals),
    depthN: depthVals.length,
    depthMedian: median(depthVals),
    tapN: tapVals.length,
    tapMedian: median(tapVals),
    knownVisitors: known.length,
    returning: known.filter((e) => n(e.is_returning) === 1).length,
    newVisitors: known.filter((e) => n(e.is_returning) === 0).length,
  };

  const hl = r.health[0] || {};
  const health = {
    events: n(hl.events),
    lastTs: n(hl.last_ts) || null,
    last24h: n(hl.last_24h),
    withCity: n(hl.with_city),
    citySince: n(hl.city_since) || null,
    flagSince: n(hl.flag_since) || null,
    measureSince: n(hl.measure_since) || null,
    flagged: n(hl.flagged),
  };

  const journeys = new Map();
  for (const e of r.sessionEvents) {
    const label = e.event === 'landing' ? 'landed' : e.event === 'section_view' ? e.source || 'section' : `TAP ${e.source || ''}`.trim();
    if (!journeys.has(e.sid)) journeys.set(e.sid, []);
    journeys.get(e.sid).push(label);
  }
  const sessionList = r.sessionList.map(({ sid_full, ...row }) => ({ ...row, journey: (journeys.get(sid_full) || []).join(' → ') }));

  const rows = (name) => r[name].map((row) => ({ ...row }));

  return {
    days,
    scope,
    fetchedAt: new Date(now).toISOString(),
    rangeStartIst: istDay(S),
    overview,
    allTime: { sessions: n(all.sessions), tappers: n(all.tappers), firstTs: n(all.first_ts) || null },
    filtered: { raw: n(fl.raw_sessions), bots: n(fl.bots), nonIndia: n(fl.non_india) },
    daily,
    hourly,
    funnel,
    devices: rows('devices'),
    cities: rows('cities'),
    countries: rows('countries'),
    origins: rows('origins'),
    campaigns: rows('campaigns'),
    buttons: rows('buttons'),
    recentTaps: rows('recentTaps'),
    recentEvents: rows('recentEvents'),
    leadSummary: rows('leadSummary'),
    leads: rows('leads'),
    visitors,
    health,
    sessionList,
    tapChoices: rows('tapChoices'),
  };
}

// ───────────────────────────── Leads (manual log) ─────────────────────────────

const badRequest = (message) => Object.assign(new Error(message), { status: 400 });
const sqlStr = (s) => `'${String(s).replace(/'/g, "''")}'`;

function readJson(req, limit = 4000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooBig = false;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) tooBig = true;
      else chunks.push(c);
    });
    req.on('end', () => {
      if (tooBig) return reject(badRequest('Body too large'));
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(badRequest('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function parseAmount(v) {
  if (v === '' || v == null) return null;
  const a = Number(v);
  if (!Number.isFinite(a) || a < 0 || a > 10_000_000) throw badRequest('Amount must be a number between 0 and 10,000,000');
  return a;
}

async function saveLead(b) {
  if (!b || typeof b !== 'object') throw badRequest('Invalid body');

  if (b.action === 'update') {
    const id = Number(b.id);
    if (!Number.isInteger(id) || id < 1) throw badRequest('Invalid lead id');
    if (!LEAD_STATUSES.includes(b.status)) throw badRequest('Invalid status');
    const amount = parseAmount(b.amount);
    const sets = [`status = ${sqlStr(b.status)}`];
    if (amount !== null) sets.push(`amount = ${amount}`);
    await runD1(`UPDATE leads SET ${sets.join(', ')} WHERE id = ${id}`);
    return;
  }

  if (b.action === 'add') {
    if (!LEAD_STATUSES.includes(b.status)) throw badRequest('Invalid status');
    const source = String(b.source || '').trim().toLowerCase().replace(/[^a-z0-9_:.\- ]/g, '').slice(0, 40) || 'unknown';
    // eslint-disable-next-line no-control-regex
    const note = String(b.note || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 120);
    const amount = parseAmount(b.amount);
    const sid = String(b.sid || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16);
    await runD1(
      `INSERT INTO leads (ts, source, status, amount, note, sid) VALUES (${Date.now()}, ${sqlStr(source)}, ${sqlStr(b.status)}, ${amount === null ? 'NULL' : amount}, ${note ? sqlStr(note) : 'NULL'}, ${sid ? sqlStr(sid) : 'NULL'})`,
    );
    return;
  }

  throw badRequest('Unknown action');
}

// ───────────────────────────── Cache ─────────────────────────────

const cache = new Map(); // "days:scope" → { at, data }
const inflight = new Map(); // "days:scope" → Promise

async function getData(days, scope, force) {
  const key = `${days}:${scope}`;
  const hit = cache.get(key);
  const age = hit ? Date.now() - hit.at : Infinity;
  if (hit && age < CACHE_TTL_MS && !(force && age > MIN_FORCE_GAP_MS)) return hit.data;
  if (inflight.has(key)) return inflight.get(key);

  const p = fetchAnalytics(days, scope)
    .then((data) => {
      cache.set(key, { at: Date.now(), data });
      return data;
    })
    .catch((err) => {
      if (hit) return { ...hit.data, stale: true, error: err.message }; // show old data + warning
      throw err;
    })
    .finally(() => inflight.delete(key));

  inflight.set(key, p);
  return p;
}

// ───────────────────────────── Page ─────────────────────────────
// NOTE: this is String.raw — do not use backticks or "${" inside the client code below.

const HTML_TEMPLATE = String.raw`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Hariram Namkeen — Analytics Hub</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.2/dist/chart.umd.min.js" integrity="sha384-e6cc9LaIG7xZ3XD5B+jtr1NhTWPQGQdRCh6xiZ+ZFUtWCpg4ycv3Sh+SkZoopvUY" crossorigin="anonymous"></script>
<style>
  :root {
    --bg:#0c0e14; --surface:#141822; --border:#1f2637; --hover:#1c2233;
    --text:#f1f5f9; --muted:#94a3b8; --subtle:#64748b;
    --brand:#f59e0b; --green:#10b981; --wa:#25d366; --red:#f87171; --blue:#60a5fa;
    --radius:16px;
    --font:'Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,sans-serif;
    --mono:'JetBrains Mono',ui-monospace,monospace;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:var(--bg);color:var(--text);font-family:var(--font);min-height:100vh;line-height:1.5;padding:24px;-webkit-font-smoothing:antialiased}
  .container{max-width:1400px;margin:0 auto}
  header{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:20px;padding-bottom:20px;border-bottom:1px solid var(--border)}
  .brand{display:flex;align-items:center;gap:12px}
  .logo{background:linear-gradient(135deg,#d97706,#b45309);color:#fff;font-weight:800;font-size:1.25rem;padding:8px 14px;border-radius:12px;box-shadow:0 4px 12px rgba(217,119,6,.3)}
  h1{font-size:1.4rem;font-weight:800;letter-spacing:-.02em}
  .subtitle{color:var(--muted);font-size:.85rem}
  .actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  .seg{display:flex;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:3px}
  .seg button{background:none;border:0;color:var(--muted);font:600 .85rem var(--font);padding:6px 14px;border-radius:8px;cursor:pointer}
  .seg button:hover{color:var(--text)}
  .seg button[aria-pressed="true"]{background:var(--brand);color:#1a1100}
  .pill{display:flex;align-items:center;gap:8px;border:1px solid var(--border);color:var(--muted);padding:6px 14px;border-radius:9999px;font-size:.8rem;font-weight:600}
  .pill .dot{width:8px;height:8px;border-radius:50%;background:var(--subtle)}
  .pill.ok{color:var(--green);border-color:rgba(16,185,129,.3);background:rgba(16,185,129,.08)}
  .pill.ok .dot{background:var(--green);box-shadow:0 0 8px var(--green);animation:pulse 2s infinite}
  .pill.warn{color:var(--brand);border-color:rgba(245,158,11,.35)}
  .pill.warn .dot{background:var(--brand)}
  .pill.err{color:var(--red);border-color:rgba(248,113,113,.35)}
  .pill.err .dot{background:var(--red)}
  @keyframes pulse{50%{opacity:.4;transform:scale(.9)}}
  .btn{background:var(--surface);border:1px solid var(--border);color:var(--text);padding:8px 16px;border-radius:10px;font:600 .85rem var(--font);cursor:pointer;transition:all .15s}
  .btn:hover{background:var(--hover);border-color:var(--brand);color:var(--brand)}
  .btn:disabled{opacity:.5;cursor:progress}
  .banner{display:none;margin-bottom:16px;padding:12px 16px;border-radius:12px;font-size:.875rem;background:rgba(248,113,113,.1);border:1px solid rgba(248,113,113,.35);color:#fecaca}
  .banner.show{display:block}
  .note{display:none;margin-bottom:16px;padding:10px 14px;border-radius:12px;font-size:.8rem;background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.25);color:#fcd34d}
  .note.show{display:block}
  .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin-bottom:20px}
  .kpi{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:20px}
  .kpi-label{color:var(--muted);font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px}
  .kpi-value{font-size:2rem;font-weight:800;letter-spacing:-.03em;line-height:1.1;margin-bottom:6px}
  .kpi-sub{font-size:.8rem;color:var(--subtle);display:flex;gap:6px;align-items:center;flex-wrap:wrap}
  .c-wa{color:var(--wa)} .c-brand{color:var(--brand)} .c-green{color:var(--green)}
  .delta{font-weight:700;font-size:.75rem;padding:1px 7px;border-radius:6px;background:rgba(148,163,184,.12);color:var(--muted)}
  .delta.up{background:rgba(16,185,129,.14);color:var(--green)}
  .delta.down{background:rgba(248,113,113,.14);color:var(--red)}
  .grid{display:grid;gap:20px;margin-bottom:20px}
  .g-21{grid-template-columns:2fr 1fr} .g-11{grid-template-columns:1fr 1fr}
  @media (max-width:1024px){.g-21,.g-11{grid-template-columns:1fr}}
  .card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:22px;min-width:0}
  .card-title{font-size:1rem;font-weight:700;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;gap:8px}
  .tag{font-size:.7rem;background:var(--border);padding:4px 10px;border-radius:9999px;color:var(--muted);font-weight:600;white-space:nowrap}
  .chart{height:270px;position:relative}
  .scroll{overflow-x:auto}
  table{width:100%;border-collapse:collapse;text-align:left;font-size:.85rem}
  th{color:var(--subtle);font-weight:700;padding:9px 10px;border-bottom:1px solid var(--border);font-size:.7rem;text-transform:uppercase;letter-spacing:.05em;white-space:nowrap}
  td{padding:10px;border-bottom:1px solid rgba(255,255,255,.04);color:var(--muted)}
  tbody tr:hover td{background:var(--hover);color:var(--text)}
  .r{text-align:right} .mono{font-family:var(--mono)} .small{font-size:.75rem}
  .empty{text-align:center;padding:28px;color:var(--subtle)}
  .badge{display:inline-block;padding:2px 8px;border-radius:6px;font:600 .72rem var(--mono)}
  .b-wa{background:rgba(37,211,102,.15);color:#4ade80;border:1px solid rgba(37,211,102,.3)}
  .b-land{background:rgba(245,158,11,.12);color:#fbbf24;border:1px solid rgba(245,158,11,.3)}
  .b-ev{background:rgba(59,130,246,.15);color:var(--blue);border:1px solid rgba(59,130,246,.3)}
  .b-dev{background:rgba(148,163,184,.1);color:var(--muted)}
  .b-bot{background:rgba(248,113,113,.15);color:#fca5a5;border:1px solid rgba(248,113,113,.3)}
  .src{background:rgba(245,158,11,.1);color:#fbbf24;padding:2px 8px;border-radius:6px;font:.78rem var(--mono)}
  .step{margin-bottom:14px}
  .step-top{display:flex;justify-content:space-between;gap:8px;font-size:.85rem;font-weight:600;margin-bottom:6px}
  .track{background:rgba(255,255,255,.05);height:8px;border-radius:9999px;overflow:hidden}
  .fill{height:100%;background:linear-gradient(90deg,#d97706,#fbbf24);border-radius:9999px;transition:width .5s ease}
  .fill.final{background:linear-gradient(90deg,#128c4a,var(--wa))}
  .drop{color:var(--subtle);font-weight:400;font-size:.75rem}
  .devlist{margin-top:12px;font-size:.8rem;color:var(--muted);display:grid;gap:4px}
  .devlist div{display:flex;justify-content:space-between}
  .formrow{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
  .in{background:var(--bg);border:1px solid var(--border);color:var(--text);padding:8px 10px;border-radius:8px;font:500 .85rem var(--font);min-width:0}
  .in:focus{outline:none;border-color:var(--brand)}
  .hint{color:var(--subtle);font-size:.75rem;margin-top:12px;line-height:1.6}
  .stats{display:grid;gap:2px}
  .stat{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;padding:9px 0;border-bottom:1px solid rgba(255,255,255,.04);font-size:.85rem;color:var(--muted)}
  .stat b{color:var(--text);font-weight:700;text-align:right;white-space:nowrap}
  .stat .why{display:block;color:var(--subtle);font-size:.72rem;font-weight:400;margin-top:2px;max-width:46ch;white-space:normal}
  footer{color:var(--subtle);font-size:.75rem;margin-top:8px;line-height:1.6}
  @media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
</style>
</head>
<body>
<div class="container">
  <header>
    <div class="brand">
      <div class="logo">HN</div>
      <div>
        <h1>Hariram Namkeen — Analytics Hub</h1>
        <div class="subtitle">First-party events from Cloudflare D1 · all times in IST</div>
      </div>
    </div>
    <div class="actions">
      <div class="seg" role="group" aria-label="Date range" id="range">
        <button data-days="7" aria-pressed="false">7 days</button>
        <button data-days="30" aria-pressed="false">30 days</button>
        <button data-days="90" aria-pressed="false">90 days</button>
      </div>
      <div class="seg" role="group" aria-label="Traffic scope" id="scope">
        <button data-scope="in" aria-pressed="false" title="Not flagged as a bot, and from India">India · humans</button>
        <button data-scope="all" aria-pressed="false" title="Not flagged as a bot, any country">All humans</button>
        <button data-scope="raw" aria-pressed="false" title="Everything recorded, including bots — for auditing">Raw</button>
      </div>
      <div class="pill" id="pill"><span class="dot"></span><span id="pillText">Connecting to D1…</span></div>
      <button class="btn" id="refresh">Refresh</button>
    </div>
  </header>

  <div class="banner" id="banner" role="alert"></div>
  <div class="note" id="sample"></div>

  <section class="kpis" aria-label="Key numbers">
    <div class="kpi"><div class="kpi-label">Sessions</div><div class="kpi-value" id="k-sessions">—</div><div class="kpi-sub" id="k-sessions-sub">&nbsp;</div></div>
    <div class="kpi"><div class="kpi-label">Engaged (scrolled or tapped)</div><div class="kpi-value c-brand" id="k-engaged">—</div><div class="kpi-sub" id="k-engaged-sub">&nbsp;</div></div>
    <div class="kpi"><div class="kpi-label">Tapped Order (rate)</div><div class="kpi-value c-wa" id="k-rate">—</div><div class="kpi-sub" id="k-rate-sub">&nbsp;</div></div>
    <div class="kpi"><div class="kpi-label">Paid orders (logged)</div><div class="kpi-value c-green" id="k-paid">—</div><div class="kpi-sub" id="k-paid-sub">&nbsp;</div></div>
  </section>

  <div class="grid g-21">
    <div class="card">
      <div class="card-title"><span>Sessions &amp; people who tapped Order</span><span class="tag" id="trendTag">Daily</span></div>
      <div class="chart"><canvas id="trend"></canvas></div>
    </div>
    <div class="card">
      <div class="card-title"><span>Devices</span><span class="tag">Sessions</span></div>
      <div class="chart" style="height:190px"><canvas id="devices"></canvas></div>
      <div class="devlist" id="devlist"></div>
    </div>
  </div>

  <div class="grid g-11">
    <div class="card">
      <div class="card-title"><span>Scroll funnel</span><span class="tag">Share of sessions that landed</span></div>
      <div id="funnel"><div class="empty">Loading…</div></div>
    </div>
    <div class="card">
      <div class="card-title"><span>When people visit &amp; tap (hour of day)</span><span class="tag">IST</span></div>
      <div class="chart"><canvas id="hours"></canvas></div>
    </div>
  </div>

  <div class="grid g-11">
    <div class="card">
      <div class="card-title"><span>Visitor quality</span><span class="tag">Measured sessions only</span></div>
      <div class="stats" id="vq"></div>
    </div>
    <div class="card">
      <div class="card-title"><span>Data health</span><span class="tag">How far to trust each number</span></div>
      <div class="stats" id="health"></div>
    </div>
  </div>

  <div class="grid g-11">
    <div class="card">
      <div class="card-title"><span>Where visitors come from</span><span class="tag">Landing → engaged → tapped</span></div>
      <div class="scroll"><table>
        <thead><tr><th>Source</th><th class="r">Sessions</th><th class="r">Engaged</th><th class="r">Tapped</th><th class="r">Rate</th></tr></thead>
        <tbody id="origins"></tbody>
      </table></div>
    </div>
    <div class="card">
      <div class="card-title"><span>Which Order button works</span><span class="tag">Taps</span></div>
      <div class="scroll"><table>
        <thead><tr><th>Button</th><th class="r">Taps</th><th class="r">People</th></tr></thead>
        <tbody id="buttons"></tbody>
      </table></div>
    </div>
  </div>

  <div class="grid g-11">
    <div class="card">
      <div class="card-title"><span>UTM campaigns</span><span class="tag">Tagged links only</span></div>
      <div class="scroll"><table>
        <thead><tr><th>Source / medium</th><th>Campaign</th><th class="r">Sessions</th><th class="r">Tapped</th></tr></thead>
        <tbody id="campaigns"></tbody>
      </table></div>
    </div>
    <div class="card">
      <div class="card-title">
        <span>Top Locations</span>
        <div class="seg" role="group" aria-label="Location view" style="padding:2px">
          <button type="button" id="tabCities" aria-pressed="true" style="padding:4px 10px;font-size:.75rem">Cities (India)</button>
          <button type="button" id="tabCountries" aria-pressed="false" style="padding:4px 10px;font-size:.75rem">All Countries</button>
        </div>
      </div>
      <div class="scroll" id="citiesView"><table>
        <thead><tr><th>City / State (India)</th><th class="r">Sessions</th><th class="r">Tapped</th><th class="r">Rate</th></tr></thead>
        <tbody id="cities"></tbody>
      </table></div>
      <div class="scroll" id="countriesView" style="display:none"><table>
        <thead><tr><th>Country</th><th class="r">Sessions</th><th class="r">Tapped</th><th class="r">Rate</th></tr></thead>
        <tbody id="countries"></tbody>
      </table></div>
    </div>
  </div>

  <div class="grid g-11">
    <div class="card">
      <div class="card-title"><span>Real orders — by source</span><span class="tag">Manual log · range</span></div>
      <div class="scroll"><table>
        <thead><tr><th>Source</th><th class="r">Chats</th><th class="r">Quotes</th><th class="r">Paid</th><th class="r">Revenue</th></tr></thead>
        <tbody id="leadSummary"></tbody>
      </table></div>
    </div>
    <div class="card">
      <div class="card-title"><span>Log a WhatsApp chat</span><span class="tag">Saved to D1</span></div>
      <div class="formrow">
        <select class="in" id="leadTap" style="grid-column:1/-1"><option value="">Which website tap was this chat? (optional)</option></select>
        <input class="in" id="leadSource" list="leadSources" placeholder="Source (e.g. google_ads)" autocomplete="off">
        <datalist id="leadSources"><option value="google_ads"><option value="google_organic"><option value="instagram"><option value="whatsapp"><option value="email"><option value="referral"><option value="direct"></datalist>
        <select class="in" id="leadStatus"><option value="chat">chat</option><option value="quote">quote</option><option value="paid">paid</option><option value="lost">lost</option></select>
        <input class="in" id="leadAmount" type="number" min="0" step="1" placeholder="₹ amount (if paid)">
        <input class="in" id="leadNote" maxlength="120" placeholder="Note (optional)">
        <button class="btn" id="leadAdd" type="button">Add</button>
      </div>
      <div class="hint">Read the Ref: tag in their first WhatsApp message — GAds → google_ads, instagram → instagram, no tag → direct. Change a row's status below as the chat progresses. Link a chat to a tap only when the WhatsApp message time matches it; a chat with no matching tap came from outside the site (phone, live chat, offline) — leave it unlinked.</div>
    </div>
  </div>

  <div class="card" style="margin-bottom:20px">
    <div class="card-title"><span>Recent chats</span><span class="tag">Last 15 · all time</span></div>
    <div class="scroll"><table>
      <thead><tr><th>Time (IST)</th><th>Source</th><th>Status</th><th class="r">Amount</th><th>Note</th><th>Linked visit</th></tr></thead>
      <tbody id="leadList"></tbody>
    </table></div>
  </div>

  <div class="card" style="margin-bottom:20px">
    <div class="card-title"><span>Session explorer</span><span class="tag">Last 60 · current scope · one row = one visit</span></div>
    <div class="scroll"><table>
      <thead><tr><th>Time (IST)</th><th>From</th><th>Device</th><th>Where</th><th>Journey</th><th class="r">Active</th><th class="r">Depth</th><th>Input</th><th>Visitor</th></tr></thead>
      <tbody id="sessions"></tbody>
    </table></div>
  </div>

  <div class="card" style="margin-bottom:20px">
    <div class="card-title"><span>Recent WhatsApp taps</span><span class="tag">Last 30 · current scope</span></div>
    <div class="scroll"><table>
      <thead><tr><th>Time (IST)</th><th>Button</th><th>Came from</th><th>Campaign</th><th>Device</th><th>Location</th><th>Network</th><th>Session</th></tr></thead>
      <tbody id="taps"></tbody>
    </table></div>
  </div>

  <div class="card" style="margin-bottom:20px">
    <div class="card-title"><span>Raw event stream</span><span class="tag">Last 40 · unfiltered · bots marked</span></div>
    <div class="scroll"><table>
      <thead><tr><th>Time (IST)</th><th>Event</th><th>Source</th><th>Path</th><th>Referrer</th><th>Device</th><th>Location</th><th>Network</th><th>Session</th></tr></thead>
      <tbody id="events"></tbody>
    </table></div>
  </div>

  <footer id="foot"></footer>
</div>

<script>
(function () {
  'use strict';

  var RANGES = [7, 30, 90];
  var SCOPES = ['in', 'all', 'raw'];
  var STATUSES = ['chat', 'quote', 'paid', 'lost'];
  var state = { days: initialDays(), scope: initialScope(), charts: {}, loading: false, fetchedAt: 0, lastAttemptAt: 0, stale: false, failed: false };
  var regionNames = null;
  try { regionNames = new Intl.DisplayNames(['en'], { type: 'region' }); } catch (e) {}

  if (window.Chart) {
    Chart.defaults.color = '#94a3b8';
    Chart.defaults.font.family = "'Plus Jakarta Sans', sans-serif";
    Chart.defaults.borderColor = 'rgba(255,255,255,0.06)';
  }

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function n0(v) { return Number(v || 0); }
  function num(v) { return Number(v || 0).toLocaleString('en-IN'); }
  function pct(a, b) { return b > 0 ? (a / b) * 100 : 0; }
  function fmtPct(v) { return (v >= 10 ? v.toFixed(0) : v.toFixed(1)) + '%'; }
  function fmtTime(t) { return t ? String(t).slice(5, 16) : '—'; }
  function origin(o) { return o === 'direct' ? 'Direct / bookmark' : o; }
  function country(c) {
    if (!c || c === '??') return 'Unknown';
    try { return (regionNames && regionNames.of(c)) || c; } catch (e) { return c; }
  }
  function locationLabel(city, region, countryCode) {
    if (city && city !== 'Unknown') {
      var s = esc(city);
      if (region) s += ', ' + esc(region);
      else if (countryCode && countryCode !== 'IN' && countryCode !== '??') s += ' (' + esc(countryCode) + ')';
      return s;
    }
    return esc(country(countryCode));
  }
  function initialDays() {
    var d = parseInt(new URLSearchParams(location.search).get('days'), 10);
    return RANGES.indexOf(d) === -1 ? 7 : d;
  }
  function initialScope() {
    var s = new URLSearchParams(location.search).get('scope');
    return SCOPES.indexOf(s) === -1 ? 'in' : s;
  }

  function delta(cur, prev) {
    if (!prev && !cur) return '<span class="delta">–</span>';
    if (!prev) return '<span class="delta up">new</span>';
    var d = ((cur - prev) / prev) * 100;
    var cls = d > 0.5 ? 'up' : d < -0.5 ? 'down' : '';
    var arrow = d > 0.5 ? '▲ ' : d < -0.5 ? '▼ ' : '';
    return '<span class="delta ' + cls + '">' + arrow + Math.abs(d).toFixed(0) + '%</span>';
  }
  function pts(rate, prevRate, prevSessions) {
    if (!prevSessions) return '<span class="delta">–</span>';
    var d = rate - prevRate;
    var cls = d > 0.25 ? 'up' : d < -0.25 ? 'down' : '';
    return '<span class="delta ' + cls + '">' + (d > 0 ? '+' : '') + d.toFixed(1) + ' pts</span>';
  }
  // Rates on fewer than 20 sessions are dimmed: they swing a lot with one or two visits.
  function rateCell(t, s) {
    var small = s > 0 && s < 20;
    return '<td class="r mono"' + (small ? ' style="opacity:.55" title="Only ' + s + ' sessions — treat as a rough guide"' : '') + '>' + (s > 0 ? fmtPct(pct(t, s)) : '—') + '</td>';
  }

  // Wilson 95% interval: the honest range a rate could really be, given how few sessions there are.
  function wilson(k, total) {
    if (!total) return null;
    var z = 1.96, p = k / total, d = 1 + (z * z) / total;
    var c = p + (z * z) / (2 * total);
    var m = z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total));
    return [Math.max(0, ((c - m) / d) * 100), Math.min(100, ((c + m) / d) * 100)];
  }
  function ciText(k, total) {
    var w = wilson(k, total);
    if (!w) return '';
    return '<span title="Out of ' + total + ' sessions the true rate could plausibly be anywhere in this range">95% range ' + w[0].toFixed(1) + '–' + w[1].toFixed(1) + '%</span>';
  }
  function dur(s) {
    if (s == null) return '—';
    if (s < 60) return Math.round(s) + 's';
    var m = Math.floor(s / 60);
    return m + 'm ' + Math.round(s - m * 60) + 's';
  }
  function sinceDate(ts) {
    return ts ? new Date(ts).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' }) : null;
  }
  function stat(label, value, why) {
    return '<div class="stat"><span>' + label + (why ? '<span class="why">' + why + '</span>' : '') + '</span><b>' + value + '</b></div>';
  }

  function fill(id, rows, cols, emptyMsg, fn) {
    $(id).innerHTML = rows.length
      ? rows.map(fn).join('')
      : '<tr><td colspan="' + cols + '" class="empty">' + esc(emptyMsg) + '</td></tr>';
  }

  function upsert(key, canvasId, config) {
    var c = state.charts[key];
    if (c) { c.data = config.data; c.update('none'); return; }
    state.charts[key] = new Chart($(canvasId), config);
  }

  function hourLabel(h) { return h === 0 ? '12a' : h < 12 ? h + 'a' : h === 12 ? '12p' : (h - 12) + 'p'; }

  function scopeLabel(s) { return s === 'in' ? 'India · humans' : s === 'all' ? 'all humans' : 'raw'; }

  // Says exactly what the current scope is hiding, so the filter is never a black box.
  function filterNote(d) {
    var f = d.filtered || {}, o = d.overview, bits = [];
    if (d.scope === 'raw') {
      return 'Raw view: bots, scanners and outside-India traffic are all included (' + num(f.raw) + ' sessions). Switch to "India · humans" for real numbers.';
    }
    var msg = 'Showing ' + num(o.sessions) + ' of ' + num(f.raw) + ' raw sessions.';
    if (f.bots) bits.push(num(f.bots) + ' flagged as bots');
    if (d.scope === 'in' && f.nonIndia) bits.push(num(f.nonIndia) + ' from outside India');
    if (bits.length) msg += ' Hidden: ' + bits.join(', ') + '.';
    if (o.sessions < 50) msg += ' Small sample — percentages swing on a few visits; use 30 or 90 days.';
    return msg;
  }

  function render(d) {
    state.fetchedAt = Date.parse(d.fetchedAt) || Date.now();
    state.stale = !!d.stale;
    state.failed = false;

    var o = d.overview, p = o.prev;
    var erate = pct(o.engaged, o.sessions), perate = pct(p.engaged, p.sessions);
    var rate = pct(o.tappers, o.sessions), prate = pct(p.tappers, p.sessions);

    $('k-sessions').textContent = num(o.sessions);
    $('k-sessions-sub').innerHTML = delta(o.sessions, p.sessions) + '<span>vs previous (' + num(p.sessions) + ')</span>';
    $('k-engaged').textContent = o.sessions ? fmtPct(erate) : '—';
    $('k-engaged-sub').innerHTML = pts(erate, perate, p.sessions) + '<span>' + num(o.engaged) + ' of ' + num(o.sessions) + ' sessions</span>' + ciText(o.engaged, o.sessions);
    $('k-rate').textContent = o.sessions ? fmtPct(rate) : '—';
    $('k-rate-sub').innerHTML = pts(rate, prate, p.sessions) + '<span>' + num(o.tappers) + ' people · ' + num(o.taps) + ' taps</span>' + ciText(o.tappers, o.sessions);

    var chats = 0, paid = 0, revenue = 0;
    d.leadSummary.forEach(function (r) { chats += n0(r.chats); paid += n0(r.paid); revenue += n0(r.revenue); });
    $('k-paid').textContent = chats || paid ? num(paid) : '—';
    $('k-paid-sub').innerHTML = '<span>' + num(chats) + ' chats logged · ₹' + num(revenue) + '</span>';

    var note = $('sample');
    note.textContent = filterNote(d);
    note.classList.add('show');

    var a = d.allTime;
    var since = a.firstTs ? new Date(a.firstTs).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' }) : '—';
    $('foot').innerHTML = 'All time (' + esc(scopeLabel(d.scope)) + '): <b>' + num(a.sessions) + '</b> sessions · <b>' + num(a.tappers) + '</b> people tapped · tracking since ' + esc(since) + '.<br>' +
      'Session = one browser-tab visit that fired a landing event (no cookies, no IPs stored). A random visitor id kept in the browser (localStorage) tells new from returning visitors. Engaged = scrolled to a section or tapped Order. "Real input" = a genuine touch, click or key press happened — a strong filter against simple bots, not proof of a human. Anything not measured is shown as unknown, never as zero. ' +
      'Bot flags only exist for events recorded after the filter went live; older rows are filtered by country only. ' +
      'A tap is a click on a WhatsApp link, not an order — the "Real orders" log is the number that counts. ' +
      'Changes compare against the previous period of equal length. Open any page with ?hn_ignore=1 on your own devices to stop counting yourself.';

    renderCharts(d);
    renderExtras(d);

    // Funnel: compare section drop-offs sequentially, but final tap compares to base (Landed)
    var base = d.funnel[0] ? d.funnel[0].sessions : 0;
    var prev = base;
    $('funnel').innerHTML = base
      ? d.funnel.map(function (s, i) {
          var w = Math.min(100, pct(s.sessions, base));
          var drop = '';
          if (s.final) {
            drop = ' <span class="drop">(' + Math.min(100, Math.round(pct(s.sessions, base))) + '% of landed)</span>';
          } else if (i > 0 && prev > 0 && s.sessions < prev) {
            drop = ' <span class="drop">(−' + Math.round(((prev - s.sessions) / prev) * 100) + '% vs previous step)</span>';
          }
          if (!s.final) prev = s.sessions;
          return '<div class="step"><div class="step-top"><span>' + esc(s.label) + drop + '</span>' +
            '<span class="mono" style="color:#94a3b8">' + num(s.sessions) + ' · ' + Math.round(w) + '%</span></div>' +
            '<div class="track"><div class="fill' + (s.final ? ' final' : '') + '" style="width:' + w + '%"></div></div></div>';
        }).join('')
      : '<div class="empty">No sessions in this range yet</div>';

    // Tables
    fill('origins', d.origins, 5, 'No landings in this range', function (r) {
      return '<tr><td><b>' + esc(origin(r.origin)) + '</b></td><td class="r mono">' + num(r.sessions) + '</td><td class="r mono">' + num(r.engaged) + '</td><td class="r mono">' + num(r.tappers) + '</td>' + rateCell(r.tappers, r.sessions) + '</tr>';
    });
    fill('buttons', d.buttons, 3, 'No taps in this range', function (r) {
      return '<tr><td><span class="src">' + esc(r.source) + '</span></td><td class="r mono">' + num(r.taps) + '</td><td class="r mono">' + num(r.people) + '</td></tr>';
    });
    fill('campaigns', d.campaigns, 4, 'No UTM-tagged visits yet — add ?utm_source=… to links you share', function (r) {
      return '<tr><td>' + esc(r.utm_source) + ' / ' + esc(r.utm_medium) + '</td><td>' + esc(r.utm_campaign) + '</td><td class="r mono">' + num(r.sessions) + '</td><td class="r mono">' + num(r.tappers) + '</td></tr>';
    });
    fill('cities', d.cities, 4, 'No India visits in this range', function (r) {
      var isUnknown = !r.city || r.city === 'Unknown';
      var loc = isUnknown ? '<span style="color:var(--subtle)">Historical visits in India (before city tracking)</span>' : '<b>' + esc(r.city) + '</b>';
      if (!isUnknown && r.region) loc += ' <span class="tag" style="padding:1px 6px;font-size:.65rem">' + esc(r.region) + '</span>';
      return '<tr><td>' + loc + '</td><td class="r mono">' + num(r.sessions) + '</td><td class="r mono">' + num(r.tappers) + '</td>' + rateCell(r.tappers, r.sessions) + '</tr>';
    });
    fill('countries', d.countries, 4, 'No data', function (r) {
      return '<tr><td>' + esc(country(r.country)) + '</td><td class="r mono">' + num(r.sessions) + '</td><td class="r mono">' + num(r.tappers) + '</td>' + rateCell(r.tappers, r.sessions) + '</tr>';
    });
    fill('leadSummary', d.leadSummary, 5, 'No chats logged in this range — add one on the right', function (r) {
      return '<tr><td><span class="src">' + esc(r.source) + '</span></td><td class="r mono">' + num(r.chats) + '</td><td class="r mono">' + num(r.quotes) + '</td><td class="r mono">' + num(r.paid) + '</td><td class="r mono">₹' + num(r.revenue) + '</td></tr>';
    });
    fill('leadList', d.leads, 6, 'Nothing logged yet', function (r) {
      var opts = STATUSES.map(function (s) {
        return '<option value="' + s + '"' + (s === r.status ? ' selected' : '') + '>' + s + '</option>';
      }).join('');
      var amt = r.amount != null && r.amount !== '' ? '₹' + num(r.amount) : '—';
      return '<tr><td class="mono small">' + esc(fmtTime(r.time)) + '</td><td><span class="src">' + esc(r.source) + '</span></td>' +
        '<td><select class="in lead-status" data-id="' + esc(r.id) + '">' + opts + '</select></td>' +
        '<td class="r mono">' + amt + '</td><td class="small">' + esc(r.note || '') + '</td>' +
        '<td class="small">' + (r.linked ? esc(r.linked) + (r.tapped ? ' · ' + esc(r.tapped) : '') : '<span style="color:var(--subtle)">not linked</span>') + '</td></tr>';
    });
    fill('taps', d.recentTaps, 8, 'No WhatsApp taps in this scope', function (r) {
      return '<tr><td class="mono small">' + esc(fmtTime(r.time)) + '</td><td><span class="src">' + esc(r.source) + '</span></td><td>' + esc(origin(r.origin)) +
        '</td><td class="small">' + esc(r.campaign || '—') + '</td><td><span class="badge b-dev">' + esc(r.device) + '</span></td><td class="small">' + locationLabel(r.city, r.region, r.country) +
        '</td><td class="small">' + esc(r.asorg || '—') + '</td><td class="mono small">' + esc(r.sid || '—') + '</td></tr>';
    });
    fill('events', d.recentEvents, 9, 'No events recorded', function (r) {
      var cls = r.event === 'whatsapp_click' ? 'b-wa' : r.event === 'landing' ? 'b-land' : 'b-ev';
      var bot = Number(r.is_bot) === 1 ? ' <span class="badge b-bot">bot</span>' : '';
      return '<tr><td class="mono small">' + esc(fmtTime(r.time)) + '</td><td><span class="badge ' + cls + '">' + esc(r.event) + '</span>' + bot + '</td><td>' + esc(r.source || '—') +
        '</td><td class="mono small">' + esc(r.path || '/') + '</td><td>' + esc(r.ref || 'Direct') + '</td><td><span class="badge b-dev">' + esc(r.device) +
        '</span></td><td class="small">' + locationLabel(r.city, r.region, r.country) + '</td><td class="small">' + esc(r.asorg || '—') + '</td><td class="mono small">' + esc(r.sid || '—') + '</td></tr>';
    });

    updatePill();
  }

  function renderExtras(d) {
    var v = d.visitors, h = d.health, o = d.overview;

    var vq = '';
    if (!v.measured) {
      vq = '<div class="empty">No measured sessions in this range yet. Time on site, scroll depth, real input and new/returning come only from the new tracker and start filling in after you deploy it. Older visits are not guessed.</div>';
    } else {
      vq += stat('Sessions measured', num(v.measured) + ' of ' + num(o.sessions), 'Only visits since ' + esc(sinceDate(h.measureSince) || '—') + ' carry these signals.');
      vq += stat('Had real input (touch, click, key)', fmtPct(pct(v.human, v.measured)) + ' · ' + num(v.human), 'A browser that never touched the page is almost always a bot or an instant bounce.');
      vq += stat('Typical active time', v.activeMedian == null ? '—' : dur(v.activeMedian), 'Median of ' + num(v.activeN) + ' sessions with input · tab visible and interacting only.');
      vq += stat('Typical scroll depth', v.depthMedian == null ? '—' : Math.round(v.depthMedian) + '%', 'Median of ' + num(v.depthN) + ' sessions with input.');
      vq += stat('Landing → first tap', v.tapMedian == null ? '—' : dur(v.tapMedian), 'Median of ' + num(v.tapN) + ' people who tapped.');
      vq += stat('New vs returning visitors', v.knownVisitors ? num(v.newVisitors) + ' new · ' + num(v.returning) + ' returning' : '—', 'Returning = the same browser landed at least 30 min earlier. Counts start only once the visitor id exists.');
      if (v.measured < 30) vq += '<div class="hint">Only ' + num(v.measured) + ' measured sessions so far — these medians will move a lot.</div>';
    }
    $('vq').innerHTML = vq;

    var age = h.lastTs ? Date.now() - h.lastTs : null;
    var hh = '';
    hh += stat('Last event received', age == null ? 'never' : ago(age), 'If this is days old while you expect visitors, the tracker or the deploy is broken.');
    hh += stat('Events in the last 24 h', num(h.last24h), num(h.events) + ' events stored in total.');
    hh += stat('Bot flagging live since', h.flagSince ? esc(sinceDate(h.flagSince)) : 'not deployed yet', h.flagSince ? 'Earlier visits can only be judged by country and zero scroll.' : 'Until then only country and zero-scroll separate bots from people.');
    hh += stat('Real-input signal since', h.measureSince ? esc(sinceDate(h.measureSince)) : 'not deployed yet', 'Before this date "had real input" is unknown, not zero.');
    hh += stat('City recorded since', h.citySince ? esc(sinceDate(h.citySince)) : 'never', h.citySince ? num(h.withCity) + ' events have a city.' : 'No stored event has a city yet, so city tables stay empty until the new tracker is live.');
    hh += stat('Events flagged as bots', num(h.flagged), 'Hidden in the default views, visible under Raw.');
    $('health').innerHTML = hh;

    fill('sessions', d.sessionList, 9, 'No sessions in this scope', function (r) {
      var input = !n0(r.inst)
        ? '<span style="color:var(--subtle)" title="Recorded before the new tracker: unknown, not assumed">unknown</span>'
        : n0(r.human) ? 'yes' : '<span style="color:var(--red)">none</span>';
      var vis = r.is_returning == null ? '<span style="color:var(--subtle)">unknown</span>' : n0(r.is_returning) ? 'returning' : 'new';
      var bot = n0(r.is_bot) ? ' <span class="badge b-bot">bot</span>' : '';
      var j = esc(r.journey || '—');
      if (n0(r.taps) > 0) j = '<span style="color:var(--wa)">' + j + '</span>';
      return '<tr><td class="mono small">' + esc(fmtTime(r.time)) + '</td><td>' + esc(origin(r.origin)) + bot + '</td><td><span class="badge b-dev">' + esc(r.device || '—') + '</span></td>' +
        '<td class="small">' + locationLabel(r.city, r.region, r.country) + '</td><td class="small">' + j + '</td>' +
        '<td class="r mono">' + (r.active_s == null ? '—' : dur(r.active_s)) + '</td><td class="r mono">' + (r.depth == null ? '—' : esc(r.depth) + '%') + '</td>' +
        '<td class="small">' + input + '</td><td class="small">' + vis + '</td></tr>';
    });

    // Taps you can link a logged chat to (keeps the current choice while the data refreshes)
    var sel = $('leadTap'), cur = sel.value;
    sel.innerHTML = '<option value="">Which website tap was this chat? (optional — leave empty if unknown)</option>' +
      d.tapChoices.map(function (t) {
        return '<option value="' + esc(t.sid) + '" data-origin="' + esc(t.origin) + '">' + esc(fmtTime(t.time)) + ' · ' + esc(t.source) + ' · ' + esc(origin(t.origin)) + ' · ' + esc(t.device) + (n0(t.linked) ? ' (already linked)' : '') + '</option>';
      }).join('');
    sel.value = cur;
  }

  function renderCharts(d) {
    if (!window.Chart) {
      banner('Chart library failed to load (offline?). Tables below still work.');
      return;
    }
    var labels = d.daily.map(function (x) {
      return new Date(x.day + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
    });
    $('trendTag').textContent = 'Daily · ' + d.days + ' days · ' + scopeLabel(d.scope);

    upsert('trend', 'trend', {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          { type: 'line', label: 'Sessions', data: d.daily.map(function (x) { return x.sessions; }), borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.1)', fill: true, tension: 0.35, borderWidth: 2, pointRadius: d.days > 30 ? 0 : 3, order: 0 },
          { type: 'line', label: 'Engaged', data: d.daily.map(function (x) { return x.engaged; }), borderColor: '#60a5fa', backgroundColor: 'transparent', borderDash: [5, 4], tension: 0.35, borderWidth: 2, pointRadius: d.days > 30 ? 0 : 2, order: 0 },
          { type: 'bar', label: 'People who tapped Order', data: d.daily.map(function (x) { return x.tappers; }), backgroundColor: '#25d366', borderRadius: 4, maxBarThickness: 18, order: 1 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { labels: { usePointStyle: true, boxWidth: 8 } } },
        scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 10 } }, y: { beginAtZero: true, ticks: { precision: 0 } } }
      }
    });

    var colors = ['#3b82f6', '#10b981', '#f59e0b', '#a78bfa'];
    upsert('devices', 'devices', {
      type: 'doughnut',
      data: {
        labels: d.devices.map(function (x) { return x.device; }),
        datasets: [{ data: d.devices.map(function (x) { return x.sessions; }), backgroundColor: colors, borderWidth: 0 }]
      },
      options: { responsive: true, maintainAspectRatio: false, cutout: '70%', plugins: { legend: { display: false } } }
    });
    $('devlist').innerHTML = d.devices.length
      ? d.devices.map(function (x, i) {
          return '<div><span><span style="color:' + colors[i % colors.length] + '">●</span> ' + esc(x.device) + '</span>' +
            '<span class="mono">' + num(x.sessions) + ' · ' + (x.sessions ? fmtPct(pct(x.tappers, x.sessions)) : '—') + ' tapped</span></div>';
        }).join('')
      : '<div style="color:#64748b">No data</div>';

    upsert('hours', 'hours', {
      type: 'bar',
      data: {
        labels: d.hourly.map(function (h) { return hourLabel(h.hour); }),
        datasets: [
          { label: 'Sessions (by landing hour)', data: d.hourly.map(function (h) { return h.sessions; }), backgroundColor: 'rgba(245,158,11,0.75)', borderRadius: 3 },
          { label: 'People who tapped (by tap hour)', data: d.hourly.map(function (h) { return h.tappers; }), backgroundColor: '#25d366', borderRadius: 3 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { labels: { usePointStyle: true, boxWidth: 8 } } },
        scales: { x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 12 } }, y: { beginAtZero: true, ticks: { precision: 0 } } }
      }
    });
  }

  function banner(msg) {
    var b = $('banner');
    b.textContent = msg || '';
    b.classList.toggle('show', !!msg);
  }

  function ago(ms) {
    var s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return s + 's ago';
    var m = Math.round(s / 60);
    return m < 60 ? m + ' min ago' : Math.round(m / 60) + ' h ago';
  }

  function updatePill() {
    var pill = $('pill'), text = $('pillText');
    pill.className = 'pill';
    if (state.failed && !state.fetchedAt) { pill.classList.add('err'); text.textContent = 'D1 unreachable'; return; }
    if (!state.fetchedAt) { text.textContent = 'Connecting to D1…'; return; }
    var age = Date.now() - state.fetchedAt;
    if (state.failed || state.stale) { pill.classList.add('err'); text.textContent = 'Stale · updated ' + ago(age); return; }
    pill.classList.add(age > 180000 ? 'warn' : 'ok');
    text.textContent = 'Live · updated ' + ago(age);
  }

  async function load(force) {
    if (state.loading) return;
    state.loading = true;
    state.lastAttemptAt = Date.now();
    var btn = $('refresh');
    btn.disabled = true;
    btn.textContent = 'Refreshing…';
    try {
      var res = await fetch('/api/data?days=' + state.days + '&scope=' + state.scope + (force ? '&refresh=1' : ''), { cache: 'no-store' });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
      banner(data.stale ? 'Showing cached data — the latest refresh failed: ' + data.error : '');
      render(data);
    } catch (e) {
      state.failed = true;
      banner('Could not load analytics: ' + e.message);
      updatePill();
    } finally {
      state.loading = false;
      btn.disabled = false;
      btn.textContent = 'Refresh';
    }
  }

  function setRange(days) {
    state.days = days;
    var u = new URL(location.href);
    u.searchParams.set('days', days);
    history.replaceState(null, '', u);
    Array.prototype.forEach.call($('range').querySelectorAll('button'), function (b) {
      b.setAttribute('aria-pressed', String(Number(b.dataset.days) === days));
    });
  }

  function setScope(scope) {
    state.scope = scope;
    var u = new URL(location.href);
    u.searchParams.set('scope', scope);
    history.replaceState(null, '', u);
    Array.prototype.forEach.call($('scope').querySelectorAll('button'), function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.scope === scope));
    });
  }

  function postLead(payload) {
    return fetch('/api/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-HN-Dashboard': '1' },
      body: JSON.stringify(payload)
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (j) {
        if (!res.ok) throw new Error(j.error || ('HTTP ' + res.status));
        return j;
      });
    });
  }

  $('range').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-days]');
    if (!b) return;
    setRange(Number(b.dataset.days));
    load(false);
  });
  $('scope').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-scope]');
    if (!b) return;
    setScope(b.dataset.scope);
    load(false);
  });
  $('refresh').addEventListener('click', function () { load(true); });
  $('tabCities').addEventListener('click', function () {
    $('tabCities').setAttribute('aria-pressed', 'true');
    $('tabCountries').setAttribute('aria-pressed', 'false');
    $('citiesView').style.display = '';
    $('countriesView').style.display = 'none';
  });
  $('tabCountries').addEventListener('click', function () {
    $('tabCities').setAttribute('aria-pressed', 'false');
    $('tabCountries').setAttribute('aria-pressed', 'true');
    $('citiesView').style.display = 'none';
    $('countriesView').style.display = '';
  });

  $('leadTap').addEventListener('change', function () {
    var opt = this.options[this.selectedIndex];
    var og = opt && opt.getAttribute('data-origin');
    if (!og || $('leadSource').value) return;
    $('leadSource').value = og === 'google.com' ? 'google_organic' : og === 'direct' ? 'direct' : og.toLowerCase();
  });

  $('leadAdd').addEventListener('click', function () {
    var btn = $('leadAdd');
    btn.disabled = true;
    postLead({
      action: 'add',
      source: $('leadSource').value,
      sid: $('leadTap').value,
      status: $('leadStatus').value,
      amount: $('leadAmount').value,
      note: $('leadNote').value
    }).then(function () {
      $('leadAmount').value = '';
      $('leadNote').value = '';
      $('leadTap').value = '';
      return load(true);
    }).catch(function (err) {
      banner('Could not save: ' + err.message);
    }).then(function () {
      btn.disabled = false;
    });
  });

  $('leadList').addEventListener('change', function (e) {
    var sel = e.target.closest && e.target.closest('select.lead-status');
    if (!sel) return;
    var amount = null;
    if (sel.value === 'paid') {
      var a = window.prompt('Order amount in rupees (leave empty to skip):', '');
      if (a === null) { load(true); return; }
      amount = a.trim() === '' ? null : a.trim();
    }
    postLead({ action: 'update', id: Number(sel.getAttribute('data-id')), status: sel.value, amount: amount })
      .then(function () { return load(true); })
      .catch(function (err) { banner('Could not update: ' + err.message); });
  });

  setInterval(function () {
    if (document.visibilityState !== 'visible') return;
    updatePill();
    if (Date.now() - state.lastAttemptAt > 60000) load(false);
  }, 5000);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && Date.now() - state.lastAttemptAt > 60000) load(false);
  });

  setRange(state.days);
  setScope(state.scope);
  load(false);
})();
</script>
</body>
</html>
`;

// ───────────────────────────── Server ─────────────────────────────

let currentPort = PORT;

function isAllowedHost(host) {
  const h = String(host || '').toLowerCase();
  return (
    h === `localhost:${currentPort}` ||
    h === `127.0.0.1:${currentPort}` ||
    h === `[::1]:${currentPort}`
  );
}

const CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' https://cdn.jsdelivr.net",
  "style-src 'unsafe-inline' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  "connect-src 'self'",
  "img-src data:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

function send(res, status, type, body, extra = {}, method = 'GET') {
  const content = body == null ? '' : body;
  const len = Buffer.byteLength(content);
  res.writeHead(status, {
    'Content-Type': type,
    'Content-Length': len,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    ...extra,
  });
  res.end(method === 'HEAD' ? undefined : content);
}

const sendJson = (res, status, obj, method) => send(res, status, 'application/json; charset=utf-8', JSON.stringify(obj), {}, method);

const server = http.createServer(async (req, res) => {
  // Block DNS-rebinding: only answer requests addressed to localhost on our port.
  if (!isAllowedHost(req.headers.host)) {
    return send(res, 403, 'text/plain; charset=utf-8', 'Forbidden', {}, req.method);
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  // The only write endpoint: the manual leads log. A custom header + JSON content type forces a CORS
  // preflight for any other website, which we never answer — so other sites cannot post here.
  if (url.pathname === '/api/leads') {
    if (req.method !== 'POST') {
      return send(res, 405, 'text/plain; charset=utf-8', 'Method Not Allowed', { Allow: 'POST' }, req.method);
    }
    const origin = req.headers.origin;
    let originOk = true;
    try {
      originOk = !origin || isAllowedHost(new URL(origin).host);
    } catch {
      originOk = false;
    }
    if (!originOk || req.headers['x-hn-dashboard'] !== '1' || !/^application\/json/i.test(req.headers['content-type'] || '')) {
      return send(res, 403, 'text/plain; charset=utf-8', 'Forbidden', {}, req.method);
    }
    try {
      await saveLead(await readJson(req));
      cache.clear();
      return sendJson(res, 200, { ok: true }, req.method);
    } catch (err) {
      const status = err.status || 502;
      if (status !== 400) console.error(`[analytics] lead write failed: ${err.message}`);
      return sendJson(res, status, { error: err.message }, req.method);
    }
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(res, 405, 'text/plain; charset=utf-8', 'Method Not Allowed', { Allow: 'GET, HEAD' }, req.method);
  }

  if (url.pathname === '/api/data') {
    const requested = parseInt(url.searchParams.get('days'), 10);
    const days = RANGES.includes(requested) ? requested : DEFAULT_DAYS;
    const requestedScope = url.searchParams.get('scope');
    const scope = SCOPES.includes(requestedScope) ? requestedScope : DEFAULT_SCOPE;
    try {
      const data = await getData(days, scope, url.searchParams.get('refresh') === '1');
      return sendJson(res, 200, data, req.method);
    } catch (err) {
      console.error(`[analytics] ${err.message}`);
      return sendJson(res, 502, { error: err.message }, req.method);
    }
  }

  if (url.pathname === '/' || url.pathname === '/index.html') {
    return send(res, 200, 'text/html; charset=utf-8', HTML_TEMPLATE, { 'Content-Security-Policy': CSP }, req.method);
  }

  if (url.pathname === '/favicon.ico') return send(res, 204, 'image/x-icon', '', {}, req.method);

  send(res, 404, 'text/plain; charset=utf-8', 'Not Found', {}, req.method);
});

server.on('listening', () => {
  const addr = server.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : currentPort;
  const mode = CF_API_TOKEN && CF_ACCOUNT_ID && CF_D1_DATABASE_ID ? 'direct HTTP API (fast)' : 'wrangler CLI';
  console.log(`\n✨ Hariram Namkeen Analytics Hub → http://localhost:${actualPort}`);
  console.log(`   D1 database: ${DB_NAME} (${mode}) · listening on ${HOST} only · Ctrl+C to stop\n`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    if (process.env.PORT) {
      console.error(`\nPort ${currentPort} is already in use. Try: PORT=${currentPort + 1} npm run analytics\n`);
      process.exit(1);
    }
    const nextPort = currentPort + 1;
    if (nextPort <= PORT + 10) {
      console.log(`Port ${currentPort} is busy, trying http://localhost:${nextPort} instead...`);
      currentPort = nextPort;
      server.close(() => server.listen(currentPort, HOST));
      return;
    }
  }
  console.error(err);
  process.exit(1);
});

server.listen(currentPort, HOST);

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
