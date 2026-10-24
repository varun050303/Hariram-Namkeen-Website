// Cloudflare Pages Function — POST /api/track
// First-party, cookie-less event counter that writes to a D1 database.
// If the D1 binding (named DB) isn't set up yet, events are silently dropped and the site is unaffected.
// Setup + queries: see /analytics/README.md
//
// Bot handling: events are NEVER dropped for looking like a bot — they are stored with is_bot = 1
// (plus the network owner in `asorg`) so the dashboard can hide them and you can still audit
// what was hidden ("Raw" view). Fix a bad rule and old rows can be re-flagged with SQL.

const ALLOWED_EVENTS = new Set(['landing', 'whatsapp_click', 'section_view', 'engage']);

const clip = (value, max = 80) => (typeof value === 'string' ? value.slice(0, max) : '');
const int = (value, min, max) => {
  const x = Math.round(Number(value));
  return Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : null;
};

// Self-identified crawlers, monitors, scanners and HTTP libraries.
const BOT_UA =
  /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|pingdom|uptime|monitor|scanner|preview|google-|googleother|mediapartners|apis-google|feedfetcher|curl|wget|python|node-fetch|axios|go-http|java\/|phantom|selenium|puppeteer|playwright/i;

// Cloud / hosting networks. Real visitors do not browse from these.
// Cloudflare, Akamai and Fastly are deliberately NOT listed: iCloud Private Relay and WARP route real
// people through them.
const DATACENTER_ORG =
  /google (cloud|llc)|amazon|aws|microsoft|azure|digitalocean|hetzner|ovh|oracle|linode|alibaba|tencent|vultr|leaseweb|scaleway|contabo|choopa|m247|datacamp|colocrossing/i;

function looksLikeBot({ ua, asorg, acceptLanguage, webdriver }) {
  return (
    !ua ||
    !acceptLanguage || // every real browser sends one; most scripts do not
    webdriver === true ||
    BOT_UA.test(ua) ||
    DATACENTER_ORG.test(asorg)
  );
}

async function insert(db, row) {
  const cols = Object.keys(row);
  const marks = cols.map((_, i) => `?${i + 1}`).join(', ');
  return db
    .prepare(`INSERT INTO events (${cols.join(', ')}) VALUES (${marks})`)
    .bind(...cols.map((c) => row[c]))
    .run();
}

export async function onRequestPost({ request, env }) {
  try {
    // Same-site requests only
    const origin = request.headers.get('Origin');
    if (origin && new URL(origin).host !== new URL(request.url).host) {
      return new Response(null, { status: 403 });
    }

    const raw = await request.text();
    if (raw.length > 2000) return new Response(null, { status: 413 });

    const d = JSON.parse(raw);
    if (!ALLOWED_EVENTS.has(d.event)) return new Response(null, { status: 400 });

    const db = env.DB || env.hariram_analytics;
    if (db) {
      const cf = request.cf || {};
      const asorg = typeof cf.asOrganization === 'string' ? clip(cf.asOrganization, 60) : '';
      const is_bot = looksLikeBot({
        ua: request.headers.get('User-Agent') || '',
        asorg,
        acceptLanguage: request.headers.get('Accept-Language') || '',
        webdriver: d.wd,
      })
        ? 1
        : 0;

      const base = {
        ts: Date.now(),
        event: d.event,
        source: clip(d.source),
        path: clip(d.path),
        ref: clip(d.ref),
        utm_source: clip(d.utm_source, 40),
        utm_medium: clip(d.utm_medium, 40),
        utm_campaign: clip(d.utm_campaign, 60),
        device: d.device === 'mobile' ? 'mobile' : 'desktop',
        country: typeof cf.country === 'string' ? cf.country : '',
      };
      const geo = {
        city: typeof cf.city === 'string' ? clip(cf.city, 60) : '',
        region: typeof cf.regionCode === 'string' ? clip(cf.regionCode, 10) : (typeof cf.region === 'string' ? clip(cf.region, 40) : ''),
      };
      const sid = clip(d.sid, 16);

      // New-tracker fields. A missing field stays NULL = "unknown" (old cached page), never 0, so the
      // dashboard can tell "measured and zero" from "not measured".
      const extra = {
        vid: typeof d.vid === 'string' && d.vid ? clip(d.vid, 16) : null,
        input: d.inp === 1 ? 1 : d.inp === 0 ? 0 : null,
        active_s: d.event === 'engage' ? int(d.a, 0, 7200) : null,
        depth: d.event === 'engage' ? int(d.dp, 0, 100) : null,
      };

      // Newest schema first, then progressively older ones (so a deploy before the migration still records).
      const attempts = [
        { ...base, ...geo, asorg, is_bot, ...extra, sid },
        { ...base, ...geo, asorg, is_bot, sid },
        { ...base, ...geo, sid },
        { ...base, sid },
      ];
      for (const row of attempts) {
        try {
          await insert(db, row);
          break;
        } catch {
          // column missing in an older schema: try the narrower row
        }
      }
    }

    return new Response(null, { status: 204 });
  } catch (err) {
    // Analytics must never break the page or return noisy errors
    return new Response(null, { status: 204 });
  }
}
