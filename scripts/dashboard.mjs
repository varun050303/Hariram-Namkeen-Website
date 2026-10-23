#!/usr/bin/env node
// Hariram Namkeen — local analytics dashboard (reads Cloudflare D1 via wrangler)
//
//   npm run analytics            → http://localhost:43210
//   PORT=5000 npm run analytics  → custom port
//   D1_NAME=my-db npm run analytics
//
// Needs: `npx wrangler login` once, and the `events` table from analytics/schema.sql.
// Serves on 127.0.0.1 only. See analytics/README.md for what each event means.

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
  if (/no such table/i.test(m)) {
    return 'Table "events" not found. Run the schema step in analytics/README.md';
  }
  if (/database.*(not found|does not exist)|(not found|does not exist).*database/i.test(m)) {
    return `D1 database "${DB_NAME}" was not found in this Cloudflare account`;
  }
  return m.trim().split('\n').filter(Boolean).slice(-4).join(' ').slice(0, 400) || 'Unknown wrangler error';
}

function runD1(sql) {
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
        const match = stdout.match(/^\s*\[/m);
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

// ───────────────────────────── Queries ─────────────────────────────
// All times are bucketed in IST (the business's timezone), not UTC.
// "Session" = one browser-tab visit (random sid, no cookies). "Tap" = a click on a wa.me link, not an order.

function buildQueries(now, days) {
  const todayStart = Math.floor((now + IST_OFFSET_MIN * 60_000) / DAY) * DAY - IST_OFFSET_MIN * 60_000;
  const S = Math.floor(todayStart - (days - 1) * DAY); // start of range (IST midnight)
  const P_START = S - days * DAY; // shifted window: exact same hours of day & days of week
  const P_END = now - days * DAY;
  const A = Math.floor(now - 30 * 60_000); // "active now" window
  const sid = "NULLIF(sid,'')";
  const tap = "event = 'whatsapp_click'";

  const queries = [
    [
      'overview',
      `SELECT
        COUNT(DISTINCT CASE WHEN ts >= ${S} THEN ${sid} END) AS sessions,
        COUNT(DISTINCT CASE WHEN ts >= ${S} AND ${tap} THEN ${sid} END) AS tappers,
        COUNT(CASE WHEN ts >= ${S} AND ${tap} THEN 1 END) AS taps,
        COUNT(DISTINCT CASE WHEN ts >= ${P_START} AND ts < ${P_END} THEN ${sid} END) AS prev_sessions,
        COUNT(DISTINCT CASE WHEN ts >= ${P_START} AND ts < ${P_END} AND ${tap} THEN ${sid} END) AS prev_tappers,
        COUNT(CASE WHEN ts >= ${P_START} AND ts < ${P_END} AND ${tap} THEN 1 END) AS prev_taps,
        COUNT(DISTINCT CASE WHEN ts >= ${A} THEN ${sid} END) AS active_now
      FROM events WHERE ts >= ${P_START}`,
    ],
    [
      'allTime',
      `SELECT COUNT(DISTINCT ${sid}) AS sessions,
              COUNT(CASE WHEN ${tap} THEN 1 END) AS taps,
              MIN(ts) AS first_ts
       FROM events`,
    ],
    [
      'daily',
      `SELECT date(ts/1000,'unixepoch','${IST}') AS day,
              COUNT(DISTINCT ${sid}) AS sessions,
              COUNT(DISTINCT CASE WHEN ${tap} THEN ${sid} END) AS tappers,
              COUNT(CASE WHEN ${tap} THEN 1 END) AS taps
       FROM events WHERE ts >= ${S}
       GROUP BY day ORDER BY day`,
    ],
    [
      'hourly',
      `SELECT CAST(strftime('%H', ts/1000, 'unixepoch', '${IST}') AS INTEGER) AS hour,
              COUNT(DISTINCT ${sid}) AS sessions,
              COUNT(CASE WHEN ${tap} THEN 1 END) AS taps
       FROM events WHERE ts >= ${S}
       GROUP BY hour ORDER BY hour`,
    ],
    [
      'devices',
      `SELECT COALESCE(NULLIF(device,''),'unknown') AS device,
              COUNT(DISTINCT ${sid}) AS sessions,
              COUNT(DISTINCT CASE WHEN ${tap} THEN ${sid} END) AS tappers
       FROM events WHERE ts >= ${S}
       GROUP BY device ORDER BY sessions DESC`,
    ],
    [
      'countries',
      `SELECT COALESCE(NULLIF(country,''),'??') AS country,
              COUNT(DISTINCT ${sid}) AS sessions,
              COUNT(DISTINCT CASE WHEN ${tap} THEN ${sid} END) AS tappers
       FROM events WHERE ts >= ${S}
       GROUP BY country ORDER BY sessions DESC LIMIT 8`,
    ],
    [
      'origins',
      `SELECT COALESCE(NULLIF(l.utm_source,''), NULLIF(l.ref,''), 'direct') AS origin,
              COUNT(DISTINCT l.sid) AS sessions,
              COUNT(DISTINCT c.sid) AS tappers
       FROM events l
       LEFT JOIN events c ON c.sid = l.sid AND c.event = 'whatsapp_click' AND c.ts >= ${S}
       WHERE l.event = 'landing' AND l.sid <> '' AND l.ts >= ${S}
       GROUP BY origin ORDER BY sessions DESC, origin LIMIT 12`,
    ],
    [
      'campaigns',
      `SELECT l.utm_source AS utm_source,
              COALESCE(NULLIF(l.utm_medium,''),'—') AS utm_medium,
              COALESCE(NULLIF(l.utm_campaign,''),'—') AS utm_campaign,
              COUNT(DISTINCT l.sid) AS sessions,
              COUNT(DISTINCT c.sid) AS tappers
       FROM events l
       LEFT JOIN events c ON c.sid = l.sid AND c.event = 'whatsapp_click' AND c.ts >= ${S}
       WHERE l.event = 'landing' AND l.sid <> '' AND l.ts >= ${S} AND NULLIF(l.utm_source,'') IS NOT NULL
       GROUP BY l.utm_source, l.utm_medium, l.utm_campaign
       ORDER BY sessions DESC LIMIT 10`,
    ],
    [
      'buttons',
      `SELECT COALESCE(NULLIF(source,''),'other') AS source,
              COUNT(*) AS taps,
              COUNT(DISTINCT ${sid}) AS people
       FROM events WHERE ${tap} AND ts >= ${S}
       GROUP BY source ORDER BY taps DESC LIMIT 15`,
    ],
    [
      'funnel',
      `SELECT event, COALESCE(source,'') AS source, COUNT(DISTINCT ${sid}) AS sessions
       FROM events
       WHERE ts >= ${S} AND sid <> '' AND event IN ('landing','section_view')
       GROUP BY event, source`,
    ],
    [
      'recentTaps',
      `SELECT datetime(c.ts/1000,'unixepoch','${IST}') AS time,
              COALESCE(NULLIF(c.source,''),'other') AS source,
              COALESCE(NULLIF(l.utm_source,''), NULLIF(l.ref,''), NULLIF(c.utm_source,''), NULLIF(c.ref,''), 'direct') AS origin,
              COALESCE(NULLIF(l.utm_campaign,''), NULLIF(c.utm_campaign,''), '') AS campaign,
              c.device AS device, c.country AS country, substr(c.sid,1,6) AS sid
       FROM (
         SELECT * FROM events
         WHERE event = 'whatsapp_click'
         ORDER BY ts DESC LIMIT 30
       ) c
       LEFT JOIN events l ON l.sid = c.sid AND c.sid <> '' AND l.event = 'landing'
       GROUP BY c.id ORDER BY c.ts DESC`,
    ],
    [
      'recentEvents',
      `SELECT datetime(ts/1000,'unixepoch','${IST}') AS time, event, source, path, ref,
              device, country, substr(sid,1,6) AS sid
       FROM events ORDER BY id DESC LIMIT 40`,
    ],
  ];

  return { queries, S, P_START, P_END, todayStart };
}

const FUNNEL_ORDER = ['oil-truth', 'products', 'hamper', 'story'];
const istDay = (ms) => new Date(ms + IST_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
const n = (v) => Number(v) || 0;

async function fetchAnalytics(days) {
  const now = Date.now();
  const { queries, S } = buildQueries(now, days);

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
  const overview = {
    sessions: n(ov.sessions),
    tappers: n(ov.tappers),
    taps: n(ov.taps),
    activeNow: n(ov.active_now),
    prev: { sessions: n(ov.prev_sessions), tappers: n(ov.prev_tappers), taps: n(ov.prev_taps) },
  };

  // Fill days with no traffic so the trend line isn't misleading.
  const byDay = new Map(r.daily.map((d) => [d.day, d]));
  const daily = Array.from({ length: days }, (_, i) => {
    const day = istDay(now - (days - 1 - i) * DAY);
    const d = byDay.get(day) || {};
    return { day, sessions: n(d.sessions), tappers: n(d.tappers), taps: n(d.taps) };
  });

  const byHour = new Map(r.hourly.map((h) => [n(h.hour), h]));
  const hourly = Array.from({ length: 24 }, (_, hour) => {
    const h = byHour.get(hour) || {};
    return { hour, sessions: n(h.sessions), taps: n(h.taps) };
  });

  // Funnel: landed → each section scrolled into view (page order) → tapped WhatsApp.
  const landed = Math.max(0, ...r.funnel.filter((f) => f.event === 'landing').map((f) => n(f.sessions))) || overview.sessions;
  const sections = r.funnel
    .filter((f) => f.event === 'section_view')
    .map((f) => ({ label: f.source || 'unknown', sessions: n(f.sessions) }))
    .sort((a, b) => {
      const ia = FUNNEL_ORDER.indexOf(a.label);
      const ib = FUNNEL_ORDER.indexOf(b.label);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || b.sessions - a.sessions;
    });
  const funnel = [
    { label: 'Landed', sessions: landed },
    ...sections,
    { label: 'Tapped WhatsApp', sessions: overview.tappers, final: true },
  ];

  const rows = (name) => r[name].map((row) => ({ ...row }));

  return {
    days,
    fetchedAt: new Date(now).toISOString(),
    rangeStartIst: istDay(S),
    overview,
    allTime: { sessions: n(all.sessions), taps: n(all.taps), firstTs: n(all.first_ts) || null },
    daily,
    hourly,
    funnel,
    devices: rows('devices'),
    countries: rows('countries'),
    origins: rows('origins'),
    campaigns: rows('campaigns'),
    buttons: rows('buttons'),
    recentTaps: rows('recentTaps'),
    recentEvents: rows('recentEvents'),
  };
}

// ───────────────────────────── Cache ─────────────────────────────

const cache = new Map(); // days → { at, data }
const inflight = new Map(); // days → Promise

async function getData(days, force) {
  const hit = cache.get(days);
  const age = hit ? Date.now() - hit.at : Infinity;
  if (hit && age < CACHE_TTL_MS && !(force && age > MIN_FORCE_GAP_MS)) return hit.data;
  if (inflight.has(days)) return inflight.get(days);

  const p = fetchAnalytics(days)
    .then((data) => {
      cache.set(days, { at: Date.now(), data });
      return data;
    })
    .catch((err) => {
      if (hit) return { ...hit.data, stale: true, error: err.message }; // show old data + warning
      throw err;
    })
    .finally(() => inflight.delete(days));

  inflight.set(days, p);
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
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.2/dist/chart.umd.min.js"></script>
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
  .src{background:rgba(245,158,11,.1);color:#fbbf24;padding:2px 8px;border-radius:6px;font:.78rem var(--mono)}
  .step{margin-bottom:14px}
  .step-top{display:flex;justify-content:space-between;gap:8px;font-size:.85rem;font-weight:600;margin-bottom:6px}
  .track{background:rgba(255,255,255,.05);height:8px;border-radius:9999px;overflow:hidden}
  .fill{height:100%;background:linear-gradient(90deg,#d97706,#fbbf24);border-radius:9999px;transition:width .5s ease}
  .fill.final{background:linear-gradient(90deg,#128c4a,var(--wa))}
  .drop{color:var(--subtle);font-weight:400;font-size:.75rem}
  .devlist{margin-top:12px;font-size:.8rem;color:var(--muted);display:grid;gap:4px}
  .devlist div{display:flex;justify-content:space-between}
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
      <div class="pill" id="pill"><span class="dot"></span><span id="pillText">Connecting to D1…</span></div>
      <button class="btn" id="refresh">Refresh</button>
    </div>
  </header>

  <div class="banner" id="banner" role="alert"></div>
  <div class="note" id="sample"></div>

  <section class="kpis" aria-label="Key numbers">
    <div class="kpi"><div class="kpi-label">Sessions</div><div class="kpi-value" id="k-sessions">—</div><div class="kpi-sub" id="k-sessions-sub">&nbsp;</div></div>
    <div class="kpi"><div class="kpi-label">Tapped Order (rate)</div><div class="kpi-value c-wa" id="k-rate">—</div><div class="kpi-sub" id="k-rate-sub">&nbsp;</div></div>
    <div class="kpi"><div class="kpi-label">WhatsApp taps</div><div class="kpi-value c-green" id="k-taps">—</div><div class="kpi-sub" id="k-taps-sub">&nbsp;</div></div>
    <div class="kpi"><div class="kpi-label">Active now</div><div class="kpi-value c-brand" id="k-active">—</div><div class="kpi-sub" id="k-active-sub">&nbsp;</div></div>
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
      <div class="card-title"><span>Where visitors come from</span><span class="tag">Landing → tapped Order</span></div>
      <div class="scroll"><table>
        <thead><tr><th>Source</th><th class="r">Sessions</th><th class="r">Tapped</th><th class="r">Rate</th></tr></thead>
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
      <div class="card-title"><span>Countries</span><span class="tag">Top 8</span></div>
      <div class="scroll"><table>
        <thead><tr><th>Country</th><th class="r">Sessions</th><th class="r">Tapped</th></tr></thead>
        <tbody id="countries"></tbody>
      </table></div>
    </div>
  </div>

  <div class="card" style="margin-bottom:20px">
    <div class="card-title"><span>Recent WhatsApp taps</span><span class="tag">Last 30 · all time</span></div>
    <div class="scroll"><table>
      <thead><tr><th>Time (IST)</th><th>Button</th><th>Came from</th><th>Campaign</th><th>Device</th><th>Country</th><th>Session</th></tr></thead>
      <tbody id="taps"></tbody>
    </table></div>
  </div>

  <div class="card" style="margin-bottom:20px">
    <div class="card-title"><span>Raw event stream</span><span class="tag">Last 40 · all time</span></div>
    <div class="scroll"><table>
      <thead><tr><th>Time (IST)</th><th>Event</th><th>Source</th><th>Path</th><th>Referrer</th><th>Device</th><th>Country</th><th>Session</th></tr></thead>
      <tbody id="events"></tbody>
    </table></div>
  </div>

  <footer id="foot">
    Session = one browser-tab visit (no cookies, no IPs stored). Tap = a click on a WhatsApp link, not a confirmed order —
    compare with your order sheet for the real tap-to-order rate. Changes compare against the previous period of equal length.
  </footer>
</div>

<script>
(function () {
  'use strict';

  var RANGES = [7, 30, 90];
  var state = { days: initialDays(), charts: {}, loading: false, fetchedAt: 0, lastAttemptAt: 0, stale: false, failed: false };
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
  function num(v) { return Number(v || 0).toLocaleString('en-IN'); }
  function pct(a, b) { return b > 0 ? (a / b) * 100 : 0; }
  function fmtPct(v) { return (v >= 10 ? v.toFixed(0) : v.toFixed(1)) + '%'; }
  function fmtTime(t) { return t ? String(t).slice(5, 16) : '—'; }
  function origin(o) { return o === 'direct' ? 'Direct / bookmark' : o; }
  function country(c) {
    if (!c || c === '??') return 'Unknown';
    try { return (regionNames && regionNames.of(c)) || c; } catch (e) { return c; }
  }
  function initialDays() {
    var d = parseInt(new URLSearchParams(location.search).get('days'), 10);
    return RANGES.indexOf(d) === -1 ? 7 : d;
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
  function rateCell(t, s) { return '<td class="r mono">' + (s > 0 ? fmtPct(pct(t, s)) : '—') + '</td>'; }

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

  function render(d) {
    state.fetchedAt = Date.parse(d.fetchedAt) || Date.now();
    state.stale = !!d.stale;
    state.failed = false;

    var o = d.overview, p = o.prev;
    var rate = pct(o.tappers, o.sessions), prate = pct(p.tappers, p.sessions);

    $('k-sessions').textContent = num(o.sessions);
    $('k-sessions-sub').innerHTML = delta(o.sessions, p.sessions) + '<span>vs previous (' + num(p.sessions) + ')</span>';
    $('k-rate').textContent = o.sessions ? fmtPct(rate) : '—';
    $('k-rate-sub').innerHTML = pts(rate, prate, p.sessions) + '<span>' + num(o.tappers) + ' of ' + num(o.sessions) + ' sessions</span>';
    $('k-taps').textContent = num(o.taps);
    $('k-taps-sub').innerHTML = delta(o.taps, p.taps) + '<span>' + num(o.tappers) + ' people</span>';
    $('k-active').textContent = num(o.activeNow);
    $('k-active-sub').textContent = 'sessions in the last 30 min';

    var sample = $('sample');
    if (o.sessions < 50) {
      sample.textContent = 'Small sample (' + o.sessions + ' sessions): percentages move a lot on a handful of visits. Use 30 or 90 days for steadier numbers.';
      sample.classList.add('show');
    } else {
      sample.classList.remove('show');
    }

    var a = d.allTime;
    var since = a.firstTs ? new Date(a.firstTs).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' }) : '—';
    $('foot').innerHTML = 'All time: <b>' + num(a.sessions) + '</b> sessions · <b>' + num(a.taps) + '</b> taps · tracking since ' + esc(since) + '.<br>' +
      'Session = one browser-tab visit (no cookies, no IPs stored). Tap = a click on a WhatsApp link, not a confirmed order — ' +
      'compare with your order sheet for the real tap-to-order rate. Changes compare against the previous period of equal length.';

    renderCharts(d);

    // Funnel: compare section drop-offs sequentially, but final tap compares to base (Landed)
    var base = d.funnel[0] ? d.funnel[0].sessions : 0;
    var prev = base;
    $('funnel').innerHTML = base
      ? d.funnel.map(function (s, i) {
          var w = Math.min(100, pct(s.sessions, base));
          var drop = '';
          if (s.final) {
            drop = ' <span class="drop">(' + Math.round(pct(s.sessions, base)) + '% of landed)</span>';
          } else if (i > 0 && prev > 0 && s.sessions < prev) {
            drop = ' <span class="drop">(−' + Math.round(((prev - s.sessions) / prev) * 100) + '% vs previous step)</span>';
          }
          if (!s.final) prev = s.sessions;
          return '<div class="step"><div class="step-top"><span>' + esc(s.label) + drop + '</span>' +
            '<span class="mono" style="color:#94a3b8">' + num(s.sessions) + ' · ' + Math.round(w) + '%</span></div>' +
            '<div class="track"><div class="fill' + (s.final ? ' final' : '') + '" style="width:' + w + '%\"></div></div></div>';
        }).join('')
      : '<div class="empty">No sessions in this range yet</div>';

    // Tables
    fill('origins', d.origins, 4, 'No landings in this range', function (r) {
      return '<tr><td><b>' + esc(origin(r.origin)) + '</b></td><td class="r mono">' + num(r.sessions) + '</td><td class="r mono">' + num(r.tappers) + '</td>' + rateCell(r.tappers, r.sessions) + '</tr>';
    });
    fill('buttons', d.buttons, 3, 'No taps in this range', function (r) {
      return '<tr><td><span class="src">' + esc(r.source) + '</span></td><td class="r mono">' + num(r.taps) + '</td><td class="r mono">' + num(r.people) + '</td></tr>';
    });
    fill('campaigns', d.campaigns, 4, 'No UTM-tagged visits yet — add ?utm_source=… to links you share', function (r) {
      return '<tr><td>' + esc(r.utm_source) + ' / ' + esc(r.utm_medium) + '</td><td>' + esc(r.utm_campaign) + '</td><td class="r mono">' + num(r.sessions) + '</td><td class="r mono">' + num(r.tappers) + '</td></tr>';
    });
    fill('countries', d.countries, 3, 'No data', function (r) {
      return '<tr><td>' + esc(country(r.country)) + '</td><td class="r mono">' + num(r.sessions) + '</td><td class="r mono">' + num(r.tappers) + '</td></tr>';
    });
    fill('taps', d.recentTaps, 7, 'No WhatsApp taps recorded yet', function (r) {
      return '<tr><td class="mono small">' + esc(fmtTime(r.time)) + '</td><td><span class="src">' + esc(r.source) + '</span></td><td>' + esc(origin(r.origin)) +
        '</td><td class="small">' + esc(r.campaign || '—') + '</td><td><span class="badge b-dev">' + esc(r.device) + '</span></td><td>' + esc(country(r.country)) +
        '</td><td class="mono small">' + esc(r.sid || '—') + '</td></tr>';
    });
    fill('events', d.recentEvents, 8, 'No events recorded', function (r) {
      var cls = r.event === 'whatsapp_click' ? 'b-wa' : r.event === 'landing' ? 'b-land' : 'b-ev';
      return '<tr><td class="mono small">' + esc(fmtTime(r.time)) + '</td><td><span class="badge ' + cls + '">' + esc(r.event) + '</span></td><td>' + esc(r.source || '—') +
        '</td><td class="mono small">' + esc(r.path || '/') + '</td><td>' + esc(r.ref || 'Direct') + '</td><td><span class="badge b-dev">' + esc(r.device) +
        '</span></td><td>' + esc(country(r.country)) + '</td><td class="mono small">' + esc(r.sid || '—') + '</td></tr>';
    });

    updatePill();
  }

  function renderCharts(d) {
    if (!window.Chart) {
      banner('Chart library failed to load (offline?). Tables below still work.');
      return;
    }
    var labels = d.daily.map(function (x) {
      return new Date(x.day + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
    });
    $('trendTag').textContent = 'Daily · ' + d.days + ' days';

    upsert('trend', 'trend', {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          { type: 'line', label: 'Sessions', data: d.daily.map(function (x) { return x.sessions; }), borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.1)', fill: true, tension: 0.35, borderWidth: 2, pointRadius: d.days > 30 ? 0 : 3, order: 0 },
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
          { label: 'Sessions', data: d.hourly.map(function (h) { return h.sessions; }), backgroundColor: 'rgba(245,158,11,0.75)', borderRadius: 3 },
          { label: 'WhatsApp taps', data: d.hourly.map(function (h) { return h.taps; }), backgroundColor: '#25d366', borderRadius: 3 }
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
      var res = await fetch('/api/data?days=' + state.days + (force ? '&refresh=1' : ''), { cache: 'no-store' });
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

  $('range').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-days]');
    if (!b) return;
    setRange(Number(b.dataset.days));
    load(false);
  });
  $('refresh').addEventListener('click', function () { load(true); });

  setInterval(function () {
    if (document.visibilityState !== 'visible') return;
    updatePill();
    if (Date.now() - state.lastAttemptAt > 60000) load(false);
  }, 5000);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && Date.now() - state.lastAttemptAt > 60000) load(false);
  });

  setRange(state.days);
  load(false);
})();
</script>
</body>
</html>
`;

// ───────────────────────────── Server ─────────────────────────────

const ALLOWED_HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`, `[::1]:${PORT}`]);

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

function send(res, status, type, body, extra = {}) {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    ...extra,
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  // Block DNS-rebinding: only answer requests addressed to localhost on our port.
  if (!ALLOWED_HOSTS.has(String(req.headers.host || '').toLowerCase())) {
    return send(res, 403, 'text/plain; charset=utf-8', 'Forbidden');
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(res, 405, 'text/plain; charset=utf-8', 'Method Not Allowed', { Allow: 'GET, HEAD' });
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/data') {
    const requested = parseInt(url.searchParams.get('days'), 10);
    const days = RANGES.includes(requested) ? requested : DEFAULT_DAYS;
    try {
      const data = await getData(days, url.searchParams.get('refresh') === '1');
      return send(res, 200, 'application/json; charset=utf-8', JSON.stringify(data));
    } catch (err) {
      console.error(`[analytics] ${err.message}`);
      return send(res, 502, 'application/json; charset=utf-8', JSON.stringify({ error: err.message }));
    }
  }

  if (url.pathname === '/' || url.pathname === '/index.html') {
    return send(res, 200, 'text/html; charset=utf-8', HTML_TEMPLATE, { 'Content-Security-Policy': CSP });
  }

  if (url.pathname === '/favicon.ico') return send(res, 204, 'image/x-icon', '');

  send(res, 404, 'text/plain; charset=utf-8', 'Not Found');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\nPort ${PORT} is already in use. Try: PORT=${PORT + 1} npm run analytics\n`);
  } else {
    console.error(err);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`\n✨ Hariram Namkeen Analytics Hub → http://localhost:${PORT}`);
  console.log(`   D1 database: ${DB_NAME} · listening on ${HOST} only · Ctrl+C to stop\n`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
