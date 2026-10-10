// Quality gate for generated posts. Returns a list of problems (empty = OK).
const words = (s) => s.toLowerCase().match(/[a-z0-9\u0900-\u097f]+/g) ?? [];

export function validatePost(post, facts, existing) {
  const errors = [];
  for (const k of ['title', 'slug', 'metaDescription', 'bodyMarkdown', 'caption']) {
    if (typeof post?.[k] !== 'string' || !post[k].trim()) errors.push(`missing field: ${k}`);
  }
  if (errors.length) return errors;

  const faq = Array.isArray(post.faq) ? post.faq : [];
  if (post.title.length > 60) errors.push('title is over 60 characters');
  if (post.metaDescription.length > 155) errors.push('metaDescription is over 155 characters');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(post.slug)) errors.push('slug must be lowercase-kebab-case');
  if (existing.slugs.has(post.slug)) errors.push('slug already exists');

  const n = words(post.bodyMarkdown).length;
  if (n < 350 || n > 700) errors.push(`body is ${n} words, must be 350-700`);
  if (!/^##\s/m.test(post.bodyMarkdown)) errors.push('body needs at least one ## subheading');
  if (!/yellow mustard oil/i.test(post.bodyMarkdown)) errors.push('body must mention "yellow mustard oil"');
  if (faq.length < 2 || faq.length > 4 || faq.some((f) => !f?.q?.trim() || !f?.a?.trim())) {
    errors.push('faq must have 2-4 items, each with q and a');
  }

  const all = [post.title, post.metaDescription, post.bodyMarkdown, post.caption,
  ...faq.flatMap((f) => [f?.q ?? '', f?.a ?? ''])].join('\n');

  for (const p of facts.bannedPatterns) {
    const m = all.match(new RegExp(p, 'i'));
    if (m) errors.push(`banned phrase found: "${m[0]}"`);
  }

  const allowed = new Set(facts.allowedNumbers);
  for (const m of all.matchAll(/(?:₹|\brs\.?|\binr)\s*([\d,]+(?:\.\d+)?)/gi)) {
    const v = Number(m[1].replace(/,/g, ''));
    if (!allowed.has(v)) errors.push(`price not in facts: ${m[0]}`);
  }

  const tw = new Set(words(post.title));
  for (const t of existing.titles) {
    const ow = new Set(words(t));
    const inter = [...tw].filter((w) => ow.has(w)).length;
    const union = new Set([...tw, ...ow]).size;
    if (union && inter / union > 0.7) errors.push(`title too similar to existing post: "${t}"`);
  }
  return errors;
}
