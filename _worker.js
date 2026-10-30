/**
 * Cloudflare Worker / Pages Handler
 *
 * Provides a Worker compute entrypoint alongside static assets.
 * Resolves: "Variables cannot be added to a Worker that only has static assets"
 * by attaching compute logic and unlocking Runtime Variables & Secrets in Cloudflare Dashboard.
 */

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

async function handleSitemap(env) {
  const siteOrigin = (env?.SITE_ORIGIN || DEFAULT_SITE_ORIGIN).replace(/\/+$/, "");
  const apiUrl = env?.API_URL || DEFAULT_API_URL;

  const urls = [
    sitemapEntry(`${siteOrigin}/`),
    sitemapEntry(`${siteOrigin}/pages/about.html`),
    sitemapEntry(`${siteOrigin}/pages/search.html`),
    sitemapEntry(`${siteOrigin}/pages/questions.html`),
    sitemapEntry(`${siteOrigin}/pages/lectures.html`),
  ];

  try {
    const response = await fetch(apiUrl, { signal: AbortSignal.timeout(8000) });
    if (response.ok) {
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
    }
  } catch (error) {
    console.error("Unable to load published materials for sitemap:", error);
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

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1. مسار خريطة الموقع الديناميكية
    if (url.pathname === "/api/sitemap" || url.pathname === "/sitemap.xml") {
      return handleSitemap(env);
    }

    // 2. فحص صحة الخدمة
    if (url.pathname === "/api/health") {
      return new Response(JSON.stringify({ status: "ok", service: "dsacms-frontend" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 3. تنزيل الوسائط والملفات الصوتية كملف مرفق (حفظ مباشر على جهاز المستخدم)
    if (url.pathname === "/api/download" || url.pathname === "/download") {
      const target = String(url.searchParams.get("url") || "").trim();
      if (!target) {
        return new Response(JSON.stringify({ error: "missing target url" }), {
          status: 400,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
      }
      try {
        const mediaUrl = new URL(target);
        if (!["http:", "https:"].includes(mediaUrl.protocol)) {
          return new Response(JSON.stringify({ error: "invalid protocol" }), {
            status: 400,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
          });
        }

        const upstream = await fetch(mediaUrl.toString(), {
          headers: { "User-Agent": "DSACMS-CloudflareWorker/1.0" },
        });

        if (!upstream.ok || !upstream.body) {
          return new Response(`Unable to fetch media: ${upstream.status}`, {
            status: upstream.status || 502,
            headers: { "Access-Control-Allow-Origin": "*" },
          });
        }

        const rawPath = mediaUrl.pathname;
        const defaultFilename = rawPath.substring(rawPath.lastIndexOf("/") + 1) || "dsacms-download.mp3";
        const requestedName = url.searchParams.get("filename") || defaultFilename;
        const safeFilename = requestedName.replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, " ").trim() || defaultFilename;

        const headers = new Headers(upstream.headers);
        headers.set("Content-Disposition", `attachment; filename="${encodeURIComponent(safeFilename)}"; filename*=UTF-8''${encodeURIComponent(safeFilename)}`);
        headers.set("Access-Control-Allow-Origin", "*");
        headers.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
        headers.set("Access-Control-Expose-Headers", "Content-Disposition, Content-Length, Content-Range");
        headers.set("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");

        return new Response(upstream.body, {
          status: 200,
          headers,
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message || "download error" }), {
          status: 502,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
      }
    }

    // 3. توجيه لوحة التحكم مباشرة
    if (url.pathname === "/dashboard" || url.pathname === "/dashboard.html") {
      const dashUrl = new URL(request.url);
      dashUrl.pathname = "/pages/dashboard.html";
      if (env.ASSETS && typeof env.ASSETS.fetch === "function") {
        return env.ASSETS.fetch(new Request(dashUrl.toString(), request));
      }
      return Response.redirect(dashUrl.toString(), 301);
    }

    // 4. تقديم الملفات الثابتة عبر binding ASSETS مع دعم الروابط النظيفة (.html fallback)
    if (env.ASSETS && typeof env.ASSETS.fetch === "function") {
      let response = await env.ASSETS.fetch(request);
      if (response.status === 404 && !url.pathname.includes(".") && url.pathname !== "/") {
        const cleanUrl = new URL(request.url);
        cleanUrl.pathname = `${url.pathname}.html`;
        const retryRequest = new Request(cleanUrl.toString(), request);
        const retryResponse = await env.ASSETS.fetch(retryRequest);
        if (retryResponse.status !== 404) {
          return retryResponse;
        }
      }
      return response;
    }

    return new Response("Not Found", { status: 404 });
  },
};
