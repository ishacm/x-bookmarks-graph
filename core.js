"use strict";

function sanitizeSegment(value, fallback = "unknown") {
  const cleaned = String(value || "")
    .normalize("NFKC")
    .replace(/[\\/:*?\"<>|#^[\]]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim();
  return (cleaned || fallback).slice(0, 120);
}

function yamlString(value) {
  return JSON.stringify(String(value ?? ""));
}

function uniqueStrings(values) {
  return [...new Set((values || []).map((v) => String(v).trim()).filter(Boolean))];
}

function normalizeBookmark(input) {
  if (!input || typeof input !== "object") throw new Error("Bookmark must be an object");
  const id = String(input.id || "").trim();
  const url = String(input.url || "").trim();
  if (!/^\d+$/.test(id)) throw new Error("Bookmark has no valid post id");
  if (!/^https:\/\/(x\.com|twitter\.com)\//i.test(url)) throw new Error("Bookmark has no valid X URL");
  const authorHandle = String(input.authorHandle || "unknown").replace(/^@/, "").trim() || "unknown";
  return {
    id,
    url: url.replace("twitter.com/", "x.com/"),
    text: String(input.text || "").trim(),
    authorName: String(input.authorName || authorHandle).trim(),
    authorHandle,
    createdAt: input.createdAt ? String(input.createdAt) : "",
    capturedAt: input.capturedAt ? String(input.capturedAt) : new Date().toISOString(),
    hashtags: uniqueStrings(uniqueStrings(input.hashtags).map((x) => x.replace(/^#/, "").toLowerCase())),
    domains: uniqueStrings(uniqueStrings(input.domains).map((x) => x.toLowerCase())),
    media: uniqueStrings(input.media),
    metrics: input.metrics && typeof input.metrics === "object" ? input.metrics : {}
  };
}

function mergeBookmarks(existing, incoming) {
  const byId = new Map();
  for (const raw of existing || []) {
    try { const b = normalizeBookmark(raw); byId.set(b.id, b); } catch (_) {}
  }
  let added = 0;
  let updated = 0;
  for (const raw of incoming || []) {
    const b = normalizeBookmark(raw);
    if (byId.has(b.id)) {
      byId.set(b.id, { ...byId.get(b.id), ...b, capturedAt: byId.get(b.id).capturedAt || b.capturedAt });
      updated++;
    } else {
      byId.set(b.id, b);
      added++;
    }
  }
  const bookmarks = [...byId.values()].sort((a, b) => (b.createdAt || b.capturedAt).localeCompare(a.createdAt || a.capturedAt));
  return { bookmarks, added, updated };
}

function tweetNote(bookmark, root) {
  const b = normalizeBookmark(bookmark);
  const authorFile = sanitizeSegment(`@${b.authorHandle}`);
  const tagLinks = b.hashtags.map((t) => `[[${root}/Topics/${sanitizeSegment(t)}|#${t}]]`);
  const domainLinks = b.domains.map((d) => `[[${root}/Domains/${sanitizeSegment(d)}|${d}]]`);
  const authorLink = `[[${root}/Authors/${authorFile}|@${b.authorHandle}]]`;
  const media = b.media.map((url) => `![](${url})`).join("\n");
  return `---\nsource: x-bookmark\nx_id: ${yamlString(b.id)}\nx_url: ${yamlString(b.url)}\nauthor: ${yamlString(b.authorHandle)}\ncreated: ${yamlString(b.createdAt)}\ncaptured: ${yamlString(b.capturedAt)}\nhashtags: [${b.hashtags.map(yamlString).join(", ")}]\ndomains: [${b.domains.map(yamlString).join(", ")}]\n---\n\n# ${b.authorName || `@${b.authorHandle}`} on X\n\n${b.text || "*(No text captured — this may be a media-only post.)*"}\n\n- **Author:** ${authorLink}\n- **Original:** [Open on X](${b.url})\n${tagLinks.length ? `- **Topics:** ${tagLinks.join(" · ")}\n` : ""}${domainLinks.length ? `- **Links:** ${domainLinks.join(" · ")}\n` : ""}${media ? `\n## Media\n\n${media}\n` : ""}`;
}

function entityNote(title, kind, backlinks) {
  return `---\ntype: ${kind}\n---\n\n# ${title}\n\n${backlinks.map((x) => `- [[${x.path}|${x.label}]]`).join("\n") || "No bookmarks yet."}\n`;
}

function buildGraph(bookmarks) {
  const nodes = [];
  const edges = [];
  const seen = new Set();
  const addNode = (id, type, label, path) => { if (!seen.has(id)) { seen.add(id); nodes.push({ id, type, label, path }); } };
  for (const b of bookmarks) {
    const tweetId = `tweet:${b.id}`;
    addNode(tweetId, "tweet", (b.text || "Media post").slice(0, 46), `Tweets/${b.id}`);
    const authorId = `author:${b.authorHandle.toLowerCase()}`;
    addNode(authorId, "author", `@${b.authorHandle}`, `Authors/@${b.authorHandle}`);
    edges.push({ source: tweetId, target: authorId });
    for (const tag of b.hashtags) {
      const id = `topic:${tag}`; addNode(id, "topic", `#${tag}`, `Topics/${tag}`); edges.push({ source: tweetId, target: id });
    }
    for (const domain of b.domains) {
      const id = `domain:${domain}`; addNode(id, "domain", domain, `Domains/${domain}`); edges.push({ source: tweetId, target: id });
    }
  }
  return { nodes, edges };
}

module.exports = { sanitizeSegment, normalizeBookmark, mergeBookmarks, tweetNote, entityNote, buildGraph };
