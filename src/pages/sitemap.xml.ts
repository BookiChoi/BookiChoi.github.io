import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';

export const GET: APIRoute = async ({ site }) => {
  const projects = (await getCollection('projects')).map((e) => {
    const [slug, lang] = e.id.split('/');
    return `/${lang}/projects/${slug}/`;
  });
  const urls = ['/', '/en/', '/ko/', ...projects.sort()].map((p) => `  <url><loc>${new URL(p, site).href}</loc></url>`);
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml' } });
};
