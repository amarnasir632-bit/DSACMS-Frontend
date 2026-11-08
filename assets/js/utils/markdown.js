import { escapeHtml } from "../core/ui-states.js";

function inlineMarkdown(text) {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>");
}

/** Converts the supported Markdown subset to safe HTML. */
export function renderMarkdownToHtml(rawText) {
  const source = Array.isArray(rawText) ? rawText.join("\n\n") : String(rawText || "");
  const lines = source.replace(/\r/g, "").split("\n");
  const out = [];
  let paragraph = [];
  let list = "";
  let quote = [];
  const flushParagraph = () => { if (paragraph.length) { out.push(`<p>${inlineMarkdown(paragraph.join(" "))}</p>`); paragraph = []; } };
  const flushList = () => { if (list) { out.push(`</${list}>`); list = ""; } };
  const flushQuote = () => { if (quote.length) { out.push(`<blockquote>${quote.map((line) => `<p>${inlineMarkdown(line)}</p>`).join("")}</blockquote>`); quote = []; } };
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) { flushParagraph(); flushList(); flushQuote(); continue; }
    if (/^---+$/.test(trimmed)) { flushParagraph(); flushList(); flushQuote(); out.push("<hr>"); continue; }
    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) { flushParagraph(); flushList(); flushQuote(); out.push(`<h${heading[1].length}>${inlineMarkdown(heading[2])}</h${heading[1].length}>`); continue; }
    if (trimmed.startsWith(">")) { flushParagraph(); flushList(); quote.push(trimmed.replace(/^>\s?/, "")); continue; }
    if (/﴿[^﴾]+﴾/.test(trimmed)) { flushParagraph(); flushList(); quote.push(trimmed); continue; }
    const unordered = trimmed.match(/^[-*]\s+(.+)$/);
    const ordered = trimmed.match(/^\d+\.\s+(.+)$/);
    if (unordered || ordered) {
      flushParagraph(); flushQuote();
      const type = unordered ? "ul" : "ol";
      if (list && list !== type) flushList();
      if (!list) { list = type; out.push(`<${list}>`); }
      out.push(`<li>${inlineMarkdown((unordered || ordered)[1])}</li>`); continue;
    }
    flushList(); flushQuote(); paragraph.push(trimmed);
  }
  flushParagraph(); flushList(); flushQuote();
  return out.join("\n");
}
