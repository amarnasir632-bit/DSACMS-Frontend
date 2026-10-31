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

function detectExtension(targetUrl, contentType = "") {
  try {
    const pathname = new URL(targetUrl).pathname;
    const match = pathname.match(/\.(mp3|m4a|wav|ogg|aac|flac|pdf|docx?|zip)$/i);
    if (match) return "." + match[1].toLowerCase();
  } catch (_) {}
  const ct = String(contentType).toLowerCase();
  if (ct.includes("mpeg") || ct.includes("mp3")) return ".mp3";
  if (ct.includes("mp4") || ct.includes("m4a")) return ".m4a";
  if (ct.includes("ogg")) return ".ogg";
  if (ct.includes("wav")) return ".wav";
  if (ct.includes("pdf")) return ".pdf";
  return ".mp3";
}

function sanitizeDownloadFilename(rawName, targetUrl, contentType = "") {
  const realExt = detectExtension(targetUrl, contentType);
  let base = String(rawName || "")
    .trim()
    .replace(/[\/\\:*?"<>|\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!base || /^dsacms-(media|download|audio|doc)$/i.test(base.replace(/\.[a-z0-9]+$/i, ""))) {
    try {
      const urlFile = decodeURIComponent(new URL(targetUrl).pathname.split("/").pop() || "");
      base = urlFile || "ملف-صوتي";
    } catch (_) {
      base = "ملف-صوتي";
    }
  }

  // إزالة أي امتداد قديم ووضع الامتداد الحقيقي للملف
  base = base.replace(/\.(mp3|m4a|wav|ogg|aac|flac|pdf|docx?|zip)$/i, "").trim();
  return `${base || "ملف-صوتي"}${realExt}`;
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
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
            "Access-Control-Allow-Headers": "*",
            "Access-Control-Expose-Headers": "Content-Length, Content-Type, Content-Disposition, Accept-Ranges, Content-Range",
            "Access-Control-Max-Age": "86400",
          },
        });
      }
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

        const fetchHeaders = new Headers();
        fetchHeaders.set("User-Agent", "DSACMS-CloudflareWorker/2.0");
        const rangeHeader = request.headers.get("Range");
        if (rangeHeader) {
          fetchHeaders.set("Range", rangeHeader);
        }

        const upstream = await fetch(mediaUrl.toString(), {
          method: request.method === "HEAD" ? "HEAD" : "GET",
          headers: fetchHeaders,
          redirect: "follow",
        });

        if (!upstream.ok && upstream.status !== 206) {
          return Response.redirect(target, 302);
        }

        const upstreamType = upstream.headers.get("content-type") || "application/octet-stream";
        const requestedName = url.searchParams.get("filename") || "";
        const finalFilename = sanitizeDownloadFilename(requestedName, target, upstreamType);
        const asciiFallback = finalFilename.replace(/[^\x20-\x7E]/g, "_") || "download" + detectExtension(target, upstreamType);
        const encodedUTF8 = encodeURIComponent(finalFilename);

        const resHeaders = new Headers();
        resHeaders.set("Content-Type", "application/octet-stream");
        resHeaders.set("Access-Control-Allow-Origin", "*");
        resHeaders.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
        resHeaders.set("Access-Control-Allow-Headers", "*");
        resHeaders.set(
          "Access-Control-Expose-Headers",
          "Content-Length, Content-Type, Content-Disposition, Accept-Ranges, Content-Range"
        );
        resHeaders.set(
          "Content-Disposition",
          `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodedUTF8}`
        );

        const contentLength = upstream.headers.get("content-length");
        if (contentLength) resHeaders.set("Content-Length", contentLength);

        const contentRange = upstream.headers.get("content-range");
        if (contentRange) resHeaders.set("Content-Range", contentRange);

        const acceptRanges = upstream.headers.get("accept-ranges");
        if (acceptRanges) resHeaders.set("Accept-Ranges", acceptRanges);

        resHeaders.set("X-Content-Type-Options", "nosniff");
        resHeaders.set("Cache-Control", "public, max-age=3600");

        return new Response(upstream.body, {
          status: upstream.status,
          headers: resHeaders,
        });
      } catch (err) {
        return Response.redirect(target, 302);
      }
    }

    // خريطة المسارات المختصرة إلى ملفات HTML الفعلية
    const PAGE_ALIASES = {
      "/home.html": "/index.html",
      "/index": "/index.html",
      "/about": "/pages/about.html",
      "/lectures": "/pages/lectures.html",
      "/questions": "/pages/questions.html",
      "/search": "/pages/search.html",
      "/login": "/pages/login.html",
      "/login.html": "/pages/login.html",
      "/pages/login": "/pages/login.html",
      "/dashboard": "/pages/dashboard.html",
      "/dashboard.html": "/pages/dashboard.html",
      "/pages/dashboard": "/pages/dashboard.html",
      "/account": "/pages/account.html",
      "/account.html": "/pages/account.html",
      "/pages/account": "/pages/account.html",
    };

    if (env.ASSETS && typeof env.ASSETS.fetch === "function") {
      const normalizedPath = url.pathname.replace(/\/+$/, "") || "/";
      const mappedPath = PAGE_ALIASES[normalizedPath];

      // دالة مساعدة تجلب الأصل من env.ASSETS وتتبع أي 301/308 داخلياً وترجع 200 OK بدون Redirect للمتصفح
      const fetchAssetWithoutRedirectLoop = async (targetPathname) => {
        const candidates = [
          targetPathname,
          targetPathname.replace(/\.html$/i, ""),
          targetPathname.endsWith(".html") ? targetPathname : `${targetPathname}.html`,
        ];

        for (const candidate of candidates) {
          const reqUrl = new URL(request.url);
          reqUrl.pathname = candidate;
          const res = await env.ASSETS.fetch(new Request(reqUrl.toString(), request), {
            redirect: "manual",
          });

          if (res.status >= 200 && res.status < 300) {
            const headers = new Headers(res.headers);
            if (candidate.endsWith(".html") || mappedPath || normalizedPath.startsWith("/pages/")) {
              headers.set("Content-Type", "text/html; charset=utf-8");
              headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
            }
            return new Response(res.body, { status: 200, headers });
          }

          // إذا حاول env.ASSETS عمل 301 أو 308، نتبع الـ Location داخلياً لمرة واحدة ونرجع 200 OK
          if ([301, 302, 307, 308].includes(res.status)) {
            const loc = res.headers.get("Location");
            if (loc) {
              const locUrl = new URL(loc, request.url);
              const followed = await env.ASSETS.fetch(new Request(locUrl.toString(), request), {
                redirect: "manual",
              });
              if (followed.status >= 200 && followed.status < 300) {
                const headers = new Headers(followed.headers);
                headers.set("Content-Type", "text/html; charset=utf-8");
                headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
                return new Response(followed.body, { status: 200, headers });
              }
            }
          }
        }
        return null;
      };

      if (mappedPath || normalizedPath.startsWith("/pages/")) {
        const target = mappedPath || normalizedPath;
        const resolvedResponse = await fetchAssetWithoutRedirectLoop(target);
        if (resolvedResponse) return resolvedResponse;
      }

      let response = await env.ASSETS.fetch(request);
      if (response.status === 404 && !url.pathname.includes(".") && url.pathname !== "/") {
        const cleanResponse = await fetchAssetWithoutRedirectLoop(`${url.pathname}.html`);
        if (cleanResponse) return cleanResponse;
      }
      return response;
    }

    return new Response("Not Found", { status: 404 });
  },
};
