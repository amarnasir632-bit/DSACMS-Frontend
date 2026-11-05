/**
 * DSACMS All-in-One Cloudflare Edge Worker (Pages + D1 Database + R2 Storage)
 * يتعرف تلقائياً على ربط D1 و R2 بأي اسم متغير، وينقل البيانات تلقائياً، ويشغل الرفع المباشر إلى R2
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
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...corsHeaders(origin),
    },
  });
}

// كاشف تلقائي لربط قاعدة بيانات D1 مهما كان اسم المتغير في Cloudflare
function getDbBinding(env) {
  if (!env || typeof env !== "object") return null;
  for (const key of Object.keys(env)) {
    const val = env[key];
    if (val && typeof val === "object" && typeof val.prepare === "function" && typeof val.batch === "function") {
      return val;
    }
  }
  return null;
}

// كاشف تلقائي لربط حاوية R2 مهما كان اسم المتغير في Cloudflare
function getR2Binding(env) {
  if (!env || typeof env !== "object") return null;
  for (const key of Object.keys(env)) {
    if (key === "ASSETS") continue;
    const val = env[key];
    if (
      val &&
      typeof val === "object" &&
      typeof val.put === "function" &&
      typeof val.get === "function" &&
      typeof val.prepare !== "function"
    ) {
      return val;
    }
  }
  return null;
}

async function sha256Hex(text) {
  const data = new TextEncoder().encode(String(text || ""));
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function ensureD1SchemaAndMigrate(db) {
  if (!db) return { initialized: false, reason: "لم يتم العثور على ربط D1" };

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
  const r2 = getR2Binding(env);

  if (!targetUrl) {
    return jsonResponse({ error: "يرجى تحديد رابط الملف للتحميل" }, 400, origin);
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

  if (r2) {
    try {
      const parsedTarget = new URL(targetUrl, url.origin);
      const r2Key = decodeURIComponent(parsedTarget.pathname.replace(/^\/+/, ""));
      const obj = await r2.get(r2Key);
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
  const db = getDbBinding(env);
  const r2 = getR2Binding(env);

  if (method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  // هذا المسار في أعلى الدالة قبل أي شيء آخر حتى لا يرجع Cannot GET /api/init-d1 أبداً
  if (path === "/init-d1" || path === "/status" || path === "/health") {
    if (!db) {
      return jsonResponse(
        {
          status: "waiting_for_binding",
          message: "تم تشغيل _worker.js الجديد بنجاح! لكن ربط قاعدة بيانات D1 غير ظاهر في المتغيرات حالياً.",
          detectedEnvKeys: Object.keys(env || {}),
          dbBound: false,
          r2Bound: Boolean(r2),
          howToFix:
            "بما أن النشر من GitHub قد اكتمل الآن، ادخل إلى Cloudflare Dashboard -> Settings -> Bindings وأضف ربط D1 و R2 واضغط Save/Deploy، أو أضف database_id في ملف wrangler.jsonc.",
        },
        200,
        origin
      );
    }
    const migInfo = await ensureD1SchemaAndMigrate(db);
    const matCount = await db.prepare("SELECT COUNT(*) as c FROM materials").first();
    const catCount = await db.prepare("SELECT COUNT(*) as c FROM categories").first();
    const lecCount = await db.prepare("SELECT COUNT(*) as c FROM lectures").first();
    return jsonResponse(
      {
        status: "ok",
        message: "تم تفعيل Cloudflare D1 + R2 ونقل جميع البيانات بنجاح!",
        detectedEnvKeys: Object.keys(env || {}),
        dbBound: true,
        r2Bound: Boolean(r2),
        materialsCount: matCount?.c || 0,
        categoriesCount: catCount?.c || 0,
        lecturesCount: lecCount?.c || 0,
        migration: migInfo,
      },
      200,
      origin
    );
  }

  if (path === "/download") {
    return handleDownloadProxy(request, env, url);
  }

  // 1. الرفع المباشر إلى حاوية R2 المربوطة بالـ Worker
  if (path === "/r2-upload" && method === "PUT") {
    if (!r2) {
      return jsonResponse({ error: "حاوية R2 غير مربوطة بعد في إعدادات Cloudflare Bindings" }, 503, origin);
    }
    const key = url.searchParams.get("key") || `media/audio/${Date.now()}.mp3`;
    const contentType = request.headers.get("Content-Type") || "application/octet-stream";
    await r2.put(key, request.body, {
      httpMetadata: { contentType },
    });
    const fileUrl = `${url.origin}/api/media/${key.replace(/^\/+/, "")}`;
    return jsonResponse({ ok: true, fileUrl, storageKey: key }, 200, origin);
  }

    // قراءة وتشغيل الملفات الصوتية والـ PDF مباشرة من حاوية R2 على نفس نطاق الموقع
  if (path.startsWith("/media/") && (method === "GET" || method === "HEAD")) {
    if (!r2) return jsonResponse({ error: "R2 not bound" }, 404, origin);
    const key = decodeURIComponent(path.replace(/^\/media\//, ""));
    const obj = await r2.get(key);
    if (!obj) return jsonResponse({ error: "الملف غير موجود في R2" }, 404, origin);
    const headers = new Headers(corsHeaders(origin));
    const ext = getRealExt(key, ".mp3");
    const mime =
      obj.httpMetadata?.contentType ||
      (ext === ".pdf" ? "application/pdf" : ext === ".m4a" ? "audio/mp4" : "audio/mpeg");
    headers.set("Content-Type", mime);
    headers.set("Accept-Ranges", "bytes");
    headers.set("Cache-Control", "public, max-age=31536000");
    if (obj.size) headers.set("Content-Length", String(obj.size));
    return new Response(method === "HEAD" ? null : obj.body, { status: 200, headers });
  }

  if ((path === "/media-upload" || path === "/uploads/presigned-url") && method === "POST") {
    if (r2) {
      const body = await request.json().catch(() => ({}));
      const rawName = String(body.filename || body.name || "file.mp3");
      const extMatch = rawName.match(/\.([a-zA-Z0-9]+)$/);
      const ext = extMatch ? extMatch[1].toLowerCase() : "mp3";
      const isPdf = ext === "pdf" || String(body.contentType || "").includes("pdf");
      const folder = isPdf ? "books" : "audio";
      const randomId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const key = `media/${folder}/${randomId}.${ext}`;
      const uploadUrl = `${url.origin}/api/r2-upload?key=${encodeURIComponent(key)}`;
      const fileUrl = `${url.origin}/api/media/${key}`;
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


  // 2. تشغيل جميع مسارات الموقع من قاعدة بيانات Cloudflare D1 مباشرة
  if (db) {
    await ensureD1SchemaAndMigrate(db);

    if (path === "/auth/login" && method === "POST") {
      const b = await request.clone().json().catch(() => ({}));
      const identifier = String(b.email || b.username || b.identifier || "").trim().toLowerCase();
      const pass = String(b.password || "");
      const passHash = await sha256Hex(pass);

      const localUser = await db
        .prepare("SELECT * FROM users WHERE LOWER(email) = ? OR LOWER(username) = ?")
        .bind(identifier, identifier)
        .first();

      if (localUser && localUser.password_hash === passHash) {
        const token = `d1_${await sha256Hex(localUser.email + ":" + Date.now())}`;
        return jsonResponse(
          {
            token,
            user: { id: localUser.id, name: localUser.name, email: localUser.email, role: localUser.role || "admin" },
          },
          200,
          origin
        );
      }

      try {
        const upstreamLogin = await fetch(`${OLD_BACKEND_API}/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(b),
        });
        if (upstreamLogin.ok) {
          const data = await upstreamLogin.json();
          if (data?.user) {
            await db
              .prepare(
                "INSERT OR REPLACE INTO users (id, name, email, username, password_hash, role) VALUES (?, ?, ?, ?, ?, ?)"
              )
              .bind(
                data.user.id || 1,
                data.user.name || "المدير",
                String(data.user.email || identifier).toLowerCase(),
                String(data.user.username || identifier).toLowerCase(),
                passHash,
                data.user.role || "admin"
              )
              .run();
          }
          return jsonResponse(data, 200, origin);
        }
      } catch (_) {}
    }

    if (path === "/users" && method === "GET") {
      const { results } = await db.prepare("SELECT id, name, email, username, role, created_at FROM users ORDER BY id ASC").all();
      if (results && results.length > 0) {
        return jsonResponse(results, 200, origin);
      }
    }

    if (path === "/categories" && method === "GET") {
      const { results } = await db.prepare("SELECT * FROM categories ORDER BY id ASC").all();
      return jsonResponse(results || [], 200, origin);
    }
    if (path === "/categories" && method === "POST") {
      const b = await request.json();
      const res = await db
        .prepare("INSERT INTO categories (name, description, icon) VALUES (?, ?, ?)")
        .bind(b.name || b.title, b.description || "", b.icon || "📚")
        .run();
      const created = await db.prepare("SELECT * FROM categories WHERE id = ?").bind(res.meta.last_row_id).first();
      return jsonResponse(created, 201, origin);
    }
    if (path.startsWith("/categories/") && (method === "PUT" || method === "PATCH")) {
      const id = path.split("/")[2];
      const b = await request.json();
      await db
        .prepare("UPDATE categories SET name = COALESCE(?, name), description = COALESCE(?, description), icon = COALESCE(?, icon) WHERE id = ?")
        .bind(b.name || b.title || null, b.description ?? null, b.icon ?? null, id)
        .run();
      const updated = await db.prepare("SELECT * FROM categories WHERE id = ?").bind(id).first();
      return jsonResponse(updated, 200, origin);
    }
    if (path.startsWith("/categories/") && method === "DELETE") {
      const id = path.split("/")[2];
      await db.prepare("DELETE FROM categories WHERE id = ?").bind(id).run();
      return jsonResponse({ ok: true }, 200, origin);
    }

    if (path === "/materials" && method === "GET") {
      const { results } = await db
        .prepare(
          `SELECT m.*, COALESCE(c.name, m.category_name, 'عام') as category_name
           FROM materials m
           LEFT JOIN categories c ON CAST(m.category_id AS TEXT) = CAST(c.id AS TEXT)
           ORDER BY datetime(COALESCE(m.published_at, m.created_at)) DESC, m.id DESC`
        )
        .all();
      const formatted = (results || []).map((r) => ({
        ...r,
        body: (() => {
          try {
            return JSON.parse(r.body || "[]");
          } catch (_) {
            return [];
          }
        })(),
        keywords: (() => {
          try {
            return JSON.parse(r.keywords || "[]");
          } catch (_) {
            return [];
          }
        })(),
      }));
      return jsonResponse(formatted, 200, origin);
    }
    if (path.startsWith("/materials/") && method === "GET") {
      const id = path.split("/")[2];
      const r = await db.prepare("SELECT * FROM materials WHERE id = ?").bind(id).first();
      if (!r) return jsonResponse({ error: "المادة غير موجودة" }, 404, origin);
      r.body = (() => { try { return JSON.parse(r.body || "[]"); } catch (_) { return []; } })();
      r.keywords = (() => { try { return JSON.parse(r.keywords || "[]"); } catch (_) { return []; } })();
      return jsonResponse(r, 200, origin);
    }
    if (path === "/materials" && method === "POST") {
      const b = await request.json();
      const catId = b.category_id ?? b.categoryId ?? b.category ?? null;
      let catName = b.category_name || b.categoryName || "عام";
      if (catId) {
        const cRow = await db.prepare("SELECT name FROM categories WHERE CAST(id AS TEXT) = ?").bind(String(catId)).first();
        if (cRow?.name) catName = cRow.name;
      }
      const audioUrl = b.audio_url || b.audioUrl || b.audio || null;
      const docUrl = b.document_url || b.documentUrl || b.pdf || null;
      const cType = b.content_type || b.contentType || b.type || (audioUrl ? "audio" : docUrl ? "book" : "article");
      const res = await db
        .prepare(
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
          Number(b.duration_seconds ?? b.durationSeconds ?? b.duration ?? 0),
          JSON.stringify(b.body || []),
          JSON.stringify(b.keywords || []),
          String(b.status || "published").toLowerCase(),
          b.published_at || b.pubDate || new Date().toISOString()
        )
        .run();
      const created = await db.prepare("SELECT * FROM materials WHERE id = ?").bind(res.meta.last_row_id).first();
      return jsonResponse(created, 201, origin);
    }
    if (path.startsWith("/materials/") && (method === "PUT" || method === "PATCH")) {
      const id = path.split("/")[2];
      const b = await request.json();
      const existing = await db.prepare("SELECT * FROM materials WHERE id = ?").bind(id).first();
      if (!existing) return jsonResponse({ error: "المادة غير موجودة" }, 404, origin);

      const catId = b.category_id !== undefined ? b.category_id : b.categoryId !== undefined ? b.categoryId : b.category !== undefined ? b.category : existing.category_id;
      let catName = b.category_name || b.categoryName || existing.category_name || "عام";
      if (catId) {
        const cRow = await db.prepare("SELECT name FROM categories WHERE CAST(id AS TEXT) = ?").bind(String(catId)).first();
        if (cRow?.name) catName = cRow.name;
      }
      const audioUrl = b.audio_url !== undefined ? b.audio_url : b.audioUrl !== undefined ? b.audioUrl : b.audio !== undefined ? b.audio : existing.audio_url;
      const docUrl = b.document_url !== undefined ? b.document_url : b.documentUrl !== undefined ? b.documentUrl : b.pdf !== undefined ? b.pdf : existing.document_url;
      const cType = b.content_type || b.contentType || b.type || existing.content_type || (audioUrl ? "audio" : "article");

      await db
        .prepare(
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
          Number(b.duration_seconds ?? b.durationSeconds ?? b.duration ?? existing.duration ?? 0),
          b.body !== undefined ? JSON.stringify(b.body) : existing.body,
          b.keywords !== undefined ? JSON.stringify(b.keywords) : existing.keywords,
          String(b.status || existing.status || "published").toLowerCase(),
          b.published_at || b.pubDate || existing.published_at,
          id
        )
        .run();
      const updated = await db.prepare("SELECT * FROM materials WHERE id = ?").bind(id).first();
      return jsonResponse(updated, 200, origin);
    }
    if (path.startsWith("/materials/") && method === "DELETE") {
      const id = path.split("/")[2];
      await db.prepare("DELETE FROM materials WHERE id = ?").bind(id).run();
      return jsonResponse({ ok: true }, 200, origin);
    }

    if (path === "/lectures" && method === "GET") {
      const { results } = await db.prepare("SELECT * FROM lectures ORDER BY lecture_date ASC, id DESC").all();
      return jsonResponse(results || [], 200, origin);
    }
    if (path === "/lectures" && method === "POST") {
      const b = await request.json();
      const res = await db
        .prepare("INSERT INTO lectures (title, mosque, lecture_date, lecture_time, notes, status) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(b.title, b.mosque || "", b.lecture_date || null, b.lecture_time || "", b.notes || "", b.status || "scheduled")
        .run();
      const created = await db.prepare("SELECT * FROM lectures WHERE id = ?").bind(res.meta.last_row_id).first();
      return jsonResponse(created, 201, origin);
    }
    if (path.startsWith("/lectures/") && method === "DELETE") {
      const id = path.split("/")[2];
      await db.prepare("DELETE FROM lectures WHERE id = ?").bind(id).run();
      return jsonResponse({ ok: true }, 200, origin);
    }

    if (path === "/questions" && method === "GET") {
      const { results } = await db.prepare("SELECT * FROM questions ORDER BY id DESC").all();
      return jsonResponse(results || [], 200, origin);
    }
    if (path === "/questions" && method === "POST") {
      const b = await request.json();
      const res = await db
        .prepare("INSERT INTO questions (question, asker_name, status) VALUES (?, ?, 'pending')")
        .bind(b.question || b.text || "", b.asker_name || b.name || "زائر")
        .run();
      const created = await db.prepare("SELECT * FROM questions WHERE id = ?").bind(res.meta.last_row_id).first();
      return jsonResponse(created, 201, origin);
    }
    if (path === "/audit-logs" && method === "GET") {
      const { results } = await db.prepare("SELECT * FROM audit_logs ORDER BY id DESC LIMIT 100").all();
      return jsonResponse(results || [], 200, origin);
    }
  }

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

    if (url.pathname.startsWith("/api/") || url.pathname === "/api") {
      return handleApiRoute(request, env, url);
    }

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
