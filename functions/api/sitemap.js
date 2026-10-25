const DEFAULT_SITE_ORIGIN = "https://www.mohamedalahadi.com";
const DEFAULT_API_URL = "https://dsacms-backend.vercel.app/api/materials";

const escapeXml = (value) => String(value)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&apos;");

function sitemapEntry(url, lastModified) {
  const lastmod = lastModified ? `\n    <lastmod>${escapeXml(lastModified)}</lastmod>` : "";
  return `  <url>\n    <loc>${escapeXml(url)}</loc>${lastmod}\n  </url>`;
}

export async function onRequestGet(context) {
  const env = context.env || {};
  const siteOrigin = (env.SITE_ORIGIN || DEFAULT_SITE_ORIGIN).replace(/\/+$/, "");
  const apiUrl = env.API_URL || DEFAULT_API_URL;

  const urls = [
    sitemapEntry(`${siteOrigin}/`),
    sitemapEntry(`${siteOrigin}/pages/about.html`),
    sitemapEntry(`${siteOrigin}/pages/search.html`),
    sitemapEntry(`${siteOrigin}/pages/questions.html`),
    sitemapEntry(`${siteOrigin}/pages/lectures.html`),
  ];

  try {
    const response = await fetch(apiUrl, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`Backend returned ${response.status}`);
    const materials = await response.json();
    if (Array.isArray(materials)) {
      for (const material of materials) {
        if (!material?.id || String(material.status || "published").toLowerCase() !== "published") continue;
        const url = new URL("/pages/content-detail.html", siteOrigin);
        url.searchParams.set("id", String(material.id));
        const date = material.published_at || material.publishedAt || material.pub_date || material.pubDate || material.date || material.updated_at || material.created_at;
        const lastModified = date && !Number.isNaN(new Date(date).getTime())
          ? new Date(date).toISOString().slice(0, 10)
          : undefined;
        urls.push(sitemapEntry(url.toString(), lastModified));
      }
    }
  } catch (error) {
    console.error("Unable to load published materials for sitemap", error);
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>`;
  return new Response(xml, {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600",
    },
  });
}
