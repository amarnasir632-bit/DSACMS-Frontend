/* ==========================================================================
   DSACMS – نظام إدارة وأرشفة المحتوى العلمي والصوتي
   الملف:  assets/js/main.js
   الغرض: الطبقة التفاعلية للواجهة الأمامية (Vanilla JavaScript ES6+)
   يتضمن:
     1) المنظّم العام (IIFE) ومصادر البيانات التجريبية
     2) طبقة التخزين (localStorage) – تحاكي قاعدة البيانات في الإنتاج
     3) التحقق من المدخلات وسياسة كلمات المرور (SEC-005 / SEC-008)
     4) إدارة الجلسات والأدوار (RBAC)
     5) مشغّل الصوت الموحّد (Audio Player Controller)
     6) تهيئة كل صفحة بحسب data-page
   ========================================================================== */
import { initNavbar } from "./components/navbar.js";
import { initHomePage } from "./pages/home.js";
import { initSearchPage } from "./pages/search.js";
import { initLecturesPage as initModularLectures } from "./pages/lectures.js";

  /* ----------------------------------------------------------------------
     0) أدوات مساعدة (Utilities)
     ---------------------------------------------------------------------- */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  /** قاعدة المسار النسبي: الصفحة الرئيسية "" بينما "pages/" هي "../" */
  const BASE = (document.body && document.body.dataset.base) || "";

  function resolveMediaUrl(value) {
    const url = String(value || "").trim();
    if (/^(?:https?:|data:|blob:)/i.test(url)) return url;
    return BASE + url;
  }

  function resolveDownloadUrl(value) {
    const resolved = resolveMediaUrl(value);
    if (!/^https?:\/\//i.test(resolved)) return resolved;
    return `${API_CONFIG.baseUrl}/download?url=${encodeURIComponent(resolved)}`;
  }

  function triggerBlobDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function downloadWithProgress(button, status) {
    const primaryUrl = button.dataset.downloadUrl;
    const backupUrl = button.dataset.backupDownloadUrl;
    const downloadName = button.dataset.downloadName || "dsacms-download";

    function runDownload(targetUrl, isBackup = false) {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("GET", targetUrl, true);
        xhr.responseType = "blob";
        button.disabled = true;
        status.hidden = false;
        status.textContent = isBackup ? "جارٍ التحميل من الأرشيف الاحتياطي…" : "جارٍ تجهيز التحميل…";
        xhr.addEventListener("progress", (event) => {
          if (event.lengthComputable && event.total > 0) {
            const percent = Math.min(100, Math.round((event.loaded / event.total) * 100));
            status.textContent = `جاري التحميل: ${percent}%`;
            status.style.setProperty("--download-progress", `${percent}%`);
          } else {
            status.textContent = "جاري التحميل… حجم الملف غير متاح من الخادم";
            status.style.removeProperty("--download-progress");
          }
        });
        xhr.addEventListener("load", () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            triggerBlobDownload(xhr.response, downloadName);
            status.textContent = "اكتمل التحميل.";
            status.style.setProperty("--download-progress", "100%");
            resolve();
          } else {
            reject(new Error(`Download failed: ${xhr.status}`));
          }
        });
        xhr.addEventListener("error", () => reject(new Error("Download connection failed")));
        xhr.addEventListener("abort", () => reject(new Error("Download aborted")));
        xhr.send();
      });
    }

    return runDownload(primaryUrl)
      .catch((error) => {
        if (backupUrl && backupUrl !== primaryUrl) {
          console.warn("[Download Failover] فشل التحميل من الرابط الأساسي؛ الانتقال التلقائي للرابط الاحتياطي:", backupUrl);
          return runDownload(backupUrl, true);
        }
        throw error;
      })
      .catch((error) => {
        console.error("Unable to download file", error);
        status.textContent = "تعذر التحميل. حاول مرة أخرى.";
        status.style.removeProperty("--download-progress");
        throw error;
      })
      .finally(() => {
        button.disabled = false;
      });
  }

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

  /** مكتبة أيقونات SVG الاحترافية بدلاً من الإيموجي */
  const ICONS = {
    play: '<svg class="svg-icon svg-icon--play" viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><polygon points="6 3 20 12 6 21 6 3"/></svg>',
    pause: '<svg class="svg-icon svg-icon--pause" viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>',
    volume: '<svg class="svg-icon svg-icon--volume" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>',
    mute: '<svg class="svg-icon svg-icon--mute" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>',
    noAudio: '<svg class="svg-icon svg-icon--no-audio" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>',
    mosque: '<svg class="svg-icon svg-icon--mosque" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v3"/><path d="M12 5a4 4 0 0 0-4 4v12h8V9a4 4 0 0 0-4-4Z"/><path d="M4 11v10h16V11"/><path d="M9 21v-4a3 3 0 0 1 6 0v4"/></svg>',
    location: '<svg class="svg-icon svg-icon--location" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-6-5.333-6-10a6 6 0 0 1 12 0c0 4.667-6 10-6 10z"/><circle cx="12" cy="11" r="2.5"/></svg>',
    clock: '<svg class="svg-icon svg-icon--clock" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    calendar: '<svg class="svg-icon svg-icon--calendar" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    author: '<svg class="svg-icon svg-icon--author" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    category: '<svg class="svg-icon svg-icon--category" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>',
    document: '<svg class="svg-icon svg-icon--document" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
    book: '<svg class="svg-icon svg-icon--book" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
    quran: '<svg class="svg-icon svg-icon--quran" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>',
    check: '<svg class="svg-icon svg-icon--check" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    eye: '<svg class="svg-icon svg-icon--eye" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>',
    eyeOff: '<svg class="svg-icon svg-icon--eye-off" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/></svg>'
  };

  function getCategorySVG(nameOrId) {
    const key = String(nameOrId || "").toLowerCase();
    if (key.includes("fiqh") || key.includes("فقه")) return ICONS.mosque;
    if (key.includes("tafsir") || key.includes("تفسير") || key.includes("قرآن")) return ICONS.quran;
    if (key.includes("hadith") || key.includes("حديث") || key.includes("سنة")) return ICONS.book;
    if (key.includes("aqeedah") || key.includes("عقيدة") || key.includes("توحيد")) {
      return '<svg class="svg-icon svg-icon--aqeedah" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';
    }
    if (key.includes("seerah") || key.includes("سيرة")) {
      return '<svg class="svg-icon svg-icon--seerah" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 0 1-4.4 2.26 5.403 5.403 0 0 1-3.14-9.8c-.44-.06-.9-.1-1.36-.1z"/></svg>';
    }
    if (key.includes("language") || key.includes("لغة") || key.includes("نحو")) {
      return '<svg class="svg-icon svg-icon--pen" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>';
    }
    if (key.includes("history") || key.includes("تاريخ")) {
      return '<svg class="svg-icon svg-icon--scroll" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h12a2 2 0 0 0 2-2v-2H10v2a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v3h4"/><path d="M19 17V5a2 2 0 0 0-2-2H4"/></svg>';
    }
    return ICONS.book;
  }

  const lecturePrayers = ["الفجر", "الظهر", "العصر", "المغرب", "العشاء"];
  function lecturePrayerLabel(value) {
    const prayer = lecturePrayers.find((name) => String(value || "").includes(name));
    return prayer ? `بعد صلاة ${prayer}` : "بعد الصلاة";
  }
  function lecturePrayerRank(value) {
    const index = lecturePrayers.findIndex((name) => String(value || "").includes(name));
    return index < 0 ? 5 : index;
  }

  /** تنسيق المدة بالثواني إلى نص mm:ss أو h:mm:ss */
  function formatDuration(totalSeconds) {
    const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    if (s <= 0) return "";
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

  const SITE_ORIGIN = "https://www.mohamedalahadi.com";

  function setMetaContent(selector, attribute, value) {
    let element = $(selector);
    if (!element) {
      element = document.createElement("meta");
      document.head.appendChild(element);
    }
    element.setAttribute(attribute, value);
    return element;
  }

  function setCanonicalUrl(url) {
    let canonical = $('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.setAttribute("rel", "canonical");
      document.head.appendChild(canonical);
    }
    canonical.setAttribute("href", url);
  }

  function setJsonLd(id, data) {
    const script = document.getElementById(id);
    if (script) script.textContent = JSON.stringify(data);
  }

  /** إضافة إعدادات رأس الصفحة للمواد المعروضة (SEO-002 / SEO-003) */
  function setPageMeta(title, description) {
    document.title = title;
    setMetaContent('meta[name="description"]', "content", description);
    setMetaContent('meta[property="og:title"]', "content", title);
    setMetaContent('meta[property="og:description"]', "content", description);
    setMetaContent('meta[name="twitter:title"]', "content", title);
    setMetaContent('meta[name="twitter:description"]', "content", description);
  }

  function contentMetaDescription(content) {
    const lead = String(content.description || "").replace(/\s+/g, " ").trim();
    const suffix = " من المكتبة العلمية للشيخ محمد أحمد الهادي الكرار. استمع إلى الدروس الصوتية وتصفح المواد الشرعية.";
    let description = `${lead}${suffix}`.trim();
    if (description.length < 140) {
      description += " تصفح المزيد من الدروس والكتب والمقالات العلمية.";
    }
    if (description.length > 160) {
      description = `${description.slice(0, 157).replace(/\s+\S*$/, "").trim()}…`;
    }
    return description;
  }

  function setContentStructuredData(content, canonicalUrl, category) {
    const graph = [
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "الرئيسية", item: `${SITE_ORIGIN}/` },
          { "@type": "ListItem", position: 2, name: "المكتبة العلمية", item: `${SITE_ORIGIN}/pages/search.html` },
          ...(category ? [{
            "@type": "ListItem",
            position: 3,
            name: category.name,
            item: `${SITE_ORIGIN}/pages/search.html?category=${encodeURIComponent(category.id)}`,
          }] : []),
          { "@type": "ListItem", position: category ? 4 : 3, name: content.title, item: canonicalUrl },
        ],
      },
    ];
    const published = content.pubDate && !Number.isNaN(new Date(content.pubDate).getTime())
      ? new Date(content.pubDate).toISOString()
      : undefined;
    const author = content.author && content.author !== "غير محدد"
      ? { "@type": "Person", name: content.author }
      : undefined;

    if (content.type === "book") {
      graph.push({
        "@type": "Book",
        name: content.title,
        description: content.description,
        url: canonicalUrl,
        inLanguage: "ar",
        ...(author ? { author } : {}),
        ...(published ? { datePublished: published } : {}),
        ...(content.pdf ? { bookFormat: "https://schema.org/EBook", encodingFormat: "application/pdf" } : {}),
      });
    } else if (content.type === "article") {
      graph.push({
        "@type": "Article",
        headline: content.title,
        description: content.description,
        url: canonicalUrl,
        inLanguage: "ar",
        ...(author ? { author } : {}),
        ...(published ? { datePublished: published } : {}),
        ...(category ? { articleSection: category.name } : {}),
      });
    }

    if (content.audio) {
      const duration = Number(content.duration) || 0;
      const minutes = Math.floor(duration / 60);
      const seconds = duration % 60;
      graph.push({
        "@type": "AudioObject",
        name: content.title,
        description: content.description,
        contentUrl: new URL(resolveContentUrl(content.audio), window.location.href).toString(),
        url: canonicalUrl,
        inLanguage: "ar",
        ...(duration ? { duration: `PT${minutes}M${seconds}S` } : {}),
        ...(published ? { uploadDate: published } : {}),
      });
    }

    setJsonLd("content-structured-data", { "@context": "https://schema.org", "@graph": graph });
  }

  /** تقييد تنفيذ دالة حتى تتوقف الكتابة (للبحث المباشر) */
  function debounce(fn, wait) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  async function copyTextToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const helper = document.createElement("textarea");
    helper.value = text;
    helper.setAttribute("readonly", "");
    helper.style.position = "fixed";
    helper.style.opacity = "0";
    document.body.appendChild(helper);
    helper.select();
    const copied = document.execCommand("copy");
    helper.remove();
    if (!copied) throw new Error("Clipboard copy was rejected");
  }

  /* ----------------------------------------------------------------------
     1) مصدر البيانات (REST API)
     ---------------------------------------------------------------------- */
  const API_CONFIG = {
    baseUrl: (() => {
      if (typeof window !== "undefined") {
        if (window.DSACMS_API_BASE) return window.DSACMS_API_BASE;
        try {
          const stored = localStorage.getItem("dsacms_api_base");
          if (stored) {
            if (stored.includes("onrender.com") || stored.includes("localhost")) {
              localStorage.removeItem("dsacms_api_base");
            } else {
              return stored;
            }
          }
        } catch (_) {}
      }
      return "https://dsacms-backend.vercel.app/api";
    })().replace(/\/$/, ""),
  };
  let apiCategories = [];
  let apiContents = [];
  let apiUsers = [];
  /** مفاتيح التخزين الدائم المحلي */
  const STORE = {
    contents: "dsacms_contents",
    categories: "dsacms_categories",
    users: "dsacms_users",
    session: "dsacms_session",
    audit: "dsacms_audit",
    contentSettings: "dsacms_content_reading_settings",
    readingPreferences: "dsacms_reading_preferences",
    contentDates: "dsacms_content_dates",
  };

  const DEFAULT_READING_SETTINGS = { fontSize: 1.125, lineHeight: 2 };
  const READING_FONT_SIZES = [1, 1.125, 1.25, 1.5, 1.75];
  const READING_LINE_HEIGHTS = [1.7, 2, 2.4, 2.8, 3.2];

  function normalizeReadingSettings(settings) {
    const source = settings || {};
    const fontSize = Number(source.fontSize);
    const lineHeight = Number(source.lineHeight);
    return {
      fontSize: READING_FONT_SIZES.includes(fontSize) ? fontSize : DEFAULT_READING_SETTINGS.fontSize,
      lineHeight: READING_LINE_HEIGHTS.includes(lineHeight) ? lineHeight : DEFAULT_READING_SETTINGS.lineHeight,
    };
  }

  function loadContentSettings() {
    const settings = store.read(STORE.contentSettings, {});
    return settings && typeof settings === "object" ? settings : {};
  }

  function saveContentSettings(id, settings) {
    const all = loadContentSettings();
    all[id] = normalizeReadingSettings(settings);
    store.write(STORE.contentSettings, all);
  }

  function loadContentDates() {
    const dates = store.read(STORE.contentDates, {});
    return dates && typeof dates === "object" ? dates : {};
  }

  function saveContentDate(id, date) {
    if (!id || !date) return;
    const all = loadContentDates();
    all[String(id)] = String(date).slice(0, 10);
    store.write(STORE.contentDates, all);
  }

  function removeContentDate(id) {
    if (!id) return;
    const all = loadContentDates();
    delete all[String(id)];
    store.write(STORE.contentDates, all);
  }

  function loadReadingPreferences() {
    const settings = store.read(STORE.readingPreferences, {});
    return settings && typeof settings === "object" ? settings : {};
  }

  function saveReadingPreference(id, settings) {
    const all = loadReadingPreferences();
    all[id] = normalizeReadingSettings(settings);
    store.write(STORE.readingPreferences, all);
  }

  function removeReadingPreference(id) {
    const all = loadReadingPreferences();
    delete all[id];
    store.write(STORE.readingPreferences, all);
  }

  /** التصنيفات الافتراضية (FR-015) */
  const DEFAULT_CATEGORIES = [];

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

  /** المحتوى العام: المواد المنشورة فقط واستبعاد المواد غير الصالحة أو أحادية الحرف */
  function publicContents() {
    return loadContents().filter((c) => c.status === "published" && String(c.title || "").trim().length >= 2);
  }

  function normalizeCategory(row) {
    if (!row) return null;
    return {
      id: String(row.id),
      name: row.name,
      desc: row.description || "",
      icon: getCategorySVG((row.id || "") + " " + (row.name || "")),
    };
  }

  function normalizeContentType(value, { audio, pdf, body } = {}) {
    const type = String(value || "").trim().toLowerCase();
    if (["book", "pdf", "ebook", "كتاب"].includes(type)) return "book";
    if (["article", "text", "written", "نص", "مقال"].includes(type)) return "article";
    if (["audio", "sound", "صوت", "مادة صوتية"].includes(type)) return "audio";
    if (pdf) return "book";
    if (body?.length) return "article";
    return audio ? "audio" : "article";
  }

  function normalizeMaterial(row) {
    if (!row) return null;
    const audio = row.audio_url || row.audioUrl || null;
    const pdf = row.document_url || row.documentUrl || null;
    const archiveUrl = row.archive_url || row.archiveUrl || null;
    const storageKey = row.storage_key || row.storageKey || null;
    const archiveStatus = row.archive_status || row.archiveStatus || "UPLOADED_TO_R2";
    const body = Array.isArray(row.body) ? row.body : [];
    const materialId = String(row.id != null ? row.id : "");
    const localDates = loadContentDates();
    const candidateDate =
      localDates[materialId] ||
      row.pubDate ||
      row.published_at ||
      row.publishedAt ||
      row.pub_date ||
      row.date ||
      row.created_at ||
      new Date().toISOString();

    return {
      id: materialId,
      title: row.title,
      description: row.description || "",
      author: row.author || "غير محدد",
      category: row.category_id ? String(row.category_id) : "",
      categoryName: row.category_name || "عام",
      keywords: Array.isArray(row.keywords) ? row.keywords : [],
      body,
      readingSettings: normalizeReadingSettings(row.reading_settings || row.readingSettings),
      pubDate: candidateDate,
      duration: Number(row.duration_seconds) || 0,
      audio,
      pdf,
      archiveUrl,
      storageKey,
      archiveStatus,
      audioArchive: (audio && archiveUrl && (archiveUrl.endsWith(".mp3") || archiveUrl.includes("/audio") || !pdf)) ? archiveUrl : archiveUrl,
      pdfArchive: (pdf && archiveUrl && (archiveUrl.endsWith(".pdf") || archiveUrl.includes(".pdf") || !audio)) ? archiveUrl : archiveUrl,
      type: normalizeContentType(row.content_type || row.contentType || row.type, { audio, pdf, body }),
      status: row.status || "published",
    };
  }

  async function fetchApi(path, options) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);
    const session = store.read(STORE.session, null);
    const headers = new Headers((options && options.headers) || {});
    if (session?.token) headers.set("Authorization", `Bearer ${session.token}`);
    const requestOptions = { ...(options || {}), headers, signal: controller.signal };
    let response;
    try {
      response = await fetch(`${API_CONFIG.baseUrl}${path}`, requestOptions);
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) {
      let detail = "";
      try {
        const payload = await response.json();
        detail = payload.error ? `: ${payload.error}` : "";
      } catch (_) {
        try {
          const text = await response.text();
          detail = text ? `: ${text.slice(0, 180)}` : "";
        } catch (readError) {
          console.warn("Unable to read API error response", readError);
        }
      }
      const error = new Error(`API request failed: ${response.status}${detail}`);
      error.status = response.status;
      error.detail = detail.replace(/^:\s*/, "");
      error.path = path;
      console.error("DSACMS API request failed", {
        path,
        method: requestOptions.method || "GET",
        status: response.status,
        detail,
      });
      throw error;
    }
    if (response.status === 204) return null;
    return response.json();
  }

  async function loadRemoteData() {
    const results = await Promise.allSettled([
      fetchApi("/categories"),
      fetchApi("/materials"),
    ]);
    if (results[0].status === "fulfilled") {
      apiCategories = results[0].value.map(normalizeCategory);
    }

    if (results[1].status === "fulfilled") {
      apiContents = results[1].value.map(normalizeMaterial);
    }
    if (results.every((result) => result.status === "rejected")) {
      console.warn("DSACMS API unavailable; continuing with locally available data.");
      return false;
    }
    return true;
  }

  async function loadRemoteUsers() {
    const users = await fetchApi("/auth/users");
    if (Array.isArray(users)) {
      apiUsers = users.map((user) => ({
        ...user,
        id: String(user.id),
        status: user.status || "active",
        passHash: "",
      }));
      saveUsers(apiUsers);
    }
  }

  function loadUsers() {
    if (apiUsers.length) return apiUsers;
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
    apiUsers = Array.isArray(list) ? list : [];
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
    site_admin: { label: "مدير الموقع", home: "pages/dashboard.html" },
    manager: { label: "مدير المحتوى", home: "pages/dashboard.html" },
    SHEIKH: { label: "الشيخ", home: "pages/dashboard.html" },
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
      token: user.token || null,
    });
  }
  function clearSession() {
    store.remove(STORE.session);
  }
  function performLogout() {
    const session = getSession();
    if (session) {
      logAudit("LOGOUT", session.username, "OK");
    }
    clearSession();
    showToast("تم تسجيل الخروج بنجاح.", "info");
    setTimeout(() => {
      window.location.href = BASE + "index.html";
    }, 250);
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
    if (!/[0-9\u0660-\u0669\u06f0-\u06f9]/.test(pw)) return "كلمة المرور يجب أن تحتوي على رقم واحد على الأقل.";
    if (!/[A-Z\u0621-\u064a]/.test(pw)) return "كلمة المرور يجب أن تحتوي على حرف كبير أو حرف عربي على الأقل.";
    return null;
  }

  function passwordChangeErrorMessage(error) {
    if (error?.name === "AbortError") return "انتهت مهلة الاتصال. تحقق من الشبكة ثم حاول مرة أخرى.";
    if (error?.status === 401) {
      return String(error.detail || "").includes("كلمة المرور الحالية")
        ? "كلمة المرور الحالية غير صحيحة. تحقق منها وحاول مرة أخرى."
        : "انتهت الجلسة. سجّل الدخول من جديد ثم غيّر كلمة المرور.";
    }
    if (error?.status === 400) return error.detail || "كلمة المرور الجديدة لا تحقق الشروط المطلوبة.";
    if (error?.status >= 500) return "تعذر تحديث كلمة المرور على الخادم الآن. حاول بعد قليل.";
    return "تعذر تغيير كلمة المرور. تحقق من اتصالك وحاول مرة أخرى.";
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
    activeSources: [],  // [primaryUrl, backupUrl]
    activeSourceIndex: 0,
    volume: 0.9,
    isMuted: false,
    rate: 1,
    _failoverInProgress: false,

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
      a.preload = "none";

      a.addEventListener("loadedmetadata", () => {
        this._notify("onMeta", a.duration);
      });
      a.addEventListener("timeupdate", () => {
        this._notify("onTime", a.currentTime, a.duration);
      });
      a.addEventListener("play", () => {
        this._failoverInProgress = false;
        this._notify("onPlay");
      });
      a.addEventListener("playing", () => {
        this._failoverInProgress = false;
        this._notify("onPlay");
      });
      a.addEventListener("loadstart", () => {
        if (a.paused || a.currentTime === 0) {
          this._notify("onLoading");
        }
      });
      a.addEventListener("waiting", () => this._notify("onBuffering"));
      a.addEventListener("stalled", () => this._notify("onBuffering"));
      a.addEventListener("canplay", () => {
        if (!a.paused) this._notify("onPlay");
        else this._notify("onReady");
      });
      a.addEventListener("canplaythrough", () => {
        if (!a.paused) this._notify("onPlay");
      });
      a.addEventListener("pause", () => {
        if (!this._failoverInProgress) this._notify("onPause");
      });
      a.addEventListener("ended", () => this._notify("onEnd"));
      a.addEventListener("error", () => {
        this._handleFailoverOrError();
      });
      a.volume = this.volume;
      a.loop = false;
    },

    _notify(name, ...args) {
      const cb = this.widgets[this.activeId];
      if (cb && typeof cb[name] === "function") cb[name](...args);
    },

    _handleFailoverOrError() {
      if (this.activeSourceIndex < this.activeSources.length - 1) {
        const previousSrc = this.activeSources[this.activeSourceIndex];
        this.activeSourceIndex++;
        const nextSrc = this.activeSources[this.activeSourceIndex];
        console.warn(`[AudioPlayer Failover] فشل المصدر الأساسي (${previousSrc})، يجري التبديل التلقائي إلى المصدر الاحتياطي (${nextSrc}) دون مقاطعة المستخدم.`);
        this._failoverInProgress = true;
        this._notify("onBuffering");
        try {
          showToast("تم الانتقال تلقائياً إلى خادم البث الاحتياطي لضمان استمرار الاستماع.", "info");
        } catch (_) {}
        const a = this.audio;
        const savedTime = a.currentTime || 0;
        a.setAttribute("data-src", nextSrc);
        a.src = nextSrc;
        a.load();
        if (savedTime > 0) {
          const restoreTime = () => {
            try { a.currentTime = savedTime; } catch (_) {}
            a.removeEventListener("loadedmetadata", restoreTime);
          };
          a.addEventListener("loadedmetadata", restoreTime, { once: true });
        }
        const p = a.play();
        if (p && p.catch) {
          p.catch(() => this._handleFailoverOrError());
        }
        return;
      }
      this._failoverInProgress = false;
      this._notify("onError");
    },

    /** بدء تشغيل مصدر معيّن من واجهة معيّنة مع دعم المصدر الاحتياطي Failover */
    play(id, src, backupSrc = null) {
      if (this.activeId && this.activeId !== id && this.widgets[this.activeId]) {
        this.widgets[this.activeId].onPause();
      }
      this.activeId = id;
      this.activeSources = [src, backupSrc].filter((s, idx, arr) => s && (!idx || s !== arr[0]));
      this.activeSourceIndex = 0;
      this._failoverInProgress = false;

      const a = this.audio;
      a.pause();
      const currentSrc = this.activeSources[0];
      const sameSource = a.getAttribute("data-src") === currentSrc;
      this._notify("onLoading");
      if (!sameSource) {
        a.setAttribute("data-src", currentSrc);
        a.src = currentSrc;
        a.load();
      } else if (a.error || a.networkState === 3) {
        a.load();
      }
      a.volume = this.isMuted ? 0 : this.volume;
      a.playbackRate = this.rate;
      const p = a.play();
      if (p && p.catch) {
        p.catch(() => this._handleFailoverOrError());
      }
    },

    pause() {
      this._failoverInProgress = false;
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
    toggle(id, src, backupSrc = null) {
      if (this.activeId === id && !this.audio.paused) {
        this.pause();
        return;
      }
      this.play(id, src, backupSrc);
    },
  };

  /** بناء أزرار المشغّل المصغّر داخل البطاقات */
  function renderMiniPlayer(btn, content) {
    if (!content.audio) {
      btn.setAttribute("aria-disabled", "true");
      btn.classList.add("is-disabled");
      btn.title = "لا يوجد ملف صوتي مرتبط";
      btn.innerHTML = `<span class="icon" aria-hidden="true">${ICONS.noAudio}</span> لا يتوفر صوت`;
      return;
    }
    const id = "mini-" + content.id;
    const src = resolveMediaUrl(content.audio);
    const backupSrc = (content.audioArchive || content.archiveUrl) && (content.audioArchive || content.archiveUrl) !== content.audio
      ? resolveMediaUrl(content.audioArchive || content.archiveUrl)
      : null;
    btn.setAttribute("aria-pressed", "false");
    btn.innerHTML = `<span class="icon" aria-hidden="true">${ICONS.play}</span><span data-label>تشغيل</span>`;

    const setLabel = (playing) => {
      btn.setAttribute("aria-pressed", String(playing));
      btn.classList.toggle("is-playing", playing);
      btn.classList.remove("is-buffering");
      const icon = btn.querySelector(".icon");
      if (icon) icon.innerHTML = playing ? ICONS.pause : ICONS.play;
      const l = btn.querySelector("[data-label]");
      if (l) l.textContent = playing ? "إيقاف" : "تشغيل";
    };

    AudioPlayer.register(id, {
      onPlay: () => setLabel(true),
      onPause: () => setLabel(false),
      onLoading: () => {
        if (AudioPlayer.activeId === id && (!AudioPlayer.audio || AudioPlayer.audio.paused || AudioPlayer.audio.currentTime === 0)) {
          btn.classList.add("is-buffering");
          const l = btn.querySelector("[data-label]");
          if (l) l.textContent = "جارٍ التحميل…";
        } else if (AudioPlayer.activeId === id && AudioPlayer.audio && !AudioPlayer.audio.paused) {
          setLabel(true);
        }
      },
      onBuffering: () => {
        if (AudioPlayer.activeId === id) btn.classList.add("is-buffering");
      },
      onReady: () => {
        btn.classList.remove("is-buffering");
        if (AudioPlayer.activeId === id && AudioPlayer.audio) {
          setLabel(!AudioPlayer.audio.paused);
        }
      },
      onTime: () => {
        if (AudioPlayer.activeId === id && AudioPlayer.audio && !AudioPlayer.audio.paused) {
          btn.classList.remove("is-buffering");
          const l = btn.querySelector("[data-label]");
          if (l && l.textContent !== "إيقاف") setLabel(true);
        }
      },
      onError: () => setLabel(false),
      onEnd: () => setLabel(false),
    });

    btn.addEventListener("click", () => {
      if (AudioPlayer.activeId === id && !AudioPlayer.audio.paused) {
        AudioPlayer.pause();
        setLabel(false);
      } else {
        AudioPlayer.play(id, src, backupSrc);
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
            <span class="icon" aria-hidden="true">${ICONS.play}</span>
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
                <span class="icon" aria-hidden="true">${ICONS.volume}</span>
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
    const backupSrc = config.backupSrc && config.backupSrc !== config.src
      ? resolveContentUrl(config.backupSrc)
      : null;

    AudioPlayer.register(id, {
      onPlay() {
        toggleBtn.setAttribute("aria-pressed", "true");
        toggleBtn.querySelector(".icon").innerHTML = ICONS.pause;
        status.textContent = "يعمل الآن";
        status.classList.remove("player__error");
      },
      onLoading() {
        status.textContent = "جارٍ تحميل الصوت…";
        status.classList.remove("player__error");
      },
      onBuffering() {
        status.textContent = "الاتصال بطيء؛ جارٍ استكمال تحميل الصوت…";
      },
      onReady() {
        if (AudioPlayer.audio.paused) status.textContent = "الصوت جاهز. اضغط تشغيل.";
      },
      onPause() {
        toggleBtn.setAttribute("aria-pressed", "false");
        toggleBtn.querySelector(".icon").innerHTML = ICONS.play;
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
        toggleBtn.querySelector(".icon").innerHTML = ICONS.play;
        seek.value = "0";
        curEl.textContent = "0:00";
        status.textContent = "انتهى الملف";
      },
      onError() {
        toggleBtn.setAttribute("aria-pressed", "false");
        toggleBtn.querySelector(".icon").innerHTML = ICONS.play;
        const mediaError = AudioPlayer.audio.error;
        status.textContent = mediaError?.code === 4
          ? "صيغة الصوت غير مدعومة أو أن الرابط لا يشير إلى ملف صوت مباشر."
          : "تعذّر تحميل الصوت. تحقق من اتصالك ثم حاول مجدداً.";
        status.classList.add("player__error");
      },
    });

    toggleBtn.addEventListener("click", () => {
      if (AudioPlayer.activeId === id && !AudioPlayer.audio.paused) {
        AudioPlayer.pause();
      } else {
        AudioPlayer.play(id, src, backupSrc);
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
      muteBtn.querySelector(".icon").innerHTML =
        Number(volEl.value) === 0 || AudioPlayer.isMuted ? ICONS.mute : ICONS.volume;
    });

    // كتم
    muteBtn.addEventListener("click", () => {
      const muted = AudioPlayer.toggleMute();
      muteBtn.setAttribute("aria-pressed", String(muted));
      muteBtn.querySelector(".icon").innerHTML = muted ? ICONS.mute : ICONS.volume;
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
    // جميع مشغلات الصفحة، بما فيها عناصر audio الأصلية، تتناوب على التشغيل.
    document.addEventListener("play", (event) => {
      const playing = event.target;
      if (!(playing instanceof HTMLMediaElement)) return;
      $$('audio').forEach((audio) => {
        if (audio !== playing) audio.pause();
      });
      if (playing !== AudioPlayer.audio) AudioPlayer.pause();
    }, true);

    // إزالة أية عناصر تحكم تنقل قديمة
    const oldScrollControls = $(".scroll-controls");
    if (oldScrollControls) oldScrollControls.remove();

    // زر العودة إلى الأعلى الدائري العائم (44×44px) - يظهر فقط بعد التمرير > 400px
    let backToTopBtn = document.getElementById("back-to-top");
    if (!backToTopBtn) {
      backToTopBtn = document.createElement("button");
      backToTopBtn.type = "button";
      backToTopBtn.id = "back-to-top";
      backToTopBtn.className = "back-to-top";
      backToTopBtn.setAttribute("aria-label", "الرجوع إلى أعلى الصفحة");
      backToTopBtn.title = "الرجوع إلى أعلى الصفحة";
      backToTopBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="18 15 12 9 6 15"/>
        </svg>
      `;
      document.body.appendChild(backToTopBtn);
    }
    const updateBackToTop = () => {
      if (window.scrollY > 400) {
        backToTopBtn.classList.add("is-visible");
      } else {
        backToTopBtn.classList.remove("is-visible");
      }
    };
    backToTopBtn.addEventListener("click", () => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    window.addEventListener("scroll", updateBackToTop, { passive: true });
    updateBackToTop();

   
    
    // القائمة الجانبية للتنقل
    const toggle = $(".nav-toggle");
    const nav = $("#site-nav");
    let closeButton = nav ? $(".nav-close", nav) : null;
    let overlay = $(".nav-overlay");

    if (nav && !closeButton) {
      closeButton = document.createElement("button");
      closeButton.className = "nav-close";
      closeButton.type = "button";
      closeButton.setAttribute("aria-label", "إغلاق قائمة التنقل");
      closeButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
      nav.insertBefore(closeButton, nav.firstChild);
    }

    if (!overlay && nav && nav.parentElement) {
      overlay = document.createElement("div");
      overlay.className = "nav-overlay";
      overlay.setAttribute("aria-hidden", "true");
      nav.parentElement.appendChild(overlay);
    }

    if (toggle && nav) {
      function setMenuOpen(open) {
        nav.classList.toggle("is-open", open);
        toggle.setAttribute("aria-expanded", String(open));
        toggle.setAttribute(
          "aria-label",
          open ? "إغلاق قائمة التنقل" : "فتح قائمة التنقل"
        );

        document.body.classList.toggle("nav-menu-open", open);

        if (overlay) {
          overlay.setAttribute("aria-hidden", String(!open));
        }

        if (open && closeButton) {
          closeButton.focus();
        } else if (!open) {
          toggle.focus();
        }
      }

      toggle.addEventListener("click", () => {
        const isOpen = nav.classList.contains("is-open");
        setMenuOpen(!isOpen);
      });

      if (closeButton) {
        closeButton.addEventListener("click", () => {
          setMenuOpen(false);
        });
      }

      if (overlay) {
        overlay.addEventListener("click", () => {
          setMenuOpen(false);
        });
      }

      // إغلاق القائمة بزر Escape
      document.addEventListener("keydown", (event) => {
        if (
          event.key === "Escape" &&
          nav.classList.contains("is-open")
        ) {
          setMenuOpen(false);
        }
      });

      // فتح وإغلاق القائمة الفرعية لتصفح المحتوى
      const dropdownToggle = $(".dropdown-toggle", nav);
      const dropdownMenu = $(".dropdown-menu", nav);

      if (dropdownToggle && dropdownMenu) {
        dropdownToggle.addEventListener("click", (event) => {
          event.preventDefault();

          const expanded =
            dropdownToggle.getAttribute("aria-expanded") === "true";

          dropdownToggle.setAttribute(
            "aria-expanded",
            String(!expanded)
          );

          dropdownMenu.style.display = expanded ? "none" : "block";
        });
      }

      // إغلاق القائمة الجانبية بعد اختيار رابط
      nav.addEventListener("click", (event) => {
        const link = event.target.closest("a");

        if (link && !link.classList.contains("dropdown-toggle")) {
          setMenuOpen(false);
        }
      });
    }

    // معالج موحد لأزرار تسجيل الخروج في كل الصفحات (FR-022)
    document.addEventListener("click", (event) => {
      const logoutTarget = event.target.closest('[data-action="logout"], .btn-logout');
      if (logoutTarget) {
        event.preventDefault();
        performLogout();
      }
    });

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
      const navUl = $(".site-nav ul");
      if (navUl && !navUl.querySelector('[data-action="logout"]')) {
        const li = document.createElement("li");
        const accountLink = document.createElement("a");
        accountLink.href = BASE + "pages/account.html";
        accountLink.textContent = "الحساب وكلمة المرور";
        li.appendChild(accountLink);
        const accountItem = document.createElement("li");
        const logoutBtn = document.createElement("button");
        logoutBtn.type = "button";
        logoutBtn.className = "btn btn--danger-outline btn--sm btn-logout";
        logoutBtn.dataset.action = "logout";
        logoutBtn.textContent = "تسجيل الخروج";
        logoutBtn.setAttribute("aria-label", "تسجيل الخروج من الجلسة الحالية");
        accountItem.appendChild(logoutBtn);
        navUl.append(li, accountItem);
      }
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

    loadUpcomingLectures();

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

  async function loadUpcomingLectures() {
    const container = $("#upcoming-lectures-list");
    if (!container) return;
    const lectureMoment = (lecture) => {
      const date = String(lecture.lecture_date || "").slice(0, 10);
      const dateParts = date.split("-").map(Number);
      if (dateParts.length !== 3 || dateParts.some((part) => !Number.isFinite(part))) return null;
      const dateTime = new Date(dateParts[0], dateParts[1] - 1, dateParts[2]);
      if (Number.isNaN(dateTime.getTime())) return null;
      // ترتيب تقريبي داخل اليوم بحسب الصلاة، دون عرض ساعة محددة.
      dateTime.setHours([5, 13, 16, 19, 21, 23][lecturePrayerRank(lecture.lecture_time)], 0, 0, 0);
      return dateTime;
    };
    const formatDate = (date) => new Intl.DateTimeFormat("ar-SD", {
      weekday: "long", day: "numeric", month: "long",
    }).format(date);
    try {
      const entries = await fetchApi("/lectures");
      const now = new Date();
      const upcoming = entries
        .map((lecture) => ({ lecture, moment: lectureMoment(lecture) }))
        .filter((item) => item.moment && item.moment >= now)
        .sort((a, b) => a.moment - b.moment)
        .slice(0, 3);
      container.innerHTML = upcoming.length ? upcoming.map(({ lecture, moment }) => `
        <article class="upcoming-lecture-card">
          <div class="upcoming-lecture-date">${escapeHTML(formatDate(moment))}</div>
          <h3>${escapeHTML(lecture.title)}</h3>
          <p class="upcoming-lecture-mosque">${ICONS.location} ${escapeHTML(lecture.mosque)}</p>
          <p class="upcoming-lecture-time">${ICONS.clock} ${escapeHTML(lecturePrayerLabel(lecture.lecture_time))}</p>
        </article>`).join("") : `<p class="section-desc upcoming-lectures-empty">لا توجد محاضرات قادمة معلنة حاليًا. <a href="pages/lectures.html">افتح جدول المحاضرات</a>.</p>`;
    } catch (error) {
      console.error("Unable to load upcoming lectures", error);
      container.innerHTML = `<p class="section-desc upcoming-lectures-empty">تعذر تحميل المواعيد الآن. <a href="pages/lectures.html">افتح جدول المحاضرات</a>.</p>`;
    } finally {
      container.setAttribute("aria-busy", "false");
    }
  }

  /** عنوان صفحة التفاصيل نسبياً إلى الصفحة الحالية (SEO-001)
      home → "pages/content-detail.html"  /  صفحات pages/* → "content-detail.html" */
  const detailHref = (id) =>
    (BASE === "../" ? "content-detail.html" : "pages/content-detail.html") +
    "?id=" +
    encodeURIComponent(id);

  const resolveContentUrl = resolveMediaUrl;

  /** بطاقة مادة علمية قابلة لإعادة الاستخدام */
  function contentCard(c) {
    const cat = loadCategories().find((x) => x.id === c.category);
    const formattedDur = (c.duration && Number(c.duration) > 0) ? formatDuration(c.duration) : "";
    const hasAudio = !!c.audio;
    const durationChip = formattedDur ? ` · ${formattedDur}` : (hasAudio ? ` · <span class="badge--audio-chip">ملف صوتي</span>` : "");
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
        <span class="duration">${typeLabel}${durationChip}</span>
      </div>
      <div class="item-body">
        <h3><a href="${detailHref(c.id)}">${escapeHTML(c.title)}</a></h3>
        <ul class="item-meta">
          <li>${ICONS.author} ${escapeHTML(c.author)}</li>
          <li>${ICONS.category} ${cat ? escapeHTML(cat.name) : "عام"}</li>
          <li>${ICONS.calendar} ${formatDate(c.pubDate)}</li>
        </ul>
        <p class="item-excerpt">${escapeHTML(c.description)}</p>
        <div class="item-actions">
          <a class="btn btn--outline btn--sm" href="${detailHref(c.id)}">تفاصيل المادة</a>
          ${downloadPath
            ? `<a class="btn btn--accent btn--sm card-download" href="${escapeHTML(resolveDownloadUrl(downloadPath))}" download>${downloadLabel}</a>`
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
      form.addEventListener("submit", async (e) => {
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
  async function initDetail() {
    const wrap = $("#detail-wrap");
    const notFound = $("#not-found");
    if (!wrap || !notFound) return;

    // جلب المعرّف من الرابط (SEO-001: رابط مستقل لكل مادة)
    const params = new URLSearchParams(window.location.search);
    const id = params.get("id") || "";
    let content = loadContents().find((c) => String(c.id) === String(id) || String(c.slug || "") === String(id));

    if (!content && id) {
      await loadRemoteData();
      content = loadContents().find((c) => String(c.id) === String(id) || String(c.slug || "") === String(id));
    }

    if (!content && id) {
      try {
        const rawMaterials = await fetchApi("/materials");
        if (Array.isArray(rawMaterials)) {
          apiContents = rawMaterials.map(normalizeMaterial).filter(Boolean);
          content = loadContents().find((c) => String(c.id) === String(id) || String(c.slug || "") === String(id));
        }
      } catch (err) {
        console.error("Direct fetch failed for material", id, err);
      }
    }

    if (!loadCategories().length) {
      try {
        const rawCats = await fetchApi("/categories");
        if (Array.isArray(rawCats)) {
          apiCategories = rawCats.map(normalizeCategory).filter(Boolean);
        }
      } catch (_) {}
    }

    if (!content) {
      notFound.hidden = false;
      wrap.style.display = "none";
      setPageMeta("مادة غير متوفرة | مكتبة الشيخ محمد أحمد الهادي الكرار", "لم يتم العثور على المادة المطلوبة في المكتبة العلمية للشيخ محمد أحمد الهادي الكرار.");
      setMetaContent('meta[name="robots"]', "content", "noindex, follow");
      setCanonicalUrl(`${SITE_ORIGIN}${window.location.pathname}`);
      setMetaContent('meta[property="og:url"]', "content", `${SITE_ORIGIN}${window.location.pathname}`);
      setJsonLd("content-structured-data", { "@context": "https://schema.org", "@graph": [] });
      return;
    }

    notFound.hidden = true;
    wrap.style.display = "";

    const cat = loadCategories().find((x) => String(x.id) === String(content.category || content.category_id));

    // تحديث عنوان الصفحة وبيانات SEO + Open Graph (SEo-002/003 + مشاركة)
    const pageTitle = `${content.title} | الشيخ محمد أحمد الهادي الكرار`;
    const pageDescription = contentMetaDescription(content);
    const canonicalUrl = new URL(window.location.pathname, SITE_ORIGIN);
    canonicalUrl.searchParams.set("id", content.id);
    const canonicalHref = canonicalUrl.toString();
    setPageMeta(pageTitle, pageDescription);
    setCanonicalUrl(canonicalHref);
    setMetaContent('meta[property="og:url"]', "content", canonicalHref);
    setMetaContent('meta[property="og:type"]', "content", "article");
    setContentStructuredData(content, canonicalHref, cat);

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
    if (readingSection && (content.type === "article" || content.type === "book" || content.body?.length || content.pdf)) {
      readingSection.hidden = false;
      readingSection.classList.toggle("reading-section--article", content.type === "article");
      $("#reading-title").textContent = content.type === "book" ? "قراءة الكتاب" : "نص المادة";
      const adminSettings = normalizeReadingSettings(
        loadContentSettings()[content.id] || content.readingSettings
      );
      const savedPreference = loadReadingPreferences()[content.id];
      let readingSettings = savedPreference
        ? normalizeReadingSettings(savedPreference)
        : adminSettings;
      const applyReadingSettings = () => {
        if (articleBody) {
          articleBody.style.setProperty("--reading-font-size", `${readingSettings.fontSize}rem`);
          articleBody.style.setProperty("--reading-line-height", String(readingSettings.lineHeight));
        }
        const lineHeightSelect = $("#reading-line-height");
        if (lineHeightSelect) lineHeightSelect.value = String(readingSettings.lineHeight);
      };
      const readingControls = $$(".reading-control-btn", readingSection);
      readingControls.forEach((button) => {
        button.addEventListener("click", () => {
          const action = button.dataset.readingAction;
          if (action === "increase") {
            const next = READING_FONT_SIZES.find((size) => size > readingSettings.fontSize);
            if (next) readingSettings.fontSize = next;
          } else if (action === "decrease") {
            const previous = [...READING_FONT_SIZES].reverse().find((size) => size < readingSettings.fontSize);
            if (previous) readingSettings.fontSize = previous;
          } else if (action === "reset") {
            readingSettings = normalizeReadingSettings(adminSettings);
            removeReadingPreference(content.id);
          }
          saveReadingPreference(content.id, readingSettings);
          applyReadingSettings();
        });
      });
      const lineHeightSelect = $("#reading-line-height");
      if (lineHeightSelect) {
        lineHeightSelect.addEventListener("change", () => {
          readingSettings.lineHeight = Number(lineHeightSelect.value);
          readingSettings = normalizeReadingSettings(readingSettings);
          saveReadingPreference(content.id, readingSettings);
          applyReadingSettings();
        });
      }
      applyReadingSettings();
      if (content.body && content.body.length) {
        const paragraphs = content.body
          .flatMap((paragraph) => String(paragraph).split(/\r?\n+/))
          .map((paragraph) => paragraph.trim())
          .filter(Boolean);
        articleBody.innerHTML = paragraphs
          .map((paragraph) => `<p>${escapeHTML(paragraph)}</p>`)
          .join("");
      }
      if (content.pdf && pdfReader && pdfFrame) {
        pdfReader.hidden = false;
        pdfFrame.src = resolveContentUrl(content.pdf);
        const backupPdfUrl = (content.pdfArchive || content.archiveUrl) && (content.pdfArchive || content.archiveUrl) !== content.pdf
          ? resolveContentUrl(content.pdfArchive || content.archiveUrl)
          : null;
        if (backupPdfUrl) {
          pdfFrame.onerror = () => {
            console.warn("[PDF Failover] فشل تحميل الرابط الأساسي، جاري التبديل للأرشيف الاحتياطي:", backupPdfUrl);
            pdfFrame.src = backupPdfUrl;
          };
        }
      }

    }

    const copyButtons = $$("[data-copy-content]");
    copyButtons.forEach((copyButton) => {
      copyButton.addEventListener("click", async () => {
        const text = [
          content.title,
          `المؤلف: ${content.author}`,
          content.description,
          ...(content.body || []),
        ]
          .filter(Boolean)
          .join("\n\n");
        try {
          await copyTextToClipboard(text);
          showToast("تم نسخ محتوى المادة بالكامل.");
        } catch (error) {
          console.error("Unable to copy article content", error);
          showToast("تعذر نسخ المحتوى. حاول مرة أخرى.", "error");
        }
      });
    });

    const downloadsSection = $("#downloads-section");
    const downloadActions = $("#download-actions");
    if (downloadsSection && downloadActions) {
      const downloads = [];
      if (content.audio) {
        const backupAudio = (content.audioArchive || content.archiveUrl) && (content.audioArchive || content.archiveUrl) !== content.audio
          ? `data-backup-download-url="${escapeHTML(resolveDownloadUrl(content.audioArchive || content.archiveUrl))}"`
          : "";
        downloads.push(`
          <div class="download-item">
            <button type="button" class="btn btn--primary download-trigger"
              data-download-url="${escapeHTML(resolveDownloadUrl(content.audio))}"
              ${backupAudio}
              data-download-name="${escapeHTML(content.title)}.mp3">تحميل الملف الصوتي</button>
            <div class="download-progress" id="download-progress-audio" role="status" aria-live="polite" hidden></div>
          </div>`);
      }
      if (content.pdf) {
        const backupPdf = (content.pdfArchive || content.archiveUrl) && (content.pdfArchive || content.archiveUrl) !== content.pdf
          ? `data-backup-download-url="${escapeHTML(resolveDownloadUrl(content.pdfArchive || content.archiveUrl))}"`
          : "";
        downloads.push(`
          <div class="download-item">
            <button type="button" class="btn btn--accent download-trigger"
              data-download-url="${escapeHTML(resolveDownloadUrl(content.pdf))}"
              ${backupPdf}
              data-download-name="${escapeHTML(content.title)}.pdf">تحميل الكتاب PDF</button>
            <div class="download-progress" id="download-progress-pdf" role="status" aria-live="polite" hidden></div>
          </div>`);
      }
      downloadsSection.hidden = downloads.length === 0;
      downloadActions.innerHTML = downloads.join("");
      downloadActions.querySelectorAll(".download-trigger").forEach((button) => {
        const status = button.parentElement.querySelector(".download-progress");
        button.addEventListener("click", () => {
          downloadWithProgress(button, status).catch(() => {});
        });
      });
    }

    const metaList = $("#meta-list");
    metaList.innerHTML = `
      <li class="meta-chip">${ICONS.author} ${escapeHTML(content.author)}</li>
      <li class="meta-chip">${ICONS.category} ${cat ? escapeHTML(cat.name) : "عام"}</li>
      <li class="meta-chip">${ICONS.calendar} ${formatDate(content.pubDate)}</li>
      ${content.duration ? `<li class="meta-chip" dir="ltr">${ICONS.clock} ${formatDuration(content.duration)}</li>` : ""}
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
      <tr><th scope="row">نوع المادة</th><td>${content.type === "book" ? "كتاب PDF" : content.type === "article" ? "مقال مكتوب" : "مادة صوتية"}</td></tr>
      <tr><th scope="row">التصنيف</th><td>${cat ? escapeHTML(cat.name) : "عام"}</td></tr>
      <tr><th scope="row">تاريخ النشر</th><td>${formatDate(content.pubDate)}</td></tr>
      <tr><th scope="row">المدة</th><td dir="ltr">${content.duration ? formatDuration(content.duration) : "—"}</td></tr>
      <tr><th scope="row">الحالة</th><td><span class="badge badge--published">منشور</span></td></tr>
      <tr><th scope="row">الكلمات المفتاحية</th><td>${(content.keywords || []).join("، ")}</td></tr>
    `;

    const metadataShareButton = $("#share-metadata-status");
    if (metadataShareButton) {
      const metadataRows = [
        ["العنوان", content.title],
        ["المؤلف", content.author],
        ["نوع المادة", content.type === "book" ? "كتاب PDF" : content.type === "article" ? "مقال مكتوب" : "مادة صوتية"],
        ["التصنيف", cat ? cat.name : "عام"],
        ["تاريخ النشر", formatDate(content.pubDate)],
        ["المدة", content.duration ? formatDuration(content.duration) : "—"],
        ["الحالة", "منشور"],
        ["الكلمات المفتاحية", (content.keywords || []).join("، ") || "—"],
      ];

      const createMetadataImage = async (orientation) => {
        const canvas = document.createElement("canvas");
        const scale = Math.min(window.devicePixelRatio || 1, 2);
        const isPortrait = orientation === "portrait";
        const width = isPortrait ? 1080 : 1920;
        const height = isPortrait ? 1920 : 1080;
        const padding = isPortrait ? 72 : 96;
        const headerHeight = isPortrait ? 260 : 210;
        const rowHeight = isPortrait ? 190 : 100;
        canvas.width = width * scale;
        canvas.height = height * scale;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Canvas is not supported");
        if (document.fonts?.ready) await document.fonts.ready;
        await document.fonts?.load(`700 ${isPortrait ? 48 : 52}px Tajawal`);
        await document.fonts?.load(`500 ${isPortrait ? 30 : 32}px Tajawal`);
        context.scale(scale, scale);
        context.direction = "rtl";
        context.fillStyle = "#f9f6f2";
        context.fillRect(0, 0, width, canvas.height / scale);
        context.fillStyle = "#14253e";
        context.fillRect(0, 0, width, headerHeight);
        const logo = new Image();
        logo.src = `${BASE}assets/images/logo.png`;
        await new Promise((resolve, reject) => {
          logo.onload = resolve;
          logo.onerror = () => reject(new Error("Unable to load site logo"));
        });
        const logoSize = isPortrait ? 150 : 130;
        const logoScale = Math.min(logoSize / logo.naturalWidth, logoSize / logo.naturalHeight);
        const logoWidth = logo.naturalWidth * logoScale;
        const logoHeight = logo.naturalHeight * logoScale;
        context.drawImage(
          logo,
          padding,
          (headerHeight - logoHeight) / 2,
          logoWidth,
          logoHeight
        );
        context.fillStyle = "#ffffff";
        context.font = `700 ${isPortrait ? 48 : 52}px Tajawal, Arial, sans-serif`;
        context.textAlign = "right";
        context.fillText("بيانات المادة العلمية", width - padding, isPortrait ? 100 : 82);
        context.font = `500 ${isPortrait ? 30 : 32}px Tajawal, Arial, sans-serif`;
        context.fillText("أرشيف DSACMS", width - padding, isPortrait ? 170 : 140);

        metadataRows.forEach(([label, value], index) => {
          const y = headerHeight + index * rowHeight;
          context.fillStyle = index % 2 ? "#ffffff" : "#f0f2f5";
          context.fillRect(padding / 2, y, width - padding, rowHeight - 2);
          context.fillStyle = "#14253e";
          context.font = `700 ${isPortrait ? 32 : 34}px Tajawal, Arial, sans-serif`;
          context.textAlign = "right";
          context.fillText(label, width - padding * 1.5, y + (isPortrait ? 70 : 68));
          context.fillStyle = "#334155";
          context.font = `500 ${isPortrait ? 30 : 32}px Tajawal, Arial, sans-serif`;
          context.fillText(String(value), width - (isPortrait ? 90 : 430), y + (isPortrait ? 125 : 68), isPortrait ? 850 : 1300);
        });
        return new Promise((resolve, reject) => {
          canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Unable to create image"))), "image/png");
        });
      };

      metadataShareButton.addEventListener("click", async () => {
        const modal = $("#metadata-share-modal");
        if (!modal) return;
        modal.hidden = false;
        $(".metadata-share-modal", modal)?.focus();
      });

      const metadataModal = $("#metadata-share-modal");
      const closeMetadataModal = () => {
        if (metadataModal) metadataModal.hidden = true;
        metadataShareButton.focus();
      };
      $("#metadata-share-cancel")?.addEventListener("click", closeMetadataModal);
      metadataModal?.addEventListener("click", (event) => {
        if (event.target === metadataModal) closeMetadataModal();
      });
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && metadataModal && !metadataModal.hidden) closeMetadataModal();
      });

      const getMetadataImage = async () => {
        const orientation = $('input[name="metadata-image-orientation"]:checked')?.value || "portrait";
        const blob = await createMetadataImage(orientation);
        return new File([blob], `بيانات-المادة-${orientation}.png`, { type: "image/png" });
      };

      $("#metadata-save-image")?.addEventListener("click", async () => {
        try {
          const file = await getMetadataImage();
          const url = URL.createObjectURL(file);
          const link = document.createElement("a");
          link.href = url;
          link.download = file.name;
          document.body.appendChild(link);
          link.click();
          link.remove();
          URL.revokeObjectURL(url);
          closeMetadataModal();
          showToast("تم حفظ صورة البيانات في الهاتف.");
        } catch (error) {
          console.error("Unable to save metadata image", error);
          showToast("تعذر حفظ صورة البيانات.", "error");
        }
      });

    }

    // المشغّل الصوتي (FR-008)
    const playerSection = $("#player-section");
    if (content.audio) {
      playerSection.hidden = false;
      renderFullPlayer(playerSection, {
        id: content.id,
        title: content.title,
        src: content.audio,
        backupSrc: content.audioArchive || content.archiveUrl,
      });
    } else {
      playerSection.hidden = true;
      playerSection.innerHTML = "";
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
              <span class="rel-icon" aria-hidden="true">${cat && cat.icon ? cat.icon : ICONS.document}</span>
              <a href="content-detail.html?id=${encodeURIComponent(c.id)}">${escapeHTML(c.title)}</a>
            </div>`
          )
          .join("")
      : '<p class="dash-empty">لا توجد مواد أخرى في هذا التصنيف.</p>';

    // أزرار المشاركة (FR-024 / FR-025)
    const shareUrl = window.location.href.split("#")[0];
    const homeUrl = new URL(BASE + "index.html", window.location.href).href;
    const shareCopy = $("#share-copy");
    const shareX = $("#share-twitter");
    const shareWA = $("#share-whatsapp");
    const text = encodeURIComponent(`${content.title} — من أرشيف DSACMS`);
    if (shareX) shareX.href = `https://twitter.com/intent/tweet?text=${text}&url=${encodeURIComponent(shareUrl)}`;
    if (shareWA) {
      const shareModal = $("#whatsapp-share-modal");
      const shareModalPanel = $(".whatsapp-share-modal", shareModal);
      const shareCancel = $("#whatsapp-share-cancel");
      const shareConfirm = $("#whatsapp-share-confirm");
      const openShareModal = () => {
        if (!shareModal) return;
        shareModal.hidden = false;
        shareModalPanel?.focus();
      };
      const closeShareModal = () => {
        if (shareModal) shareModal.hidden = true;
        shareWA.focus();
      };
      shareWA.addEventListener("click", openShareModal);
      shareCancel?.addEventListener("click", closeShareModal);
      shareModal?.addEventListener("click", (event) => {
        if (event.target === shareModal) closeShareModal();
      });
      shareConfirm?.addEventListener("click", () => {
        const parts = [`${content.title}`, `رابط الموقع: ${homeUrl}`];
        if ($("#share-include-description")?.checked && content.description) {
          parts.splice(1, 0, `الوصف: ${content.description}`);
        }
        if ($("#share-include-body")?.checked && content.body?.length) {
          parts.splice(parts.length - 1, 0, `نص المادة:\n${content.body.join("\n\n")}`);
        }
        if ($("#share-include-audio")?.checked && content.audio) {
          parts.splice(parts.length - 1, 0, `صوت المادة: ${resolveContentUrl(content.audio)}`);
        }
        window.open(`https://wa.me/?text=${encodeURIComponent(parts.join("\n\n"))}`, "_blank", "noopener");
        closeShareModal();
      });
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && shareModal && !shareModal.hidden) closeShareModal();
      });
    }

    if (shareCopy) {
      shareCopy.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(shareUrl);
          shareCopy.innerHTML = `${ICONS.check} تم نسخ الرابط`;
        } catch (e) {
          // مسار احتياطي قديم
          const ta = document.createElement("textarea");
          ta.value = shareUrl;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          ta.remove();
          shareCopy.innerHTML = `${ICONS.check} تم نسخ الرابط`;
        }
        setTimeout(() => (shareCopy.textContent = "نسخ الرابط"), 2000);
      });
    }
  }

  function renderPublicQuestions(items) {
    const list = $("#public-questions-list");
    if (!list) return;
    const tools = $("#public-question-tools");
    const search = $("#public-question-search");
    const categoryFilter = $("#public-question-category");
    const pagination = $("#public-question-pagination");
    const pageSize = 10;
    let currentPage = 1;
    const categories = [...new Set(items.map((item) => item.category || "عام"))].sort((a, b) => a.localeCompare(b, "ar"));
    if (categoryFilter) {
      categoryFilter.innerHTML = '<option value="">كل الموضوعات</option>' + categories.map((category) => `<option value="${escapeHTML(category)}">${escapeHTML(category)}</option>`).join("");
    }
    if (tools) tools.hidden = items.length === 0;
    const render = () => {
      const query = (search?.value || "").trim().toLocaleLowerCase("ar");
      const selectedCategory = categoryFilter?.value || "";
      const filtered = items.filter((item) => {
        const content = `${item.question_text || ""} ${item.answer_text || ""} ${item.asker_name || ""}`.toLocaleLowerCase("ar");
        return (!query || content.includes(query)) && (!selectedCategory || (item.category || "عام") === selectedCategory);
      });
      const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
      currentPage = Math.min(currentPage, pageCount);
      const visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
      list.innerHTML = visible.length
      ? visible.map((item) => `
        <article class="qa-item">
          <div class="qa-item-meta"><span class="qa-category">${escapeHTML(item.category || "عام")}</span><span>${escapeHTML(item.asker_name || "بدون اسم")}</span></div>
          <h3>السؤال</h3>
          <p class="qa-question">${escapeHTML(item.question_text)}</p>
          <div class="qa-answer"><strong>الإجابة:</strong><br>${escapeHTML(item.answer_text)}</div>
          <small>تاريخ الإجابة: ${formatDate(item.answered_at)}</small>
        </article>`).join("")
      : `<p class="alert alert--info">${items.length ? "لا توجد نتائج مطابقة. جرّب كلمات أو موضوعاً آخر." : "لا توجد أسئلة مجاب عنها حتى الآن."}</p>`;
      if (pagination) {
        pagination.hidden = filtered.length <= pageSize;
        pagination.innerHTML = pagination.hidden ? "" : `<button type="button" class="btn btn--outline btn--sm" data-question-page="prev" ${currentPage === 1 ? "disabled" : ""}>السابق</button><span>صفحة ${currentPage} من ${pageCount}</span><button type="button" class="btn btn--outline btn--sm" data-question-page="next" ${currentPage === pageCount ? "disabled" : ""}>التالي</button>`;
      }
    };
    search?.addEventListener("input", () => { currentPage = 1; render(); });
    categoryFilter?.addEventListener("change", () => { currentPage = 1; render(); });
    pagination?.addEventListener("click", (event) => {
      const direction = event.target.closest("[data-question-page]")?.dataset.questionPage;
      if (!direction) return;
      currentPage += direction === "next" ? 1 : -1;
      render();
    });
    render();
  }

  async function initQuestions() {
    const form = $("#question-form");
    const list = $("#public-questions-list");
    const maintenanceNotice = $("#qa-maintenance-notice");
    const maintenanceMessage = $("#qa-maintenance-message");
    const formStatus = $("#question-form-status");

    const setQuestionIntakeState = (accepting, message = "") => {
      if (maintenanceNotice) maintenanceNotice.hidden = accepting;
      if (maintenanceMessage && message) maintenanceMessage.textContent = message;
      if (!form) return;
      form.setAttribute("aria-disabled", String(!accepting));
      form.querySelectorAll("input, select, textarea, button[type='submit']").forEach((control) => {
        control.disabled = !accepting;
      });
      if (formStatus) formStatus.textContent = accepting ? "خدمة استقبال الأسئلة متاحة." : "";
    };

    try {
      const items = await fetchApi("/questions");
      renderPublicQuestions(Array.isArray(items) ? items : []);
    } catch (error) {
      console.error("Unable to load public questions", error);
      if (list) list.innerHTML = '<p class="alert alert--error">تعذر تحميل الأسئلة حالياً.</p>';
    }
    if (!form) return;

    const siteKey = String(form.dataset.recaptchaSiteKey || "").trim();
    try {
      const status = await fetchApi("/questions/status");
      if (!status?.accepting) {
        setQuestionIntakeState(false, "استقبال الأسئلة متوقف مؤقتاً. ستُفتح الخدمة تلقائياً بعد اكتمال إعداد التحقق.");
      } else if (!siteKey) {
        setQuestionIntakeState(false, "مفتاح reCAPTCHA العام غير مضبوط في صفحة الموقع.");
      } else {
        await new Promise((resolve, reject) => {
          if (window.grecaptcha?.ready) return resolve();
          const timeout = setTimeout(() => finish(reject, new Error("reCAPTCHA loading timed out")), 12000);
          const finish = (callback, value) => {
            clearTimeout(timeout);
            callback(value);
          };
          const script = document.createElement("script");
          script.src = `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(siteKey)}&hl=ar`;
          script.async = true;
          script.onload = () => window.grecaptcha?.ready
            ? finish(resolve)
            : finish(reject, new Error("reCAPTCHA did not initialize"));
          script.onerror = () => finish(reject, new Error("Unable to load reCAPTCHA"));
          document.head.appendChild(script);
        });
        setQuestionIntakeState(true);
      }
    } catch (error) {
      console.error("Unable to initialize public question intake", error);
      setQuestionIntakeState(false, "تعذر التحقق من جاهزية الخدمة أو تحميل reCAPTCHA. أعد تحميل الصفحة لاحقاً.");
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const submit = $("#question-submit");
      const status = $("#question-form-status");
      const question = $("#question-text").value.trim();
      if (!question) return;
      if (!window.grecaptcha?.ready || !window.grecaptcha?.execute) {
        status.textContent = "تعذر تحميل reCAPTCHA. تحقق من اتصالك وأعد تحميل الصفحة.";
        return;
      }
      submit.disabled = true;
      status.textContent = "جارٍ التحقق وإرسال السؤال…";
      try {
        const captchaToken = await new Promise((resolve, reject) => {
          window.grecaptcha.ready(() => {
            window.grecaptcha.execute(siteKey, { action: "submit_question" })
              .then(resolve, reject);
          });
        });
        await fetchApi("/questions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            asker_name: $("#question-asker-name").value.trim(),
            category: $("#question-category").value,
            question_text: question,
            website_url: $("#website-url").value,
            captcha_token: captchaToken,
          }),
        });
        form.reset();
        status.textContent = "تم استلام سؤالك للمراجعة، وستظهر الإجابة بعد نشرها.";
      } catch (error) {
        console.error("Unable to submit question", error);
        status.textContent = error.status === 429
          ? "وصلت للحد المسموح من الأسئلة حالياً. حاول بعد خمس دقائق."
          : error.status === 400 || error.status === 503
            ? error.detail || "تعذر التحقق من reCAPTCHA. أعد المحاولة."
            : "تعذر إرسال السؤال حالياً. تحقق من اتصالك وحاول لاحقاً.";
      } finally {
        submit.disabled = false;
      }
    });
  }

  /* ======================================================================
     9) صفحة تسجيل الدخول (login.html) – FR-021 / SEC-001 / SEC-004/006/011
     ====================================================================== */
  function initLogin() {
    const form = $("#login-form");
    if (!form) return;

    const goToDashboard = (user) => {
      const home = (user && ROLES[user.role] && ROLES[user.role].home) || "pages/dashboard.html";
      const target = (PAGE === "login" && home.startsWith("pages/")) ? home.replace(/^pages\//, "") : (BASE + home);
      window.location.href = target;
    };

    // إذا كان المستخدم مسجلاً بالفعل، إعادة توجيه للوحة
    const session = getSession();
    if (session) {
      goToDashboard(session);
      return;
    }

    const userInput = $("#login-username");
    const passInput = $("#login-password");
    const attemptsHint = $("#attempts-hint");
    const toggleBtn = $("#password-toggle");
    const passwordModal = $("#password-setup-modal");

    if (passwordModal) {
      const changeForm = $("#password-change-form", passwordModal);
      const error = $("#password-change-error", passwordModal);
      $("#password-continue", passwordModal).addEventListener("click", () => {
        passwordModal.hidden = true;
        goToDashboard(getSession());
      });
      $("#password-change-start", passwordModal).addEventListener("click", () => {
        $("#password-setup-message", passwordModal).hidden = true;
        $("#password-setup-actions", passwordModal).hidden = true;
        changeForm.hidden = false;
        $("#new-password", changeForm).focus();
      });
      $("#password-change-back", passwordModal).addEventListener("click", () => {
        changeForm.hidden = true;
        $("#password-setup-message", passwordModal).hidden = false;
        $("#password-setup-actions", passwordModal).hidden = false;
        changeForm.reset();
        error.hidden = true;
      });
      changeForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const newPassword = $("#new-password", changeForm).value;
        const confirmation = $("#confirm-new-password", changeForm).value;
        const policyError = passwordPolicyError(newPassword);
        if (policyError || newPassword !== confirmation) {
          error.textContent = policyError || "كلمتا المرور غير متطابقتين.";
          error.hidden = false;
          return;
        }
        const submit = $("#password-change-submit", changeForm);
        submit.disabled = true;
        try {
          await fetchApi("/auth/change-password", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ currentPassword: passInput.value, newPassword }),
          });
          passwordModal.hidden = true;
          showToast("تم تغيير كلمة المرور بنجاح.");
          goToDashboard(getSession());
        } catch (requestError) {
          error.textContent = passwordChangeErrorMessage(requestError);
          error.hidden = false;
        } finally {
          submit.disabled = false;
        }
      });
    }

    // زر إظهار/إخفاء كلمة المرور
    if (toggleBtn && passInput) {
      toggleBtn.addEventListener("click", () => {
        const showing = passInput.type === "text";
        passInput.type = showing ? "password" : "text";
        toggleBtn.setAttribute("aria-label", showing ? "إظهار كلمة المرور" : "إخفاء كلمة المرور");
        toggleBtn.querySelector("span").innerHTML = showing ? ICONS.eye : ICONS.eyeOff;
      });
    }

    // تم إيقاف تجميد الحساب؛ تبقى رسالة الخطأ والتحقق من بيانات الدخول فقط.
    function renderLockState() {
      if (attemptsHint) attemptsHint.hidden = true;
      const submit = $("#login-submit");
      if (submit) submit.disabled = false;
    }
    renderLockState();

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
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

      const submit = $("#login-submit");
      if (submit) submit.disabled = true;
      let user = null;
      try {
        const result = await fetchApi("/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password }),
        });
        user = { ...result.user, token: result.token };
      } catch (error) {
        console.error("Login request failed", error);
      }
      if (!user) {
        if (attemptsHint) {
          attemptsHint.hidden = false;
          attemptsHint.textContent = "بيانات الدخول غير صحيحة. تحقق من اسم المستخدم أو كلمة المرور وحاول مرة أخرى.";
        }
        logAudit("LOGIN_FAILED", username, "DENIED");
        if (submit) submit.disabled = false;
        return;
      }

      // نجاح الدخول → جلسة آمنة + سجل
      setSession(user);
      logAudit("LOGIN", user.username, "OK");
      if (user.mustChangePassword && passwordModal) {
        passwordModal.hidden = false;
        $("#password-continue", passwordModal).focus();
        return;
      }
      setTimeout(() => goToDashboard(user), 600);
    });
  }

  function initAccount() {
    if (!getSession()) {
      window.location.href = BASE + "pages/login.html";
      return;
    }
    const form = $("#account-password-form");
    if (!form) return;
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const currentPassword = $("#account-current-password").value;
      const newPassword = $("#account-new-password").value;
      const confirmation = $("#account-confirm-password").value;
      const error = $("#account-password-error");
      const policyError = passwordPolicyError(newPassword);
      if (!currentPassword || policyError || newPassword !== confirmation) {
        error.textContent = !currentPassword ? "أدخل كلمة المرور الحالية." : (policyError || "كلمتا المرور الجديدة غير متطابقتين.");
        error.hidden = false;
        return;
      }
      const submit = $("#account-password-submit");
      submit.disabled = true;
      error.hidden = true;
      try {
        await fetchApi("/auth/change-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ currentPassword, newPassword }),
        });
        form.reset();
        showToast("تم تغيير كلمة المرور بنجاح.");
      } catch (requestError) {
        error.textContent = passwordChangeErrorMessage(requestError);
        error.hidden = false;
      } finally {
        submit.disabled = false;
      }
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
    const kind = ["success", "info", "warning", "error"].includes(type) ? type : "success";
    const symbols = {
      success: '<svg class="svg-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
      info: '<svg class="svg-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
      warning: '<svg class="svg-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
      error: '<svg class="svg-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>'
    };
    const t = document.createElement("div");
    t.className = "toast toast--" + kind;
    t.setAttribute("role", kind === "error" ? "alert" : "status");
    const icon = document.createElement("span");
    icon.className = "toast__icon";
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = symbols[kind];
    const text = document.createElement("span");
    text.className = "toast__message";
    text.textContent = message;
    const close = document.createElement("button");
    close.className = "toast__close";
    close.type = "button";
    close.setAttribute("aria-label", "إغلاق الإشعار");
    close.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    close.addEventListener("click", () => t.remove());
    t.append(icon, text, close);
    region.appendChild(t);
    setTimeout(() => {
      t.classList.add("toast--leaving");
      setTimeout(() => t.remove(), 220);
    }, 4500);
  }

  /** نافذة تأكيد ديناميكية تُرجع وعداً */
  function confirmAction(title, desc, confirmLabel = "تأكيد", confirmClass = "btn--danger") {
    return new Promise((resolve) => {
      const modal = $("#confirm-modal");
      if (!modal) return resolve(true);
      $("#modal-title").textContent = title;
      $("#modal-desc").textContent = desc;
      modal.hidden = false;
      const confirmEl = $("#modal-confirm");
      const cancelEl = $("#modal-cancel");
      const previousConfirmLabel = confirmEl.textContent;
      const previousConfirmClass = confirmEl.className;
      confirmEl.textContent = confirmLabel;
      confirmEl.className = `btn ${confirmClass}`;
      let settled = false;

      const finish = (val) => {
        if (settled) return;
        settled = true;
        modal.hidden = true;
        confirmEl.removeEventListener("click", onConfirm);
        cancelEl.removeEventListener("click", onCancel);
        modal.removeEventListener("click", onBackdrop);
        confirmEl.textContent = previousConfirmLabel;
        confirmEl.className = previousConfirmClass;
        resolve(val);
      };
      const onConfirm = () => finish(true);
      const onCancel = () => finish(false);
      const onBackdrop = (event) => {
        if (event.target === modal) finish(false);
      };
      $("#modal-cancel").addEventListener("click", onCancel);
      $("#modal-confirm").addEventListener("click", onConfirm);
      modal.addEventListener("click", onBackdrop);
      $("#modal-cancel").focus();
    });
  }

  async function initSheikhQuestions() {
    const pendingList = $("#pending-questions-list");
    const answeredList = $("#answered-questions-list");
    const questionCategories = ["عام", "العقيدة", "العبادات", "الأسرة", "المعاملات", "الآداب والسلوك", "أخرى"];
    const render = (items, target, answered) => {
      if (!target) return;
      target.innerHTML = items.length ? items.map((item) => `
        <article class="qa-item qa-admin-item">
          <div class="qa-item-meta"><span class="qa-category">${escapeHTML(item.category || "عام")}</span><span>${escapeHTML(item.asker_name || "بدون اسم")}</span></div>
          <p class="qa-question">${escapeHTML(item.question_text)}</p>
          <div class="qa-category-editor">
            <label for="question-category-${escapeHTML(item.id)}">تصنيف السؤال</label>
            <select class="field" id="question-category-${escapeHTML(item.id)}" data-question-category="${escapeHTML(item.id)}">
              ${questionCategories.map((category) => `<option value="${escapeHTML(category)}" ${category === (item.category || "عام") ? "selected" : ""}>${escapeHTML(category)}</option>`).join("")}
            </select>
            <button type="button" class="btn btn--outline btn--sm" data-question-action="category" data-question-id="${escapeHTML(item.id)}">حفظ التصنيف</button>
          </div>
          <label for="answer-${escapeHTML(item.id)}">${answered ? "الإجابة" : "اكتب الإجابة"}</label>
          <textarea class="field" id="answer-${escapeHTML(item.id)}">${escapeHTML(item.answer_text || "")}</textarea>
          <div class="form-group" style="display:flex;gap:var(--space-2);flex-wrap:wrap;margin-block-start:var(--space-3);">
            <button type="button" class="btn btn--primary btn--sm" data-question-action="${answered ? "edit" : "answer"}" data-question-id="${escapeHTML(item.id)}">${answered ? "حفظ التعديل" : "نشر الإجابة"}</button>
            <button type="button" class="btn btn--danger-outline btn--sm" data-question-action="${answered ? "delete" : "reject"}" data-question-id="${escapeHTML(item.id)}">${answered ? "حذف نهائي" : "رفض / تجاهل"}</button>
          </div>
        </article>`).join("") : '<p class="alert alert--info">لا توجد أسئلة في هذا القسم.</p>';
    };
    const load = async () => {
      try {
        const [pending, answered] = await Promise.all([
          fetchApi("/questions/sheikh/pending"),
          fetchApi("/questions/sheikh/answered"),
        ]);
        render(pending, pendingList, false);
        render(answered, answeredList, true);
      } catch (error) {
        console.error("Unable to load Sheikh questions", error);
        if (pendingList) pendingList.innerHTML = '<p class="alert alert--error">تعذر تحميل الأسئلة.</p>';
      }
    };
    document.querySelectorAll("[data-question-tab]").forEach((tab) => {
      tab.addEventListener("click", () => {
        const answered = tab.dataset.questionTab === "answered";
        if (pendingList) pendingList.hidden = answered;
        if (answeredList) answeredList.hidden = !answered;
      });
    });
    document.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-question-action]");
      if (!button) return;
      const id = button.dataset.questionId;
      const textarea = $(`#answer-${CSS.escape(id)}`);
      const categorySelect = $(`[data-question-category="${CSS.escape(id)}"]`);
      try {
        button.disabled = true;
        if (button.dataset.questionAction === "delete") {
          const ok = await confirmAction(
            "حذف السؤال",
            "هل أنت متأكد من رغبتك في حذف هذا السؤال نهائياً؟ لا يمكن التراجع عن هذا الإجراء."
          );
          if (!ok) return;
          await fetchApi(`/questions/sheikh/${encodeURIComponent(id)}`, { method: "DELETE" });
        } else if (button.dataset.questionAction === "reject") {
          const ok = await confirmAction(
            "رفض السؤال",
            "سيتم تحويل السؤال إلى «مرفوض» ولن يظهر للجمهور. هل تريد المتابعة؟"
          );
          if (!ok) return;
          await fetchApi(`/questions/sheikh/${encodeURIComponent(id)}/reject`, { method: "PATCH" });
        } else if (button.dataset.questionAction === "category") {
          await fetchApi(`/questions/sheikh/${encodeURIComponent(id)}/category`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ category: categorySelect?.value || "عام" }),
          });
        } else {
          await fetchApi(`/questions/sheikh/${encodeURIComponent(id)}/${button.dataset.questionAction === "edit" ? "edit" : "answer"}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ answer_text: textarea.value }),
          });
        }
        showToast("تم حفظ التغيير.");
        await load();
      } catch (error) {
        console.error("Unable to update question", error);
        showToast("تعذر حفظ التغيير.", "error");
      } finally {
        button.disabled = false;
      }
    });
    await load();
  }

  async function initLecturesAdmin() {
    const form = $("#lecture-admin-form");
    const list = $("#lecture-admin-list");
    const status = $("#lecture-admin-status");
    if (!form || !list) return;
    let lectures = [];
    const reset = () => {
      form.reset();
      $("#lecture-id").value = "";
      $("#lecture-save").textContent = "إضافة المحاضرة";
      $("#lecture-cancel").hidden = true;
    };
    const load = async () => {
      lectures = await fetchApi("/lectures");
      list.innerHTML = lectures.length ? lectures.map((item) => `
        <tr>
          <td data-label="التاريخ">${escapeHTML(item.lecture_date)}</td>
          <td data-label="وقت الصلاة">${escapeHTML(lecturePrayerLabel(item.lecture_time))}</td>
          <td data-label="المحاضرة">${escapeHTML(item.title)}</td>
          <td data-label="المسجد">${escapeHTML(item.mosque)}</td>
          <td data-label="إجراءات"><button class="btn btn--outline btn--sm" type="button" data-lecture-edit="${escapeHTML(item.id)}">تعديل</button> <button class="btn btn--danger btn--sm" type="button" data-lecture-delete="${escapeHTML(item.id)}">حذف</button></td>
        </tr>`).join("") : `<tr><td colspan="5">لا توجد محاضرات مضافة.</td></tr>`;
    };
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const id = $("#lecture-id").value;
      const payload = {
        lecture_date: $("#lecture-date").value,
        lecture_time: $("#lecture-time").value.trim(),
        title: $("#lecture-title").value.trim(),
        mosque: $("#lecture-mosque").value.trim(),
      };
      const save = $("#lecture-save");
      save.disabled = true;
      try {
        await fetchApi(id ? `/lectures/${encodeURIComponent(id)}` : "/lectures", {
          method: id ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        status.hidden = false;
        status.dataset.state = "success";
        status.textContent = id ? "تم تحديث المحاضرة." : "تمت إضافة المحاضرة.";
        reset();
        await load();
      } catch (error) {
        console.error("Unable to save lecture", error);
        status.hidden = false;
        status.dataset.state = "error";
        status.textContent = "تعذر حفظ المحاضرة. تحقق من الاتصال ثم حاول مجددًا.";
      } finally { save.disabled = false; }
    });
    $("#lecture-cancel").addEventListener("click", reset);
    list.addEventListener("click", async (event) => {
      const edit = event.target.closest("[data-lecture-edit]");
      if (edit) {
        const item = lectures.find((lecture) => String(lecture.id) === edit.dataset.lectureEdit);
        if (!item) return;
        $("#lecture-id").value = item.id;
        $("#lecture-date").value = String(item.lecture_date).slice(0, 10);
        $("#lecture-time").value = lecturePrayerLabel(item.lecture_time);
        $("#lecture-title").value = item.title;
        $("#lecture-mosque").value = item.mosque;
        $("#lecture-save").textContent = "حفظ التعديلات";
        $("#lecture-cancel").hidden = false;
        $("#lecture-date").focus();
      }
      const remove = event.target.closest("[data-lecture-delete]");
      if (remove && window.confirm("هل تريد حذف هذه المحاضرة؟")) {
        remove.disabled = true;
        try { await fetchApi(`/lectures/${encodeURIComponent(remove.dataset.lectureDelete)}`, { method: "DELETE" }); await load(); }
        catch (error) { console.error("Unable to delete lecture", error); showToast("تعذر حذف المحاضرة.", "error"); remove.disabled = false; }
      }
    });
    try { await load(); }
    catch (error) { console.error("Unable to load lectures for admin", error); status.hidden = false; status.dataset.state = "error"; status.textContent = "تعذر تحميل جدول المحاضرات من الخادم."; }
  }

  async function initLecturesPage() {
    const list = $("#lectures-list");
    const weekLabel = $("#lectures-week");
    if (!list) return;
    const today = new Date();
    const periodSelect = $("#lectures-period");
    const weekPicker = $("#lectures-week-picker");
    const monthPicker = $("#lectures-month-picker");
    const rangeFromPicker = $("#lectures-range-from");
    const rangeToPicker = $("#lectures-range-to");
    const heading = $("#lectures-list-title");
    const downloadButton = $("#lectures-download-image");
    const toISO = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const formatDate = (value) => new Intl.DateTimeFormat("ar-SD", { weekday: "long", day: "numeric", month: "long" }).format(new Date(`${value}T12:00:00`));
    const formatRange = (date) => new Intl.DateTimeFormat("ar-SD", { day: "numeric", month: "long" }).format(date);
    const formatMonth = (value) => new Intl.DateTimeFormat("ar-SD", { month: "long", year: "numeric" }).format(new Date(`${value}-01T12:00:00`));
    const todayIso = toISO(today);
    weekPicker.value = todayIso;
    monthPicker.value = todayIso.slice(0, 7);
    let currentWeek = [];
    let selectedStart = new Date(today);
    let selectedEnd = new Date(today);
    let selectedPeriodLabel = "";
    let allLectures = [];
    const renderSchedule = () => {
      const mode = periodSelect.value;
      weekPicker.hidden = mode !== "specific-week";
      monthPicker.hidden = mode !== "month";
      rangeFromPicker.hidden = mode !== "range";
      rangeToPicker.hidden = mode !== "range";
      if (mode === "range") {
        const from = rangeFromPicker.value;
        const to = rangeToPicker.value;
        heading.textContent = "محاضرات الفترة المحددة";
        if (!from || !to || from > to) {
          selectedPeriodLabel = from && to ? "تاريخ البداية يجب أن يسبق تاريخ النهاية" : "اختر تاريخ البداية والنهاية";
          weekLabel.textContent = selectedPeriodLabel;
          currentWeek = [];
          list.innerHTML = `<tr><td colspan="4" class="lectures-empty">${escapeHTML(selectedPeriodLabel)}</td></tr>`;
          if (downloadButton) downloadButton.disabled = true;
          return;
        }
        selectedStart = new Date(`${from}T12:00:00`);
        selectedEnd = new Date(`${to}T12:00:00`);
        selectedPeriodLabel = `من ${formatDate(from)} إلى ${formatDate(to)}`;
      } else if (mode === "month") {
        const value = monthPicker.value || todayIso.slice(0, 7);
        const [year, month] = value.split("-").map(Number);
        selectedStart = new Date(year, month - 1, 1);
        selectedEnd = new Date(year, month, 0);
        selectedPeriodLabel = `شهر ${formatMonth(value)}`;
        heading.textContent = `محاضرات ${formatMonth(value)}`;
      } else {
        const anchor = mode === "specific-week" && weekPicker.value ? new Date(`${weekPicker.value}T12:00:00`) : today;
        selectedStart = new Date(anchor);
        selectedStart.setDate(selectedStart.getDate() - selectedStart.getDay());
        selectedStart.setHours(0, 0, 0, 0);
        selectedEnd = new Date(selectedStart);
        selectedEnd.setDate(selectedEnd.getDate() + 6);
        selectedPeriodLabel = `الأسبوع من ${formatRange(selectedStart)} إلى ${formatRange(selectedEnd)}`;
        heading.textContent = mode === "specific-week" ? `محاضرات أسبوع ${formatRange(selectedStart)} إلى ${formatRange(selectedEnd)}` : "محاضرات الأسبوع الحالي";
      }
      weekLabel.textContent = selectedPeriodLabel;
      const from = toISO(selectedStart);
      const to = toISO(selectedEnd);
      currentWeek = allLectures.filter((item) => {
        const date = String(item.lecture_date || "").slice(0, 10);
        return date >= from && date <= to;
      });
      currentWeek.sort((a, b) => String(a.lecture_date).localeCompare(String(b.lecture_date)) || lecturePrayerRank(a.lecture_time) - lecturePrayerRank(b.lecture_time));
      list.innerHTML = currentWeek.length ? currentWeek.map((item) => `
        <tr>
          <td data-label="اليوم والتاريخ">${escapeHTML(formatDate(String(item.lecture_date).slice(0, 10)))}</td>
          <td data-label="وقت الصلاة">${escapeHTML(lecturePrayerLabel(item.lecture_time))}</td>
          <td data-label="المحاضرة">${escapeHTML(item.title)}</td>
          <td data-label="المسجد">${escapeHTML(item.mosque)}</td>
        </tr>`).join("") : `<tr><td colspan="4" class="lectures-empty">لا توجد محاضرات معلنة في الفترة المحددة.</td></tr>`;
      if (downloadButton) downloadButton.disabled = false;
    };
    periodSelect?.addEventListener("change", renderSchedule);
    weekPicker?.addEventListener("change", renderSchedule);
    monthPicker?.addEventListener("change", renderSchedule);
    rangeFromPicker?.addEventListener("change", renderSchedule);
    rangeToPicker?.addEventListener("change", renderSchedule);
    try {
      allLectures = await fetchApi("/lectures");
      renderSchedule();
    } catch (error) {
      console.error("Unable to load lectures", error);
      list.innerHTML = `<tr><td colspan="4" class="lectures-empty" role="status">تعذر تحميل الجدول الآن. يرجى المحاولة لاحقًا.</td></tr>`;
      if (downloadButton) downloadButton.disabled = true;
    }

    const imageStatus = $("#lectures-image-status");
    downloadButton?.addEventListener("click", async () => {
      downloadButton.disabled = true;
      imageStatus.hidden = false;
      imageStatus.textContent = "جارٍ تجهيز صورة الجدول…";
      try {
        const width = 1080;
        const padding = 72;
        const rowHeight = 230;
        const headerHeight = 320;
        const footerHeight = 330;
        const height = headerHeight + Math.max(currentWeek.length, 1) * rowHeight + footerHeight;
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Canvas is not supported");
        if (document.fonts?.ready) await document.fonts.ready;
        await Promise.all([
          document.fonts?.load("700 52px Cairo"),
          document.fonts?.load("500 34px Cairo"),
        ]);
        if (document.fonts && (!document.fonts.check("700 52px Cairo") || !document.fonts.check("500 34px Cairo"))) {
          throw new Error("Cairo font is unavailable");
        }
        context.fillStyle = "#f5f7f6";
        context.fillRect(0, 0, width, height);
        context.fillStyle = "#14253e";
        context.fillRect(0, 0, width, headerHeight);
        const logo = new Image();
        logo.src = `${BASE}assets/images/logo.png`;
        await new Promise((resolve, reject) => {
          logo.onload = resolve;
          logo.onerror = () => reject(new Error("Unable to load site logo"));
        });
        context.direction = "rtl";
        context.fillStyle = "#ffffff";
        context.font = "700 52px Cairo, Arial, sans-serif";
        const title = "جدول محاضرات الشيخ";
        const titleWidth = context.measureText(title).width;
        const logoWidth = 126;
        const logoHeight = logo.naturalHeight * Math.min(logoWidth / logo.naturalWidth, 78 / logo.naturalHeight);
        const titleLogoGap = 22;
        const groupWidth = titleWidth + titleLogoGap + logoWidth;
        const groupStart = (width - groupWidth) / 2;
        context.textAlign = "right";
        context.fillText(title, groupStart + titleWidth, 110);
        context.drawImage(logo, groupStart + titleWidth + titleLogoGap, 92 - logoHeight / 2, logoWidth, logoHeight);
        context.textAlign = "center";
        context.font = "500 34px Cairo, Arial, sans-serif";
        context.fillText(selectedPeriodLabel, width / 2, 180);
        context.fillText("المكتبة العلمية والصوتية للشيخ محمد أحمد الهادي الكرار", width / 2, 250, width - padding * 2);
        currentWeek.forEach((item, index) => {
          const y = headerHeight + index * rowHeight;
          context.fillStyle = index % 2 ? "#ffffff" : "#e9efec";
          context.beginPath();
          context.roundRect(padding, y + 12, width - padding * 2, rowHeight - 24, 22);
          context.fill();
          context.textAlign = "right";
          context.fillStyle = "#176b5b";
          context.font = "700 34px Cairo, Arial, sans-serif";
          context.fillText(formatDate(String(item.lecture_date).slice(0, 10)), width - padding * 1.5, y + 68, width - padding * 3);
          context.fillStyle = "#14253e";
          context.font = "700 40px Cairo, Arial, sans-serif";
          context.fillText(String(item.title), width - padding * 1.5, y + 125, width - padding * 3);
          context.fillStyle = "#334155";
          context.font = "500 32px Cairo, Arial, sans-serif";
          context.fillText(`${lecturePrayerLabel(item.lecture_time)} · ${item.mosque}`, width - padding * 1.5, y + 182, width - padding * 3);
        });
        if (!currentWeek.length) {
          context.textAlign = "center";
          context.fillStyle = "#334155";
          context.font = "500 38px Cairo, Arial, sans-serif";
          context.fillText("لا توجد محاضرات معلنة لهذا الأسبوع", width / 2, headerHeight + 120);
        }

        const pageUrl = "https://www.mohamedalahadi.com/pages/lectures.html";
        const qr = new Image();
        qr.crossOrigin = "anonymous";
        qr.src = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&format=png&data=${encodeURIComponent(pageUrl)}`;
        await new Promise((resolve, reject) => {
          qr.onload = resolve;
          qr.onerror = () => reject(new Error("تعذر إنشاء رمز QR"));
        });
        const qrY = height - footerHeight + 34;
        context.fillStyle = "#ffffff";
        context.fillRect((width - 240) / 2, qrY, 240, 240);
        context.drawImage(qr, (width - 220) / 2, qrY + 10, 220, 220);
        context.textAlign = "center";
        context.fillStyle = "#14253e";
        context.font = "700 30px Cairo, Arial, sans-serif";
        context.fillText("امسح الرمز لفتح جدول المحاضرات", width / 2, height - 30);
        const blob = await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("تعذر حفظ الصورة")), "image/png"));
        triggerBlobDownload(blob, "جدول-محاضرات-الشيخ.png");
        imageStatus.textContent = "تم حفظ صورة الجدول. يمكنك مشاركتها عبر واتساب.";
      } catch (error) {
        console.error("Unable to create lectures image", error);
        imageStatus.textContent = "تعذر إنشاء الصورة الآن. تحقق من الاتصال ثم أعد المحاولة.";
      } finally {
        downloadButton.disabled = false;
      }
    });
  }

  async function initDashboard() {
    const session = getSession();
    // حاجز RBAC (SEC-002): غير مسموح بالدخول دون جلسة
    if (!session || !["admin", "site_admin", "manager", "SHEIKH"].includes(session.role)) {
      window.location.href = BASE + "pages/login.html";
      return;
    }
    if (["admin", "site_admin"].includes(session.role)) {
      try {
        await loadRemoteUsers();
      } catch (error) {
        console.error("Unable to load users from the server", error);
        showToast("تعذر تحميل قائمة المستخدمين من الخادم.", "error");
      }
    }

    const isAdmin = ["admin", "site_admin"].includes(session.role);
    const isSheikh = session.role === "SHEIKH";

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
    if (!isSheikh) {
      $$("[data-sheikh-only]").forEach((el) => { el.hidden = true; });
      $("#panel-questions")?.remove();
    }
    if (isSheikh) {
      initSheikhQuestions();
    }
    if (["admin", "site_admin", "manager"].includes(session.role)) {
      initLecturesAdmin();
    } else {
      $$('[data-manager-only]').forEach((el) => { el.hidden = true; });
      $("#panel-lectures")?.remove();
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
            <td class="title-cell" data-label="العنوان"><a href="content-detail.html?id=${encodeURIComponent(c.id)}" target="_blank" rel="noopener">${escapeHTML(c.title)}</a></td>
            <td data-label="التصنيف">${cat ? escapeHTML(cat.name) : "—"}</td>
            <td data-label="الحالة">${badge}</td>
            <td data-label="المدة" dir="ltr">${c.duration ? formatDuration(c.duration) : "—"}</td>
            <td data-label="التاريخ">${formatDate(c.pubDate)}</td>
            <td class="row-actions" data-label="إجراءات">
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
        let content = loadContents().find((c) => c.id === id);
        if (!content) return;

        if (action === "edit") {
          openEditor(content);
        } else if (action === "status") {
          // التحقق من الصلاحية (RBAC)
          if (!["admin", "site_admin", "manager", "SHEIKH"].includes(session.role)) {
            showToast("لا تملك صلاحية تعديل الحالة", "error");
            return;
          }
          const next = content.status === "published" ? "archived" : "published";
          const ok = await confirmAction(
            next === "archived" ? "أرشفة المادة" : "نشر المادة",
            `تأكيد تغيير حالة «${content.title}» إلى ${next === "archived" ? "مؤرشفة" : "منشورة"}.`
          );
          if (!ok) return;
          try {
            const result = await fetchApi(`/materials/${encodeURIComponent(id)}/status`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ status: next }),
            });
            content = normalizeMaterial(result.material);
            apiContents = loadContents().map((x) => (x.id === id ? content : x));
          } catch (error) {
            showToast(error.message || "تعذر تحديث حالة المادة على الخادم.", "error");
            return;
          }
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
          try {
            await fetchApi(`/materials/${encodeURIComponent(id)}`, { method: "DELETE" });
            removeContentDate(id);
            saveContents(loadContents().filter((x) => x.id !== id));
          } catch (error) {
            showToast(error.message || "تعذر حذف المادة من الخادم.", "error");
            return;
          }
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
    const cfStatusDescription = $("#cf-status-description");
    const cfDesc = $("#cf-description");
    const cfKeywords = $("#cf-keywords");
    const cfDate = $("#cf-date");
    const cfDuration = $("#cf-duration");
    const cfAudio = $("#cf-audio");
    const cfType = $("#cf-type");
    const cfPdf = $("#cf-pdf");
    const cfBody = $("#cf-body");
    const cfFontSize = $("#cf-font-size");
    const cfLineHeight = $("#cf-line-height");
    const cfSubmit = $("#cf-submit");
    const cfReset = $("#cf-reset");
    const editorTitle = $("#panel-editor-title");
    const editorAlert = $("#editor-alert");
    const newContentBtn = $("#btn-new-content");
    const statusDescriptions = {
      published: "تظهر المادة المنشورة للزوار في الموقع.",
      draft: "تُحفظ المسودة للتحرير لاحقاً، ولا تظهر للزوار.",
      archived: "تظل المادة محفوظة في لوحة الإدارة، لكنها مخفية عن الزوار.",
    };
    const updateStatusDescription = () => {
      if (cfStatusDescription && cfStatus) cfStatusDescription.textContent = statusDescriptions[cfStatus.value] || statusDescriptions.published;
    };
    cfStatus?.addEventListener("change", updateStatusDescription);
    updateStatusDescription();
    const archiveUploadButtons = [$("#cf-archive-upload"), $("#cf-archive-upload-pdf")].filter(Boolean);
    const mediaFileInput = $("#cf-media-file");
    let selectedUploadTarget = "audio";
    function setUploadStatus(target, message, state = "") {
      const status = target === "pdf" ? $("#cf-pdf-upload-status") : $("#cf-audio-upload-status");
      if (!status) return;
      status.hidden = !message;
      status.textContent = message;
      status.dataset.state = state;
    }
    function uploadErrorMessage(error) {
      if (error?.name === "AbortError") return "انتهت مهلة تجهيز الرفع. تحقق من الاتصال وحاول مرة أخرى.";
      if (error?.status === 401) return "انتهت جلستك. سجّل الدخول مجدداً ثم أعد الرفع.";
      if (error?.status === 403) return "تعذر تصريح الرفع؛ تحقق من إعدادات نطاق الموقع وسياسة R2 CORS ثم حاول مجدداً.";
      if (error?.status === 404) return "خدمة التخزين غير متاحة حالياً. تحقق من إعدادات الخادم وR2.";
      if (error?.status === 413) return "حجم الملف أكبر من الحد المسموح (500 ميغابايت).";
      if (error?.status === 503) return "إعدادات Cloudflare R2 غير مكتملة على الخادم. أبلغ مدير الموقع.";
      if (error?.status === 502) return "تعذر إكمال التخزين في Cloudflare R2. أعد المحاولة بعد قليل.";
      return error?.message || "تعذر رفع الملف. تحقق من الاتصال وإعدادات التخزين.";
    }
    function putFileWithProgress(url, file, target, contentType, uploadToken) {
      return new Promise((resolve, reject) => {
        const request = new XMLHttpRequest();
        request.open("PUT", url);
        const isR2 = /r2\.cloudflarestorage\.com/i.test(url);
        if (uploadToken && !isR2) {
          request.setRequestHeader("Authorization", `Bearer ${uploadToken}`);
        }
        if (contentType || file.type) {
          request.setRequestHeader("Content-Type", contentType || file.type);
        }
        request.upload.addEventListener("progress", (event) => {
          if (event.lengthComputable) setUploadStatus(target, `جارٍ رفع الملف إلى Cloudflare R2… ${Math.round(event.loaded / event.total * 100)}٪`, "loading");
        });
        request.upload.addEventListener("load", () => setUploadStatus(target, "اكتمل النقل؛ جارٍ التحقق من الحفظ…", "loading"));
        request.addEventListener("load", () => {
          if (request.status >= 200 && request.status < 300) {
            let data = {};
            try {
              if (request.responseText && request.responseText.trim()) {
                data = JSON.parse(request.responseText);
              }
            } catch (_) {
              data = {};
            }
            resolve(data);
            return;
          }
          let detail = "";
          try { detail = JSON.parse(request.responseText).error || ""; } catch (_) {
            detail = String(request.responseText || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 180);
          }
          const error = new Error(`فشل التخزين (${request.status})${detail ? `: ${detail}` : "."}`);
          error.status = request.status;
          reject(error);
        });
        request.addEventListener("error", () => reject(new Error("تعذر الاتصال بالتخزين. تحقق من الاتصال وإعدادات السماح بالرفع من المتصفح (R2 CORS).")));
        request.addEventListener("abort", () => reject(new Error("تم إلغاء رفع الملف.")));
        request.addEventListener("timeout", () => reject(new Error("استغرق الرفع وقتاً أطول من المسموح. تحقق من الاتصال ثم أعد المحاولة.")));
        request.send(file);
      });
    }
    if (archiveUploadButtons.length && mediaFileInput) {
      archiveUploadButtons.forEach((button) => button.addEventListener("click", () => {
        selectedUploadTarget = button.id === "cf-archive-upload-pdf" ? "pdf" : "audio";
        mediaFileInput.accept = selectedUploadTarget === "pdf" ? ".pdf,application/pdf" : "audio/*";
        mediaFileInput.value = "";
        mediaFileInput.click();
      }));
      mediaFileInput.addEventListener("change", async () => {
        const file = mediaFileInput.files?.[0];
        if (!file) return;
        const isPdf = selectedUploadTarget === "pdf";
        const ext = file.name.split(".").pop().toLowerCase();
        const validAudioExtensions = ["mp3", "wav", "ogg", "oga", "m4a", "aac", "flac", "opus", "wma"];
        const valid = isPdf ? file.type === "application/pdf" || ext === "pdf" : file.type.startsWith("audio/") || validAudioExtensions.includes(ext);
        const target = isPdf ? "pdf" : "audio";
        const maxAllowedBytes = 500 * 1024 * 1024; // 500 MiB on Cloudflare R2
        if (!valid || file.size > maxAllowedBytes) {
          setUploadStatus(target, isPdf ? "اختر ملف PDF صالحًا لا يتجاوز حجمه 500 ميغابايت." : "اختر ملفًا صوتيًا صالحًا لا يتجاوز حجمه 500 ميغابايت.", "error");
          return;
        }
        const button = archiveUploadButtons.find((item) => item.id === (isPdf ? "cf-archive-upload-pdf" : "cf-archive-upload"));
        const field = isPdf ? cfPdf : cfAudio;
        if (button) button.disabled = true;
        setUploadStatus(target, "جارٍ تجهيز الرفع المباشر إلى Cloudflare R2…", "loading");
        try {
          const prepared = await fetchApi("/media-upload", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              filename: file.name,
              contentType: isPdf ? "application/pdf" : (file.type || "application/octet-stream"),
              size: file.size,
              title: cfTitle?.value.trim() || file.name,
              description: cfDesc?.value.trim() || "",
            }),
          });
          const uploadedResult = await putFileWithProgress(prepared.uploadUrl, file, target, prepared.contentType, prepared.uploadToken);
          const resolvedFileUrl = uploadedResult?.fileUrl || prepared.fileUrl;
          if (field) {
            field.value = resolvedFileUrl;
            if (prepared.storageKey) field.dataset.storageKey = prepared.storageKey;
            field.dispatchEvent(new Event("input", { bubbles: true }));
          }
          if (!isPdf && validateAudioUrl(resolvedFileUrl)) loadAudioDuration(resolvedFileUrl);
          setUploadStatus(target, "تم رفع الملف بنجاح إلى Cloudflare R2 وإدراج الرابط الأساسي تلقائيًا.", "success");
          showToast("تم رفع الملف بنجاح إلى Cloudflare R2.", "success");
        } catch (error) {
          console.error("Media upload failed", error);
          setUploadStatus(target, uploadErrorMessage(error), "error");
        } finally {
          if (button) button.disabled = false;
        }
      });
    }

    const editorSteps = $$("[data-editor-step]");
    let activeEditorStep = 1;

    function showEditorStep(step) {
      activeEditorStep = step;
      editorSteps.forEach((panel) => {
        panel.hidden = Number(panel.dataset.editorStep) !== step;
      });
    }
    $$("[data-step-next]").forEach((button) => {
      button.addEventListener("click", () => {
        if (Number(button.dataset.stepNext) === 1) {
          let valid = true;
          if (!cfTitle.value.trim()) { showFieldError("err-cf-title", cfTitle); valid = false; }
          if (!cfAuthor.value.trim()) { showFieldError("err-cf-author", cfAuthor); valid = false; }
          if (!cfCategory.value) { showFieldError("err-cf-category", cfCategory); valid = false; }
          if (valid) showEditorStep(2);
        } else {
          showEditorStep(Math.min(3, activeEditorStep + 1));
        }
      });
    });
    $$("[data-step-prev]").forEach((button) => {
      button.addEventListener("click", () => showEditorStep(Math.max(1, activeEditorStep - 1)));
    });

    // تعبئة خيارات التصنيف في النموذج
    if (cfCategory) {
      cfCategory.innerHTML =
        '<option value="">— اختر التصنيف —</option>' +
        loadCategories()
          .map((c) => `<option value="${escapeHTML(c.id)}">${escapeHTML(c.name)}</option>`)
          .join("");
    }
    if (cfDate && !cfDate.value) {
      cfDate.value = new Date().toISOString().slice(0, 10);
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
      updateStatusDescription();
      if (cfDesc) cfDesc.value = content.description || "";
      if (cfKeywords) cfKeywords.value = (content.keywords || []).join("، ");
      if (cfDate) {
        if (content.pubDate) {
          const d = new Date(content.pubDate);
          cfDate.value = !isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : String(content.pubDate).slice(0, 10);
        } else {
          cfDate.value = new Date().toISOString().slice(0, 10);
        }
      }
      if (cfDuration) cfDuration.value = content.duration || "";
      if (cfType) cfType.value = content.type || (content.audio ? "audio" : "article");
      if (cfAudio) {
        cfAudio.value = content.audio || "";
        if (content.storageKey) cfAudio.dataset.storageKey = content.storageKey;
        else delete cfAudio.dataset.storageKey;
      }
      if (cfPdf) {
        cfPdf.value = content.pdf || "";
        if (content.storageKey) cfPdf.dataset.storageKey = content.storageKey;
        else delete cfPdf.dataset.storageKey;
      }
      const cfArchiveInput = $("#cf-archive-url");
      if (cfArchiveInput) cfArchiveInput.value = content.archiveUrl || "";
      if (cfBody) cfBody.value = (content.body || []).join("\n\n");
      const contentSettings = loadContentSettings()[content.id] || content.readingSettings;
      const normalizedSettings = normalizeReadingSettings(contentSettings);
      if (cfFontSize) cfFontSize.value = String(normalizedSettings.fontSize);
      if (cfLineHeight) cfLineHeight.value = String(normalizedSettings.lineHeight);
      if (editorAlert) editorAlert.hidden = true;
      window.scrollTo({ top: 0, behavior: "smooth" });
    }

    function resetEditor() {
      if (cfForm) cfForm.reset();
      updateStatusDescription();
      showEditorStep(1);
      if ($("#cf-id")) $("#cf-id").value = "";
      if (cfAudio) delete cfAudio.dataset.storageKey;
      if (cfPdf) delete cfPdf.dataset.storageKey;
      const cfArchiveInput = $("#cf-archive-url");
      if (cfArchiveInput) cfArchiveInput.value = "";
      if (cfDate) cfDate.value = new Date().toISOString().slice(0, 10);
      if (editorTitle) editorTitle.textContent = "إضافة مادة جديدة";
      if (cfSubmit) cfSubmit.textContent = "حفظ المادة";
      if (cfReset) cfReset.textContent = "إلغاء / مسح النموذج";
      if (editorAlert) editorAlert.hidden = true;
      if (cfFontSize) cfFontSize.value = String(DEFAULT_READING_SETTINGS.fontSize);
      if (cfLineHeight) cfLineHeight.value = String(DEFAULT_READING_SETTINGS.lineHeight);
    }

    if (newContentBtn) {
      newContentBtn.addEventListener("click", () => {
        switchTab("editor");
        resetEditor();
        if (editorTitle) editorTitle.textContent = "إضافة مادة جديدة";
      });
    }
    if (cfReset) cfReset.addEventListener("click", resetEditor);

    function isDirectUrl(value) {
      try {
        const url = new URL(String(value).trim());
        return url.protocol === "http:" || url.protocol === "https:";
      } catch (_) {
        return false;
      }
    }

    function normalizeGoogleDriveUrl(value) {
      const raw = String(value || "").trim();
      if (!raw) return "";
      let url;
      try { url = new URL(raw); } catch (_) { return raw; }
      if (!["drive.google.com", "www.drive.google.com"].includes(url.hostname)) return raw;
      let fileId = url.searchParams.get("id");
      const match = url.pathname.match(/^\/file\/d\/([^/]+)/);
      if (!fileId && match) fileId = match[1];
      return fileId
        ? `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download`
        : raw;
    }

    function validateAudioUrl(value) {
      const errEl = $("#err-cf-audio");
      if (!value) {
        errEl.setAttribute("data-visible", "false");
        return true;
      }
      if (!isDirectUrl(value)) {
        errEl.textContent = "أدخل رابطًا مباشرًا صالحًا يبدأ بـ https:// أو http://.";
        errEl.setAttribute("data-visible", "true");
        return false;
      }
      errEl.setAttribute("data-visible", "false");
      return true;
    }

    let durationLookupId = 0;
    function loadAudioDuration(url) {
      const hint = $("#cf-duration-hint");
      if (!cfAudio || !cfDuration || !url || !isDirectUrl(url) || (cfType && cfType.value !== "audio")) {
        return;
      }
      const lookupId = ++durationLookupId;
      hint.textContent = "جارٍ قراءة مدة الملف الصوتي من الرابط…";
      const audio = document.createElement("audio");
      audio.preload = "metadata";
      audio.addEventListener("loadedmetadata", () => {
        if (lookupId !== durationLookupId || cfAudio.value.trim() !== url) return;
        if (Number.isFinite(audio.duration) && audio.duration > 0) {
          cfDuration.value = Math.round(audio.duration);
          hint.textContent = "تم حساب المدة تلقائيًا من الرابط. يمكنك تعديلها يدويًا.";
        } else {
          hint.textContent = "تعذر قراءة المدة؛ أدخلها يدويًا بالثواني.";
        }
        audio.removeAttribute("src");
        audio.load();
      });
      audio.addEventListener("error", () => {
        if (lookupId !== durationLookupId || cfAudio.value.trim() !== url) return;
        hint.textContent = "تعذر قراءة مدة الرابط. تأكد أنه ملف صوت مباشر وعام، أو أدخل المدة يدويًا.";
        audio.removeAttribute("src");
        audio.load();
      });
      audio.src = url;
    }

    if (cfAudio) {
      const normalizeAudioInput = () => {
        const normalized = normalizeGoogleDriveUrl(cfAudio.value);
        if (normalized && normalized !== cfAudio.value.trim()) {
          cfAudio.value = normalized;
          showToast("تم تحويل رابط Google Drive إلى رابط تنزيل مباشر.", "info");
        }
      };
      cfAudio.addEventListener("change", () => {
        normalizeAudioInput();
        const url = cfAudio.value.trim();
        if (validateAudioUrl(url)) loadAudioDuration(url);
      });
      cfAudio.addEventListener("blur", () => {
        normalizeAudioInput();
        const url = cfAudio.value.trim();
        if (validateAudioUrl(url)) loadAudioDuration(url);
      });
    }
    if (cfPdf) {
      cfPdf.addEventListener("blur", () => {
        const normalized = normalizeGoogleDriveUrl(cfPdf.value);
        if (normalized && normalized !== cfPdf.value.trim()) {
          cfPdf.value = normalized;
          showToast("تم تحويل رابط Google Drive إلى رابط تنزيل مباشر.", "info");
        }
      });
    }
    if (cfType) {
      cfType.addEventListener("change", () => {
        if (cfAudio.value.trim()) loadAudioDuration(cfAudio.value.trim());
      });
    }

    // حفظ المادة
    if (cfForm) {
      cfForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (cfSubmit) cfSubmit.disabled = true;
        let ok = true;
        if (!cfTitle.value.trim()) { showFieldError("err-cf-title", cfTitle); ok = false; } else hideFieldError("err-cf-title", cfTitle);
        if (!cfAuthor.value.trim()) { showFieldError("err-cf-author", cfAuthor); ok = false; } else hideFieldError("err-cf-author", cfAuthor);
        if (!cfCategory.value) { showFieldError("err-cf-category", cfCategory); ok = false; } else hideFieldError("err-cf-category", cfCategory);
        if (cfAudio) cfAudio.value = normalizeGoogleDriveUrl(cfAudio.value);
        if (cfPdf) cfPdf.value = normalizeGoogleDriveUrl(cfPdf.value);
        if (cfAudio && !validateAudioUrl(cfAudio.value)) ok = false;
        if (cfPdf && cfPdf.value.trim() && !isDirectUrl(cfPdf.value)) {
          showToast("رابط PDF غير صالح. استخدم رابطًا مباشرًا يبدأ بـ https:// أو http://.", "error");
          ok = false;
        }
        if (!ok) {
          if (cfSubmit) cfSubmit.disabled = false;
          return;
        }

        const selectedStatus = cfStatus?.value || "published";
        const selectedStatusLabel = { published: "منشور", draft: "مسودة", archived: "مؤرشف" }[selectedStatus] || "منشور";
        const shouldSave = await confirmAction(
          "تأكيد حالة المادة",
          `الحالة المختارة: ${selectedStatusLabel}. ${statusDescriptions[selectedStatus] || statusDescriptions.published} هل تريد المتابعة؟`,
          "حفظ بالحالة المختارة",
          "btn--primary"
        );
        if (!shouldSave) {
          if (cfSubmit) cfSubmit.disabled = false;
          return;
        }

        const idField = $("#cf-id");
        const id = idField && idField.value ? idField.value : slugify(cfTitle.value);
        const existing = (idField && idField.value)
          ? loadContents().find((c) => c.id === id)
          : loadContents().find((c) => c.title === cfTitle.value.trim());

        // بناء كائن المادة
        const rawDate = cfDate ? cfDate.value.trim() : "";
        const selectedDate = rawDate && !isNaN(new Date(rawDate).getTime())
          ? rawDate
          : new Date().toISOString().slice(0, 10);

        const storageKey = cfAudio?.dataset.storageKey || cfPdf?.dataset.storageKey || (existing && existing.storageKey) || null;
        const archiveUrl = $("#cf-archive-url")?.value?.trim() || (existing && existing.archiveUrl) || null;

        const item = {
          id: (existing && existing.id) || id,
          slug: (existing && existing.slug) || id,
          title: cfTitle.value.trim(),
          author: cfAuthor.value.trim(),
          category: cfCategory.value,
          status: selectedStatus,
          description: cfDesc ? cfDesc.value.trim() : "",
          keywords: cfKeywords
            ? cfKeywords.value.split(/[،,]/).map((k) => k.trim()).filter(Boolean)
            : [],
          pubDate: selectedDate,
          duration: cfDuration ? Number(cfDuration.value) || 0 : 0,
          audio: cfAudio ? cfAudio.value.trim() : (existing && existing.audio) || null,
          type: cfType ? cfType.value : (existing && existing.type) || "audio",
          pdf: cfPdf ? cfPdf.value.trim() : (existing && existing.pdf) || "",
          archiveUrl,
          storageKey,
          body: cfBody
            ? cfBody.value.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
            : (existing && existing.body) || [],
          readingSettings: normalizeReadingSettings({
            fontSize: cfFontSize ? Number(cfFontSize.value) : DEFAULT_READING_SETTINGS.fontSize,
            lineHeight: cfLineHeight ? Number(cfLineHeight.value) : DEFAULT_READING_SETTINGS.lineHeight,
          }),
        };
        saveContentSettings(item.id, item.readingSettings);
        if (item.id) saveContentDate(item.id, item.pubDate);

        try {
          const payload = {
            title: item.title,
            description: item.description,
            author: item.author,
            categoryId: item.category,
            audioUrl: item.audio,
            documentUrl: item.pdf || null,
            contentType: item.type,
            storageKey: item.storageKey,
            archiveUrl: item.archiveUrl,
            archiveStatus: (existing && existing.archiveStatus) || (archiveUrl ? "ARCHIVED" : (storageKey ? "UPLOADED_TO_R2" : "ARCHIVED")),
            body: item.body,
            readingSettings: item.readingSettings,
            keywords: item.keywords,
            durationSeconds: item.duration,
            status: item.status,
            pubDate: item.pubDate,
            publishedAt: item.pubDate,
            published_at: item.pubDate,
            date: item.pubDate,
            createdAt: item.pubDate,
            created_at: item.pubDate,
          };
          const saved = await fetchApi(existing ? `/materials/${encodeURIComponent(existing.id)}` : "/materials", {
            method: existing ? "PUT" : "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          const savedRow = (saved && saved.material) || saved || {};
          const savedId = String(savedRow.id || item.id || "");
          saveContentDate(savedId, item.pubDate);
          const normalized = normalizeMaterial({
            ...savedRow,
            id: savedId,
            pubDate: item.pubDate,
            published_at: item.pubDate,
            publishedAt: item.pubDate,
          });
          normalized.pubDate = item.pubDate;
          apiContents = [
            normalized,
            ...apiContents.filter((content) => content.id !== normalized.id),
          ];
          logAudit(existing ? "UPDATE_CONTENT" : "CREATE_CONTENT", item.title, "OK");
          showToast(existing ? "تم تحديث المادة وحفظها على الخادم." : "تم رفع المادة وحفظها بنجاح.");
          resetEditor();
          switchTab("content");
          refreshAll();
        } catch (error) {
          console.error("Unable to save material", error);
          showToast(error.message || "تعذر حفظ المادة أو رفع الملف. لم يتم اعتماد العملية.", "error");
        } finally {
          if (cfSubmit) cfSubmit.disabled = false;
        }
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
            <td data-label="التصنيف">${c.icon} ${escapeHTML(c.name)}</td>
            <td data-label="عدد المواد">${count}</td>
            <td class="row-actions" data-label="إجراءات">
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
        try {
          await fetchApi(`/categories/${encodeURIComponent(id)}`, { method: "DELETE" });
        } catch (error) {
          showToast("تعذر حذف التصنيف من الخادم.", "error");
          return;
        }
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
      catForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const name = newCat.value.trim();
        if (!name) return;
        const cats = loadCategories();
        if (cats.some((c) => c.name === name)) {
          showToast("يوجد تصنيف بهذا الاسم مسبقاً.", "error");
          return;
        }
        let created;
        try {
          created = await fetchApi("/categories", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, description: "تصنيف مضاف عبر لوحة الإدارة" }),
          });
        } catch (error) {
          showToast("تعذر حفظ التصنيف على الخادم.", "error");
          return;
        }
        cats.push(normalizeCategory(created));
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
            <td data-label="الاسم">${escapeHTML(u.name)}</td>
            <td data-label="اسم المستخدم" dir="ltr">${escapeHTML(u.username)}</td>
            <td data-label="الدور">
              <label class="visually-hidden" for="role-${escapeHTML(u.id)}">دور المستخدم</label>
              <select id="role-${escapeHTML(u.id)}" class="field" style="width:auto;" data-user-role data-id="${escapeHTML(u.id)}">
                <option value="admin" ${u.role === "admin" ? "selected" : ""}>مدير النظام</option>
                <option value="site_admin" ${u.role === "site_admin" ? "selected" : ""}>مدير الموقع</option>
                <option value="manager" ${u.role === "manager" ? "selected" : ""}>Content Manager</option>
                <option value="SHEIKH" ${u.role === "SHEIKH" ? "selected" : ""}>الشيخ</option>
                <option value="viewer" ${u.role === "viewer" ? "selected" : ""}>Viewer</option>
              </select>
            </td>
            <td data-label="الحالة">
              <span class="badge ${u.status === "active" ? "badge--active" : "badge--inactive"}">
                ${u.status === "active" ? "نشط" : "معطّل"}
              </span>
            </td>
            <td class="row-actions" data-label="إجراءات">
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
      usersTbody.addEventListener("change", async (e) => {
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
          const nextRole = sel.value === "site_admin" ? "admin" : sel.value;
          try {
            const updated = await fetchApi(`/auth/users/${encodeURIComponent(u.id)}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ role: nextRole }),
            });
            u.role = updated.role;
          } catch (error) {
            sel.value = u.role;
            showToast(error.message || "تعذر تحديث صلاحية المستخدم على الخادم.", "error");
            return;
          }
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
          try {
            await fetchApi(`/auth/users/${encodeURIComponent(u.id)}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ password: temporaryPassword }),
            });
          } catch (error) {
            showToast(error.message || "تعذر تحديث كلمة المرور على الخادم.", "error");
            return;
          }
          u.passHash = "";
          saveUsers(users);
          logAudit("RESET_USER_PASSWORD", u.username, "OK");
          showToast(`تمت استعادة كلمة مرور حساب ${u.name}.`);
        }
        if (del) {
          const u = users.find((x) => x.id === del.dataset.id);
          if (!u) return;
          if (!/^\d+$/.test(String(u.id))) {
            showToast("هذه نسخة قديمة من الحساب. أعد تحميل قائمة المستخدمين من الخادم ثم حاول مرة أخرى.", "error");
            try {
              await loadRemoteUsers();
              renderUserTable();
            } catch (error) {
              console.error("Unable to refresh users before deletion", error);
            }
            return;
          }
          if (u.username === session.username) {
            showToast("لا يمكنك حذف حسابك الحالي.", "error");
            return;
          }
          const ok = await confirmAction("حذف المستخدم", `سيتم حذف حساب «${u.name}» (${u.username}). هل أنت متأكد؟`);
          if (!ok) return;
          try {
            await fetchApi(`/auth/users/${encodeURIComponent(u.id)}`, { method: "DELETE" });
          } catch (error) {
            showToast(error.message || "تعذر حذف المستخدم من الخادم.", "error");
            return;
          }
          saveUsers(users.filter((x) => x.id !== u.id));
          logAudit("DELETE_USER", u.username, "OK");
          showToast("تم حذف المستخدم.");
          renderUserTable();
        }
      });
    }

    if (userForm) {
      userForm.addEventListener("submit", async (e) => {
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

        let created;
        try {
          created = await fetchApi("/auth/users", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password, role: role === "site_admin" ? "admin" : role }),
          });
        } catch (error) {
          showToast("تعذر إنشاء الحساب على الخادم. تحقق من الاتصال أو من أن اسم المستخدم غير مكرر.", "error");
          return;
        }
        users.push({
          id: String(created.id),
          name,
          username,
          email: username.includes("@") ? username : "",
          passHash: "",
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
                <td data-label="الزمن">${formatAuditTime(l.ts)}</td>
                <td data-label="المستخدم">${escapeHTML(l.user)}</td>
                <td data-label="الإجراء">${ACTION_LABELS[l.action] || escapeHTML(l.action)}</td>
                <td data-label="الكيان">${escapeHTML(l.entity)}</td>
                <td data-label="النتيجة"><span class="badge ${l.result === "OK" ? "badge--active" : "badge--danger"}">${escapeHTML(l.result)}</span></td>
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
  const bootstrap = async () => {
    try {
      const pagesUsingContent = ["index", "search", "detail", "dashboard"];
      if (pagesUsingContent.includes(PAGE)) {
        await loadRemoteData();
      }
      initShared();

      switch (PAGE) {
        case "index":
          await initHomePage({ contents: loadContents(), categories: loadCategories() });
          break;
        case "search":
          await initSearchPage({ contents: loadContents(), categories: loadCategories() });
          break;
        case "detail":
          await initDetail();
          break;
        case "login":
          initLogin();
          break;
        case "account":
          initAccount();
          break;
        case "dashboard":
          initDashboard();
          break;
        case "questions":
          await initQuestions();
          break;
        case "lectures":
          await initModularLectures();
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
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap);
  } else {
    bootstrap();
  }
/* ==========================================================================
   تحديثات DSACMS الشاملة (تُلصق في نهاية assets/js/main.js مباشرة)
   1. إصلاح فشل الرفع إلى R2 بعد 100%
   2. إصلاح التحميل للملفات المرفوعة يدوياً وإظهار نسبة التحميل المئوية وحفظ الملف مباشرة
   3. تحويل واجهة الرفع في لوحة التحكم إلى مكون .fu-04 بهوية الموقع
   4. إضافة زر التبديل بين الوضع الداكن والفاتح في شريط التنقل لجميع الصفحات
   ========================================================================== */
(() => {
  // 1. تنسيق الأحجام بالعربية (بايت / كيلوبايت / ميجابايت)
  function formatBytesAr(bytes) {
    const u = ["بايت", "كيلوبايت", "ميجابايت", "جيجابايت"];
    let n = Number(bytes) || 0;
    let i = 0;
    while (n >= 1024 && i < u.length - 1) {
      n /= 1024;
      i++;
    }
    return (
      new Intl.NumberFormat("ar-EG", {
        maximumFractionDigits: n < 10 && i ? 1 : 0,
      }).format(n) +
      " " +
      u[i]
    );
  }

  // 2. منع إرسال ترويسة X-Upload-Token إلى روابط R2 الموقعة مباشرة (يحل مشكلة الفشل بعد 100%)
  const origOpen = XMLHttpRequest.prototype.open;
  const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._dsacmsMethod = String(method || "").toUpperCase();
    this._dsacmsUrl = String(url || "");
    return origOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (
      this._dsacmsMethod === "PUT" &&
      /r2\.cloudflarestorage\.com/i.test(this._dsacmsUrl) &&
      String(name).toLowerCase() === "x-upload-token"
    ) {
      return;
    }
    return origSetHeader.call(this, name, value);
  };

  // 3. تفعيل الوضع الداكن والفاتح (Dark / Light Theme Toggle) في الهيدر لكل الصفحات
  function setupGlobalThemeToggle() {
    const THEME_KEY = "dsacms-theme";
    const rootEl = document.documentElement;

    const isDark = () => {
      const current = rootEl.dataset.theme || localStorage.getItem(THEME_KEY);
      if (current === "dark" || current === "light") return current === "dark";
      return window.matchMedia("(prefers-color-scheme: dark)").matches;
    };

    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "dark" || saved === "light") {
      rootEl.dataset.theme = saved;
    }

    const headerContainer = document.querySelector(".site-header .header-container");
    if (headerContainer && !headerContainer.querySelector(".fu-04__theme")) {
      const btn = document.createElement("button");
      btn.className = "fu-04__theme";
      btn.type = "button";
      btn.setAttribute("aria-pressed", "false");
      btn.setAttribute("aria-label", "التبديل إلى الوضع الداكن");
      btn.innerHTML = `
        <svg class="fu-04__moon" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
          <path d="M20 14.2A8.2 8.2 0 0 1 9.8 4 8.4 8.4 0 1 0 20 14.2" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
        </svg>
        <svg class="fu-04__sun" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
          <circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.7"/>
          <path d="M12 3.2v2M12 18.8v2M3.2 12h2M18.8 12h2M5.9 5.9 7.3 7.3M16.7 16.7l1.4 1.4M18.1 5.9l-1.4 1.4M7.3 16.7l-1.4 1.4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
        </svg>
      `;
      headerContainer.appendChild(btn);
    }

    const syncButtons = () => {
      const dark = isDark();
      document.querySelectorAll(".fu-04__theme").forEach((b) => {
        b.setAttribute("aria-pressed", String(dark));
        b.setAttribute("aria-label", dark ? "التبديل إلى الوضع الفاتح" : "التبديل إلى الوضع الداكن");
        b.title = dark ? "الوضع الفاتح" : "الوضع الداكن";
      });
    };

    document.querySelectorAll(".fu-04__theme").forEach((b) => {
      if (b.dataset.boundTheme) return;
      b.dataset.boundTheme = "1";
      b.addEventListener("click", () => {
        const next = isDark() ? "light" : "dark";
        rootEl.dataset.theme = next;
        localStorage.setItem(THEME_KEY, next);
        syncButtons();
      });
    });

    syncButtons();
  }

  // 4. إصلاح أزرار التحميل: تجاوز سقف 4.5MB في Vercel، إظهار النسبة الحقيقية، وحفظ الملف دون فتحه في تبويب جديد
  function setupEnhancedDownloads() {
    document.addEventListener(
      "click",
      (event) => {
        const button = event.target.closest("[data-download-btn], [data-download-url], .card-download, .download-trigger");
        if (!button) return;

        const rawUrl = button.dataset.downloadUrl || button.getAttribute("href") || "";
        if (!rawUrl || rawUrl === "#" || rawUrl.startsWith("javascript:")) return;

        // نوقف المعالج القديم حتى نستخدم المعالج المحسن الذي يبدأ بالتحميل المباشر أولاً
        event.preventDefault();
        event.stopImmediatePropagation();

        if (button.disabled) return;

        const cardOrWrap = button.closest(".card, .detail-actions, .material-actions, .content-detail, body");
        let status =
          (cardOrWrap && cardOrWrap.querySelector("[data-download-status], .download-status, .download-progress")) ||
          button.nextElementSibling;

        if (!status || !status.classList) {
          status = document.createElement("p");
          status.className = "download-status dsacms-dl-progress-box";
          button.insertAdjacentElement("afterend", status);
        } else {
          status.classList.add("dsacms-dl-progress-box");
        }

        const primaryUrl = rawUrl;
        const backupUrl = button.dataset.backupDownloadUrl;
        const downloadName = button.dataset.downloadName || button.getAttribute("download") || "dsacms-media";

        // استخراج رابط R2 المباشر إذا كان مغلفاً داخل /api/download?url=...
        let directR2Url = backupUrl || primaryUrl;
        try {
          const u = new URL(primaryUrl, window.location.href);
          if (u.pathname.endsWith("/download") && u.searchParams.get("url")) {
            directR2Url = u.searchParams.get("url");
          }
        } catch (_) {}

        function saveBlobAsFile(blob, filename) {
          const blobUrl = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = blobUrl;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(blobUrl), 3000);
        }

        function downloadViaXhr(targetUrl) {
          return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open("GET", targetUrl, true);
            xhr.responseType = "blob";

            button.disabled = true;
            status.hidden = false;
            status.style.setProperty("--download-progress", "2%");
            status.textContent = "جاري بدء التحميل: 0%...";

            xhr.onprogress = (e) => {
              if (e.lengthComputable && e.total > 0) {
                const pct = Math.min(100, Math.round((e.loaded / e.total) * 100));
                status.style.setProperty("--download-progress", `${pct}%`);
                status.textContent = `جاري التحميل: ${pct}% (${formatBytesAr(e.loaded)} من ${formatBytesAr(e.total)})`;
              } else {
                status.style.setProperty("--download-progress", "60%");
                status.textContent = `جاري التحميل: تم تنزيل ${formatBytesAr(e.loaded)}...`;
              }
            };

            xhr.onload = () => {
              if (xhr.status >= 200 && xhr.status < 300 && xhr.response) {
                saveBlobAsFile(xhr.response, downloadName);
                status.style.setProperty("--download-progress", "100%");
                status.textContent = `اكتمل التحميل بنجاح (100% - ${formatBytesAr(xhr.response.size)})`;
                resolve();
              } else {
                reject(new Error(`HTTP ${xhr.status}`));
              }
            };

            xhr.onerror = () => reject(new Error("CORS / Network Error"));
            xhr.send();
          });
        }

        // نبدأ بالتحميل المباشر كـ Blob لتشغيل الحفظ المحلي الفوري
        downloadViaXhr(directR2Url)
          .catch(() => {
            if (primaryUrl && primaryUrl !== directR2Url) {
              return downloadViaXhr(primaryUrl);
            }
            throw new Error("Direct blob failed");
          })
          .catch((err) => {
            console.warn("Direct blob download failed, falling back to browser attachment download:", err);
            status.style.removeProperty("--download-progress");
            status.textContent = "جارٍ بدء التحميل في المتصفح…";

            // بديل موثوق: تحميل كملف مرفق عبر الخادم دون فتح نافذة جديدة
            const apiBase = window.DSACMS_API_BASE || "https://dsacms-backend.vercel.app/api";
            const downloadEndpoint = `${apiBase}/download?url=${encodeURIComponent(directR2Url)}`;
            const hiddenFrame = document.createElement("iframe");
            hiddenFrame.style.display = "none";
            hiddenFrame.src = downloadEndpoint;
            document.body.appendChild(hiddenFrame);
            setTimeout(() => {
              hiddenFrame.remove();
              status.textContent = "تم إرسال طلب التحميل إلى المتصفح.";
            }, 6000);
          })
          .finally(() => {
            button.disabled = false;
          });
      },
      true
    );
  }

  // 5. تحويل أزرار الرفع في لوحة التحكم (#cf-archive-upload و #cf-archive-upload-pdf) تلقائياً إلى مكون .fu-04
  function upgradeDashboardUploadersToFu04() {
    const configs = [
      {
        btnSelector: "#cf-archive-upload",
        inputSelector: "#cf-audio",
        statusSelector: "#cf-audio-upload-status",
        title: "رفع الملف الصوتي",
        hint: "ملف صوتي واحد · حتى 500 ميجابايت",
        accept: ".mp3,.wav,.ogg,.m4a,audio/*",
        maxMb: 500,
        targetType: "audio",
      },
      {
        btnSelector: "#cf-archive-upload-pdf",
        inputSelector: "#cf-pdf",
        statusSelector: "#cf-pdf-upload-status",
        title: "رفع ملف الكتاب (PDF)",
        hint: "ملف PDF · حتى 500 ميجابايت",
        accept: ".pdf,application/pdf",
        maxMb: 500,
        targetType: "pdf",
      },
    ];

    configs.forEach((cfg) => {
      const oldBtn = document.querySelector(cfg.btnSelector);
      const targetUrlInput = document.querySelector(cfg.inputSelector);
      if (!oldBtn || !targetUrlInput || oldBtn.dataset.fuUpgraded) return;
      oldBtn.dataset.fuUpgraded = "1";

      const uid = "fu04-" + cfg.targetType;
      const wrapper = document.createElement("div");
      wrapper.className = "fu-04";
      wrapper.innerHTML = `
        <section class="fu-04__panel" aria-labelledby="${uid}-h">
          <header class="fu-04__head">
            <div>
              <h3 class="fu-04__h" id="${uid}-h">${cfg.title}</h3>
              <p class="fu-04__sub" id="${uid}-hint">${cfg.hint}</p>
            </div>
            <span class="fu-04__count" id="${uid}-count">0</span>
          </header>

          <div class="fu-04__pick">
            <input class="fu-04__input" id="${uid}-file" type="file" accept="${cfg.accept}" aria-describedby="${uid}-hint">
            <label class="fu-04__label" for="${uid}-file">
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false"><path d="M12 5.5v13M5.5 12h13" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>
              اختيار ملف للرفع
            </label>
          </div>

          <ul class="fu-04__list" id="${uid}-list"></ul>
          <p class="fu-04__empty">لم يتم إرفاق أي ملف بعد</p>

          <footer class="fu-04__foot">
            <span class="fu-04__total" id="${uid}-total">0 بايت من ${cfg.maxMb} ميجابايت</span>
            <button class="fu-04__send" id="${uid}-send" type="button" disabled>رفع إلى R2 وتوليد الرابط</button>
          </footer>
          <p class="fu-04__status" id="${uid}-status" role="status" aria-live="polite"></p>
        </section>

        <template id="${uid}-row">
          <li class="fu-04__item">
            <span class="fu-04__chip" data-ext aria-hidden="true"></span>
            <span class="fu-04__meta">
              <span class="fu-04__name" data-name></span>
              <span class="fu-04__size" data-size></span>
            </span>
            <button class="fu-04__rm" type="button" data-rm title="إزالة الملف">
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false"><path d="M6.5 6.5l11 11m0-11-11 11" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>
              <span class="fu-04__vh" data-rmlabel>إزالة الملف</span>
            </button>
          </li>
        </template>
      `;

      // إخفاء الزر القديم ووضع مكون fu-04 مكانه
      const actionsWrap = oldBtn.closest(".archive-upload-actions") || oldBtn;
      actionsWrap.style.display = "none";
      actionsWrap.insertAdjacentElement("afterend", wrapper);

      const fileInput = wrapper.querySelector(`#${uid}-file`);
      const list = wrapper.querySelector(`#${uid}-list`);
      const tpl = wrapper.querySelector(`#${uid}-row`);
      const countEl = wrapper.querySelector(`#${uid}-count`);
      const totalEl = wrapper.querySelector(`#${uid}-total`);
      const sendBtn = wrapper.querySelector(`#${uid}-send`);
      const statusEl = wrapper.querySelector(`#${uid}-status`);
      const picked = [];

      const sync = () => {
        const dt = new DataTransfer();
        picked.forEach((f) => dt.items.add(f));
        fileInput.files = dt.files;
      };

      const render = () => {
        list.replaceChildren(
          ...picked.map((f, i) => {
            const row = tpl.content.firstElementChild.cloneNode(true);
            row.querySelector("[data-ext]").textContent = (f.name.split(".").pop() || "?").slice(0, 4).toUpperCase();
            row.querySelector("[data-name]").textContent = f.name;
            row.querySelector("[data-size]").textContent = formatBytesAr(f.size);
            row.querySelector("[data-rmlabel]").textContent = "إزالة " + f.name;
            row.querySelector("[data-rm]").dataset.rm = i;
            return row;
          })
        );
        countEl.textContent = picked.length;
        totalEl.textContent = `${formatBytesAr(picked.reduce((s, f) => s + f.size, 0))} من ${cfg.maxMb} ميجابايت`;
        sendBtn.disabled = !picked.length;
      };

      fileInput.addEventListener("change", () => {
        picked.length = 0;
        for (const f of fileInput.files) {
          if (f.size > cfg.maxMb * 1024 * 1024) {
            statusEl.textContent = `حجم الملف يتجاوز ${cfg.maxMb} ميجابايت.`;
            continue;
          }
          picked.push(f);
          break;
        }
        sync();
        render();
        if (picked.length) {
          statusEl.textContent = `تم تجهيز "${picked[0].name}" — اضغط (رفع إلى R2 وتوليد الرابط)`;
        }
      });

      list.addEventListener("click", (e) => {
        const rmBtn = e.target.closest("[data-rm]");
        if (!rmBtn) return;
        const [gone] = picked.splice(Number(rmBtn.dataset.rm), 1);
        if (!picked.length) fileInput.value = "";
        sync();
        render();
        statusEl.textContent = gone ? `تمت إزالة "${gone.name}"` : "";
      });

      sendBtn.addEventListener("click", async () => {
        if (!picked.length) return;
        const file = picked[0];
        sendBtn.disabled = true;
        const rowItem = list.querySelector(".fu-04__item");
        const sizeLabel = rowItem ? rowItem.querySelector("[data-size]") : null;

        try {
          statusEl.textContent = "جاري طلب تصريح الرفع من الخادم...";
          const prepared = await fetchApi("/media-upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              filename: file.name,
              contentType: file.type || "application/octet-stream",
              size: file.size,
              title: document.querySelector("#cf-title")?.value || "",
              description: document.querySelector("#cf-description")?.value || "",
            }),
          });

          const uploadUrl = prepared.uploadUrl;
          const isDirectR2 = /r2\.cloudflarestorage\.com/i.test(uploadUrl);

          const uploadedResult = await new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open("PUT", uploadUrl, true);
            if (prepared.contentType || file.type) {
              xhr.setRequestHeader("Content-Type", prepared.contentType || file.type);
            }
            if (prepared.uploadToken && !isDirectR2) {
              xhr.setRequestHeader("X-Upload-Token", prepared.uploadToken);
            }

            xhr.upload.onprogress = (ev) => {
              if (ev.lengthComputable && ev.total > 0) {
                const pct = Math.min(100, Math.round((ev.loaded / ev.total) * 100));
                if (rowItem) rowItem.style.setProperty("--item-progress", `${pct}%`);
                if (sizeLabel) sizeLabel.textContent = `${formatBytesAr(ev.loaded)} / ${formatBytesAr(ev.total)} (${pct}%)`;
                statusEl.textContent = pct < 100 ? `جاري الرفع إلى R2: ${pct}%` : "اكتمل النقل (100%)، جاري تثبيت الملف في R2...";
              }
            };

            xhr.onload = () => {
              if (xhr.status >= 200 && xhr.status < 300) {
                let parsed = null;
                try {
                  parsed = xhr.responseText ? JSON.parse(xhr.responseText) : null;
                } catch (_) {}
                resolve(parsed);
              } else {
                reject(new Error(`رفض الخادم حفظ الملف (كود ${xhr.status})`));
              }
            };

            xhr.onerror = () => reject(new Error("تعذر الاتصال بـ R2 (تأكد من حفظ CORS Policy في حاوية R2)"));
            xhr.send(file);
          });

          const finalUrl = (uploadedResult && uploadedResult.fileUrl) || prepared.fileUrl || prepared.publicUrl;
          if (finalUrl) {
            targetUrlInput.value = finalUrl;
            targetUrlInput.dispatchEvent(new Event("input", { bubbles: true }));
          }
          if (rowItem) rowItem.style.setProperty("--item-progress", "100%");
          statusEl.textContent = "تم رفع الملف إلى R2 وتوليد الرابط بنجاح (100%)!";
        } catch (err) {
          console.error(err);
          statusEl.textContent = `تعذر الرفع: ${err.message || "حاول مجدداً"}`;
        } finally {
          sendBtn.disabled = false;
        }
      });
    });
  }

  function initAllEnhancements() {
    setupGlobalThemeToggle();
    setupEnhancedDownloads();
    upgradeDashboardUploadersToFu04();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initAllEnhancements);
  } else {
    initAllEnhancements();
  }
})();
