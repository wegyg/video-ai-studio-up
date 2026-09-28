/**
 * Reference material extraction.
 *
 * The user can paste a homepage URL or free-text notes. If it looks like a URL
 * we fetch the page and strip it to readable text; otherwise we use the text
 * as-is. The result is passed to the plan generator so the promo is tailored to
 * the brand/product. No API keys — a plain fetch + HTML strip.
 */

const URL_RE = /^https?:\/\/\S+$/i;

function looksLikeUrl(s: string): boolean {
  const t = s.trim();
  return URL_RE.test(t.split(/\s+/)[0]) && t.split(/\s+/).length <= 3;
}

/** Very small HTML -> text: drop scripts/styles/tags, collapse whitespace. */
function htmlToText(html: string): string {
  let t = html;
  t = t.replace(/<script[\s\S]*?<\/script>/gi, " ");
  t = t.replace(/<style[\s\S]*?<\/style>/gi, " ");
  t = t.replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  // keep meta description + title as strong signals
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").trim();
  const desc = (html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']+)["']/i)?.[1] || "").trim();
  const ogDesc = (html.match(/<meta[^>]+property=["']og:description["'][^>]*content=["']([^"']+)["']/i)?.[1] || "").trim();
  t = t.replace(/<[^>]+>/g, " ");
  t = t.replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"');
  t = t.replace(/\s+/g, " ").trim();
  const lead = [title, desc || ogDesc].filter(Boolean).join(". ");
  const body = (lead ? lead + ". " : "") + t;
  return body;
}

export interface ReferenceResult {
  text: string; // extracted/normalized reference text (may be empty)
  source: "url" | "notes" | "none";
  url?: string;
}

/** Resolve reference input into usable text (capped length). */
export async function resolveReference(input: string | undefined, maxChars = 1500): Promise<ReferenceResult> {
  const raw = (input || "").trim();
  if (!raw) return { text: "", source: "none" };

  if (looksLikeUrl(raw)) {
    const url = raw.split(/\s+/)[0];
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 ShortsDirector/1.0" },
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ct = res.headers.get("content-type") || "";
      const bodyText = await res.text();
      const text = ct.includes("html") ? htmlToText(bodyText) : bodyText.replace(/\s+/g, " ").trim();
      return { text: text.slice(0, maxChars), source: "url", url };
    } catch {
      // fetch failed (offline, blocked, etc.) — fall back to using the URL text
      return { text: raw.slice(0, maxChars), source: "url", url };
    }
  }

  return { text: raw.slice(0, maxChars), source: "notes" };
}

/** Pull a few short keyword-ish phrases from reference text (for the template). */
export function referenceKeyPhrases(text: string, max = 4): string[] {
  if (!text) return [];
  // split into sentence-ish chunks, keep short meaningful ones
  const parts = text
    .split(/[.。!?\n·|/]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 3 && s.length <= 40);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
    if (out.length >= max) break;
  }
  return out;
}
