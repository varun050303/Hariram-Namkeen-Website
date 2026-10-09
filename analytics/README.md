# Analytics setup (Cloudflare)

Two layers, both free at your volume:

1. **Cloudflare Web Analytics** — visitors, page views, referrers, countries, devices, Core Web Vitals. No code needed.
2. **First-party event counter** (`functions/api/track.js` + D1) — which Order button gets tapped, where visitors come from (Instagram, Google, UTM links), and how far they scroll. This is what Web Analytics can't do.

No cookies, no IP addresses and no personal data are stored.

## One-time setup

### A. Web Analytics (2 minutes)
Cloudflare dashboard → **Web Analytics** → add `hariramnamkeen.com`. Because the domain is proxied through Cloudflare, choose the automatic setup (it injects the beacon for you). Nothing to change in this repo.

### B. Event counter (10 minutes)
```bash
# 1. create the database
npx wrangler d1 create hariram-analytics

# 2. create the table
npx wrangler d1 execute hariram-analytics --remote --file=analytics/schema.sql
```
3. Cloudflare dashboard → your **Pages project** → **Settings → Bindings** (Functions) → **Add → D1 database**
   - Variable name: `DB` (exactly this)
   - Database: `hariram-analytics`
   - Add it for **Production** (and Preview if you want to test there)
4. Redeploy (push a commit, or "Retry deployment").

### C. Check it works
Open the live site, tap an Order button, then:
```bash
npx wrangler d1 execute hariram-analytics --remote \
  --command "SELECT datetime(ts/1000,'unixepoch') AS time, event, source, ref, device FROM events ORDER BY id DESC LIMIT 10"
```
Until the `DB` binding exists, events are dropped silently and the site works normally.

## Events recorded

| event | when | `source` |
|---|---|---|
| `landing` | first page load in a browser-tab session | `page` |
| `whatsapp_click` | any tap on a wa.me link | `hero`, `header`, `mobile_menu`, `mobile_bar`, `product:<name>`, `products_section`, `hamper`, `cta_banner`, `footer`, `other` |
| `section_view` | section scrolled into view (once per session) | `oil-truth`, `products`, `hamper`, `story` |

To label a specific link, add `data-track="my_label"` to it (or a parent element).

## Use UTM links everywhere you share the site
Instagram bio: `https://hariramnamkeen.com/?utm_source=instagram&utm_medium=bio`
Instagram story/reel: `...?utm_source=instagram&utm_medium=story`
WhatsApp broadcast: `...?utm_source=whatsapp&utm_medium=broadcast`
Corporate outreach email: `...?utm_source=email&utm_medium=outreach&utm_campaign=<company>`

## Queries you'll actually use
Time filter used below = last 7 days. Change `7` as needed.

**Which button gets the clicks**
```sql
SELECT source, COUNT(*) AS clicks, COUNT(DISTINCT sid) AS people
FROM events
WHERE event = 'whatsapp_click' AND ts > (strftime('%s','now') - 7*86400) * 1000
GROUP BY source ORDER BY clicks DESC;
```

**Where visitors come from, and how many of them tap Order**
```sql
SELECT COALESCE(NULLIF(l.utm_source,''), NULLIF(l.ref,''), 'direct') AS origin,
       COUNT(DISTINCT l.sid) AS sessions,
       COUNT(DISTINCT c.sid) AS tapped_order,
       ROUND(100.0 * COUNT(DISTINCT c.sid) / COUNT(DISTINCT l.sid), 1) AS pct
FROM events l
LEFT JOIN events c ON c.sid = l.sid AND c.event = 'whatsapp_click'
WHERE l.event = 'landing' AND l.ts > (strftime('%s','now') - 7*86400) * 1000
GROUP BY origin ORDER BY sessions DESC;
```

**Scroll funnel (how many sessions reach each section)**
```sql
SELECT source AS section, COUNT(DISTINCT sid) AS sessions
FROM events
WHERE event = 'section_view' AND ts > (strftime('%s','now') - 7*86400) * 1000
GROUP BY source;
```

**Mobile vs desktop**
```sql
SELECT device, COUNT(DISTINCT CASE WHEN event='landing' THEN sid END) AS sessions,
       COUNT(DISTINCT CASE WHEN event='whatsapp_click' THEN sid END) AS tapped_order
FROM events WHERE ts > (strftime('%s','now') - 7*86400) * 1000
GROUP BY device;
```

## What this can't see
A WhatsApp tap is not an order. Keep a "came from" column in your order sheet and compare it with the daily click count to get your true tap-to-order rate.

## Limits (free plan, checked against Cloudflare's pricing pages)
D1: 100,000 rows written/day, 5M rows read/day, 5 GB. Pages Functions: 100,000 requests/day. At a few hundred visits a day you use a few percent of this (each visit writes up to about 7 events).
