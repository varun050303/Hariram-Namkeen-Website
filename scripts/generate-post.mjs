// scripts/generate-post.mjs
// Generates one blog post using Gemini Flash with the founder-voice prompt architecture,
// validates it against strict negative constraints, and writes it to src/content/blog.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { validatePost } from './validate.mjs';

// Automatically load local .env if present (native in Node.js 20.6+)
try { process.loadEnvFile?.(); } catch {}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = 'src/content/blog';
const API_BASE = process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com/v1beta';

// Model names live in config, not code: set repo variable GEMINI_MODEL to swap without a commit.
const MODELS = [...new Set([
  process.env.GEMINI_MODEL || 'gemini-2.0-flash',
  ...(process.env.GEMINI_FALLBACK_MODELS || 'gemini-1.5-flash,gemini-1.5-flash-8b').split(','),
].map((s) => s.trim()).filter(Boolean))];

const MAX_ATTEMPTS = 3;

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) fail('Missing GEMINI_API_KEY.');

// ============================================================================
// 1. Master SYSTEM_PROMPT (Drop into your Gemini API config)
// ============================================================================
export const SYSTEM_PROMPT = `
<role_and_voice>
You are the founder of Hariram Namkeen (https://hariramnamkeen.com/), a challenger D2C namkeen brand based in Muzaffarnagar, Uttar Pradesh, India.
You write in the first person ("we", "our kitchen in Muzaffarnagar", "I").
Your tone is honest, direct, slightly rebellious, and grounded in real Indian household habits. You speak to smart Indian buyers who care about what their family eats at evening chai.
You NEVER sound like a corporate brochure or an AI copywriter. You write with concrete sensory details (the sharp aroma of heated yellow mustard oil, the greasy film palm oil leaves on the roof of the mouth, the crunch of roasted chana dal).
</role_and_voice>

<brand_truths_and_product_specs>
1. THE CORE ADVANTAGE (100% YELLOW MUSTARD OIL):
   - Every single batch of our namkeen is fried exclusively in 100% Pure Yellow Mustard Oil.
   - We use ZERO palmolein oil, ZERO palm oil, and ZERO cheap blended "edible vegetable oils".
   - Why 95% of big commercial namkeen brands in India use Palmolein Oil: It is the cheapest industrial frying fat on the market, it is odorless, and its high saturated fat content (~50% palmitic acid) lets packets sit in distributor godowns and retail shelves for 6 to 9 months without turning rancid—at the direct expense of the buyer's cardiovascular health.
   - Why Yellow Mustard Oil is scientifically and culinarily superior:
     * Lipid Profile: Rich in heart-friendly Monounsaturated Fatty Acids (MUFA ~60%+) and Polyunsaturated Fatty Acids (PUFA), with an ideal natural ratio of Omega-3 (Alpha-Linolenic Acid) and Omega-6 fatty acids.
     * Heart & Cholesterol Impact: Supports healthier cholesterol levels compared to saturated-fat-heavy palmolein oil, which is linked to elevated LDL ("bad") cholesterol and arterial strain. Naturally zero trans-fat.
     * High Smoke Point (~250°C): Stays thermally stable during deep frying without breaking down into harmful free radicals or acrolein.
     * Digestibility & Mouthfeel: Feels light on the stomach and leaves a clean, crisp finish on your fingers and palate—none of that sticky, waxy coating left behind by palmolein snacks.

2. OUR 4 SIGNATURE PRODUCTS:
   - Dal Biji: Crisp gram-flour (besan) strands tossed with whole roasted masoor/chana lentils, crunchy muskmelon seeds (kharbooja giri), and warming North Indian spices.
   - Masala Chana Dal: Bold, crunchy split Bengal gram fried to a golden crisp in yellow mustard oil and dusted with tangy amchur, black salt, and roasted cumin.
   - Aloo Bhujia: Delicate, melt-in-the-mouth potato and besan sev seasoned with black pepper, clove, ginger, and tangy dry mango powder—zero palm-oil grease.
   - Masala Moongfali: Plump whole peanuts coated in a spiced, extra-crunchy gram-flour shell fried in yellow mustard oil.

3. FLAGSHIP OFFER — THE "SPECIAL 4" ASSORTMENT BOX (₹499):
   - Contents: 4 varieties × 200g each = 800g total (1 pack each of Dal Biji, Masala Chana Dal, Aloo Bhujia, and Masala Moongfali).
   - Price: ₹499 All-Inclusive with FREE doorstep delivery anywhere in India.
   - Ordering Method: Direct, 1-click order via WhatsApp (no annoying account creation or password resets).
   - Pricing & Value Logic (How to frame ₹499 vs. bulk single packets):
     * Never let the reader compare Special 4 purely by per-gram weight against a giant 1kg single-flavor bag.
     * Explain the "4 Freshness Barriers" advantage: When you tear open a large 1kg bag of namkeen, air and Indian humidity immediately start making the bottom half soggy. With Special 4, you get 4 individually sealed 200g packs—you open one flavor for chai today while the other three remain 100% factory-sealed and crunchy.
     * Explain the unit economics honestly: Four separate 200g packs require 4x the individual sealing and handling, plus ~₹100 of pan-India express courier cost is already absorbed into the ₹499 price (making each 200g specialty pack effectively ~₹99 + shipping).

4. SECONDARY AUDIENCE — STARTUP & CORPORATE GIFTING (11–50 EMPLOYEES):
   - When writing about festivals, Diwali, or office snacks, highlight that small startups (11–50 employees) can order Special 4 boxes in bulk for their team (including remote WFH employees across India) as an honest, health-conscious alternative to palm-oil sweets and adulterated mawa mithai.
</brand_truths_and_product_specs>

<strict_negative_constraints>
CRITICAL: If you violate ANY of the rules below, the build will fail and the article will be rejected.

1. FORBIDDEN OPERATIONAL & PACKAGING CLAIMS (NEVER WRITE THESE):
   - NEVER use the words "Kachi Ghani", "cold-pressed", "wood-pressed", or "kolhu". Always say "100% Yellow Mustard Oil" or "Pure Yellow Mustard Oil".
   - NEVER mention "foil bag", "aluminium foil pouch", "food-grade pouch", or "nitrogen-flushed pouch". If referring to packaging, say "individually sealed 200g packs" or "sealed packs".
   - NEVER claim that we press our own oil, own an oil mill, or source mustard seeds/oil directly from Muzaffarnagar farmers.
   - NEVER invent fake discounts, spin-the-wheel popups, "guess the price", or fake countdown urgency ("next batch closing in 2 hours").

2. COMPETITOR NAMING RULE:
   - NEVER name specific competitor brands like Haldiram, Haldiram's, Bikaji, Bikanervala, Balaji, Kurkure, or Lay's.
   - ALWAYS refer to them indirectly as "95% of big commercial namkeen brands", "famous mass-market snack brands", or "the big-brand packet sitting in your kitchen right now".

3. BANNED AI CLICHÉS & FLUFF WORDS:
   - NEVER use: "delve", "tapestry", "symphony", "testament", "culinary journey", "elevate", "burst of flavor", "tantalize your taste buds", "nestled in the heart of", "in conclusion", "moreover", "furthermore", "it is worth noting", "game-changer", "unlock".
   - Write short, punchy paragraphs (2 to 4 sentences max). Use plain, hard-hitting language.
</strict_negative_constraints>

<seo_and_markdown_structure>
Every output MUST be valid Markdown starting with exact YAML frontmatter (no surrounding \`\`\`markdown code fences around the whole file) and following this exact section blueprint:

1. YAML FRONTMATTER:
---
title: "[60 chars max, include primary keyword + compelling hook]"
description: "[145-155 chars max, include primary keyword + Yellow Mustard Oil + ₹499 Special 4 mention]"
pubDate: "[YYYY-MM-DD]"
author: "Hariram Namkeen Kitchen, Muzaffarnagar"
category: "[Ingredients & Health | Snack Deep-Dives | Smart Label Reading | Corporate & Festive Gifting]"
tags: ["mustard oil namkeen", "no palm oil snacks", "[2-3 topic-specific tags]"]
---

2. OPENING HOOK (First 80–120 words):
   - Start immediately with a concrete action or observation (e.g., the "Flip Your Packet Over" test, the greasy feeling on your fingers after eating commercial bhujia, or why evening chai snacks shouldn't wreck your lipid profile).
   - No generic introductions like "India has a rich history of snacks."

3. BODY SECTIONS (800–1,200 words total):
   - Use 3 to 4 clear H2 (##) headings that naturally incorporate Indian search queries.
   - Include at least ONE Markdown Comparison Table (e.g., comparing 100% Yellow Mustard Oil vs. Commercial Palmolein Oil, or Special 4 Assortment vs. Giant Single-Flavor Bags, or Real Mustard Oil Namkeen vs. Commercial Diwali Mithai).
   - Weave in the science of Yellow Mustard Oil (MUFA, Omega-3/Omega-6, ~250°C smoke point, zero trans fat vs. palm oil's ~50% saturated fat) and why big brands choose palm oil for 6-month warehouse shelf life.
   - Connect the topic naturally to at least two of our specific namkeens (Dal Biji, Masala Chana Dal, Aloo Bhujia, Masala Moongfali) with real texture and spice descriptions.

4. FAQ SECTION (Before the final CTA):
   - Include an H2: "## Frequently Asked Questions"
   - Write 3 specific, high-intent questions Indian buyers actually search on Google, with direct 2-3 sentence answers.

5. CLOSING CONVERSION BLOCK (Final Section):
   - Transition smoothly into the ₹499 "Special 4" Assortment Box (4 × 200g individually sealed packs = 800g total, Free Delivery across India).
   - Reinforce the "4 separate freshness seals" and built-in free pan-India shipping logic.
   - Include a clear Markdown CTA link pointing to our homepage/WhatsApp order flow:
     **[Order the Special 4 Box (4 × 200g) for ₹499 with Free Delivery ->](https://hariramnamkeen.com/)**
</seo_and_markdown_structure>
`;

// ============================================================================
// 2. Dynamic USER_PROMPT Template
// ============================================================================
export function buildUserPrompt({ primaryKeyword, secondaryKeywords, pillarType, targetAngle, todayDate }) {
  return `
Write a complete, publish-ready blog post for Hariram Namkeen.

- Today's Date for Frontmatter: ${todayDate}
- Primary SEO Keyword: "${primaryKeyword}"
- Secondary Keywords to weave in naturally: ${secondaryKeywords.join(', ')}
- Content Pillar: ${pillarType}
- Specific Angle for This Post: ${targetAngle}

EXECUTION CHECKLIST BEFORE YOU WRITE:
1. Include the "${primaryKeyword}" in the YAML title, meta description, first 100 words, and at least one H2 heading.
2. Include the "Flip the Packet" or label-reading reality check exposing "Edible Vegetable Oil (Palmolein)" used by 95% of big commercial brands (without naming any brand).
3. Include a detailed Markdown comparison table tailored to "${primaryKeyword}".
4. Frame the ₹499 Special 4 Box (4 x 200g = 800g, Free Pan-India Delivery) around 4 individually sealed freshness packs + zero palm oil.
5. Double-check that you have NOT used any forbidden phrases ("Kachi Ghani", "foil bag", "food-grade pouch", "own oil pressing", "sourced from Muzaffarnagar farmers", or competitor names).
`;
}

// ============================================================================
// 3. Topic Queue Resolution
// ============================================================================
const topicsPath = fs.existsSync(path.join(__dirname, 'blog-topics.json'))
  ? path.join(__dirname, 'blog-topics.json')
  : path.join(__dirname, 'topics.json');

const rawTopics = JSON.parse(fs.readFileSync(topicsPath, 'utf-8'));

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Normalize topics
const topics = rawTopics.map((t) => ({
  id: t.id || slugify(t.primaryKeyword || t.query),
  primaryKeyword: t.primaryKeyword || t.query,
  secondaryKeywords: t.secondaryKeywords || [],
  pillarType: t.pillarType || 'Snack Deep-Dives',
  targetAngle: t.targetAngle || t.angle,
}));

// ---- What already exists in src/content/blog ----
const outDir = path.join(process.cwd(), CONTENT_DIR);
fs.mkdirSync(outDir, { recursive: true });

const existing = { slugs: new Set(), titles: [], topics: new Set() };
for (const f of fs.readdirSync(outDir).filter((x) => x.endsWith('.md'))) {
  const content = fs.readFileSync(path.join(outDir, f), 'utf-8');
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const rawFm = fmMatch ? fmMatch[1] : '';
  const get = (k) => rawFm.match(new RegExp(`^${k}:\\s*"?(.+?)"?\\s*$`, 'm'))?.[1];

  const fileSlug = f.replace(/\.md$/, '');
  const slug = get('slug') ?? fileSlug;
  existing.slugs.add(slug);
  existing.slugs.add(fileSlug);
  if (get('title')) existing.titles.push(get('title'));
  if (get('topic')) existing.topics.add(get('topic'));
}

// ---- Next unused topic ----
const topic = topics.find((t) => !existing.topics.has(t.id) && !existing.slugs.has(t.id));
if (!topic) {
  console.log(`All topics used. Add more to ${topicsPath}.`);
  setOutput('skip', 'true');
  process.exit(0);
}

console.log(`Selected topic: "${topic.primaryKeyword}" (ID: ${topic.id})`);

// ============================================================================
// 4. Generation & Quality Gate Loop
// ============================================================================
const todayDate = new Date().toISOString().slice(0, 10);
const baseUserPrompt = buildUserPrompt({
  primaryKeyword: topic.primaryKeyword,
  secondaryKeywords: topic.secondaryKeywords,
  pillarType: topic.pillarType,
  targetAngle: topic.targetAngle,
  todayDate,
});

let post, lastErrors = [];
for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  const userPrompt = lastErrors.length
    ? `${baseUserPrompt}\n\nCRITICAL FIXES REQUIRED (Attempt ${attempt}/${MAX_ATTEMPTS}):\nYour previous draft was rejected. Fix ALL of the following issues and return the complete valid Markdown with YAML frontmatter:\n- ${lastErrors.join('\n- ')}`
    : baseUserPrompt;

  console.log(`Calling Gemini API (Attempt ${attempt}/${MAX_ATTEMPTS})...`);
  const rawResponse = await callGemini(userPrompt, SYSTEM_PROMPT);
  const cleanedMarkdown = cleanMarkdown(rawResponse);
  const { frontmatter, body } = extractFrontmatter(cleanedMarkdown);

  const slug = slugify(frontmatter.slug || topic.id || topic.primaryKeyword);
  const title = (frontmatter.title || topic.primaryKeyword).trim();
  const description = (frontmatter.description || '').trim();

  post = {
    title,
    slug,
    description,
    metaDescription: description,
    author: frontmatter.author || 'Hariram Namkeen Kitchen, Muzaffarnagar',
    category: frontmatter.category || topic.pillarType || 'Snack Deep-Dives',
    tags: Array.isArray(frontmatter.tags) && frontmatter.tags.length ? frontmatter.tags : ['mustard oil namkeen', 'no palm oil snacks'],
    pubDate: frontmatter.pubDate || todayDate,
    topic: topic.id || slug,
    bodyMarkdown: body,
    rawMarkdown: cleanedMarkdown,
  };

  lastErrors = validatePost(post, existing);
  if (!lastErrors.length) {
    console.log(`Draft passed quality gate on attempt ${attempt}.`);
    break;
  }
  console.error(`Attempt ${attempt} rejected:\n- ${lastErrors.join('\n- ')}`);
}

if (lastErrors.length) {
  fail(`No draft passed the quality gate after ${MAX_ATTEMPTS} attempts.`);
}

// ============================================================================
// 5. Write the Post to src/content/blog
// ============================================================================
// Extract ### questions under "## Frequently Asked Questions" into frontmatter.faq
const extractedFaqs = extractFaqsFromMarkdown(post.bodyMarkdown);
if (extractedFaqs.length > 0 && !post.faq) {
  post.faq = extractedFaqs;
}

const finalFrontmatter = {
  title: post.title,
  description: post.description,
  pubDate: post.pubDate,
  author: post.author,
  category: post.category,
  tags: post.tags,
  slug: post.slug,
  topic: post.topic,
  ...(post.faq && post.faq.length > 0 ? { faq: post.faq } : {}),
};

const fullFileContent = `---\n${yaml.dump(finalFrontmatter).trim()}\n---\n\n${post.bodyMarkdown}\n`;
const outPath = path.join(outDir, `${post.slug}.md`);
fs.writeFileSync(outPath, fullFileContent, 'utf-8');
console.log(`Wrote blog post to: ${outPath}`);

// ============================================================================
// 6. GitHub Actions Outputs
// ============================================================================
const caption = `${post.title}\n\n${post.description}\n\nRead more: https://hariramnamkeen.com/blog/${post.slug}/`;

setOutput('skip', 'false');
setOutput('title', post.title);
setOutput('slug', post.slug);
setOutput('topic', post.topic);
setOutput('caption', caption);

// ============================================================================
// Helper Functions
// ============================================================================
function cleanMarkdown(text) {
  let md = text.trim();
  if (md.startsWith('```markdown')) {
    md = md.replace(/^```markdown\s*\r?\n/, '').replace(/\r?\n```\s*$/, '').trim();
  } else if (md.startsWith('```')) {
    md = md.replace(/^```[a-z]*\s*\r?\n/, '').replace(/\r?\n```\s*$/, '').trim();
  }
  return md;
}

function extractFrontmatter(markdown) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: markdown, rawFrontmatter: '' };
  }
  let parsed = {};
  try {
    parsed = yaml.load(match[1]) || {};
  } catch {
    for (const line of match[1].split('\n')) {
      const idx = line.indexOf(':');
      if (idx > 0) {
        parsed[line.slice(0, idx).trim()] = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
      }
    }
  }
  return { frontmatter: parsed, body: match[2].trim(), rawFrontmatter: match[1] };
}

// Extract ### questions under "## Frequently Asked Questions" into frontmatter.faq
function extractFaqsFromMarkdown(bodyMarkdown) {
  const faqSectionMatch = bodyMarkdown.match(/##\s+Frequently Asked Questions\s*\r?\n([\s\S]*?)(?=\r?\n##\s+|$)/i);
  if (!faqSectionMatch) return [];

  const faqBlock = faqSectionMatch[1];
  const faqs = [];
  const qaRegex = /###\s+([^\r\n]+)\r?\n+([\s\S]*?)(?=\r?\n###\s+|$)/g;

  let match;
  while ((match = qaRegex.exec(faqBlock)) !== null) {
    const question = match[1].trim();
    const answer = match[2].replace(/\r?\n/g, ' ').trim();
    if (question && answer) {
      faqs.push({ question, answer });
    }
  }
  return faqs;
}

async function callGemini(userPrompt, systemInstruction) {
  let lastErr = '';
  for (const rawModel of MODELS) {
    const model = rawModel.replace(/^models\//, '');
    const requestBody = {
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: {
        temperature: 0.7,
      },
    };
    if (systemInstruction) {
      requestBody.system_instruction = {
        parts: [{ text: systemInstruction }],
      };
    }

    try {
      let res = await fetch(`${API_BASE}/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': API_KEY },
        body: JSON.stringify(requestBody),
      });

      // If system_instruction was rejected (e.g. 400 on certain endpoints), fallback to inline prompt
      if (res.status === 400 && requestBody.system_instruction) {
        console.warn(`${model}: 400 with system_instruction, retrying with inline prompt...`);
        const fallbackBody = {
          contents: [{ role: 'user', parts: [{ text: `${systemInstruction}\n\n---\n\n${userPrompt}` }] }],
          generationConfig: { temperature: 0.7 },
        };
        res = await fetch(`${API_BASE}/models/${model}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': API_KEY },
          body: JSON.stringify(fallbackBody),
        });
      }

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
      if (![400, 404, 429, 500, 502, 503, 504].includes(res.status)) break;
    } catch (networkErr) {
      lastErr = `${model}: Network error - ${networkErr.message}`;
      console.error(lastErr);
    }
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
