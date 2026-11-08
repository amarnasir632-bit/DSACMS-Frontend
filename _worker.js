/**
 * DSACMS All-in-One Cloudflare Edge Worker (Pages + D1 Database + R2 Storage)
 * يتعرف تلقائياً على ربط D1 و R2 بأي اسم متغير، وينقل البيانات تلقائياً، ويشغل الرفع المباشر إلى R2
 */

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

function encodeBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function signArchiveUpload(payload, secret) {
  const encodedPayload = encodeBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(encodedPayload));
  return `${encodedPayload}.${encodeBase64Url(new Uint8Array(signature))}`;
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

function parseJsonField(value, fallback = []) {
  if (Array.isArray(value) || (value && typeof value === "object")) return value;
  try { return JSON.parse(value || ""); } catch (_) { return fallback; }
}

// استخدم أسماء bindings الصريحة حتى لا يُكتشف Service binding كأنه D1.
function getDbBinding(env) {
  if (!env || typeof env !== "object") return null;
  return env.DB || env.D1 || env.DATABASE || env.DSACMS_DB || null;
}

// استخدم binding R2 الصريح؛ Service bindings قد تعرض RPC عامّاً لأي اسم دالة.
function getR2Binding(env) {
  if (!env || typeof env !== "object") return null;
  return env.R2 || env.MEDIA_BUCKET || env.STORAGE || null;
}

function escapeHtmlAttribute(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function previewDescription(material) {
  let description = String(material.description || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (!description) {
    const body = parseJsonField(material.body, []);
    const extractText = (value) => {
      if (typeof value === "string") return value;
      if (Array.isArray(value)) return value.map(extractText).join(" ");
      if (value && typeof value === "object") return extractText(value.text || value.content || value.children || "");
      return "";
    };
    description = extractText(body).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  }
  if (!description) description = "درس من المكتبة العلمية والصوتية للشيخ محمد أحمد الهادي الكرار.";
  if (description.length > 200) description = `${description.slice(0, 197).replace(/\s+\S*$/, "").trim()}…`;
  return description;
}

function replaceMetaContent(html, attribute, key, content) {
  const escapedContent = escapeHtmlAttribute(content);
  const tagPattern = new RegExp(`<meta\\b(?=[^>]*\\b${attribute}=["']${key}["'])(?=[^>]*\\bcontent=)[^>]*>`, "i");
  return html.replace(tagPattern, (tag) => tag.replace(/\bcontent=(["'])[^"']*\1/i, `content="${escapedContent}"`));
}

async function addContentShareMetadata(response, request, assetPath, env) {
  if (!/^\/pages\/content-detail(?:\.html)?\/?$/i.test(assetPath)) return response;
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const db = getDbBinding(env);
  if (!id || !db) return response;

  try {
    const material = await db.prepare("SELECT * FROM materials WHERE id = ?").bind(id).first();
    if (!material || (material.status && String(material.status).toLowerCase() !== "published")) return response;

    const title = `${material.title || material.name || "درس علمي"} | الشيخ محمد أحمد الهادي الكرار`;
    const description = previewDescription(material);
    const canonicalUrl = new URL(`/pages/content-detail?id=${encodeURIComponent(id)}`, url.origin).toString();
    let html = await response.text();
    html = html.replace(/<title\b[^>]*>[\s\S]*?<\/title>/i, `<title>${escapeHtmlAttribute(title)}</title>`);
    html = replaceMetaContent(html, "name", "description", description);
    html = replaceMetaContent(html, "property", "og:title", title);
    html = replaceMetaContent(html, "property", "og:description", description);
    html = replaceMetaContent(html, "property", "og:url", canonicalUrl);
    html = replaceMetaContent(html, "name", "twitter:title", title);
    html = replaceMetaContent(html, "name", "twitter:description", description);
    if (!/<meta\b[^>]*property=["']og:url["']/i.test(html)) {
      html = html.replace("</head>", `<meta property="og:url" content="${escapeHtmlAttribute(canonicalUrl)}">\n</head>`);
    }
    if (!/<link\b[^>]*rel=["']canonical["']/i.test(html)) {
      html = html.replace("</head>", `<link rel="canonical" href="${escapeHtmlAttribute(canonicalUrl)}">\n</head>`);
    }
    const headers = new Headers(response.headers);
    headers.delete("Content-Length");
    headers.delete("Content-Encoding");
    headers.delete("ETag");
    return new Response(html, { status: response.status, statusText: response.statusText, headers });
  } catch (error) {
    console.error("Unable to add content share metadata", { id, message: error?.message || String(error) });
    return response;
  }
}

async function sha256Hex(text) {
  const data = new TextEncoder().encode(String(text || ""));
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function ensureD1SchemaAndMigrate(db, env = {}) {
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
    db.prepare(`CREATE TABLE IF NOT EXISTS public_question_rate_limits (
      ip_hash TEXT PRIMARY KEY,
      last_submitted_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      username TEXT,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'admin',
      status TEXT DEFAULT 'active',
      must_change_password INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS auth_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT UNIQUE NOT NULL,
      expires_at TEXT NOT NULL,
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
  try { await db.prepare("ALTER TABLE questions ADD COLUMN category TEXT DEFAULT 'عام'").run(); } catch (_) {}
  try { await db.prepare("ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'active'").run(); } catch (_) {}
  try { await db.prepare("ALTER TABLE users ADD COLUMN must_change_password INTEGER DEFAULT 0").run(); } catch (_) {}

  const userCount = await db.prepare("SELECT COUNT(*) as total FROM users").first();
  if (Number(userCount?.total || 0) === 0) {
    const identifier = String(env.DSACMS_INITIAL_ADMIN_USERNAME || "admin").trim().toLowerCase();
    const email = String(env.DSACMS_INITIAL_ADMIN_EMAIL || "admin@dsacms.local").trim().toLowerCase();
    const password = String(env.DSACMS_INITIAL_ADMIN_PASSWORD || "");
    if (!password) return { initialized: true, usersSeeded: false, adminSetupRequired: true };
    await db.prepare(
      "INSERT INTO users (name, email, username, password_hash, role, status, must_change_password) VALUES (?, ?, ?, ?, 'admin', 'active', 1)"
    ).bind("مدير النظام", email, identifier, await sha256Hex(password)).run();
  }
  return { initialized: true, usersSeeded: Number(userCount?.total || 0) === 0 };
}

async function writeAuditLog(db, request, action, details = "") {
  const session = await getD1SessionUser(db, request).catch(() => null);
  const actor = String(session?.username || session?.email || "system").slice(0, 160);
  await db.prepare("INSERT INTO audit_logs (action, actor, details) VALUES (?, ?, ?)")
    .bind(action, actor, String(details || "").slice(0, 1000)).run();
}

async function getD1SessionUser(db, request) {
  const authorization = request.headers.get("Authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  return db.prepare(
    `SELECT u.id, u.name, u.email, u.username, u.role, u.status
     FROM auth_sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ? AND u.status = 'active'`
  ).bind(await sha256Hex(token), new Date().toISOString()).first();
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
      const mediaPrefix = "/api/media/";
      const mediaIndex = parsedTarget.pathname.indexOf(mediaPrefix);
      const r2Key = decodeURIComponent(mediaIndex >= 0
        ? parsedTarget.pathname.slice(mediaIndex + mediaPrefix.length)
        : parsedTarget.pathname.replace(/^\/+/, ""));
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

async function analyzeAudioWithGemini(env, { audioUrl, storageKey, mode = "full", categories = [] }, originUrl) {
  const apiKey = String(env.GEMINI_API_KEY || "").trim();
  if (!apiKey) throw new Error("مفتاح GEMINI_API_KEY غير مضاف في إعدادات Cloudflare Variables and Secrets.");
  const r2 = getR2Binding(env);
  let audioStream = null, contentLength = 0, mimeType = "audio/mpeg";
  let keyToTry = String(storageKey || "").trim();
  if (!keyToTry && audioUrl) {
    try { keyToTry = decodeURIComponent(new URL(audioUrl, originUrl).pathname.replace(/^\/api\/media\//, "").replace(/^\/+/, "")); } catch (_) {}
  }
  if (r2 && keyToTry) {
    const obj = (await r2.get(keyToTry)) || (await r2.get(`media/${keyToTry.replace(/^media\//, "")}`));
    if (obj) { audioStream = obj.body; contentLength = Number(obj.size || 0); mimeType = obj.httpMetadata?.contentType || (/\.m4a$/i.test(keyToTry) ? "audio/mp4" : "audio/mpeg"); }
  }
  if (!audioStream && audioUrl) {
    const resolvedUrl = audioUrl.startsWith("/") ? `${originUrl}${audioUrl}` : audioUrl;
    const upstream = await fetch(resolvedUrl);
    if (!upstream.ok) throw new Error("تعذر الوصول إلى الملف الصوتي من الرابط المحدد لتحليله.");
    audioStream = upstream.body; contentLength = Number(upstream.headers.get("Content-Length") || 0);
    const ct = upstream.headers.get("Content-Type"); if (ct && ct.includes("audio/")) mimeType = ct.split(";")[0].trim();
  }
  if (!audioStream) throw new Error("لم يتم العثور على الملف الصوتي لتحليله. تأكد من رفع الملف أولاً.");
  const startHeaders = { "X-Goog-Upload-Protocol": "resumable", "X-Goog-Upload-Command": "start", "X-Goog-Upload-Header-Content-Type": mimeType, "Content-Type": "application/json" };
  if (contentLength > 0) startHeaders["X-Goog-Upload-Header-Content-Length"] = String(contentLength);
  const startRes = await fetch(`https://generativelanguage.googleapis.com/upload/v1beta/files?key=${encodeURIComponent(apiKey)}`, { method: "POST", headers: startHeaders, body: JSON.stringify({ file: { display_name: `dsacms_audio_${Date.now()}` } }) });
  if (!startRes.ok) { console.error("Gemini Upload Start Error:", await startRes.text().catch(() => "")); throw new Error("تعذر بدء جلسة رفع الملف الصوتي إلى خدمة الذكاء الاصطناعي."); }
  const googleUploadUrl = startRes.headers.get("x-goog-upload-url");
  if (!googleUploadUrl) throw new Error("لم يرجع خادم Gemini رابط استلام الملف الصوتي.");
  const uploadHeaders = { "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize", "Content-Type": mimeType };
  if (contentLength > 0) uploadHeaders["Content-Length"] = String(contentLength);
  const uploadRes = await fetch(googleUploadUrl, { method: "POST", headers: uploadHeaders, body: audioStream });
  if (!uploadRes.ok) { console.error("Gemini Stream Upload Error:", await uploadRes.text().catch(() => "")); throw new Error("تعذر نقل الملف الصوتي لتحليله بالذكاء الاصطناعي."); }
  const uploadedFileInfo = await uploadRes.json();
  const fileUri = uploadedFileInfo?.file?.uri, googleFileName = uploadedFileInfo?.file?.name;
  if (!fileUri) throw new Error("لم يتم استلام معرف الملف الصوتي من Gemini.");
  try {
    let fileState = uploadedFileInfo?.file?.state || "ACTIVE";
    for (let i = 0; i < 12 && fileState === "PROCESSING"; i++) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const checkRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/${googleFileName}?key=${encodeURIComponent(apiKey)}`);
      if (checkRes.ok) fileState = (await checkRes.json())?.state || "ACTIVE";
    }
    const catListText = Array.isArray(categories) && categories.length ? categories.map((c) => c.name || c).join("، ") : "خطب جمعة، تفسير، دروس عامة، محاضرات، عقيدة، فقه";
    const promptText = `أنت مساعد علمي شرعي متخصص في أرشفة دروس وخطب فضيلة الشيخ محمد أحمد الهادي الكرار. استمع إلى التسجيل بالكامل، وأخرج كائن JSON صالحاً باللغة العربية الفصحى يحتوي title عنواناً دقيقاً وجذاباً، suggestedTitles مصفوفة من 3 بدائل، description نبذة وافية من سطرين إلى ثلاثة، categoryName تصنيفاً من هذه القائمة فقط (${catListText})، keywords من 5 إلى 8 كلمات مفتاحية، وmarkdownBody تفريغاً كاملاً منسقاً بـ Markdown (اتركه فارغاً في وضع metadata). في التفريغ استخدم ## للعناوين، وضع الآيات بين ﴿...﴾ داخل اقتباس >، والأحاديث والاقتباسات في >، والنقاط بالقوائم، وأبرز المهم بخط عريض. صحح العفوي إملائياً مع الحفاظ على كلام الشيخ ومعانيه.`;
    const genRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ file_data: { mime_type: mimeType, file_uri: fileUri } }, { text: promptText }] }], generationConfig: { temperature: 0.2, responseMimeType: "application/json" } }) });
    if (!genRes.ok) { console.error("Gemini Generate Error:", await genRes.text().catch(() => "")); throw new Error("تعذر إكمال التحليل الذكي للملف الصوتي عبر Gemini 2.5 Flash."); }
    const rawJsonText = (await genRes.json())?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    const parsed = JSON.parse(rawJsonText);
    return { title: String(parsed.title || "").trim(), suggestedTitles: Array.isArray(parsed.suggestedTitles) ? parsed.suggestedTitles.slice(0, 3) : [], description: String(parsed.description || "").trim(), categoryName: String(parsed.categoryName || "").trim(), keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [], markdownBody: String(parsed.markdownBody || "").trim() };
  } finally {
    if (googleFileName) fetch(`https://generativelanguage.googleapis.com/v1beta/${googleFileName}?key=${encodeURIComponent(apiKey)}`, { method: "DELETE" }).catch(() => {});
  }
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

  // أبقِ ترحيل قاعدة البيانات صريحاً؛ تشغيل DDL مع كل طلب API يسبب تعارضات ويعطل القراءة.
  if (path === "/init-d1") {
    if (!db) {
      return jsonResponse(
        {
          status: "waiting_for_binding",
          message: "تم تشغيل _worker.js لكن ربط قاعدة بيانات D1 غير ظاهر في المتغيرات حالياً.",
          detectedEnvKeys: Object.keys(env || {}),
          dbBound: false,
          r2Bound: Boolean(r2),
          howToFix:
            "ادخل إلى Cloudflare Dashboard -> Settings -> Bindings وأضف ربط D1 و R2 ثم أعد النشر، أو راجع wrangler.toml.",
        },
        200,
        origin
      );
    }
    const migInfo = await ensureD1SchemaAndMigrate(db, env);
    const matCount = await db.prepare("SELECT COUNT(*) as c FROM materials").first();
    const catCount = await db.prepare("SELECT COUNT(*) as c FROM categories").first();
    const lecCount = await db.prepare("SELECT COUNT(*) as c FROM lectures").first();
    const userCount = await db.prepare("SELECT COUNT(*) as c FROM users").first();
    return jsonResponse(
      {
        status: "ok",
        message: "Cloudflare D1 و R2 جاهزان لمعالجة بيانات الموقع وملفاته.",
        detectedEnvKeys: Object.keys(env || {}),
        dbBound: true,
        r2Bound: Boolean(r2),
        materialsCount: matCount?.c || 0,
        categoriesCount: catCount?.c || 0,
        lecturesCount: lecCount?.c || 0,
        usersCount: userCount?.c || 0,
        migration: migInfo,
      },
      200,
      origin
    );
  }

  if (path === "/ai/analyze-audio" && method === "POST") {
    try {
      if (!db) return jsonResponse({ ok: false, error: "خدمة الدخول غير متاحة حالياً." }, 503, origin);
      const sessionUser = await getD1SessionUser(db, request);
      if (!sessionUser || !["admin", "manager"].includes(String(sessionUser.role).toLowerCase())) return jsonResponse({ ok: false, error: "يلزم تسجيل الدخول بحساب مدير لتحليل الصوت." }, 401, origin);
      const body = await request.json();
      const result = await analyzeAudioWithGemini(env, body, url.origin);
      return jsonResponse({ ok: true, ...result }, 200, origin);
    } catch (err) {
      return jsonResponse({ ok: false, error: err?.message || "تعذر تحليل الملف الصوتي بالذكاء الاصطناعي." }, 500, origin);
    }
  }

  if (path === "/download") {
    return handleDownloadProxy(request, env, url);
  }

  // الرفع المباشر إلى حاوية R2 المربوطة بالـ Worker
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

  // تمرير الرفع الاحتياطي إلى Worker الأرشيف عبر Service Binding؛ تبقى مفاتيح IA على الخادم.
  if (path === "/archive-upload" && method === "PUT") {
    if (!env.ARCHIVE_WORKER || !env.MEDIA_UPLOAD_SECRET) {
      return jsonResponse({ error: "مسار Internet Archive الاحتياطي غير مهيأ" }, 503, origin);
    }
    const headers = new Headers({
      "Authorization": request.headers.get("Authorization") || "",
      "Content-Type": request.headers.get("Content-Type") || "application/octet-stream",
      "Origin": request.headers.get("Origin") || "",
    });
    const archiveResponse = await env.ARCHIVE_WORKER.fetch(new Request("https://dsacms-archive-worker/upload", {
      method: "PUT", headers, body: request.body,
    }));
    return new Response(archiveResponse.body, {
      status: archiveResponse.status,
      headers: { "Content-Type": archiveResponse.headers.get("Content-Type") || "application/json; charset=utf-8", "Cache-Control": "no-store", ...corsHeaders(origin) },
    });
  }

  // قراءة الملفات من R2 مع دعم طلبات الوسائط ذات النطاق الجزئي (stream seeking).
  if (path.startsWith("/media/") && (method === "GET" || method === "HEAD")) {
    if (!r2) return jsonResponse({ error: "R2 not bound" }, 404, origin);
    const key = decodeURIComponent(path.replace(/^\/media\//, ""));
    const rangeHeader = request.headers.get("Range");
    const meta = method === "HEAD" || rangeHeader ? await r2.head(key) : null;
    if ((method === "HEAD" || rangeHeader) && !meta) return jsonResponse({ error: "الملف غير موجود في R2" }, 404, origin);
    let range = null;
    if (rangeHeader && meta) {
      const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/i);
      if (!match || (!match[1] && !match[2])) {
        return new Response(null, { status: 416, headers: { ...corsHeaders(origin), "Content-Range": `bytes */${meta.size}` } });
      }
      const start = match[1] ? Number(match[1]) : Math.max(0, meta.size - Number(match[2]));
      const end = match[1] ? Math.min(meta.size - 1, match[2] ? Number(match[2]) : meta.size - 1) : meta.size - 1;
      if (start >= meta.size || end < start) {
        return new Response(null, { status: 416, headers: { ...corsHeaders(origin), "Content-Range": `bytes */${meta.size}` } });
      }
      range = { offset: start, length: end - start + 1 };
    }
    const obj = method === "HEAD" ? meta : await r2.get(key, range ? { range } : {});
    if (!obj) return jsonResponse({ error: "الملف غير موجود في R2" }, 404, origin);
    const headers = new Headers(corsHeaders(origin));
    const ext = getRealExt(key, ".mp3");
    const mime =
      obj.httpMetadata?.contentType ||
      (ext === ".pdf" ? "application/pdf" : ext === ".m4a" ? "audio/mp4" : "audio/mpeg");
    headers.set("Content-Type", mime);
    headers.set("Accept-Ranges", "bytes");
    headers.set("Cache-Control", "public, max-age=31536000");
    if (range) {
      const first = range.offset;
      const last = first + range.length - 1;
      headers.set("Content-Range", `bytes ${first}-${last}/${meta.size}`);
      headers.set("Content-Length", String(range.length));
    } else if (obj.size != null) {
      headers.set("Content-Length", String(obj.size));
    }
    return new Response(method === "HEAD" ? null : obj.body, { status: range ? 206 : 200, headers });
  }

  if ((path === "/media-upload" || path === "/uploads/presigned-url") && method === "POST") {
    const actor = db ? await getD1SessionUser(db, request).catch(() => null) : null;
    if (!actor) return jsonResponse({ error: "authentication is required" }, 401, origin);
    if (!["admin", "site_admin", "manager"].includes(actor.role)) return jsonResponse({ error: "forbidden" }, 403, origin);
    const body = await request.json().catch(() => ({}));
      const rawName = String(body.filename || body.name || "file.mp3");
      const extMatch = rawName.match(/\.([a-zA-Z0-9]+)$/);
      const ext = extMatch ? extMatch[1].toLowerCase() : "mp3";
      const allowedExts = ["mp3", "wav", "ogg", "oga", "m4a", "aac", "flac", "opus", "wma", "pdf"];
      if (!allowedExts.includes(ext)) return jsonResponse({ error: "صيغة الملف غير مدعومة" }, 400, origin);
      const isPdf = ext === "pdf" || String(body.contentType || "").includes("pdf");
      const folder = isPdf ? "books" : "audio";
      const randomId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const key = `media/${folder}/${randomId}.${ext}`;
      const fileUrl = `${url.origin}/api/media/${key}`;
      const archiveReady = Boolean(env.ARCHIVE_WORKER && env.MEDIA_UPLOAD_SECRET && Number(body.size) > 0 && Number(body.size) <= 90 * 1024 * 1024);
      const archiveItemId = `dsacms-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
      const archiveToken = archiveReady ? await signArchiveUpload({
        itemId: archiveItemId,
        key: `media.${ext}`,
        size: Number(body.size),
        contentType: body.contentType || (isPdf ? "application/pdf" : "audio/mpeg"),
        title: String(body.title || rawName).slice(0, 500),
        description: String(body.description || "").slice(0, 2000),
        origin,
        expiresAt: Math.floor(Date.now() / 1000) + 15 * 60,
      }, env.MEDIA_UPLOAD_SECRET) : null;
      const archiveUploadUrl = archiveReady ? `${url.origin}/api/archive-upload` : null;
      if (!r2 && !archiveReady) return jsonResponse({ error: "لا يتوفر تخزين R2 ولا مسار أرشيف احتياطي مهيأ" }, 503, origin);
      return jsonResponse(
        {
          provider: r2 ? "cloudflare-r2" : "internet-archive-fallback",
          uploadUrl: r2 ? `${url.origin}/api/r2-upload?key=${encodeURIComponent(key)}` : archiveUploadUrl,
          fileUrl: r2 ? fileUrl : null,
          publicUrl: r2 ? fileUrl : null,
          storageKey: r2 ? key : null,
          contentType: body.contentType || (isPdf ? "application/pdf" : "audio/mpeg"),
          maxBytes: 500 * 1024 * 1024,
          archiveUploadUrl,
          archiveUploadToken: archiveToken,
          archiveMaxBytes: archiveReady ? 90 * 1024 * 1024 : 0,
        },
        201,
        origin
      );
  }


  if (path === "/status" || path === "/health") {
    return jsonResponse({ status: db ? "ok" : "waiting_for_binding", dbBound: Boolean(db), r2Bound: Boolean(r2) }, 200, origin);
  }

  // 2. تشغيل جميع مسارات الموقع من قاعدة بيانات Cloudflare D1 مباشرة
  if (db) {
    if (path === "/debug-d1" && method === "GET") {
      const actor = await getD1SessionUser(db, request).catch(() => null);
      if (!actor) return jsonResponse({ error: "authentication is required" }, 401, origin);
      if (!(actor.role === "admin" || actor.role === "site_admin")) return jsonResponse({ error: "forbidden" }, 403, origin);
      const [tables, categoryColumns, materialColumns, categoryCount, materialCount, categorySample, materialSample] = await Promise.all([
        db.prepare("PRAGMA table_list").all(),
        db.prepare("PRAGMA table_info(categories)").all(),
        db.prepare("PRAGMA table_info(materials)").all(),
        db.prepare("SELECT COUNT(*) AS count FROM categories").first(),
        db.prepare("SELECT COUNT(*) AS count FROM materials").first(),
        db.prepare("SELECT * FROM categories LIMIT 1").first(),
        db.prepare("SELECT * FROM materials LIMIT 1").first(),
      ]);
      return jsonResponse({
        tables: tables.results || [],
        categoryColumns: categoryColumns.results || [],
        materialColumns: materialColumns.results || [],
        categoriesCount: Number(categoryCount?.count || 0),
        materialsCount: Number(materialCount?.count || 0),
        categorySample: categorySample || null,
        materialSample: materialSample || null,
      }, 200, origin);
    }

    if (path === "/questions/status" && method === "GET") {
      return jsonResponse({ accepting: String(env.PUBLIC_QUESTIONS_ENABLED || "true").toLowerCase() !== "false" }, 200, origin);
    }

    if (path === "/auth/login" && method === "POST") {
      const b = await request.json().catch(() => ({}));
      const identifier = String(b.email || b.username || b.identifier || "").trim().toLowerCase();
      const pass = String(b.password || "");
      const passHash = await sha256Hex(pass);

      const localUser = await db
        .prepare("SELECT * FROM users WHERE LOWER(email) = ? OR LOWER(username) = ?")
        .bind(identifier, identifier)
        .first();

      if (localUser && localUser.status !== "inactive" && localUser.password_hash === passHash) {
        const token = `d1_${crypto.randomUUID()}_${await sha256Hex(localUser.email + ":" + Date.now())}`;
        await db.prepare("INSERT INTO auth_sessions (user_id, token_hash, expires_at) VALUES (?, ?, ?)")
          .bind(localUser.id, await sha256Hex(token), new Date(Date.now() + 30 * 86400000).toISOString()).run();
        return jsonResponse(
          {
            token,
            user: { id: localUser.id, name: localUser.name, email: localUser.email, username: localUser.username, role: localUser.role || "admin", mustChangePassword: Boolean(localUser.must_change_password) },
          },
          200,
          origin
        );
      }
      return jsonResponse({ error: "اسم المستخدم أو كلمة المرور غير صحيحة" }, 401, origin);
    }

    if (path === "/auth/change-password" && method === "POST") {
      const actor = await getD1SessionUser(db, request);
      if (!actor) return jsonResponse({ error: "authentication is required" }, 401, origin);
      const b = await request.json().catch(() => ({}));
      if (String(b.newPassword || "").length < 8) return jsonResponse({ error: "كلمة المرور يجب ألا تقل عن 8 أحرف" }, 400, origin);
      const user = await db.prepare("SELECT password_hash FROM users WHERE id = ?").bind(actor.id).first();
      if (!user || user.password_hash !== await sha256Hex(String(b.currentPassword || ""))) {
        return jsonResponse({ error: "كلمة المرور الحالية غير صحيحة" }, 401, origin);
      }
      await db.prepare("UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?").bind(await sha256Hex(String(b.newPassword)), actor.id).run();
      await writeAuditLog(db, request, "CHANGE_PASSWORD", actor.username || actor.email);
      return jsonResponse({ ok: true }, 200, origin);
    }

    const usersBasePath = path === "/auth/users" || path === "/users";
    const userId = usersBasePath ? null : path.match(/^\/(?:auth\/)?users\/([^/]+)$/)?.[1];
    if (usersBasePath || (userId && ["PUT", "PATCH", "DELETE"].includes(method))) {
      const actor = await getD1SessionUser(db, request);
      if (!actor) return jsonResponse({ error: "authentication is required" }, 401, origin);
      if (!(["admin", "site_admin"].includes(actor.role))) return jsonResponse({ error: "forbidden" }, 403, origin);
      if (method === "GET" && usersBasePath) {
        const { results } = await db.prepare("SELECT id, name, email, username, role, status, created_at FROM users ORDER BY id ASC").all();
        return jsonResponse(results || [], 200, origin);
      }
      if (method === "POST" && usersBasePath) {
        const b = await request.json().catch(() => ({}));
        const username = String(b.username || b.email || "").trim().toLowerCase();
        const password = String(b.password || "");
        const email = String(b.email || (username.includes("@") ? username : `${username}@dsacms.local`)).trim().toLowerCase();
        if (!username || password.length < 8) return jsonResponse({ error: "username and a password of at least 8 characters are required" }, 400, origin);
        try {
          const result = await db.prepare("INSERT INTO users (name, email, username, password_hash, role, status) VALUES (?, ?, ?, ?, ?, 'active')")
            .bind(String(b.name || username), email, username, await sha256Hex(password), String(b.role || "manager")).run();
          const created = await db.prepare("SELECT id, name, email, username, role, status FROM users WHERE id = ?").bind(result.meta.last_row_id).first();
          await writeAuditLog(db, request, "CREATE_USER", username);
          return jsonResponse(created, 201, origin);
        } catch (_) { return jsonResponse({ error: "اسم المستخدم أو البريد مستخدم مسبقاً" }, 409, origin); }
      }
      if (userId && method === "DELETE") {
        if (String(actor.id) === decodeURIComponent(userId)) return jsonResponse({ error: "لا يمكن حذف الحساب الحالي" }, 400, origin);
        await db.prepare("DELETE FROM users WHERE id = ?").bind(decodeURIComponent(userId)).run();
        await db.prepare("DELETE FROM auth_sessions WHERE user_id = ?").bind(decodeURIComponent(userId)).run();
        await writeAuditLog(db, request, "DELETE_USER", userId);
        return jsonResponse({ ok: true }, 200, origin);
      }
      if (userId && ["PUT", "PATCH"].includes(method)) {
        const b = await request.json().catch(() => ({}));
        const existing = await db.prepare("SELECT * FROM users WHERE id = ?").bind(decodeURIComponent(userId)).first();
        if (!existing) return jsonResponse({ error: "المستخدم غير موجود" }, 404, origin);
        const passwordHash = b.password ? await sha256Hex(String(b.password)) : existing.password_hash;
        await db.prepare("UPDATE users SET name = ?, email = ?, username = ?, role = ?, status = ?, password_hash = ? WHERE id = ?")
          .bind(b.name ?? existing.name, b.email ?? existing.email, b.username ?? existing.username, b.role ?? existing.role, b.status ?? existing.status, passwordHash, existing.id).run();
        if (b.password) await db.prepare("DELETE FROM auth_sessions WHERE user_id = ?").bind(existing.id).run();
        const updated = await db.prepare("SELECT id, name, email, username, role, status FROM users WHERE id = ?").bind(existing.id).first();
        await writeAuditLog(db, request, "UPDATE_USER", userId);
        return jsonResponse(updated, 200, origin);
      }
    }

    const protectedWrite = ["POST", "PUT", "PATCH", "DELETE"].includes(method) && (
      path === "/categories" || path.startsWith("/categories/") ||
      path === "/materials" || path.startsWith("/materials/") ||
      path === "/lectures" || path.startsWith("/lectures/") ||
      (path.startsWith("/questions/") && path !== "/questions")
    );
    if (protectedWrite) {
      const actor = await getD1SessionUser(db, request);
      if (!actor) return jsonResponse({ error: "authentication is required" }, 401, origin);
      const allowedRoles = path.startsWith("/materials") || path.startsWith("/lectures")
        ? ["admin", "site_admin", "manager"]
        : ["admin", "site_admin"];
      if (!allowedRoles.includes(actor.role)) return jsonResponse({ error: "forbidden" }, 403, origin);
    }

    if (path === "/categories" && method === "GET") {
      const { results } = await db.prepare("SELECT * FROM categories").all();
      const formatted = (results || []).map((row) => ({
        ...row,
        id: String(row.id ?? ""),
        name: row.name || row.title || "",
        description: row.description || "",
        icon: row.icon || "📚",
      })).sort((a, b) => Number(a.id) - Number(b.id));
      return jsonResponse(formatted, 200, origin);
    }
    if (path === "/categories" && method === "POST") {
      const b = await request.json();
      const res = await db
        .prepare("INSERT INTO categories (name, description, icon) VALUES (?, ?, ?)")
        .bind(b.name || b.title, b.description || "", b.icon || "📚")
        .run();
      const created = await db.prepare("SELECT * FROM categories WHERE id = ?").bind(res.meta.last_row_id).first();
      await writeAuditLog(db, request, "CREATE_CATEGORY", created?.name || b.name || b.title || "");
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
      await writeAuditLog(db, request, "UPDATE_CATEGORY", updated?.name || id);
      return jsonResponse(updated, 200, origin);
    }
    if (path.startsWith("/categories/") && method === "DELETE") {
      const id = path.split("/")[2];
      const removed = await db.prepare("SELECT name FROM categories WHERE id = ?").bind(id).first();
      await db.prepare("DELETE FROM categories WHERE id = ?").bind(id).run();
      await writeAuditLog(db, request, "DELETE_CATEGORY", removed?.name || id);
      return jsonResponse({ ok: true }, 200, origin);
    }

    if (path === "/materials" && method === "GET") {
      const [matsRes, catsRes] = await Promise.all([
        db.prepare("SELECT * FROM materials").all(),
        db.prepare("SELECT * FROM categories").all().catch(() => ({ results: [] })),
      ]);
      const catsById = new Map((catsRes.results || []).map((row) => [String(row.id), row.name || row.title || ""]));
      const formatted = (matsRes.results || []).map((row) => ({
        ...row,
        id: String(row.id ?? ""),
        title: row.title || row.name || "",
        category_name: row.category_name || catsById.get(String(row.category_id ?? row.categoryId ?? "")) || "عام",
        body: parseJsonField(row.body, []),
        keywords: parseJsonField(row.keywords, []),
      })).sort((a, b) => {
        const dateA = new Date(a.published_at || a.pubDate || a.created_at || a.id || 0).getTime() || Number(a.id) || 0;
        const dateB = new Date(b.published_at || b.pubDate || b.created_at || b.id || 0).getTime() || Number(b.id) || 0;
        return dateB - dateA;
      });
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
      await writeAuditLog(db, request, "CREATE_MATERIAL", created?.title || b.title || "");
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
      await writeAuditLog(db, request, "UPDATE_MATERIAL", updated?.title || id);
      return jsonResponse(updated, 200, origin);
    }
    if (path.startsWith("/materials/") && method === "DELETE") {
      const id = path.split("/")[2];
      const removed = await db.prepare("SELECT title FROM materials WHERE id = ?").bind(id).first();
      await db.prepare("DELETE FROM materials WHERE id = ?").bind(id).run();
      await writeAuditLog(db, request, "DELETE_MATERIAL", removed?.title || id);
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
    if (path.startsWith("/lectures/") && ["PUT", "PATCH"].includes(method)) {
      const id = path.split("/")[2];
      const b = await request.json().catch(() => ({}));
      const current = await db.prepare("SELECT * FROM lectures WHERE id = ?").bind(id).first();
      if (!current) return jsonResponse({ error: "المحاضرة غير موجودة" }, 404, origin);
      await db.prepare(`UPDATE lectures SET title = ?, mosque = ?, lecture_date = ?, lecture_time = ?, notes = ?, status = ? WHERE id = ?`)
        .bind(b.title ?? current.title, b.mosque ?? current.mosque, b.lecture_date ?? b.lectureDate ?? current.lecture_date,
          b.lecture_time ?? b.lectureTime ?? current.lecture_time, b.notes ?? current.notes, b.status ?? current.status, id).run();
      return jsonResponse(await db.prepare("SELECT * FROM lectures WHERE id = ?").bind(id).first(), 200, origin);
    }
    if (path.startsWith("/lectures/") && method === "DELETE") {
      const id = path.split("/")[2];
      await db.prepare("DELETE FROM lectures WHERE id = ?").bind(id).run();
      return jsonResponse({ ok: true }, 200, origin);
    }

    if (path === "/questions" && method === "GET") {
      const { results } = await db.prepare("SELECT id, asker_name, category, question, answer, status, answered_at FROM questions WHERE LOWER(status) = 'answered' ORDER BY id DESC").all();
      return jsonResponse((results || []).map((row) => ({
        ...row,
        id: String(row.id),
        question_text: row.question,
        answer_text: row.answer,
      })), 200, origin);
    }
    if (path === "/questions" && method === "POST") {
      if (String(env.PUBLIC_QUESTIONS_ENABLED || "true").toLowerCase() === "false") {
        return jsonResponse({ error: "استقبال الأسئلة متوقف مؤقتاً للصيانة." }, 503, origin);
      }
      const b = await request.json().catch(() => ({}));
      if (String(b.website_url || "").trim()) return jsonResponse({ error: "Spam detected." }, 400, origin);
      const question = String(b.question_text || b.question || b.text || "").trim();
      if (question.length < 10 || question.length > 10000) {
        return jsonResponse({ error: "يجب أن يكون السؤال بين 10 و10000 حرف." }, 400, origin);
      }
      const clientIp = request.headers.get("CF-Connecting-IP") || "unknown";
      const ipHash = await sha256Hex(clientIp);
      const slot = await db.prepare(
        `INSERT INTO public_question_rate_limits (ip_hash, last_submitted_at)
         VALUES (?, unixepoch())
         ON CONFLICT (ip_hash) DO UPDATE SET last_submitted_at = unixepoch()
         WHERE public_question_rate_limits.last_submitted_at <= unixepoch() - 60
         RETURNING last_submitted_at`
      ).bind(ipHash).first();
      if (!slot) {
        const previous = await db.prepare("SELECT last_submitted_at FROM public_question_rate_limits WHERE ip_hash = ?").bind(ipHash).first();
        const retryAfter = Math.max(1, 60 - (Math.floor(Date.now() / 1000) - Number(previous?.last_submitted_at || Math.floor(Date.now() / 1000))));
        return new Response(JSON.stringify({ error: `يمكنك إرسال سؤال جديد بعد ${retryAfter} ثانية.`, retry_after: retryAfter }), {
          status: 429,
          headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Retry-After": String(retryAfter), ...corsHeaders(origin) },
        });
      }
      const res = await db
        .prepare("INSERT INTO questions (question, asker_name, category, status) VALUES (?, ?, ?, 'pending')")
        .bind(question, String(b.asker_name || b.name || "زائر").trim().slice(0, 255) || "زائر", String(b.category || "عام").slice(0, 80))
        .run();
      const created = await db.prepare("SELECT * FROM questions WHERE id = ?").bind(res.meta.last_row_id).first();
      return jsonResponse(created, 201, origin);
    }
    if (path.startsWith("/questions/") && ["PUT", "PATCH"].includes(method)) {
      const id = path.split("/")[2];
      const b = await request.json().catch(() => ({}));
      const current = await db.prepare("SELECT * FROM questions WHERE id = ?").bind(id).first();
      if (!current) return jsonResponse({ error: "السؤال غير موجود" }, 404, origin);
      await db.prepare("UPDATE questions SET question = ?, asker_name = ?, answer = ?, status = ?, answered_at = ? WHERE id = ?")
        .bind(b.question ?? b.text ?? current.question, b.asker_name ?? b.askerName ?? current.asker_name,
          b.answer ?? current.answer, b.status ?? current.status, b.answered_at ?? b.answeredAt ?? current.answered_at, id).run();
      return jsonResponse(await db.prepare("SELECT * FROM questions WHERE id = ?").bind(id).first(), 200, origin);
    }
    if (path.startsWith("/questions/") && method === "DELETE") {
      const id = path.split("/")[2];
      await db.prepare("DELETE FROM questions WHERE id = ?").bind(id).run();
      return jsonResponse({ ok: true }, 200, origin);
    }
    if (path === "/audit-logs" && method === "GET") {
      const { results } = await db.prepare("SELECT * FROM audit_logs ORDER BY id DESC LIMIT 100").all();
      return jsonResponse(results || [], 200, origin);
    }
  }

  if (!db) return jsonResponse({ error: "Cloudflare D1 binding is not configured" }, 503, origin);
  return jsonResponse({ error: "المسار غير موجود" }, 404, origin);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/") || url.pathname === "/api") {
      try {
        return await handleApiRoute(request, env, url);
      } catch (err) {
        const origin = request.headers.get("Origin") || "*";
        console.error("Unhandled API worker exception", { path: url.pathname, message: err?.message || String(err), stack: err?.stack || null });
        return jsonResponse({
          error: "Internal Worker Exception",
          path: url.pathname,
        }, 500, origin);
      }
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
            const assetResponse = new Response(res.body, { status: 200, headers });
            return await addContentShareMetadata(assetResponse, request, candidate, env);
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
                const assetResponse = new Response(followed.body, { status: 200, headers });
                return await addContentShareMetadata(assetResponse, request, locUrl.pathname, env);
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
