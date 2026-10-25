/**
 * DSACMS - UI States & Skeleton Loaders Module
 * Manages loading skeletons, empty states, error alerts with retry, and toasts.
 */

export function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  if (s <= 0) return "";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

export function formatDate(dateStr) {
  if (!dateStr) return "غير محدد";
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  return new Intl.DateTimeFormat("ar", { year: "numeric", month: "long", day: "numeric" }).format(d);
}

/**
 * Filter out invalid / single-character test items from public displays
 */
export function filterPublicMaterials(items) {
  if (!Array.isArray(items)) return [];
  return items.filter((item) => {
    if (!item || !item.title) return false;
    const cleanTitle = String(item.title).trim();
    // Exclude junk test records like single character 'ل'
    return cleanTitle.length >= 2;
  });
}

/**
 * Toast notifications with auto-dismiss and accessibility support
 */
export function showToast(message, type = "info", duration = 4000) {
  let region = document.getElementById("toast-region");
  if (!region) {
    region = document.createElement("div");
    region.id = "toast-region";
    region.className = "toast-region";
    region.setAttribute("aria-live", "polite");
    region.setAttribute("aria-atomic", "true");
    document.body.appendChild(region);
  }

  const toast = document.createElement("div");
  toast.className = `toast toast--${type}`;
  toast.setAttribute("role", type === "error" ? "alert" : "status");
  toast.textContent = message;

  region.appendChild(toast);

  const timeoutId = setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(8px)";
    setTimeout(() => toast.remove(), 300);
  }, duration);

  toast.addEventListener("click", () => {
    clearTimeout(timeoutId);
    toast.remove();
  });
}

/**
 * Unified View State Machine (UI State Machine)
 * Supports: 'loading' | 'empty' | 'error' | 'success'
 */
export function renderViewState(container, state, options = {}) {
  const root = typeof container === "string" ? document.querySelector(container) : container;
  if (!root) return;

  if (state === "loading") {
    root.setAttribute("aria-busy", "true");
    const count = options.count || 3;
    const type = options.type || "cards";

    if (type === "cards") {
      let html = "";
      for (let i = 0; i < count; i++) {
        html += `
          <div class="skeleton-card" aria-hidden="true">
            <div class="skeleton-media-box"></div>
            <div class="skeleton-line skeleton-line--title"></div>
            <div class="skeleton-line skeleton-line--meta"></div>
            <div class="skeleton-line skeleton-line--text"></div>
          </div>
        `;
      }
      root.innerHTML = html;
    } else if (type === "rows") {
      let html = "";
      for (let i = 0; i < count; i++) {
        html += `
          <tr class="skeleton-row" aria-hidden="true">
            <td><div class="skeleton-row-line" style="width:70%;"></div></td>
            <td><div class="skeleton-row-line" style="width:40%;"></div></td>
            <td><div class="skeleton-row-line" style="width:50%;"></div></td>
            <td><div class="skeleton-row-line" style="width:30%;"></div></td>
          </tr>
        `;
      }
      root.innerHTML = html;
    } else if (type === "categories") {
      let html = "";
      for (let i = 0; i < count; i++) {
        html += `
          <div class="skeleton-card" style="padding:var(--space-3);" aria-hidden="true">
            <div class="skeleton-line" style="width:60%; height:20px; margin:auto;"></div>
          </div>
        `;
      }
      root.innerHTML = html;
    } else {
      root.innerHTML = `<div class="skeleton-box" style="width:100%; height:120px;" aria-hidden="true"></div>`;
    }
  } else if (state === "empty") {
    root.removeAttribute("aria-busy");
    const title = options.title || "لم يتم العثور على أي عناصر";
    const message = options.message || "لا توجد مواد متوفرة حالياً ضمن هذا القسم.";
    const actionText = options.actionText || "";
    const actionHref = options.actionHref || "";

    root.innerHTML = `
      <div class="view-state-empty" role="status">
        <div class="state-icon" aria-hidden="true">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
        </div>
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(message)}</p>
        ${actionText && actionHref
          ? `<a href="${escapeHtml(actionHref)}" class="btn btn--outline btn--sm">${escapeHtml(actionText)}</a>`
          : actionText && options.onAction
          ? `<button type="button" class="btn btn--outline btn--sm btn-state-action">${escapeHtml(actionText)}</button>`
          : ""
        }
      </div>
    `;

    if (options.onAction) {
      const btn = root.querySelector(".btn-state-action");
      if (btn) btn.addEventListener("click", options.onAction);
    }
  } else if (state === "error") {
    root.removeAttribute("aria-busy");
    const message = options.message || "تعذر تحميل البيانات من الخادم في الوقت الحالي.";
    const title = options.title || "حدث خطأ أثناء جلب البيانات";

    root.innerHTML = `
      <div class="view-state-error" role="alert">
        <div class="state-icon" aria-hidden="true">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
        </div>
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(message)}</p>
        ${options.onRetry
          ? `<button type="button" class="btn-retry" aria-label="إعادة المحاولة">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <polyline points="23 4 23 10 17 10"/>
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
              </svg>
              إعادة المحاولة
            </button>`
          : ""
        }
      </div>
    `;

    if (options.onRetry) {
      const retryBtn = root.querySelector(".btn-retry");
      if (retryBtn) {
        retryBtn.addEventListener("click", (e) => {
          e.preventDefault();
          options.onRetry();
        });
      }
    }
  } else if (state === "success") {
    root.removeAttribute("aria-busy");
    if (typeof options.render === "function") {
      const rawData = options.data || [];
      const cleanData = Array.isArray(rawData) ? filterPublicMaterials(rawData) : rawData;
      options.render(cleanData);
    }
  }
}
