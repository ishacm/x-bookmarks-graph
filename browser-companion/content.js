"use strict";

const captured = new Map();

function isCapturePage() {
  return location.pathname.startsWith("/i/bookmarks") || location.pathname.startsWith("/i/history");
}
function text(el) { return el ? (el.innerText || el.textContent || "").trim() : ""; }

function parseArticle(article) {
  const statusAnchor = article.querySelector("time")?.closest('a[href*="/status/"]') || [...article.querySelectorAll('a[href*="/status/"]')].find((a) => /\/status\/\d+/.test(a.getAttribute("href") || ""));
  if (!statusAnchor) return null;
  const match = (statusAnchor.getAttribute("href") || "").match(/^\/([^/]+)\/status\/(\d+)/);
  if (!match) return null;
  const [, authorHandle, id] = match;
  const url = `https://x.com/${authorHandle}/status/${id}`;
  const userBlock = article.querySelector('[data-testid="User-Name"]');
  const userLines = text(userBlock).split("\n").filter(Boolean);
  const authorName = userLines.find((line) => !line.startsWith("@") && line !== "·") || authorHandle;
  const tweetText = text(article.querySelector('[data-testid="tweetText"]'));
  const time = article.querySelector("time");
  const hashtags = [...article.querySelectorAll('a[href^="/hashtag/"]')].map((a) => text(a).replace(/^#/, ""));
  const media = [...article.querySelectorAll('img[src*="pbs.twimg.com/media"]')].map((img) => img.currentSrc || img.src).filter(Boolean);
  const domains = [];
  for (const a of article.querySelectorAll('a[href^="http"]')) {
    try {
      const u = new URL(a.href);
      if (!/(^|\.)x\.com$|(^|\.)twitter\.com$|(^|\.)t\.co$/i.test(u.hostname)) domains.push(u.hostname.replace(/^www\./, ""));
    } catch (_) {}
  }
  return { id, url, text: tweetText, authorName, authorHandle, createdAt: time?.dateTime || "", capturedAt: new Date().toISOString(), hashtags: [...new Set(hashtags)], domains: [...new Set(domains)], media: [...new Set(media)] };
}

function scan() {
  if (!isCapturePage()) return;
  document.querySelectorAll('article[data-testid="tweet"]').forEach((article) => {
    const item = parseArticle(article); if (item) captured.set(item.id, item);
  });
}

const observer = new MutationObserver(scan);
observer.observe(document.documentElement, { childList: true, subtree: true });
scan();

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message?.type === "XBG_STATUS") { scan(); respond({ ok: true, onCapturePage: isCapturePage(), count: captured.size }); return; }
  if (message?.type === "XBG_CLEAR") { captured.clear(); scan(); respond({ ok: true, count: captured.size }); return; }
  if (message?.type === "XBG_EXPORT") {
    scan();
    respond({ ok: true, capturedAt: new Date().toISOString(), bookmarks: [...captured.values()] });
    return;
  }
});
