/**
 * DSACMS - Core API Client Module
 * Handles unified fetch requests, 10s timeout, credentials, and backend communication.
 */

const DEFAULT_PRODUCTION_API = "https://dsacms-backend.vercel.app/api";

export function getApiBase() {
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
  return DEFAULT_PRODUCTION_API;
}

export function setApiBase(url) {
  if (typeof window !== "undefined") {
    window.DSACMS_API_BASE = url;
    try {
      localStorage.setItem("dsacms_api_base", url);
    } catch (_) {}
  }
}

/**
 * Fetch wrapper with configurable AbortController timeout (default: 25s for serverless cold start)
 */
export async function fetchWithTimeout(resource, options = {}, timeoutMs = 25000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  const customSignal = options.signal;
  if (customSignal) {
    if (customSignal.aborted) {
      clearTimeout(id);
      controller.abort();
    } else {
      customSignal.addEventListener("abort", () => {
        clearTimeout(id);
        controller.abort();
      });
    }
  }

  try {
    const response = await fetch(resource, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    if (error.name === "AbortError") {
      throw new Error(`انتهت مهلة الاتصال بالخادم (${timeoutMs / 1000} ثوانٍ). يرجى التحقق من اتصال الإنترنت.`);
    }
    throw error;
  }
}

/**
 * Unified API Request helper with token fallback and configurable credentials
 */
export async function apiRequest(endpoint, options = {}) {
  const base = getApiBase().replace(/\/$/, "");
  const url = endpoint.startsWith("http") ? endpoint : `${base}${endpoint.startsWith("/") ? "" : "/"}${endpoint}`;

  const headers = {
    Accept: "application/json",
    ...(options.headers || {}),
  };

  // Add Auth header if token exists in session storage
  try {
    const rawSession = localStorage.getItem("dsacms_session_v1");
    if (rawSession) {
      const session = JSON.parse(rawSession);
      if (session && session.token && !headers.Authorization) {
        headers.Authorization = `Bearer ${session.token}`;
      }
    }
  } catch (_) {}

  // Auto-stringify JSON body if plain object
  let body = options.body;
  if (body && typeof body === "object" && !(body instanceof FormData) && !(body instanceof Blob)) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(body);
  }

  // Cross-origin API calls must default to same-origin credentials to avoid CORS failures
  // when the backend does not return Access-Control-Allow-Credentials: true.
  const credentials = options.credentials || "same-origin";

  const response = await fetchWithTimeout(url, {
    ...options,
    headers,
    body,
    credentials,
  }, options.timeout || 25000);

  let data = null;
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    data = await response.json().catch(() => null);
  } else {
    data = await response.text().catch(() => null);
  }

  if (!response.ok) {
    const message = (data && (data.message || data.error)) || `خطأ في الخادم (${response.status})`;
    const err = new Error(message);
    err.status = response.status;
    err.data = data;
    throw err;
  }

  return data;
}

/**
 * Resolve relative media paths to absolute URLs (supports Cloudflare R2 and presigned URLs)
 */
export function resolveMediaUrl(path) {
  if (!path) return "";
  if (path.startsWith("http://") || path.startsWith("https://") || path.startsWith("data:") || path.startsWith("blob:")) {
    return path;
  }
  const base = getApiBase().replace(/\/$/, "");
  return `${base}${path.startsWith("/") ? "" : "/"}${path}`;
}

export function resolveDownloadUrl(path) {
  return resolveMediaUrl(path);
}

export function triggerBlobDownload(blob, filename = "download") {
  const safeName = String(filename || "download")
    .trim()
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ") || "download";

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = safeName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadWithProgress({
  primaryUrl,
  backupUrl,
  filename,
  button,
  statusElement,
}) {
  const finalFilename = String(filename || "dsacms-download").trim() || "dsacms-download";

  const updateStatus = (message, progress = null) => {
    if (statusElement) {
      statusElement.hidden = !message;
      statusElement.textContent = message || "";
      if (typeof progress === "number") {
        statusElement.dataset.progress = String(progress);
      } else {
        delete statusElement.dataset.progress;
      }
    }
  };

  const runDownload = (targetUrl, isBackup = false) => new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", targetUrl, true);
    xhr.responseType = "blob";

    if (button) button.disabled = true;
    updateStatus(isBackup ? "جارٍ التحميل من الأرشيف الاحتياطي…" : "جارٍ تجهيز التحميل…");

    xhr.addEventListener("progress", (event) => {
      if (event.lengthComputable && event.total > 0) {
        const percent = Math.min(100, Math.round((event.loaded / event.total) * 100));
        updateStatus(`جاري التحميل: ${percent}%`, percent);
      } else {
        updateStatus("جاري التحميل… حجم الملف غير متاح من الخادم");
      }
    });

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        triggerBlobDownload(xhr.response, finalFilename);
        updateStatus("اكتمل التحميل.", 100);
        resolve();
        return;
      }

      reject(new Error(`Download failed: ${xhr.status}`));
    });

    xhr.addEventListener("error", () => reject(new Error("Download connection failed")));
    xhr.addEventListener("abort", () => reject(new Error("Download aborted")));
    xhr.send();
  });

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
      updateStatus("تعذر التحميل. حاول مرة أخرى.");
      throw error;
    })
    .finally(() => {
      if (button) button.disabled = false;
    });
}
