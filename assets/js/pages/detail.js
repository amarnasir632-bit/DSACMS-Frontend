/**
 * DSACMS - Material Detail Page Controller
 * Manages single material view, full audio player with failover, PDF failover, and downloads.
 */

import { renderViewState, escapeHtml, formatDuration, formatDate } from "../core/ui-states.js";
import { apiRequest, resolveMediaUrl, resolveDownloadUrl, downloadWithProgress } from "../core/api.js";
import { renderFullPlayer } from "../components/audio-player.js";

const ICONS = {
  author: `<svg class="svg-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
  category: `<svg class="svg-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>`,
  calendar: `<svg class="svg-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
  clock: `<svg class="svg-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
};

export async function initDetailPage(storeData = {}) {
  const container = document.getElementById("detail-wrap") || document.getElementById("detail-content") || document.getElementById("main");
  if (!container) return;

  const urlParams = new URLSearchParams(window.location.search);
  const id = urlParams.get("id");

  if (!id) {
    renderViewState(container, "error", {
      title: "معرّف المادة مفقود",
      message: "لم يتم تحديد المادة العلمية المطلوبة. يرجى الرجوع لصفحة تصفح المحتوى.",
    });
    return;
  }

  renderViewState(container, "loading", { count: 1, type: "box" });

  try {
    let item = null;
    const contents = storeData.contents || [];
    item = contents.find((c) => String(c.id) === String(id) || String(c.slug || "") === String(id));

    if (!item) {
      try {
        const res = await apiRequest("/materials");
        const list = Array.isArray(res) ? res : res.items || [];
        item = list.find((c) => String(c.id) === String(id) || String(c.slug || "") === String(id));
      } catch (_) {}
    }

    if (!item) {
      renderViewState(container, "empty", {
        title: "المادة غير موجودة",
        message: "قد تكون المادة حُذفت أو تم تعديل رابطها.",
        actionText: "تصفّح المحتوى",
        actionHref: "search.html",
      });
      return;
    }

    renderViewState(container, "success", {
      data: item,
      render: (m) => renderMaterialDetail(container, m, storeData.categories),
    });
  } catch (err) {
    console.error("Failed to load material detail", err);
    renderViewState(container, "error", {
      title: "تعذر تحميل المادة",
      message: "حدث خطأ أثناء جلب تفاصيل المادة من الخادم.",
      onRetry: () => initDetailPage(storeData),
    });
  }
}

function renderMaterialDetail(container, m, categories = []) {
  const cat = Array.isArray(categories) ? categories.find((x) => x.id === m.category) : null;
  const hasAudio = !!m.audio;
  const hasPdf = !!m.pdf;
  const typeLabel = m.type === "book" ? "كتاب PDF" : m.type === "article" ? "مقال مكتوب" : "مادة صوتية";

  const primaryAudio = m.audio ? resolveMediaUrl(m.audio) : "";
  const backupAudio = (m.audioArchive || m.archiveUrl) && (m.audioArchive || m.archiveUrl) !== m.audio
    ? resolveMediaUrl(m.audioArchive || m.archiveUrl)
    : null;

  const primaryPdf = m.pdf ? resolveMediaUrl(m.pdf) : "";
  const backupPdf = (m.pdfArchive || m.archiveUrl) && (m.pdfArchive || m.archiveUrl) !== m.pdf
    ? resolveMediaUrl(m.pdfArchive || m.archiveUrl)
    : null;

  const durationStr = m.duration ? formatDuration(m.duration) : "";

  container.innerHTML = `
    <article class="detail-card">
      <header class="detail-head">
        <span class="badge badge--primary">${escapeHtml(typeLabel)}</span>
        <h1>${escapeHtml(m.title)}</h1>
        <ul class="item-meta">
          <li>${ICONS.author} ${escapeHtml(m.author || "الشيخ محمد أحمد الهادي")}</li>
          <li>${ICONS.category} ${cat ? escapeHtml(cat.name) : "عام"}</li>
          <li>${ICONS.calendar} ${formatDate(m.pubDate)}</li>
          ${durationStr ? `<li>${ICONS.clock} ${durationStr}</li>` : ""}
        </ul>
      </header>

      ${hasAudio ? `<div id="detail-player-wrapper" style="margin-block:var(--space-4);"></div>` : ""}

      <div class="detail-body prose" style="margin-block:var(--space-4);">
        <p>${escapeHtml(m.description || "")}</p>
      </div>

      ${hasPdf ? `
        <div class="pdf-viewer-section" style="margin-block:var(--space-5);">
          <h3>ملف المادة المرفق (PDF)</h3>
          <iframe src="${escapeHtml(primaryPdf)}" title="قارئ PDF" width="100%" height="600" style="border:1px solid var(--color-border);border-radius:var(--radius-md);"></iframe>
        </div>
      ` : ""}

      <footer class="detail-actions" style="margin-block-start:var(--space-5);display:flex;gap:var(--space-3);flex-wrap:wrap;align-items:center;">
        ${hasAudio ? (() => {
          const audioExtMatch = String(m.audio || primaryAudio || "").split("?")[0].match(/\.(mp3|m4a|wav|ogg|aac|flac)$/i);
          const audioExt = audioExtMatch ? "." + audioExtMatch[1].toLowerCase() : ".mp3";
          const audioName = `${(m.title || "مادة-صوتية").trim()}${audioExt}`;
          return `
          <div class="download-item">
            <button type="button" class="btn btn--accent download-trigger"
              data-download-btn="1"
              data-download-url="${escapeHtml(resolveDownloadUrl(primaryAudio, audioName))}"
              data-backup-download-url="${escapeHtml(resolveDownloadUrl(backupAudio || '', audioName))}"
              data-download-name="${escapeHtml(audioName)}">تحميل الملف الصوتي</button>
            <div class="download-progress" role="status" aria-live="polite" hidden></div>
          </div>
        `;
        })() : ""}
        ${hasPdf ? (() => {
          const pdfExtMatch = String(m.pdf || primaryPdf || "").split("?")[0].match(/\.(pdf|docx?|zip)$/i);
          const pdfExt = pdfExtMatch ? "." + pdfExtMatch[1].toLowerCase() : ".pdf";
          const pdfName = `${(m.title || "كتاب-علمي").trim()}${pdfExt}`;
          return `
          <div class="download-item">
            <button type="button" class="btn btn--primary download-trigger"
              data-download-btn="1"
              data-download-url="${escapeHtml(resolveDownloadUrl(primaryPdf, pdfName))}"
              data-backup-download-url="${escapeHtml(resolveDownloadUrl(backupPdf || '', pdfName))}"
              data-download-name="${escapeHtml(pdfName)}">تحميل ملف PDF</button>
            <div class="download-progress" role="status" aria-live="polite" hidden></div>
          </div>
        `;
        })() : ""}
        <a class="btn btn--outline" href="search.html">← العودة لتصفّح المحتوى</a>
      </footer>
    </article>
  `;

  if (hasAudio) {
    renderFullPlayer("#detail-player-wrapper", {
      id: m.id,
      title: m.title,
      src: primaryAudio,
      backupSrc: backupAudio,
      duration: m.duration,
    });
  }

  container.querySelectorAll(".download-trigger").forEach((button) => {
    const status = button.parentElement?.querySelector(".download-progress");
    button.addEventListener("click", () => {
      downloadWithProgress({
        primaryUrl: button.dataset.downloadUrl,
        backupUrl: button.dataset.backupDownloadUrl,
        filename: button.dataset.downloadName,
        button,
        statusElement: status,
      }).catch(() => { });
    });
  });
}
