export const config = {
  runtime: "edge",
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Expose-Headers": "Content-Length, Content-Type, Content-Disposition, Accept-Ranges, Content-Range",
};

function detectExtension(targetUrl, contentType = "") {
  try {
    const pathname = new URL(targetUrl).pathname;
    const match = pathname.match(/\.(mp3|m4a|wav|ogg|aac|flac|pdf|docx?|zip)$/i);
    if (match) return "." + match[1].toLowerCase();
  } catch (_) {}
  const ct = String(contentType).toLowerCase();
  if (ct.includes("mpeg") || ct.includes("mp3")) return ".mp3";
  if (ct.includes("mp4") || ct.includes("m4a")) return ".m4a";
  if (ct.includes("ogg")) return ".ogg";
  if (ct.includes("wav")) return ".wav";
  if (ct.includes("pdf")) return ".pdf";
  return ".mp3";
}

function sanitizeDownloadFilename(rawName, targetUrl, contentType = "") {
  const realExt = detectExtension(targetUrl, contentType);
  let base = String(rawName || "")
    .trim()
    .replace(/[\/\\:*?"<>|\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!base || /^dsacms-(media|download|audio|doc)$/i.test(base.replace(/\.[a-z0-9]+$/i, ""))) {
    try {
      const urlFile = decodeURIComponent(new URL(targetUrl).pathname.split("/").pop() || "");
      base = urlFile || "ملف-صوتي";
    } catch (_) {
      base = "ملف-صوتي";
    }
  }

  // إزالة أي امتداد قديم ووضع الامتداد الحقيقي للملف
  base = base.replace(/\.(mp3|m4a|wav|ogg|aac|flac|pdf|docx?|zip)$/i, "").trim();
  return `${base || "ملف-صوتي"}${realExt}`;
}

export default async function handler(req) {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const reqUrl = new URL(req.url);
  const targetUrl = reqUrl.searchParams.get("url");
  const requestedName = reqUrl.searchParams.get("filename") || "";

  if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
    return new Response(JSON.stringify({ error: "رابط الملف غير صالح" }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" },
    });
  }

  try {
    const upstreamHeaders = new Headers();
    const range = req.headers.get("range");
    if (range) upstreamHeaders.set("Range", range);
    upstreamHeaders.set("User-Agent", "DSACMS-Edge-Downloader/2.0");

    const upstream = await fetch(targetUrl, {
      method: req.method === "HEAD" ? "HEAD" : "GET",
      headers: upstreamHeaders,
      redirect: "follow",
    });

    if (!upstream.ok && upstream.status !== 206) {
      return Response.redirect(targetUrl, 302);
    }

    const upstreamType = upstream.headers.get("content-type") || "application/octet-stream";
    const finalFilename = sanitizeDownloadFilename(requestedName, targetUrl, upstreamType);
    const asciiFallback = finalFilename.replace(/[^\x20-\x7E]/g, "_") || "download" + detectExtension(targetUrl, upstreamType);
    const encodedUTF8 = encodeURIComponent(finalFilename);

    const resHeaders = new Headers(CORS_HEADERS);
    resHeaders.set("Content-Type", "application/octet-stream");
    resHeaders.set(
      "Content-Disposition",
      `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodedUTF8}`
    );

    const contentLength = upstream.headers.get("content-length");
    if (contentLength) resHeaders.set("Content-Length", contentLength);

    const contentRange = upstream.headers.get("content-range");
    if (contentRange) resHeaders.set("Content-Range", contentRange);

    const acceptRanges = upstream.headers.get("accept-ranges");
    if (acceptRanges) resHeaders.set("Accept-Ranges", acceptRanges);

    resHeaders.set("Cache-Control", "public, max-age=3600");

    return new Response(upstream.body, {
      status: upstream.status,
      headers: resHeaders,
    });
  } catch (err) {
    return Response.redirect(targetUrl, 302);
  }
}
