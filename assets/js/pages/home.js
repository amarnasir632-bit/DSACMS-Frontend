/**
 * DSACMS - Home Page Controller
 * Manages stats with skeleton loaders, latest audio cards, categories, and lectures.
 */

import { renderViewState, filterPublicMaterials, escapeHtml, formatDuration, formatDate } from "../core/ui-states.js";
import { apiRequest, resolveMediaUrl, resolveDownloadUrl, downloadWithProgress } from "../core/api.js";
import { renderMiniPlayer } from "../components/audio-player.js";

const ICONS = {
  author: `<svg class="svg-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
  category: `<svg class="svg-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>`,
  calendar: `<svg class="svg-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
  clock: `<svg class="svg-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  location: `<svg class="svg-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-6-5.333-6-10a6 6 0 0 1 12 0c0 4.667-6 10-6 10z"/><circle cx="12" cy="11" r="2.5"/></svg>`,
};

export async function initHomePage(storeData = {}) {
  // 1) Initialize Statistics with Skeletons
  initHeroStats(storeData);

  // 2) Load & Render Latest Audio Materials
  await loadLatestAudio(storeData);

  // 3) Render Categories Grid
  renderCategoriesGrid(storeData);

  // 4) Load Upcoming Lectures
  loadHomeLectures();
}

/**
 * Initializes and populates statistics counters without initial raw zeros
 */
function initHeroStats(storeData) {
  const statContent = document.getElementById("stat-content");
  const statAudio = document.getElementById("stat-audio");
  const statArticles = document.getElementById("stat-articles");
  const statBooks = document.getElementById("stat-books");
  const statCats = document.getElementById("stat-categories");

  const pub = filterPublicMaterials(storeData.contents || []);
  const cats = storeData.categories || [];

  if (pub.length > 0 || cats.length > 0) {
    if (statContent) statContent.innerHTML = escapeHtml(pub.length);
    if (statAudio) statAudio.innerHTML = escapeHtml(pub.filter((c) => c.audio || c.audio_url).length);
    if (statArticles) statArticles.innerHTML = escapeHtml(pub.filter((c) => c.type === "article" || c.content_type === "article").length);
    if (statBooks) statBooks.innerHTML = escapeHtml(pub.filter((c) => c.type === "book" || c.content_type === "book").length);
    if (statCats) statCats.innerHTML = escapeHtml(cats.length);
  }
}

/**
 * Loads latest audio items with state machine (loading, empty, error with retry, success)
 */
async function loadLatestAudio(storeData) {
  const container = document.getElementById("latest-grid");
  if (!container) return;

  renderViewState(container, "loading", { count: 3, type: "cards" });

  try {
    let contents = storeData.contents || [];
    if (!contents.length) {
      try {
        const res = await apiRequest("/materials");
        contents = Array.isArray(res) ? res : res.items || [];
      } catch (_) {
        // Fallback to local storage if API is temporarily unavailable
        const cached = localStorage.getItem("dsacms_contents_v1");
        if (cached) contents = JSON.parse(cached);
      }
    }

    const clean = filterPublicMaterials(contents);
    const audioItems = clean
      .filter((c) => c.audio || c.audio_url)
      .sort((a, b) => new Date(b.pubDate || b.published_at || b.created_at || 0) - new Date(a.pubDate || a.published_at || a.created_at || 0))
      .slice(0, 6);

    if (audioItems.length === 0) {
      renderViewState(container, "empty", {
        title: "لا توجد مواد صوتية منشورة حالياً",
        message: "سيتم إضافة أحدث المواد الصوتية والدروس قريباً بإذن الله.",
        actionText: "تصفّح جميع المواد",
        actionHref: "pages/search.html",
      });
      return;
    }

    renderViewState(container, "success", {
      data: audioItems,
      render: (items) => {
        container.innerHTML = items.map((c) => buildContentCard(c, storeData.categories)).join("");
        container.querySelectorAll(".card-download").forEach((button) => {
          const status = button.parentElement?.querySelector(".download-progress");
          if (status) {
            button.addEventListener("click", () => {
              downloadWithProgress({
                primaryUrl: button.dataset.downloadUrl,
                backupUrl: button.dataset.backupDownloadUrl,
                filename: button.dataset.downloadName,
                button,
                statusElement: status,
              }).catch(() => {});
            });
          }
        });
        // Connect mini players
        container.querySelectorAll("[data-mini]").forEach((btn) => {
          const item = items.find((x) => String(x.id) === String(btn.dataset.contentId));
          if (item) renderMiniPlayer(btn, item);
        });
      },
    });

    // Update stats with accurate live counts
    initHeroStats({ contents: clean, categories: storeData.categories });
  } catch (err) {
    console.error("Failed to load latest audio", err);
    renderViewState(container, "error", {
      title: "تعذر تحميل المواد الصوتية",
      message: "حدث خطأ أثناء الاتصال بالخادم. يرجى الضغط على زر إعادة المحاولة.",
      onRetry: () => loadLatestAudio(storeData),
    });
  }
}

function buildContentCard(c, categories = []) {
  const cat = Array.isArray(categories) ? categories.find((x) => String(x.id) === String(c.category || c.category_id)) : null;
  const audioSrc = c.audio || c.audio_url || "";
  const pdfSrc = c.pdf || c.document_url || "";
  const hasAudio = !!audioSrc;
  const type = c.type || c.content_type || (hasAudio ? "audio" : "article");
  const typeLabel = type === "book" ? "كتاب PDF" : type === "article" ? "مقال مكتوب" : "مادة صوتية";
  
  // Format duration or fallback to badge
  const durSeconds = c.duration || c.duration_seconds;
  const durationText = durSeconds ? formatDuration(durSeconds) : "";
  const durationChip = durationText
    ? ` · ${durationText}`
    : (hasAudio ? ` · <span class="badge--audio-chip">ملف صوتي</span>` : "");

  const detailUrl = `pages/content-detail.html?id=${encodeURIComponent(c.id)}`;
  const downloadUrl = audioSrc || pdfSrc || "";
  const downloadLabel = audioSrc ? "تحميل الصوت" : pdfSrc ? "تحميل PDF" : "";
  const backupDownloadUrl = (c.audioArchive || c.archiveUrl || c.pdfArchive) && ((c.audioArchive || c.archiveUrl || c.pdfArchive) !== downloadUrl)
    ? (c.audioArchive || c.archiveUrl || c.pdfArchive)
    : "";

  return `
    <article class="card item-card">
      <div class="item-media">
        ${hasAudio
          ? `<button type="button" class="btn btn--primary btn--sm" data-mini data-content-id="${escapeHtml(c.id)}" aria-label="تشغيل ${escapeHtml(c.title)}">تشغيل</button>`
          : ""}
        <span class="duration">${typeLabel}${durationChip}</span>
      </div>
      <div class="item-body">
        <h3><a href="${detailUrl}">${escapeHtml(c.title)}</a></h3>
        <ul class="item-meta">
          <li>${ICONS.author} ${escapeHtml(c.author || "الشيخ محمد أحمد الهادي")}</li>
          <li>${ICONS.category} ${cat ? escapeHtml(cat.name) : "عام"}</li>
          <li>${ICONS.calendar} ${formatDate(c.pubDate || c.published_at || c.created_at)}</li>
        </ul>
        <p class="item-excerpt">${escapeHtml(c.description || "")}</p>
        <div class="item-actions">
          <a class="btn btn--outline btn--sm" href="${detailUrl}">تفاصيل المادة</a>
          ${downloadUrl
            ? (() => {
                const safeExt = audioSrc ? ".m4a" : ".pdf";
                const dlName = (c.title || "dsacms-download") + safeExt;
                return `<div class="download-item">
                  <button type="button" class="btn btn--accent btn--sm card-download download-trigger"
                    data-download-btn="1"
                    data-download-url="${escapeHtml(resolveDownloadUrl(downloadUrl, dlName))}"
                    data-backup-download-url="${escapeHtml(resolveDownloadUrl(backupDownloadUrl, dlName))}"
                    data-download-name="${escapeHtml(dlName)}">${downloadLabel}</button>
                  <div class="download-progress" role="status" aria-live="polite" hidden></div>
                </div>`;
              })()
            : ""}
        </div>
      </div>
    </article>
  `;
}

async function renderCategoriesGrid(storeData) {
  const grid = document.getElementById("categories-grid");
  if (!grid) return;

  let cats = storeData.categories || [];
  if (!cats.length) {
    try {
      const res = await apiRequest("/categories");
      cats = Array.isArray(res) ? res : res.items || [];
    } catch (_) {}
  }

  const pub = filterPublicMaterials(storeData.contents || []);

  if (!cats.length) {
    grid.innerHTML = `<p class="section-desc">لا توجد تصنيفات معرّفة حالياً.</p>`;
    return;
  }

  grid.innerHTML = cats
    .map((c) => {
      const count = pub.filter((x) => String(x.category || x.category_id) === String(c.id)).length;
      return `
        <a class="card category-card" href="pages/search.html?category=${encodeURIComponent(c.id)}" aria-label="تصنيف ${escapeHtml(c.name)} — ${count} مادة">
          <span class="cat-emoji" aria-hidden="true">${c.icon || "📚"}</span>
          <span>
            <h3>${escapeHtml(c.name)}</h3>
            <p>${count} مادة</p>
          </span>
        </a>
      `;
    })
    .join("");
}

async function loadHomeLectures() {
  const container = document.getElementById("upcoming-lectures-list");
  if (!container) return;

  try {
    const entries = await apiRequest("/lectures").catch(() => []);
    const now = new Date();
    const list = Array.isArray(entries) ? entries : entries.items || [];
    const upcoming = list
      .filter((lec) => lec.lecture_date && new Date(lec.lecture_date) >= now)
      .slice(0, 3);

    if (upcoming.length === 0) {
      container.innerHTML = `<p class="section-desc upcoming-lectures-empty">لا توجد محاضرات قادمة معلنة حاليًا. <a href="pages/lectures.html">افتح جدول المحاضرات</a>.</p>`;
      return;
    }

    container.innerHTML = upcoming.map((lecture) => `
      <article class="upcoming-lecture-card">
        <div class="upcoming-lecture-date">${formatDate(lecture.lecture_date)}</div>
        <h3>${escapeHtml(lecture.title)}</h3>
        <p class="upcoming-lecture-mosque">${ICONS.location} ${escapeHtml(lecture.mosque || "")}</p>
        <p class="upcoming-lecture-time">${ICONS.clock} ${escapeHtml(lecture.lecture_time || "")}</p>
      </article>
    `).join("");
  } catch (_) {
    container.innerHTML = `<p class="section-desc upcoming-lectures-empty">تعذر تحميل المواعيد الآن. <a href="pages/lectures.html">افتح جدول المحاضرات</a>.</p>`;
  }
}
