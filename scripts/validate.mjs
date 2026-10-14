// scripts/validate.mjs
// Quality gate for generated blog posts. Returns an array of error messages (empty = valid).

const words = (s) => s.toLowerCase().match(/[a-z0-9\u0900-\u097f]+/g) ?? [];

const BANNED_OPERATIONAL_PATTERNS = [
  /\bkachi\s*ghani\b/i,
  /\bkacchi\s*ghani\b/i,
  /\bkachchi\s*ghani\b/i,
  /\bcold[- ]?press(?:ed)?\b/i,
  /\bwood[- ]?press(?:ed)?\b/i,
  /\bkolhu\b/i,
  /\bfoil\s*bag\b/i,
  /\baluminium\s*foil\b/i,
  /\bfood[- ]grade\s*pouch\b/i,
  /\bnitrogen[- ]flushed\b/i,
  /\bpress(?:ed|ing)?\s+(?:our|the)\s+(?:own\s+)?(?:mustard\s+)?oil\b/i,
  /\bown\s+(?:mustard\s+)?oil\s+mill\b/i,
  /\boil\s+mill\b/i,
  /\b(?:source|sourcing|sourced)\s+(?:mustard\s+)?(?:seeds?|oil)\s+(?:directly\s+)?from\s+muzaffarnagar\s+farmers\b/i,
  /\bspin[- ]the[- ]wheel\b/i,
  /\bguess\s+the\s+price\b/i,
  /\bnext\s+batch\s+closing\s+in\b/i,
];

const BANNED_COMPETITORS = [
  /\bhaldiram(?:'s)?\b/i,
  /\bbikaji\b/i,
  /\bbikanervala\b/i,
  /\bbalaji\b/i,
  /\bkurkure\b/i,
  /\blay'?s\b/i,
];

const BANNED_AI_CLICHES = [
  /\bdelve\b/i,
  /\btapestry\b/i,
  /\bsymphony\b/i,
  /\btestament\b/i,
  /\bculinary\s+journey\b/i,
  /\belevate\b/i,
  /\bburst\s+of\s+flavou?r\b/i,
  /\btantalize\b/i,
  /\bnestled\s+in\s+the\s+heart\s+of\b/i,
  /\bin\s+conclusion\b/i,
  /\bmoreover\b/i,
  /\bfurthermore\b/i,
  /\bit\s+is\s+worth\s+noting\b/i,
  /\bgame[- ]changer\b/i,
  /\bunlock\b/i,
];

export function validatePost(post, factsOrExisting, maybeExisting) {
  const existing = (maybeExisting || factsOrExisting) ?? { slugs: new Set(), titles: [] };
  const errors = [];

  const metaDesc = post.description || post.metaDescription || '';
  if (!post.title?.trim()) errors.push('missing field: title');
  if (!post.slug?.trim()) errors.push('missing field: slug');
  if (!metaDesc.trim()) errors.push('missing field: description/metaDescription');
  if (!post.bodyMarkdown?.trim()) errors.push('missing field: bodyMarkdown');

  if (errors.length) return errors;

  // Title checks
  if (post.title.length > 70) errors.push(`title is ${post.title.length} characters (recommended max 60)`);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(post.slug)) errors.push('slug must be lowercase-kebab-case');
  if (existing.slugs && existing.slugs.has(post.slug)) errors.push(`slug "${post.slug}" already exists`);

  // Word count check (Target: 800 - 1,200 words, tolerance: 700 - 1,450 words)
  const bodyWords = words(post.bodyMarkdown).length;
  if (bodyWords < 700 || bodyWords > 1450) {
    errors.push(`body is ${bodyWords} words, expected 800-1200 words`);
  }

  // Heading check
  if (!/^##\s/m.test(post.bodyMarkdown)) {
    errors.push('body needs at least 3-4 H2 (##) headings');
  }

  // Markdown Comparison Table check
  if (!/\|.+\|[\r\n]+\|[-:\s|]+\|/m.test(post.bodyMarkdown)) {
    errors.push('body must include at least one Markdown comparison table');
  }

  // Core brand check (Must mention Yellow Mustard Oil)
  if (!/yellow\s+mustard\s+oil/i.test(post.bodyMarkdown)) {
    errors.push('body must mention "Yellow Mustard Oil"');
  }

  // Special 4 Box offer check
  if (!/special\s*4/i.test(post.bodyMarkdown) || !/(?:₹|rs\.?|inr)?\s*499/i.test(post.bodyMarkdown)) {
    errors.push('body must feature the ₹499 Special 4 Assortment Box');
  }

  // Conversion link check
  if (!/hariramnamkeen\.com/i.test(post.bodyMarkdown)) {
    errors.push('closing conversion block must link to https://hariramnamkeen.com/');
  }

  // Content corpus to check for banned phrases
  const allContent = [
    post.title,
    metaDesc,
    post.bodyMarkdown,
    post.caption || '',
  ].join('\n');

  // Check forbidden claims
  for (const regex of BANNED_OPERATIONAL_PATTERNS) {
    const match = allContent.match(regex);
    if (match) errors.push(`forbidden operational/packaging claim found: "${match[0]}"`);
  }

  // Check competitor names
  for (const regex of BANNED_COMPETITORS) {
    const match = allContent.match(regex);
    if (match) errors.push(`forbidden competitor name found: "${match[0]}" (use indirect phrasing instead)`);
  }

  // Check banned AI clichés
  for (const regex of BANNED_AI_CLICHES) {
    const match = allContent.match(regex);
    if (match) errors.push(`banned AI cliché found: "${match[0]}"`);
  }

  // Similarity check with existing titles
  if (existing.titles && Array.isArray(existing.titles)) {
    const postWords = new Set(words(post.title));
    for (const t of existing.titles) {
      const otherWords = new Set(words(t));
      const intersection = [...postWords].filter((w) => otherWords.has(w)).length;
      const union = new Set([...postWords, ...otherWords]).size;
      if (union && intersection / union > 0.75) {
        errors.push(`title is too similar to existing post: "${t}"`);
      }
    }
  }

  return errors;
}
