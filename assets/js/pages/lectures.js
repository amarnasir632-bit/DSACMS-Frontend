/**
 * DSACMS - Lectures Schedule Page Controller
 * Manages weekly lecture table with loading skeleton, empty state, and retry handling.
 */

import { renderViewState, escapeHtml, formatDate } from "../core/ui-states.js";
import { apiRequest } from "../core/api.js";

export async function initLecturesPage() {
  const tbody = document.getElementById("lectures-table-body");
  const container = document.getElementById("lectures-container") || tbody?.closest(".card") || tbody;
  if (!tbody) return;

  renderViewState(tbody, "loading", { count: 4, type: "rows" });

  try {
    const data = await apiRequest("/lectures");
    const lectures = Array.isArray(data) ? data : data.items || [];

    if (lectures.length === 0) {
      tbody.innerHTML = "";
      renderViewState(container, "empty", {
        title: "لا توجد محاضرات مجدولة لهذا الأسبوع حالياً",
        message: "يتم تحديث جدول المحاضرات والدروس العلمية بشكل دوري. يمكنك متابعة الدروس المسجلة.",
        actionText: "تصفّح الدروس المسجلة",
        actionHref: "search.html?media=audio",
      });
      return;
    }

    renderViewState(tbody, "success", {
      data: lectures,
      render: (items) => {
        tbody.innerHTML = items.map((lec) => `
          <tr>
            <td data-label="اليوم والتاريخ">${formatDate(lec.lecture_date)}</td>
            <td data-label="عنوان الدرس"><strong>${escapeHtml(lec.title)}</strong></td>
            <td data-label="المسجد / المكان">${escapeHtml(lec.mosque || "غير محدد")}</td>
            <td data-label="الوقت">${escapeHtml(lec.lecture_time || "بين المغرب والعشاء")}</td>
          </tr>
        `).join("");
      },
    });
  } catch (err) {
    console.error("Failed to load lectures", err);
    tbody.innerHTML = "";
    renderViewState(container, "error", {
      title: "تعذر تحميل جدول المحاضرات",
      message: "حدث خطأ أثناء الاتصال بالخادم لجلب مواعيد المحاضرات. يرجى إعادة المحاولة.",
      onRetry: () => initLecturesPage(),
    });
  }
}
