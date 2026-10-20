"use strict";

const $ = (id) => document.getElementById(id);
const status = $("status"), result = $("result"), send = $("send"), clear = $("clear"), port = $("port"), secret = $("secret");

async function activeTab() { const tabs = await chrome.tabs.query({ active: true, currentWindow: true }); return tabs[0]; }
async function ask(message) { const tab = await activeTab(); if (!tab?.id) throw new Error("No active tab"); return chrome.tabs.sendMessage(tab.id, message); }
function show(message, kind = "") { result.textContent = message; result.className = `result ${kind}`; }

async function refresh() {
  const saved = await chrome.storage.local.get({ port: 27123, secret: "" }); port.value = saved.port; secret.value = saved.secret;
  try {
    const info = await ask({ type: "XBG_STATUS" });
    status.textContent = info.onCapturePage ? `${info.count} unique post${info.count === 1 ? "" : "s"} captured in this tab.` : "Open x.com/i/history or x.com/i/bookmarks in this tab, then scroll through the posts.";
    send.disabled = !info.onCapturePage;
  } catch (_) { status.textContent = "Open or reload x.com/i/history after installing this companion."; send.disabled = true; }
}

send.addEventListener("click", async () => {
  const p = Number(port.value), s = secret.value.trim();
  if (!Number.isInteger(p) || p < 1024 || p > 65535 || !s) return show("Enter the port and pairing code from Obsidian settings.", "error");
  await chrome.storage.local.set({ port: p, secret: s }); send.disabled = true; show("Sending to Obsidian…");
  try {
    const payload = await ask({ type: "XBG_EXPORT" });
    if (!payload?.ok) throw new Error(payload?.error || "Could not read captured posts");
    const res = await fetch(`http://127.0.0.1:${p}/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-XBG-Secret": s },
      body: JSON.stringify({ source: "x-bookmarks-browser-companion", capturedAt: payload.capturedAt, bookmarks: payload.bookmarks })
    });
    const response = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(response.error || `HTTP ${res.status}`);
    show(`Done: ${response.added} new, ${response.updated} refreshed, ${response.total} total.`, "success");
  } catch (error) { show(`Could not connect: ${error.message}. Make sure Obsidian is open and the receiver is enabled.`, "error"); }
  finally { send.disabled = false; }
});

clear.addEventListener("click", async () => { try { const r = await ask({ type: "XBG_CLEAR" }); status.textContent = `${r.count} bookmarks captured in this tab.`; show("Session cleared."); } catch (e) { show(e.message, "error"); } });
refresh();
