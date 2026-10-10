// scripts/generate-post.mjs
// Drafts one blog post from first-party facts, validates it, and writes it to
// src/content/blog. A PR step (see workflow) then puts it in front of you.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePost } from './validate.mjs';

// Automatically load local .env if present (native in Node.js 20.6+)
try { process.loadEnvFile?.(); } catch {}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = 'src/content/blog';
const API_BASE = process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com/v1beta';
// Model names live in config, not code: set repo variable GEMINI_MODEL to swap without a commit.
const MODELS = [...new Set([
  process.env.GEMINI_MODEL || 'gemini-3.8-flash',
  ...(process.env.GEMINI_FALLBACK_MODELS || 'gemini-3.5-flash-lite,gemini-3.5-flash').split(','),
].map((s) => s.trim()).filter(Boolean))];
const MAX_ATTEMPTS = 3;

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) fail('Missing GEMINI_API_KEY.');

const facts = JSON.parse(fs.readFileSync(path.join(__dirname, 'facts.json'), 'utf-8'));
const topics = JSON.parse(fs.readFileSync(path.join(__dirname, 'topics.json'), 'utf-8'));

// ---- what already exists ----
const outDir = path.join(process.cwd(), CONTENT_DIR);
fs.mkdirSync(outDir, { recursive: true });
const existing = { slugs: new Set(), titles: [], topics: new Set() };
for (const f of fs.readdirSync(outDir).filter((x) => x.endsWith('.md'))) {
  const fm = fs.readFileSync(path.join(outDir, f), 'utf-8').split('---')[1] ?? '';
  const get = (k) => fm.match(new RegExp(`^${k}:\\s*"?(.+?)"?\\s*$`, 'm'))?.[1];
  existing.slugs.add(get('slug') ?? f.replace(/\.md$/, ''));
  if (get('title')) existing.titles.push(get('title'));
  if (get('topic')) existing.topics.add(get('topic'));
}

// ---- next unused topic (no repeats; stops when the list is used up) ----
const topic = topics.find((t) => !existing.topics.has(t.id));
if (!topic) {
  console.log('All topics used. Add more to scripts/topics.json.');
  setOutput('skip', 'true');
  process.exit(0);
}

const basePrompt = `You write for Hariram Namkeen.

VOICE: ${facts.voice}

FACTS (the only claims you may make about Hariram; do not add any other):
${facts.facts.map((f) => `- ${f}`).join('\n')}

TOPIC: ${topic.angle}
TARGET SEARCH PHRASE (use naturally in the title and once or twice in the body): ${topic.query}

RULES:
- Answer the reader's question first, in the opening paragraph. Plain, concrete sentences.
- Use only the facts above for anything about Hariram. General cooking or gifting advice is fine if it is common knowledge and contains no numbers.
- No health or medical claims. No comparison with other brands. No invented customers, quotes, prices, dates, awards or numbers.
- The only prices you may mention are those in the facts.
- Include the phrase "yellow mustard oil" in the body.
- Do not write a call-to-action link; one is added automatically.

Respond with ONLY valid JSON, no code fences, exactly this shape:
{
  "title": "under 60 characters",
  "slug": "lowercase-kebab-case",
  "metaDescription": "under 155 characters",
  "bodyMarkdown": "350-700 words, markdown, at least one ## subheading",
  "faq": [{"q": "question a buyer would ask", "a": "1-3 sentence answer using only the facts"}],
  "caption": "under 280 characters, for Instagram/WhatsApp, 1-2 emoji"
}
faq must have 2-4 items.`;

let post, lastErrors = [];
for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  const prompt = lastErrors.length
    ? `${basePrompt}\n\nYour previous draft was rejected. Fix ALL of these and return the full JSON again:\n- ${lastErrors.join('\n- ')}`
    : basePrompt;
  const text = await callGemini(prompt);
  try {
    post = JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch {
    lastErrors = ['response was not valid JSON'];
    console.error(`Attempt ${attempt}: not valid JSON`);
    continue;
  }
  lastErrors = validatePost(post, facts, existing);
  if (!lastErrors.length) break;
  console.error(`Attempt ${attempt} rejected:\n- ${lastErrors.join('\n- ')}`);
}
if (lastErrors.length) fail(`No draft passed the quality gate after ${MAX_ATTEMPTS} attempts.`);

// ---- write the post ----
const today = new Date().toISOString().slice(0, 10);
const waLink = 'https://wa.me/916396122920?text=' + encodeURIComponent('Hi Hariram Namkeen, I want to order the Special 4 Box (800g) for Rs.499.');
const faqMd = post.faq.map((f) => `### ${f.q}\n\n${f.a}`).join('\n\n');
const body = `${post.bodyMarkdown.trim()}

## Questions people ask

${faqMd}

---

**Want to taste it?** The Special 4 Box is 4 varieties, 800g, ₹499 with free delivery across India. [Order on WhatsApp](${waLink}).
`;
// JSON strings are valid YAML, so every value is safely quoted/escaped.
const frontmatter = `---
title: ${JSON.stringify(post.title)}
description: ${JSON.stringify(post.metaDescription)}
pubDate: ${today}
slug: ${JSON.stringify(post.slug)}
topic: ${JSON.stringify(topic.id)}
faq: ${JSON.stringify(post.faq)}
---

`;
const outPath = path.join(outDir, `${post.slug}.md`);
fs.writeFileSync(outPath, frontmatter + body, 'utf-8');
console.log(`Wrote ${outPath}`);

setOutput('skip', 'false');
setOutput('title', post.title);
setOutput('slug', post.slug);
setOutput('topic', topic.id);
setOutput('caption', post.caption);

// ---- helpers ----
async function callGemini(prompt) {
  let lastErr = '';
  for (const rawModel of MODELS) {
    const model = rawModel.replace(/^models\//, '');
    const res = await fetch(`${API_BASE}/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': API_KEY },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              title: { type: 'STRING' },
              slug: { type: 'STRING' },
              metaDescription: { type: 'STRING' },
              bodyMarkdown: { type: 'STRING' },
              faq: {
                type: 'ARRAY',
                items: {
                  type: 'OBJECT',
                  properties: {
                    q: { type: 'STRING' },
                    a: { type: 'STRING' },
                  },
                  required: ['q', 'a'],
                },
              },
              caption: { type: 'STRING' },
            },
            required: ['title', 'slug', 'metaDescription', 'bodyMarkdown', 'faq', 'caption'],
          },
        },
      }),
    });
    if (res.ok) {
      const data = await res.json();
      const candidate = data.candidates?.[0];
      const parts = candidate?.content?.parts ?? [];
      const text = parts.filter((p) => !p.thought).map((p) => p.text ?? '').join('');
      if (text) return text;

      const reason = candidate?.finishReason || data.promptFeedback?.blockReason || 'empty response';
      lastErr = `${model}: No text returned from model (finishReason: ${reason})`;
      console.error(lastErr);
      continue;
    }
    lastErr = `${model}: ${res.status} ${await res.text()}`;
    console.error(`Model failed -> ${lastErr}`);
    // Try the next model for retired (404), quota (429) or server (5xx) errors; stop on auth errors.
    if (![400, 404, 429, 500, 502, 503, 504].includes(res.status)) break;
  }
  return fail(`All Gemini models failed. Last error: ${lastErr}`);
}

function setOutput(name, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  const d = `EOF_${Math.random().toString(36).slice(2)}`;
  fs.appendFileSync(file, `${name}<<${d}\n${value}\n${d}\n`);
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}
