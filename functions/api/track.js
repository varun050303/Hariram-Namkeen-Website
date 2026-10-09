// Cloudflare Pages Function — POST /api/track
// First-party, cookie-less event counter that writes to a D1 database.
// If the D1 binding (named DB) isn't set up yet, events are silently dropped and the site is unaffected.
// Setup + queries: see /analytics/README.md

const ALLOWED_EVENTS = new Set(['landing', 'whatsapp_click', 'section_view']);

const clip = (value, max = 80) => (typeof value === 'string' ? value.slice(0, max) : '');

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

    if (env.DB) {
      await env.DB.prepare(
        `INSERT INTO events
           (ts, event, source, path, ref, utm_source, utm_medium, utm_campaign, device, country, sid)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`
      )
        .bind(
          Date.now(),
          d.event,
          clip(d.source),
          clip(d.path),
          clip(d.ref),
          clip(d.utm_source, 40),
          clip(d.utm_medium, 40),
          clip(d.utm_campaign, 60),
          d.device === 'mobile' ? 'mobile' : 'desktop',
          request.cf && request.cf.country ? request.cf.country : '',
          clip(d.sid, 16)
        )
        .run();
    }

    return new Response(null, { status: 204 });
  } catch (err) {
    // Analytics must never break the page or return noisy errors
    return new Response(null, { status: 204 });
  }
}
