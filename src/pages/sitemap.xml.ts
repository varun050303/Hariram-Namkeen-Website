import type { APIRoute } from 'astro';

export const GET: APIRoute = async () => {
  const siteUrl = 'https://hariramnamkeen.com';

  // Blog posts
  const postFiles = import.meta.glob('../content/blog/*.md', { eager: true });
  const blogUrls = Object.values(postFiles).map((post: any) => {
    const slug = post.frontmatter?.slug || '';
    const pubDate = post.frontmatter?.pubDate ? new Date(post.frontmatter.pubDate).toISOString().split('T')[0] : '2026-10-10';
    return {
      loc: `${siteUrl}/blog/${slug}`,
      lastmod: pubDate,
      changefreq: 'monthly',
      priority: '0.8',
    };
  });

  // Dedicated Product Pages
  const { products } = await import('../data/products');
  const productUrls = products.map((product) => ({
    loc: `${siteUrl}/products/${product.slug}`,
    lastmod: '2026-10-10',
    changefreq: 'weekly',
    priority: '0.9',
  }));

  // Static Pages
  const staticUrls = [
    { loc: `${siteUrl}/`, lastmod: '2026-10-10', changefreq: 'daily', priority: '1.0' },
    { loc: `${siteUrl}/blog`, lastmod: '2026-10-10', changefreq: 'weekly', priority: '0.8' },
    { loc: `${siteUrl}/shipping`, lastmod: '2026-10-10', changefreq: 'monthly', priority: '0.5' },
    { loc: `${siteUrl}/returns`, lastmod: '2026-10-10', changefreq: 'monthly', priority: '0.5' },
    { loc: `${siteUrl}/privacy`, lastmod: '2026-10-10', changefreq: 'monthly', priority: '0.5' },
  ];

  const allUrls = [...staticUrls, ...productUrls, ...blogUrls];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allUrls
  .map(
    (item) => `  <url>
    <loc>${item.loc}</loc>
    <lastmod>${item.lastmod}</lastmod>
    <changefreq>${item.changefreq}</changefreq>
    <priority>${item.priority}</priority>
  </url>`
  )
  .join('\n')}
</urlset>`;

  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
    },
  });
};
