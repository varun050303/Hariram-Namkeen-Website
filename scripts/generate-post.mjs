// scripts/generate-post.mjs
// Weekly content generator for Hariram Namkeen.
// Picks a rotating topic, calls Gemini Flash, writes a markdown blog post,
// and sets GitHub Actions outputs used by the PR step.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---- CONFIG: adjust these two lines to match your actual Astro repo ----
const CONTENT_DIR = 'src/content/blog';   // <-- change if your blog posts live elsewhere
const GEMINI_MODEL = 'gemini-3.5-flash';  // <-- check aistudio.google.com for the current free-tier model name; swap if this is retired
// --------------------------------------------------------------------

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error('Missing GEMINI_API_KEY environment variable.');
  process.exit(1);
}

// 1. Pick this week's topic (rotates automatically, no state file needed)
const topics = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'topics.json'), 'utf-8')
);
const weekNumber = getISOWeek(new Date());
const topic = topics[weekNumber % topics.length];

// 2. Brand voice — keep this in sync with the actual site copy so the LLM
//    doesn't invent new positioning. Update if the site's messaging changes.
const BRAND_VOICE = `
You are writing for Hariram Namkeen, a small home-kitchen namkeen brand from
Muzaffarnagar, Uttar Pradesh, India.

Facts you must stick to (do not invent new claims):
- Every product uses Kachi Ghani (cold-pressed, unrefined) mustard oil, never palm or sunflower oil.
- Spices are ground fresh in-house daily, not bought as pre-mixed industrial masala.
- Made in small batches, never factory/bulk production.
- FSSAI licensed (Lic. 22725393001461).
- Philosophy: "Grahak Dev Tulya" - the customer is treated as equal to God. Respect, honesty, purity.
- Big industrial brands (Haldiram's, Bikaji, etc.) have generally used palm or refined
  vegetable oil from the start, for cost and shelf life - this is NOT a story of them
  "switching away" from mustard oil. Never claim they switched. The honest contrast is:
  they chose the cheaper industrial oil from day one; Hariram deliberately chose Kachi
  Ghani mustard oil instead, even though it costs more and has a shorter shelf life.
- Origin story: namkeen as a tradition traces back to Rajasthan. Hariram is blending that
  Rajasthani heritage with UP (Uttar Pradesh) style preparation, made fresh in Muzaffarnagar.
  Do not claim the tradition originated in UP - it didn't. Frame it as a blend/fusion.
- Tone: warm, proud, direct, quietly confident about ingredient honesty rather than
  positioning as "the real tradition vs fake brands". Never arrogant or salesy. Written
  like a real person from Muzaffarnagar who cares about the craft, not a corporate copywriter.
- Do not use exaggerated superlatives ("world's best", "#1") or make medical claims.
- Target reader: health-conscious buyers in India who care about ingredient quality.
`;

const prompt = `${BRAND_VOICE}

This week's topic angle: ${topic.angle}

Write a blog post for the Hariram Namkeen website plus a short social caption.

Respond with ONLY valid JSON, no markdown code fences, no preamble, matching exactly this shape:
{
  "title": "string, under 60 characters, SEO-friendly",
  "slug": "string, lowercase-kebab-case, no special characters",
  "metaDescription": "string, under 155 characters, for SEO meta tag",
  "bodyMarkdown": "string, 300-500 words, markdown formatted with at least one ## subheading, written in the brand voice above",
  "caption": "string, under 280 characters, punchy Instagram/WhatsApp caption with 1-2 relevant emoji, ending with a WhatsApp order call-to-action"
}`;

const response = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${API_KEY}`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.8 },
    }),
  }
);

if (!response.ok) {
  console.error('Gemini API error:', response.status, await response.text());
  process.exit(1);
}

const data = await response.json();
const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

// Gemini sometimes wraps JSON in code fences despite instructions — strip them defensively.
const cleaned = rawText.replace(/```json|```/g, '').trim();

let post;
try {
  post = JSON.parse(cleaned);
} catch (err) {
  console.error('Failed to parse Gemini response as JSON:', cleaned);
  process.exit(1);
}

// 3. Write the markdown file with Astro content-collection frontmatter
const today = new Date().toISOString().split('T')[0];
const frontmatter = `---
title: "${post.title.replace(/"/g, '\\"')}"
description: "${post.metaDescription.replace(/"/g, '\\"')}"
pubDate: ${today}
slug: "${post.slug}"
---

${post.bodyMarkdown}
`;

const outDir = path.join(process.cwd(), CONTENT_DIR);
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, `${post.slug}.md`);
fs.writeFileSync(outPath, frontmatter, 'utf-8');

console.log(`Wrote ${outPath}`);

// 4. Set outputs for the PR step
const githubOutput = process.env.GITHUB_OUTPUT;
if (githubOutput) {
  const escape = (s) => s.replace(/\n/g, '\\n').replace(/%/g, '%25');
  fs.appendFileSync(
    githubOutput,
    `title=${escape(post.title)}\nslug=${escape(post.slug)}\ncaption=${escape(post.caption)}\n`
  );
}

function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}
