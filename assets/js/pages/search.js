/**
 * DSACMS - Search & Browse Page Controller
 * Manages search filters, keyword query, audio filter, and multi-state view machine.
 */

import { renderViewState, filterPublicMaterials, escapeHtml, formatDuration, formatDate } from "../core/ui-states.js";
import { apiRequest, resolveMediaUrl, resolveDownloadUrl } from "../core/api.js";
import { renderMiniPlayer } from "../components/audio-player.js";

const ICONS = {
  author: `<svg class="svg-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
  category: `<svg class="svg-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>`,
  calendar: `<svg class="svg-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
};

export async function initSearchPage(storeData = {}) {
  const grid = document.getElementById("results-grid");
  const countEl = document.getElementById("results-count");
  const countNum = document.getElementById("count-num");
  const qInput = document.getElementById("search-q") || document.getElementById("search-query");
  const form = document.getElementById("search-form");
  const catSel = document.getElementById("filter-category") || document.getElementById("search-category");
  const mediaSel = document.getElementById("filter-media") || document.getElementById("search-media");
  const sortSel = document.getElementById("filter-sort");
  const clearBtn = document.getElementById("clear-filters");
  const emptyEl = document.getElementById("empty-state");
  const loadingEl = document.getElementById("loading-state");

  if (!grid) return;

  // Prevent flash of "عُثر على 0 نتيجة" during load
  if (countNum) {
    countNum.innerHTML = `<span class="skeleton-pulse" style="display:inline-block;width:24px;height:16px;"></span>`;
  }
  if (loadingEl) loadingEl.hidden = true;
  if (emptyEl) emptyEl.hidden = true;

  renderViewState(grid, "loading", { count: 6, type: "cards" });

  let allMaterials = filterPublicMaterials(storeData.contents || []);

  if (!allMaterials.length) {
    try {
      const res = await apiRequest("/content");
      const list = Array.isArray(res) ? res : res.items || [];
      allMaterials = filterPublicMaterials(list);
    } catch (_) {
      const cached = localStorage.getItem("dsacms_contents_v1");
      if (cached) allMaterials = filterPublicMaterials(JSON.parse(cached));
    }
  }

  // Populate category options
  if (catSel && storeData.categories && storeData.categories.length) {
    const currentVal = catSel.value;
    catSel.innerHTML =
      '<option value="">جميع التصنيفات</option>' +
      storeData.categories
        .map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`)
        .join("");
    if (currentVal) catSel.value = currentVal;
  }

  // Parse URL query params
  const params = new URLSearchParams(window.location.search);
  if (qInput && params.has("q")) qInput.value = params.get("q");
  if (catSel && params.has("category")) catSel.value = params.get("category");
  if (mediaSel && params.has("media")) mediaSel.value = params.get("media");
  if (sortSel && params.has("sort")) sortSel.value = params.get("sort");

  function runSearch() {
    const q = (qInput ? qInput.value : "").trim().toLowerCase();
    const cat = catSel ? catSel.value : "";
    const media = mediaSel ? mediaSel.value : "";
    const sort = sortSel ? sortSel.value : "newest";

    let results = allMaterials.filter((item) => {
      // Keyword search in title, author, description
      if (q) {
        const title = (item.title || "").toLowerCase();
        const author = (item.author || "").toLowerCase();
        const desc = (item.description || "").toLowerCase();
        if (!title.includes(q) && !author.includes(q) && !desc.includes(q)) return false;
      }
      // Category filter
      if (cat && item.category !== cat) return false;
      // Media filter
      if (media === "audio" && !item.audio) return false;
      if (media === "no-audio" && item.audio) return false;
      if (media === "book" && item.type !== "book" && !item.pdf) return false;
      if (media === "article" && item.type !== "article") return false;

      return true;
    });

    // Sorting
    results.sort((a, b) => {
      if (sort === "oldest") return new Date(a.pubDate || 0) - new Date(b.pubDate || 0);
      if (sort === "title-asc") return (a.title || "").localeCompare(b.title || "", "ar");
      if (sort === "title-desc") return (b.title || "").localeCompare(a.title || "", "ar");
      return new Date(b.pubDate || 0) - new Date(a.pubDate || 0);
    });

    // Update count display smoothly
    if (countNum) {
      countNum.textContent = String(results.length);
    }
    if (countEl) {
      countEl.removeAttribute("aria-busy");
    }

    if (results.length === 0) {
      renderViewState(grid, "empty", {
        title: "لم يتم العثور على أي نتائج",
        message: "لم نجد أي مادة مطابقة لمعايير البحث المحددة. جرب كلمة بحث أخرى أو أعد ضبط الفلاتر.",
        actionText: "إعادة ضبط جميع الفلاتر",
        onAction: () => {
          if (qInput) qInput.value = "";
          if (catSel) catSel.value = "";
          if (mediaSel) mediaSel.value = "";
          if (sortSel) sortSel.value = "newest";
          runSearch();
        },
      });
      return;
    }

    renderViewState(grid, "success", {
      data: results,
      render: (items) => {
        grid.innerHTML = items.map((c) => buildSearchCard(c, storeData.categories)).join("");
        grid.querySelectorAll("[data-mini]").forEach((btn) => {
          const item = items.find((x) => x.id === btn.dataset.contentId);
          if (item) renderMiniPlayer(btn, item);
        });
      },
    });
  }

  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      runSearch();
    });
  }

  [qInput, catSel, mediaSel, sortSel].forEach((el) => {
    if (el) el.addEventListener("change", runSearch);
  });

  if (qInput) {
    let debounceTimer;
    qInput.addEventListener("input", () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(runSearch, 300);
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      if (qInput) qInput.value = "";
      if (catSel) catSel.value = "";
      if (mediaSel) mediaSel.value = "";
      if (sortSel) sortSel.value = "newest";
      runSearch();
    });
  }

  // Initial execution
  runSearch();
}

function buildSearchCard(c, categories = []) {
  const cat = Array.isArray(categories) ? categories.find((x) => x.id === c.category) : null;
  const hasAudio = !!c.audio;
  const type = c.type || (hasAudio ? "audio" : "article");
  const typeLabel = type === "book" ? "كتاب PDF" : type === "article" ? "مقال مكتوب" : "مادة صوتية";

  const durationText = c.duration ? formatDuration(c.duration) : "";
  const durationChip = durationText
    ? ` · ${durationText}`
    : (hasAudio ? ` · <span class="badge--audio-chip">ملف صوتي</span>` : "");

  const detailUrl = `content-detail.html?id=${encodeURIComponent(c.id)}`;
  const downloadUrl = c.audio || c.pdf || "";
  const downloadLabel = c.audio ? "تحميل الصوت" : c.pdf ? "تحميل PDF" : "";

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
          <li>${ICONS.calendar} ${formatDate(c.pubDate)}</li>
        </ul>
        <p class="item-excerpt">${escapeHtml(c.description || "")}</p>
        <div class="item-actions">
          <a class="btn btn--outline btn--sm" href="${detailUrl}">تفاصيل المادة</a>
          ${downloadUrl
            ? `<a class="btn btn--accent btn--sm card-download" href="${escapeHtml(resolveDownloadUrl(downloadUrl))}" download>${downloadLabel}</a>`
            : ""}
        </div>
      </div>
    </article>
  `;
}
