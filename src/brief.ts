/**
 * Homepage/reference -> editable "brief card" extraction (feature 4).
 *
 * Given a URL, fetch the page and pull: name (상호명), up to 3 services,
 * tagline (대표 문구), contact (연락처), brand color (대표 색상), hero image.
 * If fetching fails (blocked, JS-only, offline) we return a card flagged
 * crawlFailed so the UI shows the "paste text" fallback. Given plain text
 * (not a URL) we derive a light brief from the text. No paid/Google APIs.
 */

export interface Brief {
  name: string;
  services: string[];
  tagline: string;
  contact: string;
  color: string;
  heroImage: string | null;
  sourceUrl?: string;
  crawlFailed?: boolean;
}

const URL_RE = /^https?:\/\/\S+$/i;

function isUrl(s: string): boolean {
  const first = s.trim().split(/\s+/)[0] || "";
  return URL_RE.test(first);
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function attr(html: string, re: RegExp): string {
  const m = html.match(re);
  return m ? decodeEntities(m[1].trim()) : "";
}

/** Phone/contact patterns common in Korea (1877-7323, 02-123-4567, 010-...). */
function findContact(text: string): string {
  const m =
    text.match(/1\d{3}[-.\s]?\d{4}/) ||
    text.match(/0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}/) ||
    text.match(/\d{2,4}[-.\s]?\d{3,4}[-.\s]?\d{4}/);
  return m ? m[0].replace(/\s/g, "") : "";
}

function absolutize(src: string, base: string): string {
  try {
    return new URL(src, base).toString();
  } catch {
    return src;
  }
}

function briefFromHtml(html: string, url: string): Brief {
  const title = attr(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const ogSite = attr(html, /<meta[^>]+property=["']og:site_name["'][^>]*content=["']([^"']+)["']/i);
  const ogTitle = attr(html, /<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
  const desc =
    attr(html, /<meta[^>]+name=["']description["'][^>]*content=["']([^"']+)["']/i) ||
    attr(html, /<meta[^>]+property=["']og:description["'][^>]*content=["']([^"']+)["']/i);
  const ogImage = attr(html, /<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["']/i);
  const themeColor = attr(html, /<meta[^>]+name=["']theme-color["'][^>]*content=["']([^"']+)["']/i);

  // headings as candidate services
  const h = [...html.matchAll(/<h[123][^>]*>([\s\S]*?)<\/h[123]>/gi)]
    .map((m) => decodeEntities(m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()))
    .filter((s) => s.length >= 2 && s.length <= 30);

  const name = (ogSite || ogTitle || title || "").split(/[|\-–·:]/)[0].trim() || "브랜드";
  const services = Array.from(new Set(h)).slice(0, 3);
  while (services.length < 3) services.push("");
  const plain = decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");

  return {
    name,
    services,
    tagline: (desc || ogTitle || title || "").slice(0, 60),
    contact: findContact(plain),
    color: themeColor || "#ff5252",
    heroImage: ogImage ? absolutize(ogImage, url) : null,
    sourceUrl: url,
    crawlFailed: false,
  };
}

function briefFromText(text: string): Brief {
  const lines = text
    .split(/[\n。.·|/]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2 && s.length <= 40);
  const services = lines.slice(1, 4);
  while (services.length < 3) services.push("");
  return {
    name: lines[0] || "브랜드",
    services,
    tagline: lines[0] || "",
    contact: findContact(text),
    color: "#ff5252",
    heroImage: null,
    crawlFailed: false,
  };
}

export async function extractBrief(reference: string): Promise<Brief> {
  const raw = (reference || "").trim();
  if (!raw) {
    return { name: "", services: ["", "", ""], tagline: "", contact: "", color: "#ff5252", heroImage: null, crawlFailed: true };
  }

  if (isUrl(raw)) {
    const url = raw.split(/\s+/)[0];
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 ShortsDirector/1.0", "Accept-Language": "ko,en" },
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      const brief = briefFromHtml(html, url);
      // If the page was essentially empty (JS-only SPA), flag as needing paste.
      if (!brief.tagline && brief.services.every((s) => !s)) {
        brief.crawlFailed = true;
      }
      return brief;
    } catch {
      return {
        name: "",
        services: ["", "", ""],
        tagline: "",
        contact: "",
        color: "#ff5252",
        heroImage: null,
        sourceUrl: url,
        crawlFailed: true,
      };
    }
  }

  return briefFromText(raw);
}
