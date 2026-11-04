/**
 * DSACMS All-in-One Cloudflare Edge Worker (Pages + D1 Database + R2 Storage)
 * يعمل بالكامل على Cloudflare مجاناً بدون الحاجة إلى Vercel أو Supabase
 */

const OLD_BACKEND_API = "https://dsacms-backend.vercel.app/api";
const R2_PUBLIC_BASE = "https://media.mohamedalahadi.com";

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

function corsHeaders(origin = "*") {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Upload-Token, Range, Accept",
    "Access-Control-Expose-Headers": "Content-Length, Content-Type, Content-Disposition, Accept-Ranges, Content-Range",
  };
}

function jsonResponse(data, status = 200, origin = "*") {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...corsHeaders(origin),
    },
  });
}

async function ensureD1SchemaAndMigrate(db) {
  if (!db) return { initialized: false, reason: "DB binding not found" };

  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      icon TEXT DEFAULT '📚',
      created_at TEXT DEFAULT (datetime('now'))
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS materials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      author TEXT DEFAULT 'الشيخ محمد أحمد الهادي الكرار',
      category_id INTEGER,
      category_name TEXT DEFAULT 'عام',
      content_type TEXT DEFAULT 'audio',
      audio_url TEXT,
      document_url TEXT,
      archive_url TEXT,
      storage_key TEXT,
      duration INTEGER DEFAULT 0,
      body TEXT DEFAULT '[]',
      keywords TEXT DEFAULT '[]',
      status TEXT DEFAULT 'published',
      published_at TEXT DEFAULT (datetime('now')),
      created_at TEXT DEFAULT (datetime('now'))
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS lectures (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      mosque TEXT DEFAULT '',
      lecture_date TEXT,
      lecture_time TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      status TEXT DEFAULT 'scheduled',
      created_at TEXT DEFAULT (datetime('now'))
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question TEXT NOT NULL,
      asker_name TEXT DEFAULT 'زائر',
      answer TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now')),
      answered_at TEXT
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      username TEXT,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'admin',
      created_at TEXT DEFAULT (datetime('now'))
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      actor TEXT DEFAULT 'admin',
      details TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    )`),
  ]);

  // التحقق مما إذا كانت قاعدة البيانات فارغة لنسخ البيانات الحالية من السيرفر القديم تلقائياً
  const countRow = await db.prepare("SELECT COUNT(*) as total FROM materials").first();
  let migratedMaterials = 0;
  let migratedCategories = 0;
  let migratedLectures = 0;

  if (!countRow || Number(countRow.total) === 0) {
    try {
      const [catsRes, matsRes, lecsRes] = await Promise.allSettled([
        fetch(`${OLD_BACKEND_API}/categories`).then((r) => (r.ok ? r.json() : [])),
        fetch(`${OLD_BACKEND_API}/materials`).then((r) => (r.ok ? r.json() : [])),
        fetch(`${OLD_BACKEND_API}/lectures`).then((r) => (r.ok ? r.json() : [])),
      ]);

      const cats =
        catsRes.status === "fulfilled"
          ? Array.isArray(catsRes.value)
            ? catsRes.value
            : catsRes.value?.items || catsRes.value?.categories || []
          : [];
      for (const c of cats) {
        await db
          .prepare("INSERT OR IGNORE INTO categories (id, name, description, icon) VALUES (?, ?, ?, ?)")
          .bind(c.id || null, c.name || c.title || "تصنيف", c.description || "", c.icon || "📚")
          .run();
        migratedCategories++;
      }

      const mats =
        matsRes.status === "fulfilled"
          ? Array.isArray(matsRes.value)
            ? matsRes.value
            : matsRes.value?.items || matsRes.value?.materials || []
          : [];
      for (const m of mats) {
        const bodyStr = typeof m.body === "string" ? m.body : JSON.stringify(m.body || []);
        const kwStr = typeof m.keywords === "string" ? m.keywords : JSON.stringify(m.keywords || []);
        await db
          .prepare(
            `INSERT OR IGNORE INTO materials
             (id, title, description, author, category_id, category_name, content_type, audio_url, document_url, archive_url, storage_key, duration, body, keywords, status, published_at, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            m.id || null,
            m.title || "مادة علمية",
            m.description || "",
            m.author || "الشيخ محمد أحمد الهادي الكرار",
            m.category_id || m.category || null,
            m.category_name || m.categoryName || "عام",
            m.content_type || m.type || (m.audio_url || m.audio ? "audio" : "article"),
            m.audio_url || m.audio || null,
            m.document_url || m.pdf || null,
            m.archive_url || m.archiveUrl || null,
            m.storage_key || m.storageKey || null,
            Number(m.duration || 0),
            bodyStr,
            kwStr,
            String(m.status || "published").toLowerCase(),
            m.published_at || m.pubDate || m.created_at || new Date().toISOString(),
            m.created_at || new Date().toISOString()
          )
          .run();
        migratedMaterials++;
      }

      const lecs =
        lecsRes.status === "fulfilled"
          ? Array.isArray(lecsRes.value)
            ? lecsRes.value
            : lecsRes.value?.items || []
          : [];
      for (const l of lecs) {
        await db
          .prepare(
            "INSERT OR IGNORE INTO lectures (id, title, mosque, lecture_date, lecture_time, notes, status) VALUES (?, ?, ?, ?, ?, ?, ?)"
          )
          .bind(
            l.id || null,
            l.title || "محاضرة",
            l.mosque || "",
            l.lecture_date || null,
            l.lecture_time || "",
            l.notes || "",
            l.status || "scheduled"
          )
          .run();
        migratedLectures++;
      }
    } catch (err) {
      console.error("Auto-migration warning:", err);
    }
  }

  return { initialized: true, migratedCategories, migratedMaterials, migratedLectures };
}

function getRealExt(urlStr, fallback = ".mp3") {
  try {
    const p = new URL(urlStr, "https://www.mohamedalahadi.com").pathname;
    const m = p.match(/\.(mp3|m4a|wav|ogg|aac|flac|pdf|docx?|zip)$/i);
    if (m) return "." + m[1].toLowerCase();
  } catch (_) {}
  return fallback;
}

async function handleDownloadProxy(request, env, url) {
  const origin = request.headers.get("Origin") || "*";
  const targetUrl = url.searchParams.get("url") || "";
  const rawFilename = url.searchParams.get("filename") || "";

  if (!targetUrl) {
    return jsonResponse({ error: "Missing url parameter" }, 400, origin);
  }

  const ext = getRealExt(targetUrl, ".mp3");
  let cleanTitle = String(rawFilename || "مادة-علمية")
    .replace(/^dsacms-(media|download|audio|doc)(\.[a-z0-9]+)?$/i, "")
    .replace(/[\/\\:*?"<>|\r\n]+/g, " ")
    .replace(/\.(mp3|m4a|wav|ogg|aac|flac|pdf|docx?|zip)$/i, "")
    .trim();
  if (!cleanTitle) cleanTitle = "مادة-علمية";
  const finalFilename = `${cleanTitle}${ext}`;
  const asciiFallback = `media${ext}`;
  const contentDisposition = `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(finalFilename)}`;

  // إذا كانت حاوية R2 مربوطة والملف داخلها نقرأه مباشرة من R2 بسرعه فائقة
  if (env.R2_BUCKET) {
    try {
      const parsedTarget = new URL(targetUrl, url.origin);
      const r2Key = decodeURIComponent(parsedTarget.pathname.replace(/^\/+/, ""));
      const obj = await env.R2_BUCKET.get(r2Key);
      if (obj) {
        const headers = new Headers(corsHeaders(origin));
        headers.set("Content-Type", "application/octet-stream");
        headers.set("Content-Disposition", contentDisposition);
        if (obj.size) headers.set("Content-Length", String(obj.size));
        return new Response(obj.body, { status: 200, headers });
      }
    } catch (_) {}
  }

  const upstream = await fetch(targetUrl, {
    headers: request.headers.get("Range") ? { Range: request.headers.get("Range") } : {},
  });
  const headers = new Headers(corsHeaders(origin));
  headers.set("Content-Type", "application/octet-stream");
  headers.set("Content-Disposition", contentDisposition);
  if (upstream.headers.get("Content-Length")) {
    headers.set("Content-Length", upstream.headers.get("Content-Length"));
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}

async function handleApiRoute(request, env, url) {
  const origin = request.headers.get("Origin") || "*";
  const method = request.method.toUpperCase();
  const path = url.pathname.replace(/^\/api\/?/, "/").replace(/\/+$/, "") || "/";

  if (method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  if (path === "/download") {
    return handleDownloadProxy(request, env, url);
  }

  // 1. الرفع المباشر إلى حاوية R2 المربوطة بالـ Worker (بدون أي مشاكل CORS أو S3)
  if (path === "/r2-upload" && method === "PUT") {
    if (!env.R2_BUCKET) {
      return jsonResponse({ error: "حاوية R2_BUCKET غير مربوطة في إعدادات Cloudflare Pages Bindings" }, 503, origin);
    }
    const key = url.searchParams.get("key") || `media/audio/${Date.now()}.mp3`;
    const contentType = request.headers.get("Content-Type") || "application/octet-stream";
    await env.R2_BUCKET.put(key, request.body, {
      httpMetadata: { contentType },
    });
    const publicBase = String(env.R2_PUBLIC_URL || R2_PUBLIC_BASE).replace(/\/+$/, "");
    const fileUrl = `${publicBase}/${key.replace(/^\/+/, "")}`;
    return jsonResponse({ ok: true, fileUrl, storageKey: key }, 200, origin);
  }

  if ((path === "/media-upload" || path === "/uploads/presigned-url") && method === "POST") {
    if (env.R2_BUCKET) {
      const body = await request.json().catch(() => ({}));
      const rawName = String(body.filename || body.name || "file.mp3");
      const extMatch = rawName.match(/\.([a-zA-Z0-9]+)$/);
      const ext = extMatch ? extMatch[1].toLowerCase() : "mp3";
      const isPdf = ext === "pdf" || String(body.contentType || "").includes("pdf");
      const folder = isPdf ? "books" : "audio";
      const randomId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const key = `media/${folder}/${randomId}.${ext}`;
      const uploadUrl = `${url.origin}/api/r2-upload?key=${encodeURIComponent(key)}`;
      const publicBase = String(env.R2_PUBLIC_URL || R2_PUBLIC_BASE).replace(/\/+$/, "");
      const fileUrl = `${publicBase}/${key}`;
      return jsonResponse(
        {
          provider: "cloudflare-r2-direct",
          uploadUrl,
          fileUrl,
          publicUrl: fileUrl,
          storageKey: key,
          contentType: body.contentType || (isPdf ? "application/pdf" : "audio/mpeg"),
          maxBytes: 500 * 1024 * 1024,
        },
        201,
        origin
      );
    }
  }

  // 2. إذا كانت قاعدة بيانات D1 مربوطة (env.DB) نخدم الموقع بالكامل من Cloudflare D1
  if (env.DB) {
    const migInfo = await ensureD1SchemaAndMigrate(env.DB);

    if (path === "/init-d1" || path === "/status" || path === "/health") {
      const matCount = await env.DB.prepare("SELECT COUNT(*) as c FROM materials").first();
      const catCount = await env.DB.prepare("SELECT COUNT(*) as c FROM categories").first();
      return jsonResponse(
        {
          status: "ok",
          engine: "Cloudflare D1 + R2 All-in-One",
          r2Bound: Boolean(env.R2_BUCKET),
          materialsCount: matCount?.c || 0,
          categoriesCount: catCount?.c || 0,
          migration: migInfo,
        },
        200,
        origin
      );
    }

    // التصنيفات (Categories)
    if (path === "/categories" && method === "GET") {
      const { results } = await env.DB.prepare("SELECT * FROM categories ORDER BY id ASC").all();
      return jsonResponse(results || [], 200, origin);
    }
    if (path === "/categories" && method === "POST") {
      const b = await request.json();
      const res = await env.DB.prepare("INSERT INTO categories (name, description, icon) VALUES (?, ?, ?)")
        .bind(b.name || b.title, b.description || "", b.icon || "📚")
        .run();
      const created = await env.DB.prepare("SELECT * FROM categories WHERE id = ?").bind(res.meta.last_row_id).first();
      return jsonResponse(created, 201, origin);
    }
    if (path.startsWith("/categories/") && (method === "PUT" || method === "PATCH")) {
      const id = path.split("/")[2];
      const b = await request.json();
      await env.DB.prepare("UPDATE categories SET name = COALESCE(?, name), description = COALESCE(?, description), icon = COALESCE(?, icon) WHERE id = ?")
        .bind(b.name || b.title || null, b.description ?? null, b.icon ?? null, id)
        .run();
      const updated = await env.DB.prepare("SELECT * FROM categories WHERE id = ?").bind(id).first();
      return jsonResponse(updated, 200, origin);
    }
    if (path.startsWith("/categories/") && method === "DELETE") {
      const id = path.split("/")[2];
      await env.DB.prepare("DELETE FROM categories WHERE id = ?").bind(id).run();
      return jsonResponse({ ok: true }, 200, origin);
    }

    // المواد العلمية والصوتية (Materials)
    if (path === "/materials" && method === "GET") {
      const { results } = await env.DB.prepare(
        `SELECT m.*, COALESCE(c.name, m.category_name, 'عام') as category_name
         FROM materials m
         LEFT JOIN categories c ON CAST(m.category_id AS TEXT) = CAST(c.id AS TEXT)
         ORDER BY datetime(COALESCE(m.published_at, m.created_at)) DESC, m.id DESC`
      ).all();
      const formatted = (results || []).map((r) => ({
        ...r,
        body: (() => { try { return JSON.parse(r.body || "[]"); } catch (_) { return []; } })(),
        keywords: (() => { try { return JSON.parse(r.keywords || "[]"); } catch (_) { return []; } })(),
      }));
      return jsonResponse(formatted, 200, origin);
    }
    if (path === "/materials" && method === "POST") {
      const b = await request.json();
      const catId = b.category_id || b.category || null;
      let catName = b.category_name || b.categoryName || "عام";
      if (catId) {
        const cRow = await env.DB.prepare("SELECT name FROM categories WHERE CAST(id AS TEXT) = ?").bind(String(catId)).first();
        if (cRow?.name) catName = cRow.name;
      }
      const audioUrl = b.audio_url || b.audio || null;
      const docUrl = b.document_url || b.pdf || null;
      const cType = b.content_type || b.type || (audioUrl ? "audio" : docUrl ? "book" : "article");
      const res = await env.DB.prepare(
        `INSERT INTO materials
         (title, description, author, category_id, category_name, content_type, audio_url, document_url, archive_url, storage_key, duration, body, keywords, status, published_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          b.title || "مادة جديدة",
          b.description || "",
          b.author || "الشيخ محمد أحمد الهادي الكرار",
          catId,
          catName,
          cType,
          audioUrl,
          docUrl,
          b.archive_url || b.archiveUrl || null,
          b.storage_key || b.storageKey || null,
          Number(b.duration || 0),
          JSON.stringify(b.body || []),
          JSON.stringify(b.keywords || []),
          String(b.status || "published").toLowerCase(),
          b.published_at || b.pubDate || new Date().toISOString()
        )
        .run();
      const created = await env.DB.prepare("SELECT * FROM materials WHERE id = ?").bind(res.meta.last_row_id).first();
      return jsonResponse(created, 201, origin);
    }
    if (path.startsWith("/materials/") && (method === "PUT" || method === "PATCH")) {
      const id = path.split("/")[2];
      const b = await request.json();
      const existing = await env.DB.prepare("SELECT * FROM materials WHERE id = ?").bind(id).first();
      if (!existing) return jsonResponse({ error: "المادة غير موجودة" }, 404, origin);

      const catId = b.category_id !== undefined ? b.category_id : b.category !== undefined ? b.category : existing.category_id;
      let catName = b.category_name || b.categoryName || existing.category_name || "عام";
      if (catId) {
        const cRow = await env.DB.prepare("SELECT name FROM categories WHERE CAST(id AS TEXT) = ?").bind(String(catId)).first();
        if (cRow?.name) catName = cRow.name;
      }
      const audioUrl = b.audio_url !== undefined ? b.audio_url : b.audio !== undefined ? b.audio : existing.audio_url;
      const docUrl = b.document_url !== undefined ? b.document_url : b.pdf !== undefined ? b.pdf : existing.document_url;
      const cType = b.content_type || b.type || existing.content_type || (audioUrl ? "audio" : "article");

      await env.DB.prepare(
        `UPDATE materials SET
         title = ?, description = ?, author = ?, category_id = ?, category_name = ?, content_type = ?,
         audio_url = ?, document_url = ?, archive_url = ?, duration = ?, body = ?, keywords = ?, status = ?, published_at = ?
         WHERE id = ?`
      )
        .bind(
          b.title ?? existing.title,
          b.description ?? existing.description,
          b.author ?? existing.author,
          catId,
          catName,
          cType,
          audioUrl,
          docUrl,
          b.archive_url ?? b.archiveUrl ?? existing.archive_url,
          Number(b.duration ?? existing.duration ?? 0),
          b.body !== undefined ? JSON.stringify(b.body) : existing.body,
          b.keywords !== undefined ? JSON.stringify(b.keywords) : existing.keywords,
          String(b.status || existing.status || "published").toLowerCase(),
          b.published_at || b.pubDate || existing.published_at,
          id
        )
        .run();
      const updated = await env.DB.prepare("SELECT * FROM materials WHERE id = ?").bind(id).first();
      return jsonResponse(updated, 200, origin);
    }
    if (path.startsWith("/materials/") && method === "DELETE") {
      const id = path.split("/")[2];
      await env.DB.prepare("DELETE FROM materials WHERE id = ?").bind(id).run();
      return jsonResponse({ ok: true }, 200, origin);
    }

    // المحاضرات (Lectures)
    if (path === "/lectures" && method === "GET") {
      const { results } = await env.DB.prepare("SELECT * FROM lectures ORDER BY lecture_date ASC, id DESC").all();
      return jsonResponse(results || [], 200, origin);
    }
    if (path === "/lectures" && method === "POST") {
      const b = await request.json();
      const res = await env.DB.prepare(
        "INSERT INTO lectures (title, mosque, lecture_date, lecture_time, notes, status) VALUES (?, ?, ?, ?, ?, ?)"
      )
        .bind(b.title, b.mosque || "", b.lecture_date || null, b.lecture_time || "", b.notes || "", b.status || "scheduled")
        .run();
      const created = await env.DB.prepare("SELECT * FROM lectures WHERE id = ?").bind(res.meta.last_row_id).first();
      return jsonResponse(created, 201, origin);
    }
    if (path.startsWith("/lectures/") && method === "DELETE") {
      const id = path.split("/")[2];
      await env.DB.prepare("DELETE FROM lectures WHERE id = ?").bind(id).run();
      return jsonResponse({ ok: true }, 200, origin);
    }

    // الأسئلة (Questions)
    if (path === "/questions" && method === "GET") {
      const { results } = await env.DB.prepare("SELECT * FROM questions ORDER BY id DESC").all();
      return jsonResponse(results || [], 200, origin);
    }
    if (path === "/questions" && method === "POST") {
      const b = await request.json();
      const res = await env.DB.prepare("INSERT INTO questions (question, asker_name, status) VALUES (?, ?, 'pending')")
        .bind(b.question || b.text || "", b.asker_name || b.name || "زائر")
        .run();
      const created = await env.DB.prepare("SELECT * FROM questions WHERE id = ?").bind(res.meta.last_row_id).first();
      return jsonResponse(created, 201, origin);
    }
  }

  // 3. تمرير أي مسار إضافي كنسخة احتياطية إلى الباك إند القديم حتى يكتمل ربط D1
  const targetBackendUrl = `${OLD_BACKEND_API}${path}${url.search}`;
  const proxyReq = new Request(targetBackendUrl, {
    method,
    headers: request.headers,
    body: ["GET", "HEAD"].includes(method) ? null : request.body,
  });
  const backendRes = await fetch(proxyReq);
  const resHeaders = new Headers(backendRes.headers);
  Object.entries(corsHeaders(origin)).forEach(([k, v]) => resHeaders.set(k, v));
  return new Response(backendRes.body, { status: backendRes.status, headers: resHeaders });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 1. معالجة جميع مسارات /api/* محلياً عبر Cloudflare D1 + R2
    if (url.pathname.startsWith("/api/") || url.pathname === "/api") {
      return handleApiRoute(request, env, url);
    }

    // 2. معالجة صفحات الموقع بدون أي حلقة توجيه (No 301/308 Redirect Loops)
    if (env.ASSETS && typeof env.ASSETS.fetch === "function") {
      const normalizedPath = url.pathname.replace(/\/+$/, "") || "/";
      const mappedPath = PAGE_ALIASES[normalizedPath];

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
        const resolvedResponse = await fetchAssetWithoutRedirectLoop(mappedPath || normalizedPath);
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
200, headers });
          }

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
        const resolvedResponse = await fetchAssetWithoutRedirectLoop(mappedPath || normalizedPath);
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
