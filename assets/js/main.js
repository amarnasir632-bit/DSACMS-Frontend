/* ==========================================================================
   DSACMS – نظام إدارة وأرشفة المحتوى العلمي والصوتي
   الملف:  assets/js/main.js
   الغرض: الطبقة التفاعلية للواجهة الأمامية (Vanilla JavaScript ES6+)
   يتضمن:
     1) المنظّم العام (IIFE) ومصادر البيانات التجريبية
     2) طبقة التخزين (localStorage) – تحاكي قاعدة البيانات في الإنتاج
     3) التحقق من المدخلات وسياسة كلمات المرور (SEC-005 / SEC-008)
     4) إدارة الجلسات والأدوار (RBAC) وأقفال المحاولات الفاشلة (SEC-011)
     5) مشغّل الصوت الموحّد (Audio Player Controller)
     6) تهيئة كل صفحة بحسب data-page
   ========================================================================== */
(function () {
  "use strict";

  /* ----------------------------------------------------------------------
     0) أدوات مساعدة (Utilities)
     ---------------------------------------------------------------------- */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  /** قاعدة المسار النسبي: الصفحة الرئيسية "" بينما "pages/" هي "../" */
  const BASE = (document.body && document.body.dataset.base) || "";

  /** تحديد الصفحة الحالية */
  const PAGE = (document.body && document.body.dataset.page) || "";

  /** تأمين الحقول عند العرض داخل DOM (SEC-008: التحقق من المدخلات) */
  const escapeHTML = (str) =>
    String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  /** تنسيق المدة بالثواني إلى نص mm:ss أو h:mm:ss */
  function formatDuration(totalSeconds) {
    const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const pad = (n) => String(n).padStart(2, "0");
    return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
  }

  /** تنسيق التاريخ بالعربية */
  function formatDate(dateStr) {
    if (!dateStr) return "غير محدد";
    const d = new Date(dateStr);
    if (isNaN(d)) return dateStr;
    return new Intl.DateTimeFormat("ar", { year: "numeric", month: "long", day: "numeric" }).format(d);
  }

  /** تحويل نص عربي إلى slug آمن لعنوان URL */
  function slugify(text) {
    const slug = String(text)
      .trim()
      .toLowerCase()
      .replace(/[^\w\u0600-\u06FF\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-");
    return slug + "-" + Date.now().toString(36).slice(-4);
  }

  /** إضافة إعدادات رأس الصفحة للمواد المعروضة (SEO-002 / SEO-003) */
  function setPageMeta(title, description) {
    document.title = title;
    const desc = $('meta[name="description"]');
    if (desc && description) desc.setAttribute("content", description);
  }

  /** تقييد تنفيذ دالة حتى تتوقف الكتابة (للبحث المباشر) */
  function debounce(fn, wait) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  /* ----------------------------------------------------------------------
     1) مصدر البيانات (REST API)
     ---------------------------------------------------------------------- */
  const API_CONFIG = {
    baseUrl: (window.DSACMS_API_BASE || "https://dsacms-backend.vercel.app/api").replace(/\/$/, ""),
  };
  let apiCategories = [];
  let apiContents = [];
  /** مفاتيح التخزين الدائم المحلي */
  const STORE = {
    contents: "dsacms_contents",
    categories: "dsacms_categories",
    users: "dsacms_users",
    session: "dsacms_session",
    audit: "dsacms_audit",
    lockout: "dsacms_lockout",
  };

  /** التصنيفات الافتراضية (FR-015) */
  const DEFAULT_CATEGORIES = /*
    { id: "fiqh", name: "الفقه", icon: "🕌", desc: "الأحكام الفقهية وتطبيقاتها" },
    { id: "tafsir", name: "التفسير", icon: "📖", desc: "تفسير آيات القرآن الكريم" },
    { id: "hadith", name: "الحديث", icon: "🗞️", desc: "شرح أحاديث النبي ﷺ" },
    { id: "aqeedah", name: "العقيدة", icon: "⭐", desc: "أصول الإيمان وتوحيد الله" },
    { id: "seerah", name: "السيرة", icon: "🌙", desc: "سيرة النبي ﷺ ومواقفه" },
    { id: "language", name: "اللغة العربية", icon: "✍️", desc: "قواعد اللغة والإملاء والنحو" },
    { id: "literature", name: "الأدب", icon: "📚", desc: "البلاغة والأدب والشعر" },
    { id: "history", name: "التاريخ", icon: "📜", desc: "الدروس والعبر من التاريخ" },
  */ [];

  /** المواد العلمية الافتراضية – audio مع مسار نسبي أو null عند الغياب */
  const DEFAULT_CONTENTS = /*
    {
      id: "muqaddimat-usul-fiqh",
      title: "مقدمة في علم أصول الفقه",
      description: "تسجيل صوتي يعرّف بعلم أصول الفقه وموضوعه وأهميته، مع استعراض قواعد الاجتهاد والتقليد وعناصر الاستدلال الفقهي بطريقة ميسّرة للمبتدئين.",
      author: "د. عبد الله محمد أحمد",
      category: "fiqh",
      keywords: ["أصول الفقه", "الاجتهاد", "مقدمة"],
      pubDate: "2026-08-12",
      duration: 2820,
      audio: "assets/audio/track-1.wav",
      status: "published",
    },
    {
      id: "tafsir-surat-al-fatiha",
      title: "تفسير سورة الفاتحة - الجزء الأول",
      description: "شرح تفسيري لسورة الفاتحة: الأسماء، ومعاني الآيات، وما اشتملت عليه من أنواع التوحيد وأركان الهداية، مع لفتات بلاغية مختصرة.",
      author: "أ. سارة محمود",
      category: "tafsir",
      keywords: ["الفاتحة", "الهداية", "التوحيد"],
      pubDate: "2026-08-05",
      duration: 3180,
      audio: "assets/audio/track-2.wav",
      status: "published",
    },
    {
      id: "sharh-hadith-innama-al-a3mal",
      title: "شرح حديث: إنما الأعمال بالنيات",
      description: "تحليل حديث «إنما الأعمال بالنيات» وأثره في ضبط الأفعال، مع تطبيقات معاصرة في العمل العلمي والمهني، وأهمية النية في رفع العمل إلى درجة العبادة.",
      author: "د. خالد حسن النور",
      category: "hadith",
      keywords: ["النية", "الإخلاص", "الأعمال"],
      pubDate: "2026-07-28",
      duration: 2440,
      audio: "assets/audio/track-3.wav",
      status: "published",
    },
    {
      id: "aqeedah-arkan-al-iman",
      title: "أركان الإيمان الستة بأسلوب مبسط",
      description: "تعريف بأركان الإيمان الستة الإيمان بالله وملائكته وكتبه ورسله واليوم الآخر والقدر خيره وشره، بأسلوب مبسط يناسب مختلف الأعمار.",
      author: "أ. فاطمة الزهراء",
      category: "aqeedah",
      keywords: ["أركان الإيمان", "القضاء والقدر", "الإيمان"],
      pubDate: "2026-06-19",
      duration: 3600,
      audio: "assets/audio/track-4.wav",
      status: "published",
    },
    {
      id: "seerah-fath-makkah",
      title: "فتح مكة: قراءة في الدروس والعبر",
      description: "محاضرة صوتية تتناول أحداث فتح مكة، وصفحات التسامح النبوي، والدروس المستفادة في إدارة الخلاف والانتصار، وقيمة العفو عند المقدرة.",
      author: "د. محمد الأمين",
      category: "seerah",
      keywords: ["فتح مكة", "العفو", "السيرة"],
      pubDate: "2026-06-10",
      duration: 2940,
      audio: "assets/audio/track-5.wav",
      status: "published",
    },
    {
      id: "nahw-muqaddima-fil-jumla",
      title: "مقدمة في الجملة العربية: الاسمية والفعلية",
      description: "شرح مبسط لبنية الجملة في النحو العربي، وأركان الجملة الاسمية والفعلية مع أمثلة تطبيقية من القرآن والشعر، وتمارين سمعية.",
      author: "أ. منى عبد الرحمن",
      category: "language",
      keywords: ["النحو", "الجملة الاسمية", "الجملة الفعلية"],
      pubDate: "2026-05-22",
      duration: 2100,
      audio: "assets/audio/track-6.wav",
      status: "published",
    },
    {
      id: "adab-riwayat-wa-nuqat",
      title: "الرواية والنقطة: أمسية أدبية",
      description: "أمسية صوتية تناقش فن الرواية القصيرة وتقنيات السرد الحديثة، مع نماذج مختارة من أدباء سودانيين وعرب، وحوار مع جمهور المستمعين.",
      author: "أ. الطيب صالح الخير",
      category: "literature",
      keywords: ["الرواية", "السرد", "الأدب"],
      pubDate: "2026-05-14",
      duration: 3900,
      audio: "assets/audio/track-1.wav",
      status: "published",
    },
    {
      id: "tarikh-mamlakat-mir",
      title: "مملكة مروي: عاصمة المملكة الكوشية",
      description: "رحلة صوتية عبر تاريخ مملكة مروي القديمة، وموقعها وعلاقاتها التجارية، وما اكتشفه علماء الآثار من الأهرامات والنقوش في البجراوية.",
      author: "د. عمر السيد",
      category: "history",
      keywords: ["مروي", "كوش", "البجراوية"],
      pubDate: "2026-04-30",
      duration: 2760,
      audio: "assets/audio/track-2.wav",
      status: "published",
    },
    {
      id: "fiqh-salawat-al-khawf",
      title: "صلاة المريض والمسافر: أحكام وتطبيقات",
      description: "بيان أحكام القصر والجمع للمسافر، والترخيص للمريض في الصلاة حسب الحالة، مع أمثلة عملية وموقعة من أقوال الفقهاء المعاصرين.",
      author: "د. عبد الله محمد أحمد",
      category: "fiqh",
      keywords: ["القصر", "الجمع", "الرخصة"],
      pubDate: "2026-04-18",
      duration: 3350,
      audio: "assets/audio/track-3.wav",
      status: "published",
    },
    {
      id: "tafsir-ayat-al-kursi",
      title: "تدبر آية الكرسي",
      description: "تأملات في أعظم آية في القرآن: معانيها، وبلاغتها، وما يُستفاد منها في تحقيق التوحيد واليقين، مع ذكر ما ورد في فضلها.",
      author: "أ. سارة محمود",
      category: "tafsir",
      keywords: ["الكرسي", "التدبر", "القرآن"],
      pubDate: "2026-04-02",
      duration: 1980,
      audio: "assets/audio/track-4.wav",
      status: "published",
    },
    {
      id: "hadith-ittaqa-allah-haythuma-kunta",
      title: "حديث: اتق الله حيثما كنت",
      description: "شرح وصية النبي ﷺ «اتق الله حيثما كنت، وأتبع السيئة الحسنة تمحها، وخالق الناس بخلق حسن» مع تطبيقات في معاملة الناس وتربية النفس.",
      author: "د. خالد حسن النور",
      category: "hadith",
      keywords: ["التقوى", "حسن الخلق", "الوصايا"],
      pubDate: "2026-03-21",
      duration: 1600,
      audio: "assets/audio/track-5.wav",
      status: "published",
    },
    {
      id: "maqal-ahmiyyat-talab-al-ilm",
      type: "article",
      title: "أهمية طلب العلم في بناء المجتمع",
      description: "مقال مكتوب يوضح أثر العلم النافع في بناء الفرد والمجتمع، ويقترح خطوات عملية للقراءة والتعلم المستمر.",
      body: [
        "العلم النافع أساس نهضة المجتمعات، فهو يوسّع مدارك الإنسان ويعينه على فهم واقعه واتخاذ قرارات رشيدة.",
        "ولا يقتصر طلب العلم على قاعة الدرس؛ فالقراءة المنتظمة، وسؤال أهل الاختصاص، ومراجعة المصادر الموثوقة عادات تصنع تعلماً راسخاً.",
        "حين يتحول العلم إلى عمل نافع وأخلاق حسنة، يصبح أثره ممتداً من الفرد إلى أسرته ثم إلى مجتمعه كله."
      ],
      author: "د. مريم عبد الله",
      category: "literature",
      keywords: ["العلم", "القراءة", "المجتمع"],
      pubDate: "2026-09-05",
      status: "published",
    },
    {
      id: "kitab-dalil-dsacms",
      type: "book",
      title: "دليل نظام إدارة وأرشفة المحتوى العلمي",
      description: "كتاب إلكتروني بصيغة PDF يشرح متطلبات نظام DSACMS ومكوّناته وطريقة استخدامه.",
      author: "فريق DSACMS",
      category: "history",
      keywords: ["كتاب", "PDF", "الأرشفة"],
      pubDate: "2026-09-03",
      pdf: "docs/Software Requirements Specification – DSACMS.pdf",
      status: "published",
    },
    {
      id: "rahmanaraahyu-alfahmi-matn-al-ajrumiyya",
      title: "الأجرومية: شرح المقدمة (مادة سرية قيد المراجعة)",
      description: "محتوى مسودة بانتظار المراجعة والاعتماد قبل النشر للعموم.",
      author: "أ. منى عبد الرحمن",
      category: "language",
      keywords: ["الأجرومية", "النحو"],
      pubDate: "2026-09-01",
      duration: 0,
      audio: null,
      status: "draft",
    },
  */ [];

  /** المستخدمون التجريبيون – كلمات المرور مخزّنة بشكل مجزّأ (SEC-004)
      ملاحظة: هذا تحويل بسيط لهدف العرض فقط؛ الإنتاج يتطلب تجزئة من جانب الخادم. */
  const hashDemo = (str) => {
    let h = 5381;
    const salted = "dsacms::" + str;
    for (let i = 0; i < salted.length; i++) {
      h = (h * 33) ^ salted.charCodeAt(i);
    }
    return "h" + (h >>> 0).toString(36);
  };

  const DEFAULT_USERS = [
    { id: "u1", name: "مدير النظام", username: "admin", email: "admin@dsacms.local", passHash: hashDemo("Admin1234"), role: "admin", status: "active" },
    { id: "u2", name: "مديرة المحتوى", username: "manager", email: "manager@dsacms.local", passHash: hashDemo("Manager1234"), role: "manager", status: "active" },
    { id: "u3", name: "مدير الموقع", username: "amarnasir632@gmail.com", email: "amarnasir632@gmail.com", passHash: hashDemo("admin1234"), role: "admin", status: "active" },
  ];

  /* ----------------------------------------------------------------------
     2) طبقة التخزين (Storage Layer) – بواجهة جاهزة للاستبدال بـ API لاحقاً
     ---------------------------------------------------------------------- */
  const store = {
    read(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch (e) {
        return fallback;
      }
    },
    write(key, value) {
      localStorage.setItem(key, JSON.stringify(value));
    },
    remove(key) {
      localStorage.removeItem(key);
    },
  };

  function loadCategories() {
    return apiCategories;
  }
  function saveCategories(list) {
    apiCategories = Array.isArray(list) ? list : [];
  }

  function loadContents() {
    return apiContents;
  }
  function saveContents(list) {
    apiContents = Array.isArray(list) ? list : [];
  }

  /** المحتوى العام: المواد المنشورة فقط (BR-002 / FR-027) */
  function publicContents() {
    return loadContents().filter((c) => c.status === "published");
  }

  function normalizeCategory(row) {
    return {
      id: String(row.id),
      name: row.name,
      desc: row.description || "",
      icon: "📚",
    };
  }

  function normalizeMaterial(row) {
    return {
      id: String(row.id),
      title: row.title,
      description: row.description || "",
      author: row.author || "غير محدد",
      category: row.category_id ? String(row.category_id) : "",
      categoryName: row.category_name || "عام",
      keywords: Array.isArray(row.keywords) ? row.keywords : [],
      body: Array.isArray(row.body) ? row.body : [],
      pubDate: row.created_at,
      duration: Number(row.duration_seconds) || 0,
      audio: row.audio_url || null,
      pdf: row.document_url || null,
      type: row.content_type || "audio",
      status: row.status || "published",
    };
  }

  async function fetchApi(path, options) {
    const response = await fetch(`${API_CONFIG.baseUrl}${path}`, options);
    if (!response.ok) {
      throw new Error(`API request failed: ${response.status}`);
    }
    return response.json();
  }

  async function loadRemoteData() {
    const [categories, materials] = await Promise.all([
      fetchApi("/categories"),
      fetchApi("/materials"),
    ]);
    apiCategories = categories.map(normalizeCategory);
    apiContents = materials.map(normalizeMaterial);
  }

  function loadUsers() {
    const stored = store.read(STORE.users, null);
    if (!Array.isArray(stored)) {
      saveUsers(DEFAULT_USERS);
      return DEFAULT_USERS.map((user) => ({ ...user }));
    }

    const merged = [...stored];
    DEFAULT_USERS.forEach((defaultUser) => {
      if (!merged.some((user) => user.id === defaultUser.id || user.username.toLowerCase() === defaultUser.username.toLowerCase())) {
        merged.push({ ...defaultUser });
      }
    });
    if (merged.length !== stored.length) saveUsers(merged);
    return merged;
  }
  function saveUsers(list) {
    store.write(STORE.users, list);
  }

  /** سجل العمليات (FR-019 / SEC-012) */
  function loadAudit() {
    return store.read(STORE.audit, []);
  }
  function logAudit(action, entity, result) {
    const session = getSession();
    const entry = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      ts: new Date().toISOString(),
      user: (session && session.name) || "زائر",
      username: (session && session.username) || "guest",
      action,
      entity: String(entity || "").slice(0, 120),
      result: result || "OK",
    };
    const list = loadAudit();
    list.unshift(entry);
    store.write(STORE.audit, list.slice(0, 500));
    return entry;
  }
  function formatAuditTime(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return "—";
    return new Intl.DateTimeFormat("ar", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(d);
  }

  /* ----------------------------------------------------------------------
     3) إدارة الجلسات والأدوار (RBAC) – SEC-001 / SEC-002 / SEC-003
     ---------------------------------------------------------------------- */
  const ROLES = {
    admin: { label: "مدير النظام", home: "pages/dashboard.html" },
    manager: { label: "مدير المحتوى", home: "pages/dashboard.html" },
    viewer: { label: "مستخدم مباشر", home: "index.html" },
  };

  function getSession() {
    return store.read(STORE.session, null);
  }
  function setSession(user) {
    store.write(STORE.session, {
      username: user.username,
      name: user.name,
      role: user.role,
      loginAt: new Date().toISOString(),
    });
  }
  function clearSession() {
    store.remove(STORE.session);
  }
  function requireRole(allowed) {
    const s = getSession();
    return !!(s && allowed.includes(s.role));
  }

  /** سياسة كلمات المرور القوية (SEC-005)
      المتطلبات: ≥ 8 أحرف + حرف واحد على الأقل + رقم واحد على الأقل
      + حرف كبير أو حرف عربي (ليس للعربية صيغ حالات) */
  function passwordPolicyError(pw) {
    if (!pw || pw.length < 8) return "كلمة المرور يجب ألا تقل عن 8 أحرف.";
    if (!/[A-Za-z\u0621-\u064a]/.test(pw)) return "كلمة المرور يجب أن تحتوي على حرف واحد على الأقل.";
    if (!/\d/.test(pw)) return "كلمة المرور يجب أن تحتوي على رقم واحد على الأقل.";
    if (!/[A-Z\u0621-\u064a]/.test(pw)) return "كلمة المرور يجب أن تحتوي على حرف كبير أو حرف عربي على الأقل.";
    return null;
  }

  /* سياسة إغلاق الحساب بعد محاولات فاشلة (SEC-011): 5 محاولات في 30 دقيقة
     → تجميد الحساب لمدة 3 أيام */
  const LOCK_WINDOW_MS = 30 * 60 * 1000;   // 30 دقيقة
  const LOCK_MAX_ATTEMPTS = 5;             // 5 محاولات
  const LOCK_DURATION_MS = 3 * 24 * 60 * 60 * 1000; // 3 أيام

  function loadLock() {
    return store.read(STORE.lockout, { attempts: [], lockedUntil: 0 });
  }
  function saveLock(lock) {
    store.write(STORE.lockout, lock);
  }

  /** هل الحساب مُجمّد حالياً؟ */
  function isLocked() {
    const lock = loadLock();
    return Date.now() < lock.lockedUntil;
  }
  function lockedRemainingText() {
    const lock = loadLock();
    const ms = lock.lockedUntil - Date.now();
    if (ms <= 0) return "";
    const hours = Math.floor(ms / 3600000);
    const mins = Math.floor((ms % 3600000) / 60000);
    if (hours > 0) return `${hours} ساعة و ${mins} دقيقة`;
    return `${Math.max(1, mins)} دقيقة`;
  }

  /** تسجيل محاولة فاشلة – يعيد حالة القفل الجديدة */
  function recordFailedAttempt(username) {
    const lock = loadLock();
    const now = Date.now();
    lock.attempts.push({ at: now, username });
    lock.attempts = lock.attempts.filter((a) => now - a.at < LOCK_WINDOW_MS);

    if (lock.attempts.length >= LOCK_MAX_ATTEMPTS) {
      lock.lockedUntil = now + LOCK_DURATION_MS; // تجميد تلقائي لمدة 3 أيام
      lock.attempts = [];
      saveLock(lock);
      logAudit("LOGIN_FAILED", `قفل الحساب بعد ${LOCK_MAX_ATTEMPTS} محاولات فاشلة (${username})`, "LOCKED");
      return { locked: true };
    }
    saveLock(lock);
    return {
      locked: false,
      remaining: LOCK_MAX_ATTEMPTS - lock.attempts.length,
    };
  }

  /** التحقق من بيانات الدخول مقابل المستخدمين النشطين */
  function authenticate(username, password) {
    const users = loadUsers();
    const user = users.find(
      (u) =>
        [u.username, u.email].filter(Boolean).some(
          (identifier) => identifier.toLowerCase() === String(username).trim().toLowerCase()
        )
    );
    if (user && user.status === "active" && user.passHash === hashDemo(password)) {
      return user;
    }
    return null;
  }

  /* ----------------------------------------------------------------------
     4) مشغّل الصوت الموحّد (Audio Player Controller) – FR-008 / FR-009
     مشغّل واحد يُشارك بين بطاقات الصفحة وصفحة التفاصيل، فيتوقف السابق
     عند بدء تشغيل جديد.
     ---------------------------------------------------------------------- */
  const AudioPlayer = {
    audio: new Audio(),
    widgets: {},        // id → { onState(fn), destroy() }
    activeId: null,
    volume: 0.9,
    isMuted: false,
    rate: 1,

    /** تسجيل عنصر واجهة جديد يستقبل تحديثات الحالة */
    register(id, callbacks) {
      const cb = callbacks || {
        onPlay() {}, onPause() {}, onTime() {}, onMeta() {}, onError() {}, onEnd() {},
      };
      this.widgets[id] = cb;

      if (Object.keys(this.widgets).length === 1) {
        this._bindEvents();
      }
      return () => {
        if (this.activeId === id) this.pause();
        delete this.widgets[id];
      };
    },

    _bindEvents() {
      const a = this.audio;
      a.preload = "metadata";

      a.addEventListener("loadedmetadata", () => {
        this._notify("onMeta", a.duration);
      });
      a.addEventListener("timeupdate", () => {
        this._notify("onTime", a.currentTime, a.duration);
      });
      a.addEventListener("play", () => this._notify("onPlay"));
      a.addEventListener("pause", () => this._notify("onPause"));
      a.addEventListener("ended", () => this._notify("onEnd"));
      a.addEventListener("error", () => {
        this._notify("onError");
      });
      a.volume = this.volume;
      a.loop = false;
    },

    _notify(name, ...args) {
      const cb = this.widgets[this.activeId];
      if (cb && typeof cb[name] === "function") cb[name](...args);
    },

    /** بدء تشغيل مصدر معيّن من واجهة معيّنة */
    play(id, src) {
      if (this.activeId && this.activeId !== id && this.widgets[this.activeId]) {
        this.widgets[this.activeId].onPause();
      }
      this.activeId = id;

      const a = this.audio;
      a.pause();
      // تفادي إعادة تحميل نفس الملف عند كل ضغطة
      if (a.getAttribute("data-src") !== src) {
        a.setAttribute("data-src", src);
        a.src = src;
        a.load();
      }
      a.volume = this.isMuted ? 0 : this.volume;
      a.playbackRate = this.rate;
      const p = a.play();
      if (p && p.catch) {
        p.catch(() => this._notify("onError"));
      }
    },

    pause() {
      this.audio.pause();
    },

    seekTo(seconds) {
      if (!isNaN(seconds)) this.audio.currentTime = seconds;
    },

    setVolume(v) {
      this.volume = Number(v);
      this.audio.volume = this.isMuted ? 0 : this.volume;
    },

    toggleMute() {
      this.isMuted = !this.isMuted;
      this.audio.volume = this.isMuted ? 0 : this.volume;
      return this.isMuted;
    },

    setRate(r) {
      this.rate = Number(r);
      this.audio.playbackRate = this.rate;
    },

    /** مبدّل التشغيل/الإيقاف لعنصر واجهة */
    toggle(id, src) {
      if (this.activeId === id && !this.audio.paused) {
        this.pause();
        return;
      }
      this.play(id, src);
    },
  };

  /** بناء أزرار المشغّل المصغّر داخل البطاقات */
  function renderMiniPlayer(btn, content) {
    if (!content.audio) {
      btn.setAttribute("aria-disabled", "true");
      btn.classList.add("is-disabled");
      btn.title = "لا يوجد ملف صوتي مرتبط";
      btn.innerHTML = '<span class="icon" aria-hidden="true">⛔</span> لا يتوفر صوت';
      return;
    }
    const id = "mini-" + content.id;
    const src = BASE + content.audio;
    btn.setAttribute("aria-pressed", "false");
    btn.innerHTML = '<span class="icon" aria-hidden="true">▶</span><span data-label>تشغيل</span>';

    const setLabel = (playing) => {
      btn.setAttribute("aria-pressed", String(playing));
      btn.querySelector(".icon").textContent = playing ? "⏸" : "▶";
      btn.querySelector("[data-label]").textContent = playing ? "إيقاف" : "تشغيل";
    };

    AudioPlayer.register(id, {
      onPlay: () => setLabel(true),
      onPause: () => setLabel(false),
      onTime: () => {},
      onMeta: () => {},
      onError: () => setLabel(false),
      onEnd: () => setLabel(false),
    });

    btn.addEventListener("click", () => {
      if (AudioPlayer.activeId === id && !AudioPlayer.audio.paused) {
        AudioPlayer.pause();
        setLabel(false);
      } else {
        AudioPlayer.play(id, src);
      }
    });
  }

  /**
   * بناء مشغّل الصوت الكامل داخل صفحة المادة.
   * @param {string|Element} container  الحاوية
   * @param {Object} config  { id, title, src }
   */
  function renderFullPlayer(container, config) {
    const root = typeof container === "string" ? $(container) : container;
    if (!root) return;

    const id = "full-" + config.id;
    root.innerHTML = `
      <div class="player">
        <div class="player__top">
          <button type="button" class="player__main-btn" data-role="toggle" aria-pressed="false" aria-label="تشغيل أو إيقاف الملف الصوتي">
            <span class="icon" aria-hidden="true">▶</span>
          </button>
          <div class="player__info">
            <p class="player__title" dir="rtl">${escapeHTML(config.title)}</p>
            <p class="player__status" role="status" aria-live="polite" data-role="status">اضغط تشغيل للاستماع</p>
          </div>
        </div>

        <div class="player__seek">
          <span class="player__time" data-role="current">0:00</span>
          <input type="range" data-role="seek" min="0" max="100" value="0" step="1" aria-label="شريط تقدم الصوت">
          <span class="player__time" data-role="duration">0:00</span>
        </div>

        <div class="player__controls">
          <div class="player__secondary">
            <div class="player__volume">
              <button type="button" class="player__icon-btn" data-role="mute" aria-pressed="false" aria-label="كتم الصوت">
                <span class="icon" aria-hidden="true">🔊</span>
              </button>
              <input type="range" data-role="volume" min="0" max="1" step="0.05" value="0.9" aria-label="مستوى الصوت">
            </div>
            <button type="button" class="player__icon-btn" data-rate="0.75">0.75×</button>
            <button type="button" class="player__icon-btn" data-rate="1" aria-pressed="true">1×</button>
            <button type="button" class="player__icon-btn" data-rate="1.5">1.5×</button>
          </div>
        </div>
      </div>`;

    const get = (s) => root.querySelector(s);
    const toggleBtn = get('[data-role="toggle"]');
    const status = get('[data-role="status"]');
    const seek = get('[data-role="seek"]');
    const curEl = get('[data-role="current"]');
    const durEl = get('[data-role="duration"]');
    const muteBtn = get('[data-role="mute"]');
    const volEl = get('[data-role="volume"]');
    const src = resolveContentUrl(config.src);

    AudioPlayer.register(id, {
      onPlay() {
        toggleBtn.setAttribute("aria-pressed", "true");
        toggleBtn.querySelector(".icon").textContent = "⏸";
        status.textContent = "جارٍ التشغيل…";
        status.classList.remove("player__error");
      },
      onPause() {
        toggleBtn.setAttribute("aria-pressed", "false");
        toggleBtn.querySelector(".icon").textContent = "▶";
        status.textContent = "متوقف مؤقتاً";
      },
      onTime(cur, dur) {
        curEl.textContent = formatDuration(cur);
        if (dur && isFinite(dur)) {
          durEl.textContent = formatDuration(dur);
          seek.max = Math.floor(dur);
        }
        seek.value = Math.floor(cur || 0);
      },
      onMeta(dur) {
        if (dur && isFinite(dur)) {
          durEl.textContent = formatDuration(dur);
          seek.max = Math.floor(dur);
        }
        status.textContent = "اضغط تشغيل للاستماع";
      },
      onEnd() {
        toggleBtn.setAttribute("aria-pressed", "false");
        toggleBtn.querySelector(".icon").textContent = "▶";
        seek.value = "0";
        curEl.textContent = "0:00";
        status.textContent = "انتهى الملف";
      },
      onError() {
        toggleBtn.setAttribute("aria-pressed", "false");
        toggleBtn.querySelector(".icon").textContent = "▶";
        status.textContent = "تعذّر تحميل الملف الصوتي (AF-007)";
        status.classList.add("player__error");
      },
    });

    toggleBtn.addEventListener("click", () => {
      if (AudioPlayer.activeId === id && !AudioPlayer.audio.paused) {
        AudioPlayer.pause();
      } else {
        AudioPlayer.play(id, src);
      }
    });

    // شريط التقدم
    seek.addEventListener("input", () => {
      AudioPlayer.seekTo(Number(seek.value));
    });

    // مستوى الصوت
    volEl.value = String(AudioPlayer.volume);
    volEl.addEventListener("input", () => {
      AudioPlayer.setVolume(Number(volEl.value));
      muteBtn.setAttribute("aria-pressed", String(AudioPlayer.isMuted));
      muteBtn.querySelector(".icon").textContent =
        Number(volEl.value) === 0 || AudioPlayer.isMuted ? "🔇" : "🔊";
    });

    // كتم
    muteBtn.addEventListener("click", () => {
      const muted = AudioPlayer.toggleMute();
      muteBtn.setAttribute("aria-pressed", String(muted));
      muteBtn.querySelector(".icon").textContent = muted ? "🔇" : "🔊";
      status.textContent = muted ? "الصوت مكتوم" : "الصوت مفعل";
    });

    // سرعة التشغيل
    $$("[data-rate]", root).forEach((rbtn) => {
      rbtn.addEventListener("click", () => {
        const rate = Number(rbtn.dataset.rate);
        AudioPlayer.setRate(rate);
        $$("[data-rate]", root).forEach((b) =>
          b.setAttribute("aria-pressed", String(Number(b.dataset.rate) === rate))
        );
      });
    });
  }

  /* ======================================================================
     5) التهيئة المشتركة لكل الصفحات (هيدر/فوتر/جلسة)
     ====================================================================== */
  function initShared() {
    // زر قائمة الجوال
    const toggle = $(".nav-toggle");
    const nav = $("#site-nav");
    if (toggle && nav) {
      toggle.addEventListener("click", () => {
        const open = nav.classList.toggle("is-open");
        toggle.setAttribute("aria-expanded", String(open));
      });
      // إغلاق القائمة عند اختيار رابط
      nav.addEventListener("click", (e) => {
        if (e.target.closest("a") && nav.classList.contains("is-open")) {
          nav.classList.remove("is-open");
          toggle.setAttribute("aria-expanded", "false");
        }
      });
    }

    // سنة الحقوق
    const yearEl = $("#year");
    if (yearEl) yearEl.textContent = new Date().getFullYear();

    // روابط التصنيفات في التذييل
    const footerList = $("#footer-categories");
    if (footerList) {
      const cats = loadCategories().slice(0, 5);
      footerList.innerHTML = cats
        .map((c) => `<li><a href="${BASE}pages/search.html?category=${encodeURIComponent(c.id)}">${escapeHTML(c.name)}</a></li>`)
        .join("");
    }

    // حالة الجلسة في شريط التنقل
    const session = getSession();
    const loginLink = $('.site-nav a[href$="login.html"]');

    // زر تسجيل الخروج في الواجهة للجلسات النشطة (FR-022)
    if (session && PAGE !== "login") {
      const li = document.createElement("li");
      const logoutBtn = document.createElement("button");
      logoutBtn.type = "button";
      logoutBtn.className = "btn btn--ghost btn--sm";
      logoutBtn.textContent = "تسجيل الخروج";
      logoutBtn.setAttribute("aria-label", "تسجيل الخروج من الجلسة الحالية");
      logoutBtn.addEventListener("click", () => {
        logAudit("LOGOUT", session.username, "OK");
        clearSession();
        window.location.href = BASE + "index.html";
      });
      li.appendChild(logoutBtn);
      const navUl = $(".site-nav ul");
      if (navUl) navUl.appendChild(li);
    }

    if (session && loginLink) {
      // تحويل رابط «تسجيل الدخول» إلى «لوحة التحكم»
      loginLink.textContent = "لوحة التحكم";
      loginLink.href = BASE + "pages/dashboard.html";
    }
  }

  /* ======================================================================
     6) الصفحة الرئيسية (index.html) – FR-002 / FR-003
     ====================================================================== */
  function initHome() {
    // الإحصائيات
    const pub = publicContents();
    const statContent = $("#stat-content");
    const statAudio = $("#stat-audio");
    const statArticles = $("#stat-articles");
    const statBooks = $("#stat-books");
    const statCats = $("#stat-categories");
    if (statContent) statContent.textContent = String(pub.length);
    if (statAudio) statAudio.textContent = String(pub.filter((c) => c.audio).length);
    if (statArticles) statArticles.textContent = String(pub.filter((c) => c.type === "article").length);
    if (statBooks) statBooks.textContent = String(pub.filter((c) => c.type === "book").length);
    if (statCats) statCats.textContent = String(loadCategories().length);

    // شبكة التصنيفات
    const catGrid = $("#categories-grid");
    if (catGrid) {
      const cats = loadCategories();
      catGrid.innerHTML = cats
        .map((c) => {
          const count = pub.filter((x) => x.category === c.id).length;
          return `
          <a class="card category-card" href="pages/search.html?category=${encodeURIComponent(c.id)}" aria-label="تصنيف ${escapeHTML(c.name)} — ${count} مادة">
            <span class="cat-emoji" aria-hidden="true">${c.icon}</span>
            <span>
              <h3>${escapeHTML(c.name)}</h3>
              <p>${count} مادة</p>
            </span>
          </a>`;
        })
        .join("");
    }

    // أحدث المواد الصوتية
    const latestGrid = $("#latest-grid");
    if (latestGrid) {
      const latest = [...pub].sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate)).slice(0, 6);
      latestGrid.innerHTML = latest.map((c) => contentCard(c)).join("");
      initCardPlayers(latestGrid);
    }
  }

  /** عنوان صفحة التفاصيل نسبياً إلى الصفحة الحالية (SEO-001)
      home → "pages/content-detail.html"  /  صفحات pages/* → "content-detail.html" */
  const detailHref = (id) =>
    (BASE === "../" ? "content-detail.html" : "pages/content-detail.html") +
    "?id=" +
    encodeURIComponent(id);

  const resolveContentUrl = (path) =>
    /^https?:\/\//i.test(String(path || "")) ? String(path) : BASE + String(path || "");

  /** بطاقة مادة علمية قابلة لإعادة الاستخدام */
  function contentCard(c) {
    const cat = loadCategories().find((x) => x.id === c.category);
    const duration = c.duration ? formatDuration(c.duration) : "—";
    const hasAudio = !!c.audio;
    const type = c.type || (hasAudio ? "audio" : "article");
    const typeLabel = type === "book" ? "كتاب PDF" : type === "article" ? "مقال مكتوب" : "مادة صوتية";
    const downloadPath = c.audio || c.pdf || "";
    const downloadLabel = c.audio ? "تحميل الصوت" : c.pdf ? "تحميل PDF" : "";
    return `
    <article class="card item-card">
      <div class="item-media">
        ${hasAudio
          ? `<audio class="native-audio" controls preload="none" src="${escapeHTML(resolveContentUrl(c.audio))}" aria-label="تشغيل ${escapeHTML(c.title)}"></audio>`
          : ""}
        <span class="duration">${typeLabel}${hasAudio ? ` · ${duration}` : ""}</span>
      </div>
      <div class="item-body">
        <h3><a href="${detailHref(c.id)}">${escapeHTML(c.title)}</a></h3>
        <ul class="item-meta">
          <li>✍️ ${escapeHTML(c.author)}</li>
          <li>🗂 ${cat ? escapeHTML(cat.name) : "عام"}</li>
          <li>📅 ${formatDate(c.pubDate)}</li>
        </ul>
        <p class="item-excerpt">${escapeHTML(c.description)}</p>
        <div class="item-actions">
          <a class="btn btn--outline btn--sm" href="${detailHref(c.id)}">تفاصيل المادة</a>
          ${downloadPath
            ? `<a class="btn btn--accent btn--sm card-download" href="${escapeHTML(encodeURI(resolveContentUrl(downloadPath)))}" download>${downloadLabel}</a>`
            : ""}
        </div>
      </div>
    </article>`;
  }

  /** ربط الأزرار المصغّرة داخل حاوية بعد رسمها */
  function initCardPlayers(scope) {
    $$("[data-mini]", scope).forEach((btn) => {
      const c = loadContents().find((x) => x.id === btn.dataset.contentId);
      if (c) renderMiniPlayer(btn, c);
    });
  }

  /* ======================================================================
     7) صفحة البحث (search.html) – FR-004 / FR-005 / FR-023 / SR-xxx
     ====================================================================== */
  function initSearch() {
    const grid = $("#results-grid");
    const countEl = $("#count-num");
    const emptyEl = $("#empty-state");
    const qInput = $("#search-q");
    const form = $("#search-form");
    const catSel = $("#filter-category");
    const mediaSel = $("#filter-media");
    const sortSel = $("#filter-sort");
    const clearBtn = $("#clear-filters");

    if (!grid) return;

    // تعبئة خيارات التصنيف
    if (catSel) {
      catSel.innerHTML =
        '<option value="">جميع التصنيفات</option>' +
        loadCategories()
          .map((c) => `<option value="${escapeHTML(c.id)}">${escapeHTML(c.name)}</option>`)
          .join("");
    }

    // الحالة من روابط URL (SEO-friendly: search.html?q=..&category=..)
    const params = new URLSearchParams(window.location.search);
    const initial = {
      q: params.get("q") || "",
      category: params.get("category") || "",
      media: params.get("media") || "",
      sort: params.get("sort") || "newest",
    };

    if (qInput) qInput.value = initial.q;
    if (catSel) catSel.value = initial.category;
    if (mediaSel) mediaSel.value = initial.media;
    if (sortSel) sortSel.value = initial.sort;

    /** تنفيذ البحث وتحديث الشبكة */
    function runSearch() {
      const q = (qInput ? qInput.value : "").trim().toLowerCase();
      const category = catSel ? catSel.value : "";
      const media = mediaSel ? mediaSel.value : "";
      const sort = sortSel ? sortSel.value : "newest";

      let items = publicContents();

      // البحث النصي في العنوان/الوصف/المؤلف/الكلمات المفتاحية (SR-002 / SR-006)
      if (q) {
        items = items.filter((c) => {
          const hay = [
            c.title,
            c.description,
            c.author,
            (c.keywords || []).join(" "),
            (loadCategories().find((x) => x.id === c.category) || {}).name,
          ]
            .join(" ")
            .toLowerCase();
          return hay.includes(q);
        });
      }

      // تصفية التصنيف
      if (category) items = items.filter((c) => c.category === category);

      // تصفية وسيط المحتوى
      if (media === "audio") items = items.filter((c) => (c.type || (c.audio ? "audio" : "")) === "audio");
      else if (media === "article") items = items.filter((c) => c.type === "article");
      else if (media === "book") items = items.filter((c) => c.type === "book");
      else if (media === "no-audio") items = items.filter((c) => !c.audio);

      // الفرز
      const sorters = {
        newest: (a, b) => new Date(b.pubDate) - new Date(a.pubDate),
        oldest: (a, b) => new Date(a.pubDate) - new Date(b.pubDate),
        "title-asc": (a, b) => a.title.localeCompare(b.title, "ar"),
        "title-desc": (a, b) => b.title.localeCompare(a.title, "ar"),
      };
      items.sort(sorters[sort] || sorters.newest);

      // رسم النتائج
      if (countEl) countEl.textContent = String(items.length);
      if (emptyEl) emptyEl.hidden = items.length > 0;

      if (items.length) {
        grid.innerHTML = items.map((c) => contentCard(c)).join("");
        initCardPlayers(grid);
      } else {
        grid.innerHTML = "";
      }
    }

    // الاستماع للأحداث
    if (form) {
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        runSearch();
        // تحديث شريط العناوين دون إعادة تحميل – قواعد SEO-friendly
        const u = new URL(window.location);
        u.searchParams.set("q", (qInput ? qInput.value : "").trim());
        u.searchParams.set("category", catSel ? catSel.value : "");
        u.searchParams.set("media", mediaSel ? mediaSel.value : "");
        u.searchParams.set("sort", sortSel ? sortSel.value : "newest");
        window.history.replaceState({}, "", u);
      });
    }
    if (qInput) qInput.addEventListener("input", debounce(runSearch, 220));
    if (catSel) catSel.addEventListener("change", runSearch);
    if (mediaSel) mediaSel.addEventListener("change", runSearch);
    if (sortSel) sortSel.addEventListener("change", runSearch);
    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        if (qInput) qInput.value = "";
        if (catSel) catSel.value = "";
        if (mediaSel) mediaSel.value = "";
        if (sortSel) sortSel.value = "newest";
        runSearch();
      });
    }

    runSearch();
  }

  /* ======================================================================
     8) صفحة تفاصيل المادة (content-detail.html) – FR-006 / FR-007 / FR-024
     ====================================================================== */
  function initDetail() {
    const wrap = $("#detail-wrap");
    const notFound = $("#not-found");
    if (!wrap || !notFound) return;

    // جلب المعرّف من الرابط (SEO-001: رابط مستقل لكل مادة)
    const params = new URLSearchParams(window.location.search);
    const id = params.get("id") || "";
    const content = publicContents().find((c) => c.id === id || c.slug === id);

    if (!content) {
      notFound.hidden = false;
      wrap.style.display = "none";
      setPageMeta("مادة غير متوفرة | DSACMS", "لم يتم العثور على المادة المطلوبة.");
      return;
    }

    const cat = loadCategories().find((x) => x.id === content.category);

    // تحديث عنوان الصفحة وبيانات SEO + Open Graph (SEo-002/003 + مشاركة)
    setPageMeta(`${content.title} | DSACMS`, content.description);
    const ogDesc = $('meta[property="og:description"]');
    const ogTitle = $('meta[property="og:title"]');
    if (ogDesc) ogDesc.setAttribute("content", content.description);
    if (ogTitle) ogTitle.setAttribute("content", content.title);
    const canonical = document.querySelector('link[rel="canonical"]');
    if (canonical) {
      canonical.setAttribute("href", window.location.origin + window.location.pathname + "?id=" + encodeURIComponent(content.id));
    }

    // مسار التنقل
    const bcCat = $("#breadcrumb-category");
    const bcCur = $("#breadcrumb-current");
    if (bcCat) bcCat.textContent = cat ? cat.name : "عام";
    if (bcCur) bcCur.textContent = content.title;

    // العنوان والشرائط الوصفية
    $("#article-title").textContent = content.title;
    $("#article-description").textContent = content.description;

    const readingSection = $("#reading-section");
    const articleBody = $("#article-body");
    const pdfReader = $("#pdf-reader");
    const pdfFrame = $("#pdf-frame");
    if (readingSection && (content.type === "article" || content.type === "book")) {
      readingSection.hidden = false;
      $("#reading-title").textContent = content.type === "book" ? "قراءة الكتاب" : "المقال";
      if (content.type === "article") {
        articleBody.innerHTML = (content.body || [content.description])
          .map((paragraph) => `<p>${escapeHTML(paragraph)}</p>`)
          .join("");
      } else if (content.pdf && pdfReader && pdfFrame) {
        articleBody.innerHTML = "";
        pdfReader.hidden = false;
        pdfFrame.src = `${BASE}${content.pdf}`;
      }
    }

    const downloadsSection = $("#downloads-section");
    const downloadActions = $("#download-actions");
    if (downloadsSection && downloadActions) {
      const downloads = [];
      if (content.audio) {
        downloads.push(`<a class="btn btn--primary" href="${BASE}${encodeURI(content.audio)}" download>تحميل الملف الصوتي</a>`);
      }
      if (content.pdf) {
        downloads.push(`<a class="btn btn--accent" href="${BASE}${encodeURI(content.pdf)}" download>تحميل الكتاب PDF</a>`);
      }
      downloadsSection.hidden = downloads.length === 0;
      downloadActions.innerHTML = downloads.join("");
    }

    const metaList = $("#meta-list");
    metaList.innerHTML = `
      <li class="meta-chip">✍️ ${escapeHTML(content.author)}</li>
      <li class="meta-chip">🗂 ${cat ? escapeHTML(cat.name) : "عام"}</li>
      <li class="meta-chip">📅 ${formatDate(content.pubDate)}</li>
      ${content.duration ? `<li class="meta-chip" dir="ltr">⏱ ${formatDuration(content.duration)}</li>` : ""}
    `;

    // الكلمات المفتاحية
    const kwEl = $("#article-keywords");
    kwEl.innerHTML = (content.keywords || [])
      .map((k) => `<span class="kw">${escapeHTML(k)}</span>`)
      .join("");

    // الجدول الوصفي (FR-007)
    const tbl = $("#meta-table tbody");
    tbl.innerHTML = `
      <tr><th scope="row">العنوان</th><td>${escapeHTML(content.title)}</td></tr>
      <tr><th scope="row">المؤلف</th><td>${escapeHTML(content.author)}</td></tr>
      <tr><th scope="row">التصنيف</th><td>${cat ? escapeHTML(cat.name) : "عام"}</td></tr>
      <tr><th scope="row">تاريخ النشر</th><td>${formatDate(content.pubDate)}</td></tr>
      <tr><th scope="row">المدة</th><td dir="ltr">${content.duration ? formatDuration(content.duration) : "—"}</td></tr>
      <tr><th scope="row">الحالة</th><td><span class="badge badge--published">منشور</span></td></tr>
      <tr><th scope="row">الكلمات المفتاحية</th><td>${(content.keywords || []).join("، ")}</td></tr>
    `;

    // المشغّل الصوتي (FR-008)
    const playerSection = $("#player-section");
    if (content.audio) {
      renderFullPlayer(playerSection, { id: content.id, title: content.title, src: content.audio });
    } else {
      playerSection.innerHTML = `
        <div class="alert alert--info" role="status">
          لا يتوفر ملف صوتي مرتبط بهذه المادة حالياً.
        </div>`;
    }

    // مواد ذات صلة (نفس التصنيف)
    const related = publicContents()
      .filter((c) => c.category === content.category && c.id !== content.id)
      .slice(0, 4);
    const relList = $("#related-list");
    relList.innerHTML = related.length
      ? related
          .map(
            (c) => `
            <div class="related-item">
              <span class="rel-icon" aria-hidden="true">${cat ? cat.icon : "📄"}</span>
              <a href="content-detail.html?id=${encodeURIComponent(c.id)}">${escapeHTML(c.title)}</a>
            </div>`
          )
          .join("")
      : '<p class="dash-empty">لا توجد مواد أخرى في هذا التصنيف.</p>';

    // أزرار المشاركة (FR-024 / FR-025)
    const shareUrl = window.location.href;
    const shareCopy = $("#share-copy");
    const shareX = $("#share-twitter");
    const shareWA = $("#share-whatsapp");
    const text = encodeURIComponent(`${content.title} — من أرشيف DSACMS`);
    if (shareX) shareX.href = `https://twitter.com/intent/tweet?text=${text}&url=${encodeURIComponent(shareUrl)}`;
    if (shareWA) shareWA.href = `https://wa.me/?text=${text}%20${encodeURIComponent(shareUrl)}`;

    if (shareCopy) {
      shareCopy.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(shareUrl);
          shareCopy.textContent = "✓ تم نسخ الرابط";
        } catch (e) {
          // مسار احتياطي قديم
          const ta = document.createElement("textarea");
          ta.value = shareUrl;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          ta.remove();
          shareCopy.textContent = "✓ تم نسخ الرابط";
        }
        setTimeout(() => (shareCopy.textContent = "نسخ الرابط"), 2000);
      });
    }
  }

  /* ======================================================================
     9) صفحة تسجيل الدخول (login.html) – FR-021 / SEC-001 / SEC-004/006/011
     ====================================================================== */
  function initLogin() {
    const form = $("#login-form");
    if (!form) return;

    // إذا كان المستخدم مسجلاً بالفعل، إعادة توجيه للوحة
    const session = getSession();
    const successBox = $("#login-success");
    const successText = $("#login-success-text");
    if (session && successBox) {
      successBox.hidden = false;
      successText.textContent = `مرحباً ${session.name}، أنت مسجل الدخول بالفعل.`;
      return;
    }

    const userInput = $("#login-username");
    const passInput = $("#login-password");
    const errorBox = $("#login-error");
    const errorText = $("#login-error-text");
    const attemptsHint = $("#attempts-hint");
    const toggleBtn = $("#password-toggle");

    // زر إظهار/إخفاء كلمة المرور
    if (toggleBtn && passInput) {
      toggleBtn.addEventListener("click", () => {
        const showing = passInput.type === "text";
        passInput.type = showing ? "password" : "text";
        toggleBtn.setAttribute("aria-label", showing ? "إظهار كلمة المرور" : "إخفاء كلمة المرور");
        toggleBtn.querySelector("span").textContent = showing ? "👁" : "🙈";
      });
    }

    // قفل الحساب (SEC-011)
    function renderLockState() {
      if (isLocked()) {
        const rem = lockedRemainingText();
        if (errorBox && errorText) {
          errorBox.hidden = false;
          errorText.textContent = `تم تجميد الحساب بسبب أكثر من 5 محاولات فاشلة. إعادة المحاولة بعد ${rem}.`;
        }
        ["login-username", "login-password", "login-submit"].forEach((id) => {
          const el = $('#' + id);
          if (el) el.disabled = true;
        });
        return;
      }
      // عرض عدد المحاولات المتبقية
      const lock = loadLock();
      if (lock.attempts.length > 0 && attemptsHint) {
        attemptsHint.hidden = false;
        attemptsHint.textContent = `محاولات خاطئة قريبة: ${lock.attempts.length} من ${LOCK_MAX_ATTEMPTS} – سيتم تجميد الحساب إذا تكررت المحاولات.`;
      }
    }
    renderLockState();

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (isLocked()) return;

      const username = userInput.value.trim();
      const password = passInput.value;
      let valid = true;

      if (!username) {
        showFieldError("err-username", userInput);
        valid = false;
      } else {
        hideFieldError("err-username", userInput);
      }
      if (!password) {
        showFieldError("err-password", passInput);
        valid = false;
      } else {
        hideFieldError("err-password", passInput);
      }
      if (!valid) return;

      const user = authenticate(username, password);
      if (!user) {
        // محاولة فاشلة → نظام القفل
        const res = recordFailedAttempt(username);
        if (errorBox && errorText) {
          errorBox.hidden = false;
          if (res.locked) {
            errorText.textContent = "تم تجميد الحساب لمدة 3 أيام بسبب المحاولات المتكررة.";
          } else {
            errorText.textContent = `بيانات الدخول غير صحيحة. المحاولات المتبقية: ${res.remaining}.`;
          }
        }
        logAudit("LOGIN_FAILED", username, "DENIED");
        renderLockState();
        return;
      }

      // نجاح الدخول → جلسة آمنة + سجل
      setSession(user);
      logAudit("LOGIN", user.username, "OK");
      if (successBox && successText) {
        successBox.hidden = false;
        successText.textContent = "تم تسجيل الدخول بنجاح، جارٍ النقل إلى اللوحة…";
      }
      setTimeout(() => {
        const home = (ROLES[user.role] && ROLES[user.role].home) || "pages/dashboard.html";
        window.location.href = BASE + home;
      }, 600);
    });
  }

  /** إظهار/إخفاء أخطاء الحقول */
  function showFieldError(errId, inputEl) {
    const el = $("#" + errId);
    if (el) el.setAttribute("data-visible", "true");
    if (inputEl) inputEl.classList.add("field--error");
  }
  function hideFieldError(errId, inputEl) {
    const el = $("#" + errId);
    if (el) el.setAttribute("data-visible", "false");
    if (inputEl) inputEl.classList.remove("field--error");
  }

  /* ======================================================================
     10) لوحة التحكم (dashboard.html)
         – FR-010/11/12/15/16/17, FR-019, FR-021/22, AF-001/002, RBAC
     ====================================================================== */
  /** نظام إشعارات سريعة (Toast) */
  const toastRegion = () => $("#toast-region");
  function showToast(message, type) {
    const region = toastRegion();
    if (!region) return;
    const t = document.createElement("div");
    t.className = "toast toast--" + (type || "success");
    t.setAttribute("role", "status");
    t.textContent = message;
    region.appendChild(t);
    setTimeout(() => t.remove(), 3800);
  }

  /** نافذة تأكيد ديناميكية تُرجع وعداً */
  function confirmAction(title, desc) {
    return new Promise((resolve) => {
      const modal = $("#confirm-modal");
      if (!modal) return resolve(true);
      $("#modal-title").textContent = title;
      $("#modal-desc").textContent = desc;
      modal.hidden = false;
      const confirmEl = $("#modal-confirm");
      const cancelEl = $("#modal-cancel");

      const finish = (val) => {
        modal.hidden = true;
        confirmEl.removeEventListener("click", onConfirm);
        cancelEl.removeEventListener("click", onCancel);
        resolve(val);
      };
      const onConfirm = () => finish(true);
      const onCancel = () => finish(false);
      $("#modal-cancel").addEventListener("click", onCancel);
      $("#modal-confirm").addEventListener("click", onConfirm);
      modal.addEventListener("click", (e) => {
        if (e.target === modal) finish(false);
      });
      $("#modal-cancel").focus();
    });
  }

  function initDashboard() {
    const session = getSession();
    // حاجز RBAC (SEC-002): غير مسموح بالدخول دون جلسة
    if (!session || !["admin", "manager"].includes(session.role)) {
      window.location.href = BASE + "login.html";
      return;
    }

    const isAdmin = session.role === "admin";

    // عرض بيانات المستخدم
    const uname = $("#dash-user-name");
    const urole = $("#dash-user-role");
    if (uname) uname.textContent = session.name;
    if (urole) urole.textContent = ROLES[session.role] ? ROLES[session.role].label : session.role;

    // إخفاء نهايات الفئات المحمية (users/audit) لغير المديرين (RULE: Least Privilege)
    if (!isAdmin) {
      $$("[data-admin-only]").forEach((el) => {
        el.hidden = true;
        el.removeAttribute("aria-current");
      });
      const pUsers = $("#panel-users");
      const pAudit = $("#panel-audit");
      if (pUsers) pUsers.remove();
      if (pAudit) pAudit.remove();
    }

    /* ---- التنقل بين الألواح (Tabs) ---- */
    const tabs = $$("#dash-tabs button");
    const panels = () => $$(".dash-panel");
    function switchTab(name) {
      tabs.forEach((t) => {
        const sel = t.dataset.tab === name;
        t.setAttribute("aria-current", String(sel));
      });
      panels().forEach((p) => {
        p.setAttribute("aria-hidden", String(p.id !== "panel-" + name));
      });
    }
    tabs.forEach((t) =>
      t.addEventListener("click", () => switchTab(t.dataset.tab))
    );

    /* ---- الدوال المساعدة ----
       إعادة رسم محتوى الجداول والإحصاءات */
    function refreshAll() {
      renderStats();
      renderContentTable();
      renderCategoryTable();
      renderUserTable();
      renderAuditTable();
    }

    /* ---- نظرة عامة (إحصاءات) ---- */
    function renderStats() {
      const grid = $("#stat-grid");
      if (!grid) return;
      const all = loadContents();
      const pub = all.filter((c) => c.status === "published");
      const draft = all.filter((c) => c.status === "draft");
      const arch = all.filter((c) => c.status === "archived");
      const withAudio = all.filter((c) => c.audio);
      const cards = [
        { label: "إجمالي المواد", value: all.length, accent: false },
        { label: "منشورة", value: pub.length, accent: false },
        { label: "مسودة", value: draft.length, accent: true },
        { label: "مؤرشفة", value: arch.length, accent: false },
        { label: "بملفات صوتية", value: withAudio.length, accent: false },
        { label: "التصنيفات", value: loadCategories().length, accent: false },
      ];
      if (isAdmin) cards.push({ label: "المستخدمون", value: loadUsers().length, accent: false });
      grid.innerHTML = cards
        .map(
          (c) => `
          <div class="stat-card${c.accent ? " stat-card--accent" : ""}">
            <div class="stat-value">${c.value}</div>
            <div class="stat-label">${c.label}</div>
          </div>`
        )
        .join("");
    }

    /* ---- جدول المحتوى ---- */
    const contentTbody = $("#content-tbody");
    const contentFilter = $("#content-filter");

    function renderContentTable() {
      if (!contentTbody) return;
      const all = loadContents();
      const q = contentFilter ? contentFilter.value.trim().toLowerCase() : "";
      const list = all.filter((c) => {
        if (!q) return true;
        return (c.title + " " + c.author + " " + c.category).toLowerCase().includes(q);
      });

      if (!list.length) {
        contentTbody.innerHTML = '<tr><td colspan="6" class="dash-empty">لا توجد مواد بعد. أضف مادة جديدة.</td></tr>';
        return;
      }

      contentTbody.innerHTML = list
        .map((c) => {
          const cat = loadCategories().find((x) => x.id === c.category);
          const badge =
            c.status === "published"
              ? '<span class="badge badge--published">منشور</span>'
              : c.status === "draft"
              ? '<span class="badge badge--draft">مسودة</span>'
              : '<span class="badge badge--archived">مؤرشف</span>';
          const toggleLabel = c.status === "published" ? "أرشفة" : "نشر";
          const toggleClass = c.status === "published" ? "btn--outline" : "btn--primary";
          return `
          <tr>
            <td class="title-cell"><a href="content-detail.html?id=${encodeURIComponent(c.id)}" target="_blank" rel="noopener">${escapeHTML(c.title)}</a></td>
            <td>${cat ? escapeHTML(cat.name) : "—"}</td>
            <td>${badge}</td>
            <td dir="ltr">${c.duration ? formatDuration(c.duration) : "—"}</td>
            <td>${formatDate(c.pubDate)}</td>
            <td class="row-actions">
              <button type="button" class="btn btn--ghost btn--sm" data-action="edit" data-id="${escapeHTML(c.id)}">تعديل</button>
              <button type="button" class="btn ${toggleClass} btn--sm" data-action="status" data-id="${escapeHTML(c.id)}">${toggleLabel}</button>
              <button type="button" class="btn btn--danger-outline btn--sm" data-action="delete" data-id="${escapeHTML(c.id)}">حذف</button>
            </td>
          </tr>`;
        })
        .join("");
    }

    if (contentTbody) {
      contentTbody.addEventListener("click", async (e) => {
        const btn = e.target.closest("[data-action]");
        if (!btn) return;
        const { action, id } = btn.dataset;
        const content = loadContents().find((c) => c.id === id);
        if (!content) return;

        if (action === "edit") {
          openEditor(content);
        } else if (action === "status") {
          // التحقق من الصلاحية (RBAC)
          if (session.role !== "admin" && session.role !== "manager") {
            showToast("لا تملك صلاحية تعديل الحالة", "error");
            return;
          }
          const next = content.status === "published" ? "archived" : "published";
          const ok = await confirmAction(
            next === "archived" ? "أرشفة المادة" : "نشر المادة",
            `تأكيد تغيير حالة «${content.title}» إلى ${next === "archived" ? "مؤرشفة" : "منشورة"}.`
          );
          if (!ok) return;
          content.status = next;
          saveContents(loadContents().map((x) => (x.id === id ? content : x)));
          logAudit(next === "archived" ? "ARCHIVE_CONTENT" : "PUBLISH_CONTENT", content.title, "OK");
          showToast(next === "archived" ? "تمت أرشفة المادة." : "تم نشر المادة.");
          refreshAll();
        } else if (action === "delete") {
          // الحذف الإداري: حماية من الحذف غير المقصود (BR-005)
          const ok = await confirmAction(
            "حذف المادة",
            `سيتم حذف «${content.title}» نهائياً من الأرشيف. هل تريد المتابعة؟`
          );
          if (!ok) return;
          saveContents(loadContents().filter((x) => x.id !== id));
          logAudit("DELETE_CONTENT", content.title, "OK");
          showToast("تم حذف المادة.");
          refreshAll();
        }
      });
    }

    if (contentFilter) contentFilter.addEventListener("input", debounce(renderContentTable, 200));

    /* ---- محرر المادة (إضافة/تعديل) ---- */
    const cfForm = $("#content-form");
    const cfTitle = $("#cf-title");
    const cfAuthor = $("#cf-author");
    const cfCategory = $("#cf-category");
    const cfStatus = $("#cf-status");
    const cfDesc = $("#cf-description");
    const cfKeywords = $("#cf-keywords");
    const cfDate = $("#cf-date");
    const cfDuration = $("#cf-duration");
    const cfAudio = $("#cf-audio");
    const cfType = $("#cf-type");
    const cfPdf = $("#cf-pdf");
    const cfBody = $("#cf-body");
    const cfSubmit = $("#cf-submit");
    const cfReset = $("#cf-reset");
    const editorTitle = $("#panel-editor-title");
    const editorAlert = $("#editor-alert");
    const newContentBtn = $("#btn-new-content");

    // تعبئة خيارات التصنيف في النموذج
    if (cfCategory) {
      cfCategory.innerHTML =
        '<option value="">— اختر التصنيف —</option>' +
        loadCategories()
          .map((c) => `<option value="${escapeHTML(c.id)}">${escapeHTML(c.name)}</option>`)
          .join("");
    }

    function openEditor(content) {
      switchTab("editor");
      if (editorTitle) editorTitle.textContent = "تعديل المادة";
      if (cfSubmit) cfSubmit.textContent = "حفظ التعديلات";
      if (cfReset) cfReset.textContent = "إلغاء";
      if ($("#cf-id")) $("#cf-id").value = content.id;
      if (cfTitle) cfTitle.value = content.title;
      if (cfAuthor) cfAuthor.value = content.author;
      if (cfCategory) cfCategory.value = content.category;
      if (cfStatus) cfStatus.value = content.status;
      if (cfDesc) cfDesc.value = content.description || "";
      if (cfKeywords) cfKeywords.value = (content.keywords || []).join("، ");
      if (cfDate) cfDate.value = (content.pubDate || "").slice(0, 10);
      if (cfDuration) cfDuration.value = content.duration || "";
      if (cfType) cfType.value = content.type || (content.audio ? "audio" : "article");
      if (cfPdf) cfPdf.value = content.pdf || "";
      if (cfBody) cfBody.value = (content.body || []).join("\n\n");
      if (editorAlert) editorAlert.hidden = true;
      window.scrollTo({ top: 0, behavior: "smooth" });
    }

    function resetEditor() {
      if (cfForm) cfForm.reset();
      if ($("#cf-id")) $("#cf-id").value = "";
      if (editorTitle) editorTitle.textContent = "إضافة مادة جديدة";
      if (cfSubmit) cfSubmit.textContent = "حفظ المادة";
      if (cfReset) cfReset.textContent = "إلغاء / مسح النموذج";
      if (editorAlert) editorAlert.hidden = true;
    }

    if (newContentBtn) {
      newContentBtn.addEventListener("click", () => {
        switchTab("editor");
        resetEditor();
        if (editorTitle) editorTitle.textContent = "إضافة مادة جديدة";
      });
    }
    if (cfReset) cfReset.addEventListener("click", resetEditor);

    // التحقق من صيغة وحجم الملف الصوتي (AF-002 / SEC-009)
    const ALLOWED_AUDIO = ["audio/mpeg", "audio/wav", "audio/ogg", "audio/x-wav", "audio/mp4", "audio/m4a"];
    const MAX_AUDIO = 100 * 1024 * 1024; // 100MB

    function validateAudioFile(file) {
      const errEl = $("#err-cf-audio");
      if (!file) return true;
      if (!ALLOWED_AUDIO.includes(file.type)) {
        errEl.textContent = formatType(file); // نعرض تفصيلة
        errEl.setAttribute("data-visible", "true");
        return false;
      }
      if (file.size > MAX_AUDIO) {
        errEl.textContent = `حجم الملف كبير (${Math.round(file.size / 1048576)}MB) – الحد الأقصى 100MB.`;
        errEl.setAttribute("data-visible", "true");
        return false;
      }
      errEl.setAttribute("data-visible", "false");
      return true;
    }
    function formatType(file) {
      return `صيغة الملف غير مدعومة (${file.type || "غير معروفة"}). الصيغ المسموحة: MP3، WAV، OGG، M4A.`;
    }
    if (cfAudio) {
      cfAudio.addEventListener("change", () => {
        const file = cfAudio.files[0];
        if (!file) return;
        if (!validateAudioFile(file)) {
          cfAudio.value = "";
          return;
        }
        // قراءة مدة الملف الصوتي المرفوع (AF-006 متطلبات إدارية)
        const url = URL.createObjectURL(file);
        const probe = new Audio();
        probe.addEventListener("loadedmetadata", () => {
          if (cfDuration) {
            cfDuration.value = Math.round(probe.duration);
          }
          URL.revokeObjectURL(url);
        });
        probe.src = url;
        showToast(`الملف «${file.name}» جاهز، صيغة صحيحة.`, "info");
      });
    }

    // حفظ المادة
    if (cfForm) {
      cfForm.addEventListener("submit", (e) => {
        e.preventDefault();
        let ok = true;
        if (!cfTitle.value.trim()) { showFieldError("err-cf-title", cfTitle); ok = false; } else hideFieldError("err-cf-title", cfTitle);
        if (!cfAuthor.value.trim()) { showFieldError("err-cf-author", cfAuthor); ok = false; } else hideFieldError("err-cf-author", cfAuthor);
        if (!cfCategory.value) { showFieldError("err-cf-category", cfCategory); ok = false; } else hideFieldError("err-cf-category", cfCategory);
        if (cfAudio && !validateAudioFile(cfAudio.files[0])) ok = false;
        if (!ok) return;

        const idField = $("#cf-id");
        const id = idField && idField.value ? idField.value : slugify(cfTitle.value);
        const existing = (idField && idField.value)
          ? loadContents().find((c) => c.id === id)
          : loadContents().find((c) => c.title === cfTitle.value.trim());

        // بناء كائن المادة
        const item = {
          id: (existing && existing.id) || id,
          slug: (existing && existing.slug) || id,
          title: cfTitle.value.trim(),
          author: cfAuthor.value.trim(),
          category: cfCategory.value,
          status: cfStatus ? cfStatus.value : "published",
          description: cfDesc ? cfDesc.value.trim() : "",
          keywords: cfKeywords
            ? cfKeywords.value.split(/[،,]/).map((k) => k.trim()).filter(Boolean)
            : [],
          pubDate: cfDate && cfDate.value ? cfDate.value : new Date().toISOString().slice(0, 10),
          duration: cfDuration ? Number(cfDuration.value) || 0 : 0,
          audio: existing ? existing.audio : null,
          type: cfType ? cfType.value : (existing && existing.type) || "audio",
          pdf: cfPdf ? cfPdf.value.trim() : (existing && existing.pdf) || "",
          body: cfBody
            ? cfBody.value.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
            : (existing && existing.body) || [],
        };

        // التعامل مع الملف الصوتي المرفوع في الحالة التجريبية
        const file = cfAudio && cfAudio.files[0];
        if (file) {
          // في الوضع الفعلي تُرفع إلى Object Storage (AF-003/005).
          // هنا نخزّن الإشارة فقط – يظل الأرشفة نصافياً سليماً.
          item.audio = (existing && existing.audio) || null;
          item.audioFileName = file.name;
          item.audioSize = file.size;
          item.audioReady = true;
        }

        let list = loadContents();
        const idx = existing ? list.findIndex((c) => c.id === existing.id) : -1;

        if (idx >= 0) {
          // تحديث مادة موجودة (تحافظ على id وصوتها السابق إن لم يُرفع جديد)
          list[idx] = { ...list[idx], ...item };
          logAudit("UPDATE_CONTENT", item.title, "OK");
          showToast("تم تحديث المادة بنجاح.");
        } else {
          // مادة جديدة
          list = [...list, item];
          logAudit("CREATE_CONTENT", item.title, "OK");
          showToast("تم إضافة المادة بنجاح.");
        }
        saveContents(list);
        resetEditor();
        switchTab("content");
        refreshAll();
      });
    }

    /* ---- إدارة التصنيفات (FR-015) ---- */
    const catForm = $("#category-form");
    const newCat = $("#new-category");
    const catTbody = $("#categories-tbody");

    function renderCategoryTable() {
      if (!catTbody) return;
      const cats = loadCategories();
      const all = loadContents();
      catTbody.innerHTML = cats
        .map((c) => {
          const count = all.filter((x) => x.category === c.id).length;
          return `
          <tr>
            <td>${c.icon} ${escapeHTML(c.name)}</td>
            <td>${count}</td>
            <td class="row-actions">
              <button type="button" class="btn btn--danger-outline btn--sm" data-cat-delete="${escapeHTML(c.id)}" ${count ? "disabled" : ""}
                      ${count ? 'title="لا يمكن حذف تصنيف يحتوي على مواد"' : ""}>حذف</button>
            </td>
          </tr>`;
        })
        .join("");
    }

    if (catTbody) {
      catTbody.addEventListener("click", async (e) => {
        const btn = e.target.closest("[data-cat-delete]");
        if (!btn || btn.disabled) return;
        const id = btn.dataset.catDelete;
        const cat = loadCategories().find((x) => x.id === id);
        const ok = await confirmAction("حذف التصنيف", `سيتم حذف تصنيف «${cat.name}». هل تريد المتابعة؟`);
        if (!ok) return;
        saveCategories(loadCategories().filter((x) => x.id !== id));
        // تحديث خيارات النموذج
        if (cfCategory) {
          cfCategory.innerHTML =
            '<option value="">— اختر التصنيف —</option>' +
            loadCategories()
              .map((x) => `<option value="${escapeHTML(x.id)}">${escapeHTML(x.name)}</option>`)
              .join("");
        }
        logAudit("DELETE_CATEGORY", cat.name, "OK");
        showToast("تم حذف التصنيف.");
        refreshAll();
      });
    }

    if (catForm) {
      catForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const name = newCat.value.trim();
        if (!name) return;
        const cats = loadCategories();
        if (cats.some((c) => c.name === name)) {
          showToast("يوجد تصنيف بهذا الاسم مسبقاً.", "error");
          return;
        }
        const id = "cat-" + Date.now().toString(36);
        cats.push({ id, name, icon: "📁", desc: "تصنيف مضاف عبر لوحة الإدارة" });
        saveCategories(cats);
        if (cfCategory) {
          cfCategory.innerHTML =
            '<option value="">— اختر التصنيف —</option>' +
            cats.map((x) => `<option value="${escapeHTML(x.id)}">${escapeHTML(x.name)}</option>`).join("");
        }
        newCat.value = "";
        logAudit("CREATE_CATEGORY", name, "OK");
        showToast("تم إضافة التصنيف.");
        refreshAll();
      });
    }

    /* ---- إدارة المستخدمين (FR-016 – Admin فقط) ---- */
    const userForm = $("#user-form");
    const usersTbody = $("#users-tbody");

    function renderUserTable() {
      if (!usersTbody) return;
      const users = loadUsers();
      usersTbody.innerHTML = users
        .map(
          (u) => `
          <tr>
            <td>${escapeHTML(u.name)}</td>
            <td dir="ltr">${escapeHTML(u.username)}</td>
            <td>
              <label class="visually-hidden" for="role-${escapeHTML(u.id)}">دور المستخدم</label>
              <select id="role-${escapeHTML(u.id)}" class="field" style="width:auto;" data-user-role data-id="${escapeHTML(u.id)}">
                <option value="admin" ${u.role === "admin" ? "selected" : ""}>Administrator</option>
                <option value="manager" ${u.role === "manager" ? "selected" : ""}>Content Manager</option>
                <option value="viewer" ${u.role === "viewer" ? "selected" : ""}>Viewer</option>
              </select>
            </td>
            <td>
              <span class="badge ${u.status === "active" ? "badge--active" : "badge--inactive"}">
                ${u.status === "active" ? "نشط" : "معطّل"}
              </span>
            </td>
            <td class="row-actions">
              <button type="button" class="btn btn--outline btn--sm" data-user-status data-id="${escapeHTML(u.id)}">
                ${u.status === "active" ? "تعطيل" : "تفعيل"}
              </button>
              <button type="button" class="btn btn--outline btn--sm" data-user-reset data-id="${escapeHTML(u.id)}">استعادة كلمة السر</button>
              <button type="button" class="btn btn--danger-outline btn--sm" data-user-delete data-id="${escapeHTML(u.id)}">حذف</button>
            </td>
          </tr>`
        )
        .join("");
    }

    if (usersTbody) {
      usersTbody.addEventListener("change", (e) => {
        const sel = e.target.closest("[data-user-role]");
        if (!sel) return;
        const users = loadUsers();
        const u = users.find((x) => x.id === sel.dataset.id);
        if (u) {
          // لا يجوز إسقاط صلاحية مدير النظام الحالي لنفسه (حماية)
          if (u.id === session.id || u.username === session.username) {
            sel.value = u.role;
            showToast("لا يمكن تغيير دورك الحالي أثناء الجلسة.", "error");
            return;
          }
          u.role = sel.value;
          saveUsers(users);
          logAudit("UPDATE_USER_ROLE", u.username, "OK");
          showToast(`تم تغيير دورِ المستخدم ${u.name} إلى ${ROLES[u.role].label}.`);
          renderUserTable();
        }
      });

      usersTbody.addEventListener("click", async (e) => {
        const st = e.target.closest("[data-user-status]");
        const reset = e.target.closest("[data-user-reset]");
        const del = e.target.closest("[data-user-delete]");
        const users = loadUsers();

        if (st) {
          const u = users.find((x) => x.id === st.dataset.id);
          if (!u) return;
          if (u.username === session.username) {
            showToast("لا يمكنك تعطيل حسابك الحالي.", "error");
            return;
          }
          const ok = await confirmAction(
            u.status === "active" ? "تعطيل المستخدم" : "تفعيل المستخدم",
            `تأكيد ${u.status === "active" ? "تعطيل" : "تفعيل"} حساب «${u.name}».`
          );
          if (!ok) return;
          u.status = u.status === "active" ? "inactive" : "active";
          saveUsers(users);
          logAudit("UPDATE_USER_STATUS", u.username, "OK");
          showToast("تم تحديث حالة المستخدم.");
          renderUserTable();
        }
        if (reset) {
          const u = users.find((x) => x.id === reset.dataset.id);
          if (!u) return;
          const temporaryPassword = window.prompt(`أدخل كلمة مرور جديدة للحساب «${u.name}».`);
          if (temporaryPassword === null) return;
          const policyError = passwordPolicyError(temporaryPassword);
          if (policyError) {
            showToast(policyError, "error");
            return;
          }
          u.passHash = hashDemo(temporaryPassword);
          saveUsers(users);
          logAudit("RESET_USER_PASSWORD", u.username, "OK");
          showToast(`تمت استعادة كلمة مرور حساب ${u.name}.`);
        }
        if (del) {
          const u = users.find((x) => x.id === del.dataset.id);
          if (!u) return;
          if (u.username === session.username) {
            showToast("لا يمكنك حذف حسابك الحالي.", "error");
            return;
          }
          const ok = await confirmAction("حذف المستخدم", `سيتم حذف حساب «${u.name}» (${u.username}). هل أنت متأكد؟`);
          if (!ok) return;
          saveUsers(users.filter((x) => x.id !== u.id));
          logAudit("DELETE_USER", u.username, "OK");
          showToast("تم حذف المستخدم.");
          renderUserTable();
        }
      });
    }

    if (userForm) {
      userForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const name = $("#new-user-name").value.trim();
        const username = $("#new-user-username").value.trim().toLowerCase();
        const password = $("#new-user-password").value;
        const role = $("#new-user-role").value;

        if (!name || !username || !password) {
          showToast("جميع الحقول مطلوبة لإنشاء مستخدم.", "error");
          return;
        }
        // سياسة كلمة المرور (SEC-005)
        const pwErr = passwordPolicyError(password);
        if (pwErr) {
          showToast(pwErr, "error");
          return;
        }
        const users = loadUsers();
        if (users.some((u) => u.username === username)) {
          showToast("اسم المستخدم مستخدم مسبقاً.", "error");
          return;
        }

        users.push({
          id: "u" + Date.now().toString(36),
          name,
          username,
          email: username.includes("@") ? username : "",
          passHash: hashDemo(password),
          role,
          status: "active",
        });
        saveUsers(users);
        logAudit("CREATE_USER", username, "OK");
        userForm.reset();
        showToast("تم إنشاء المستخدم بنجاح.");
        renderUserTable();
        renderStats();
      });
    }

    /* ---- سجل العمليات (FR-019 انتظام، Admin فقط) ---- */
    const auditTbody = $("#audit-tbody");
    const auditFilter = $("#audit-filter");
    const auditEmpty = $("#audit-empty");

    const ACTION_LABELS = {
      LOGIN: "تسجيل دخول",
      LOGOUT: "تسجيل خروج",
      LOGIN_FAILED: "محاولة دخول فاشلة",
      CREATE_CONTENT: "إضافة مادة",
      UPDATE_CONTENT: "تعديل مادة",
      DELETE_CONTENT: "حذف مادة",
      ARCHIVE_CONTENT: "أرشفة مادة",
      PUBLISH_CONTENT: "نشر مادة",
      CREATE_CATEGORY: "إضافة تصنيف",
      DELETE_CATEGORY: "حذف تصنيف",
      CREATE_USER: "إنشاء مستخدم",
      UPDATE_USER_ROLE: "تعديل دور",
      UPDATE_USER_STATUS: "تغيير حالة مستخدم",
      DELETE_USER: "حذف مستخدم",
      LOCKED: "قفل حساب",
    };

    function renderAuditTable() {
      if (!auditTbody) return;
      let logs = loadAudit();
      const q = auditFilter ? auditFilter.value.trim().toLowerCase() : "";
      if (q) {
        logs = logs.filter((l) =>
          (l.user + " " + l.action + " " + l.entity).toLowerCase().includes(q)
        );
      }
      if (auditEmpty) auditEmpty.hidden = logs.length > 0;
      auditTbody.innerHTML = logs.length
        ? logs
            .map(
              (l) => `
              <tr>
                <td>${formatAuditTime(l.ts)}</td>
                <td>${escapeHTML(l.user)}</td>
                <td>${ACTION_LABELS[l.action] || escapeHTML(l.action)}</td>
                <td>${escapeHTML(l.entity)}</td>
                <td><span class="badge ${l.result === "OK" ? "badge--active" : "badge--danger"}">${escapeHTML(l.result)}</span></td>
              </tr>`
            )
            .join("")
        : "";
    }
    if (auditFilter) auditFilter.addEventListener("input", debounce(renderAuditTable, 200));

    // إحصائيات
    renderStats();
    // جداول
    refreshAll();
  }

  /* ----------------------------------------------------------------------
     11) نقطة الانطلاق حسب الصفحة
     ---------------------------------------------------------------------- */
  document.addEventListener("DOMContentLoaded", async () => {
    try {
      const pagesUsingContent = ["index", "search", "detail", "dashboard"];
      if (pagesUsingContent.includes(PAGE)) {
        await loadRemoteData();
      }
      initShared();

      switch (PAGE) {
        case "index":
          initHome();
          break;
        case "search":
          initSearch();
          break;
        case "detail":
          initDetail();
          break;
        case "login":
          initLogin();
          break;
        case "dashboard":
          initDashboard();
          break;
        default:
          break;
      }
    } catch (error) {
      console.error("Unable to load DSACMS data", error);
      const message = "تعذر تحميل البيانات من الخادم. يرجى المحاولة لاحقًا.";
      ["#categories-grid", "#latest-grid", "#results-grid"].forEach((selector) => {
        const container = $(selector);
        if (container) container.innerHTML = `<p class="alert alert--error" role="alert">${message}</p>`;
      });
    }
  });
})();