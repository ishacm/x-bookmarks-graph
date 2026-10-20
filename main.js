"use strict";

const { Plugin, PluginSettingTab, Setting, ItemView, Notice, normalizePath } = require("obsidian");
const http = require("http");
const crypto = require("crypto");
function sanitizeSegment(value, fallback = "unknown") {
  const cleaned = String(value || "").normalize("NFKC").replace(/[\\/:*?\"<>|#^[\]]/g, "-").replace(/\s+/g, " ").replace(/[. ]+$/g, "").trim();
  return (cleaned || fallback).slice(0, 120);
}
function yamlString(value) { return JSON.stringify(String(value ?? "")); }
function uniqueStrings(values) { return [...new Set((values || []).map((v) => String(v).trim()).filter(Boolean))]; }
function normalizeBookmark(input) {
  if (!input || typeof input !== "object") throw new Error("Bookmark must be an object");
  const id = String(input.id || "").trim(), url = String(input.url || "").trim();
  if (!/^\d+$/.test(id)) throw new Error("Bookmark has no valid post id");
  if (!/^https:\/\/(x\.com|twitter\.com)\//i.test(url)) throw new Error("Bookmark has no valid X URL");
  const authorHandle = String(input.authorHandle || "unknown").replace(/^@/, "").trim() || "unknown";
  return { id, url: url.replace("twitter.com/", "x.com/"), text: String(input.text || "").trim(), authorName: String(input.authorName || authorHandle).trim(), authorHandle,
    createdAt: input.createdAt ? String(input.createdAt) : "", capturedAt: input.capturedAt ? String(input.capturedAt) : new Date().toISOString(),
    hashtags: uniqueStrings(uniqueStrings(input.hashtags).map((x) => x.replace(/^#/, "").toLowerCase())),
    domains: uniqueStrings(uniqueStrings(input.domains).map((x) => x.toLowerCase())), media: uniqueStrings(input.media), metrics: input.metrics && typeof input.metrics === "object" ? input.metrics : {} };
}
function mergeBookmarks(existing, incoming) {
  const byId = new Map();
  for (const raw of existing || []) { try { const b = normalizeBookmark(raw); byId.set(b.id, b); } catch (_) {} }
  let added = 0, updated = 0;
  for (const raw of incoming || []) { const b = normalizeBookmark(raw); if (byId.has(b.id)) { byId.set(b.id, { ...byId.get(b.id), ...b, capturedAt: byId.get(b.id).capturedAt || b.capturedAt }); updated++; } else { byId.set(b.id, b); added++; } }
  const bookmarks = [...byId.values()].sort((a, b) => (b.createdAt || b.capturedAt).localeCompare(a.createdAt || a.capturedAt));
  return { bookmarks, added, updated };
}
function tweetNote(bookmark, root) {
  const b = normalizeBookmark(bookmark), authorFile = sanitizeSegment(`@${b.authorHandle}`);
  const tagLinks = b.hashtags.map((t) => `[[${root}/Topics/${sanitizeSegment(t)}|#${t}]]`), domainLinks = b.domains.map((d) => `[[${root}/Domains/${sanitizeSegment(d)}|${d}]]`);
  const authorLink = `[[${root}/Authors/${authorFile}|@${b.authorHandle}]]`, media = b.media.map((url) => `![](${url})`).join("\n");
  return `---\nsource: x-bookmark\nx_id: ${yamlString(b.id)}\nx_url: ${yamlString(b.url)}\nauthor: ${yamlString(b.authorHandle)}\ncreated: ${yamlString(b.createdAt)}\ncaptured: ${yamlString(b.capturedAt)}\nhashtags: [${b.hashtags.map(yamlString).join(", ")}]\ndomains: [${b.domains.map(yamlString).join(", ")}]\n---\n\n# ${b.authorName || `@${b.authorHandle}`} on X\n\n${b.text || "*(No text captured — this may be a media-only post.)*"}\n\n- **Author:** ${authorLink}\n- **Original:** [Open on X](${b.url})\n${tagLinks.length ? `- **Topics:** ${tagLinks.join(" · ")}\n` : ""}${domainLinks.length ? `- **Links:** ${domainLinks.join(" · ")}\n` : ""}${media ? `\n## Media\n\n${media}\n` : ""}`;
}
function entityNote(title, kind, backlinks) { return `---\ntype: ${kind}\n---\n\n# ${title}\n\n${backlinks.map((x) => `- [[${x.path}|${x.label}]]`).join("\n") || "No bookmarks yet."}\n`; }
function buildGraph(bookmarks) {
  const nodes = [], edges = [], seen = new Set();
  const addNode = (id, type, label, path) => { if (!seen.has(id)) { seen.add(id); nodes.push({ id, type, label, path }); } };
  for (const b of bookmarks) { const tweetId = `tweet:${b.id}`; addNode(tweetId, "tweet", (b.text || "Media post").slice(0, 46), `Tweets/${b.id}`); const authorId = `author:${b.authorHandle.toLowerCase()}`; addNode(authorId, "author", `@${b.authorHandle}`, `Authors/@${b.authorHandle}`); edges.push({ source: tweetId, target: authorId });
    for (const tag of b.hashtags) { const id = `topic:${tag}`; addNode(id, "topic", `#${tag}`, `Topics/${tag}`); edges.push({ source: tweetId, target: id }); }
    for (const domain of b.domains) { const id = `domain:${domain}`; addNode(id, "domain", domain, `Domains/${domain}`); edges.push({ source: tweetId, target: id }); } }
  return { nodes, edges };
}

const VIEW_TYPE = "x-bookmarks-graph-view";
const DEFAULTS = { folder: "X Bookmarks", port: 27123, secret: "", receiverEnabled: true };

class XBookmarksPlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULTS, await this.loadData());
    if (!this.settings.secret) {
      this.settings.secret = crypto.randomBytes(24).toString("hex");
      await this.saveSettings();
    }
    this.server = null;
    this.registerView(VIEW_TYPE, (leaf) => new BookmarkGraphView(leaf, this));
    this.addRibbonIcon("bookmark", "Open X bookmarks graph", () => this.activateGraph());
    this.addCommand({ id: "open-x-bookmarks-graph", name: "Open bookmark graph", callback: () => this.activateGraph() });
    this.addCommand({ id: "start-x-bookmark-receiver", name: "Start local bookmark receiver", callback: () => this.startServer(true) });
    this.addCommand({ id: "stop-x-bookmark-receiver", name: "Stop local bookmark receiver", callback: () => this.stopServer(true) });
    this.addCommand({ id: "rebuild-x-bookmark-notes", name: "Rebuild bookmark notes and dashboard", callback: async () => {
      const index = await this.loadIndex(); await this.writeAll(index.bookmarks || []); new Notice("X bookmark notes rebuilt.");
    }});
    this.addSettingTab(new XBookmarksSettingTab(this.app, this));
    if (this.settings.receiverEnabled) this.startServer(false);
  }

  onunload() { this.stopServer(false); }

  async saveSettings() { await this.saveData(this.settings); }
  root(path = "") { return normalizePath(`${this.settings.folder}/${path}`); }

  async ensureFolder(path) {
    const parts = normalizePath(path).split("/");
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(current)) await this.app.vault.createFolder(current);
    }
  }

  async upsert(path, content) {
    const normalized = normalizePath(path);
    await this.ensureFolder(normalized.split("/").slice(0, -1).join("/"));
    const existing = this.app.vault.getAbstractFileByPath(normalized);
    if (existing) await this.app.vault.modify(existing, content);
    else await this.app.vault.create(normalized, content);
  }

  async loadIndex() {
    const file = this.app.vault.getAbstractFileByPath(this.root("_data/bookmarks.json"));
    if (!file) return { version: 1, bookmarks: [] };
    try { return JSON.parse(await this.app.vault.read(file)); }
    catch (_) { new Notice("X Bookmarks Graph: index file is invalid JSON."); return { version: 1, bookmarks: [] }; }
  }

  async importPayload(payload) {
    if (!payload || !Array.isArray(payload.bookmarks)) throw new Error("Expected a bookmarks array");
    if (payload.bookmarks.length > 10000) throw new Error("Import is too large");
    const current = await this.loadIndex();
    const stamped = payload.bookmarks.map((b) => ({ ...b, capturedAt: b.capturedAt || payload.capturedAt || new Date().toISOString() }));
    const merged = mergeBookmarks(current.bookmarks || [], stamped);
    await this.writeAll(merged.bookmarks);
    this.app.workspace.trigger("x-bookmarks-graph:updated");
    return { added: merged.added, updated: merged.updated, total: merged.bookmarks.length };
  }

  async writeAll(bookmarks) {
    const root = this.settings.folder;
    await this.ensureFolder(this.root("_data"));
    await this.upsert(this.root("_data/bookmarks.json"), JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), bookmarks }, null, 2));
    const groups = { author: new Map(), topic: new Map(), domain: new Map() };
    for (const b of bookmarks) {
      await this.upsert(this.root(`Tweets/${b.id}.md`), tweetNote(b, root));
      const ref = { path: `${root}/Tweets/${b.id}`, label: (b.text || `Post ${b.id}`).slice(0, 80) };
      const add = (map, key) => map.set(key, [...(map.get(key) || []), ref]);
      add(groups.author, b.authorHandle);
      for (const t of b.hashtags) add(groups.topic, t);
      for (const d of b.domains) add(groups.domain, d);
    }
    for (const [handle, refs] of groups.author) await this.upsert(this.root(`Authors/${sanitizeSegment(`@${handle}`)}.md`), entityNote(`@${handle}`, "x-author", refs));
    for (const [topic, refs] of groups.topic) await this.upsert(this.root(`Topics/${sanitizeSegment(topic)}.md`), entityNote(`#${topic}`, "x-topic", refs));
    for (const [domain, refs] of groups.domain) await this.upsert(this.root(`Domains/${sanitizeSegment(domain)}.md`), entityNote(domain, "x-domain", refs));
    await this.upsert(this.root("Dashboard.md"), this.dashboard(bookmarks));
  }

  dashboard(bookmarks) {
    const counts = (get) => {
      const map = new Map(); for (const b of bookmarks) for (const x of get(b)) map.set(x, (map.get(x) || 0) + 1);
      return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
    };
    const authors = counts((b) => [b.authorHandle]);
    const topics = counts((b) => b.hashtags);
    const list = (rows, folder, prefix = "") => rows.map(([name, n]) => `- [[${this.settings.folder}/${folder}/${sanitizeSegment(prefix + name)}|${prefix}${name}]] — ${n}`).join("\n") || "- Nothing captured yet";
    return `---\ntype: x-bookmarks-dashboard\nupdated: ${new Date().toISOString()}\n---\n\n# X Bookmarks Dashboard\n\n> Imported locally: **${bookmarks.length} bookmarks**. Use the command **Open bookmark graph** for the interactive view.\n\n## Top authors\n\n${list(authors, "Authors", "@") }\n\n## Top hashtags\n\n${list(topics, "Topics", "") }\n\n## Recently bookmarked\n\n${bookmarks.slice(0, 20).map((b) => `- [[${this.settings.folder}/Tweets/${b.id}|${(b.text || `@${b.authorHandle}`).replace(/\n/g, " ").slice(0, 90)}]]`).join("\n") || "- Nothing captured yet"}\n`;
  }

  startServer(showNotice) {
    if (this.server) { if (showNotice) new Notice("X bookmark receiver is already running."); return; }
    const server = http.createServer(async (req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-XBG-Secret");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
      if (req.url === "/health" && req.method === "GET") return this.respond(res, 200, { ok: true, app: "x-bookmarks-graph" });
      if (req.url !== "/import" || req.method !== "POST") return this.respond(res, 404, { error: "Not found" });
      if (req.headers["x-xbg-secret"] !== this.settings.secret) return this.respond(res, 401, { error: "Pairing code is incorrect" });
      try {
        const chunks = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > 10_000_000) throw new Error("Payload exceeds 10 MB"); chunks.push(chunk); }
        const result = await this.importPayload(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        this.respond(res, 200, { ok: true, ...result });
        new Notice(`X bookmarks: ${result.added} new, ${result.updated} refreshed.`);
      } catch (error) { this.respond(res, 400, { error: error.message || "Import failed" }); }
    });
    server.on("error", (error) => { this.server = null; new Notice(`X bookmark receiver: ${error.message}`); });
    server.listen(Number(this.settings.port), "127.0.0.1", () => { this.server = server; if (showNotice) new Notice(`Receiver running on port ${this.settings.port}.`); });
  }

  stopServer(showNotice) {
    if (!this.server) { if (showNotice) new Notice("X bookmark receiver is not running."); return; }
    this.server.close(); this.server = null; if (showNotice) new Notice("X bookmark receiver stopped.");
  }

  respond(res, status, body) { res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(body)); }

  async activateGraph() {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) { leaf = this.app.workspace.getLeaf("tab"); await leaf.setViewState({ type: VIEW_TYPE, active: true }); }
    this.app.workspace.revealLeaf(leaf);
  }
}

class XBookmarksSettingTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const { containerEl } = this; containerEl.empty();
    containerEl.createEl("h2", { text: "X Bookmarks Graph" });
    new Setting(containerEl).setName("Bookmark folder").setDesc("Vault folder for generated notes and the local index.").addText((text) => text.setValue(this.plugin.settings.folder).onChange(async (v) => { this.plugin.settings.folder = v.trim() || DEFAULTS.folder; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Receiver port").setDesc("Localhost port used by the browser companion.").addText((text) => text.setValue(String(this.plugin.settings.port)).onChange(async (v) => { const n = Number(v); if (Number.isInteger(n) && n >= 1024 && n <= 65535) { this.plugin.settings.port = n; await this.plugin.saveSettings(); } }));
    const secretSetting = new Setting(containerEl).setName("Pairing code").setDesc("Paste this into the browser companion. Treat it like a local password.");
    secretSetting.controlEl.createDiv({ cls: "xbg-secret", text: this.plugin.settings.secret });
    secretSetting.addButton((b) => b.setButtonText("Copy").onClick(async () => { await navigator.clipboard.writeText(this.plugin.settings.secret); new Notice("Pairing code copied."); }));
    secretSetting.addButton((b) => b.setButtonText("Regenerate").onClick(async () => { this.plugin.settings.secret = crypto.randomBytes(24).toString("hex"); await this.plugin.saveSettings(); this.display(); }));
    new Setting(containerEl).setName("Receive from browser").setDesc("Listen only on this computer (127.0.0.1).").addToggle((toggle) => toggle.setValue(this.plugin.settings.receiverEnabled).onChange(async (v) => { this.plugin.settings.receiverEnabled = v; await this.plugin.saveSettings(); v ? this.plugin.startServer(true) : this.plugin.stopServer(true); }));
  }
}

class BookmarkGraphView extends ItemView {
  constructor(leaf, plugin) { super(leaf); this.plugin = plugin; this.cleanup = null; this.refresh = () => this.draw(); }
  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return "X Bookmarks Graph"; }
  getIcon() { return "git-fork"; }
  async onOpen() { this.plugin.registerEvent(this.app.workspace.on("x-bookmarks-graph:updated", this.refresh)); await this.draw(); }
  async onClose() { if (this.cleanup) this.cleanup(); }

  async draw() {
    if (this.cleanup) this.cleanup();
    const container = this.containerEl.children[1]; container.empty(); container.addClass("xbg-view");
    const toolbar = container.createDiv({ cls: "xbg-toolbar" });
    const fit = toolbar.createEl("button", { text: "Reset view" });
    const index = await this.plugin.loadIndex();
    const graphBookmarks = (index.bookmarks || []).slice(0, 500);
    const graph = buildGraph(graphBookmarks);
    toolbar.createSpan({ cls: "xbg-stat", text: `${graph.nodes.length} nodes · ${graph.edges.length} links${(index.bookmarks || []).length > 500 ? " · latest 500 posts" : ""}` });
    if (!graph.nodes.length) { container.createDiv({ cls: "xbg-note", text: "No bookmarks yet. Install the browser companion, scroll through x.com/i/history or x.com/i/bookmarks, then send the captured posts to Obsidian." }); return; }
    const wrap = container.createDiv({ cls: "xbg-canvas-wrap" }); const canvas = wrap.createEl("canvas", { cls: "xbg-canvas" });
    const legend = container.createDiv({ cls: "xbg-legend" });
    const colors = { tweet: "#1d9bf0", author: "#f5a623", topic: "#9b59b6", domain: "#2ecc71" };
    for (const [k, c] of Object.entries(colors)) { const item = legend.createSpan(); const dot = item.createSpan({ cls: "xbg-dot" }); dot.style.background = c; item.appendText(k); }
    const state = { scale: 1, ox: 0, oy: 0, dragging: null, panning: false, px: 0, py: 0 };
    const nodes = graph.nodes.map((n, i) => ({ ...n, x: Math.cos(i * 2.399) * Math.sqrt(i + 1) * 22, y: Math.sin(i * 2.399) * Math.sqrt(i + 1) * 22, vx: 0, vy: 0 }));
    const byId = new Map(nodes.map((n) => [n.id, n])); const edges = graph.edges.map((e) => ({ a: byId.get(e.source), b: byId.get(e.target) })).filter((e) => e.a && e.b);
    let running = true, frame = 0, dpr = devicePixelRatio || 1;
    const resize = () => { const r = canvas.getBoundingClientRect(); canvas.width = Math.max(1, r.width * dpr); canvas.height = Math.max(1, r.height * dpr); };
    const reset = () => { state.scale = 1; state.ox = canvas.clientWidth / 2; state.oy = canvas.clientHeight / 2; };
    const screen = (n) => ({ x: n.x * state.scale + state.ox, y: n.y * state.scale + state.oy });
    const tick = () => {
      if (!running) return; frame++;
      if (frame < 360) {
        for (let i = 0; i < nodes.length; i++) for (let k = 1; k <= Math.min(14, nodes.length - 1); k++) { const j=(i+k*97)%nodes.length;if(i===j)continue;const a=nodes[i],b=nodes[j];let dx=a.x-b.x,dy=a.y-b.y,d2=dx*dx+dy*dy+1;const f=105/d2;a.vx+=dx*f;a.vy+=dy*f;b.vx-=dx*f;b.vy-=dy*f; }
        for (const e of edges) { const dx = e.b.x-e.a.x, dy=e.b.y-e.a.y, d=Math.sqrt(dx*dx+dy*dy)||1, f=(d-95)*0.0018; e.a.vx+=dx/d*f; e.a.vy+=dy/d*f; e.b.vx-=dx/d*f; e.b.vy-=dy/d*f; }
        for (const n of nodes) { if (state.dragging !== n) { n.vx += -n.x*0.0003; n.vy += -n.y*0.0003; n.x += n.vx; n.y += n.vy; } n.vx *= .84; n.vy *= .84; }
      }
      const ctx=canvas.getContext("2d"); ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,canvas.clientWidth,canvas.clientHeight);
      ctx.strokeStyle=getComputedStyle(document.body).getPropertyValue("--background-modifier-border-hover") || "#666"; ctx.globalAlpha=.45;
      for (const e of edges) { const a=screen(e.a), b=screen(e.b); ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke(); }
      ctx.globalAlpha=1; ctx.font="12px sans-serif"; ctx.textBaseline="middle";
      for (const n of nodes) { const p=screen(n), r=n.type==="tweet"?6:8; ctx.fillStyle=colors[n.type]; ctx.beginPath(); ctx.arc(p.x,p.y,r,0,Math.PI*2); ctx.fill(); if (state.scale>.72 && n.type!=="tweet") { ctx.fillStyle=getComputedStyle(document.body).getPropertyValue("--text-normal") || "#ddd"; ctx.fillText(n.label,p.x+r+4,p.y); } }
      requestAnimationFrame(tick);
    };
    const hit = (x,y) => nodes.slice().reverse().find((n) => { const p=screen(n); return (p.x-x)**2+(p.y-y)**2 < 144; });
    const pointerDown=(e)=>{ const r=canvas.getBoundingClientRect(); const n=hit(e.clientX-r.left,e.clientY-r.top); state.px=e.clientX; state.py=e.clientY; if(n) state.dragging=n; else state.panning=true; canvas.setPointerCapture(e.pointerId); };
    const pointerMove=(e)=>{ const dx=e.clientX-state.px,dy=e.clientY-state.py; state.px=e.clientX;state.py=e.clientY; if(state.dragging){state.dragging.x+=dx/state.scale;state.dragging.y+=dy/state.scale;} else if(state.panning){state.ox+=dx;state.oy+=dy;} };
    const pointerUp=(e)=>{ if(state.dragging && Math.abs(e.clientX-state.px)<3 && Math.abs(e.clientY-state.py)<3){ const path=this.plugin.root(`${state.dragging.path}.md`); const file=this.app.vault.getAbstractFileByPath(path); if(file) this.app.workspace.getLeaf("tab").openFile(file); } state.dragging=null;state.panning=false; };
    const wheel=(e)=>{e.preventDefault();const r=canvas.getBoundingClientRect(),mx=e.clientX-r.left,my=e.clientY-r.top,old=state.scale;state.scale=Math.max(.25,Math.min(3,state.scale*Math.exp(-e.deltaY*.001)));state.ox=mx-(mx-state.ox)*state.scale/old;state.oy=my-(my-state.oy)*state.scale/old;};
    canvas.addEventListener("pointerdown",pointerDown);canvas.addEventListener("pointermove",pointerMove);canvas.addEventListener("pointerup",pointerUp);canvas.addEventListener("wheel",wheel,{passive:false});
    const ro=new ResizeObserver(()=>{resize();if(!state.ox&&!state.oy)reset();});ro.observe(canvas);fit.onclick=reset; resize();reset();tick();
    this.cleanup=()=>{running=false;ro.disconnect();canvas.removeEventListener("pointerdown",pointerDown);canvas.removeEventListener("pointermove",pointerMove);canvas.removeEventListener("pointerup",pointerUp);canvas.removeEventListener("wheel",wheel);};
  }
}

module.exports = XBookmarksPlugin;
