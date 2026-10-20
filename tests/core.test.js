"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { sanitizeSegment, normalizeBookmark, mergeBookmarks, tweetNote, buildGraph } = require("../core");

const sample = {
  id: "1234567890",
  url: "https://x.com/alice/status/1234567890",
  text: "A useful post about #Robotics and agents.",
  authorName: "Alice",
  authorHandle: "alice",
  createdAt: "2026-10-12T10:00:00.000Z",
  capturedAt: "2026-10-12T10:10:00.000Z",
  hashtags: ["Robotics", "robotics", "Agents"],
  domains: ["Example.com"],
  media: []
};

test("normalizes and deduplicates entity values", () => {
  const b = normalizeBookmark(sample);
  assert.deepEqual(b.hashtags, ["robotics", "agents"]);
  assert.deepEqual(b.domains, ["example.com"]);
});

test("rejects untrusted post URLs", () => {
  assert.throws(() => normalizeBookmark({ ...sample, url: "https://example.com/123" }), /valid X URL/);
});

test("merges by post id without multiplying notes", () => {
  const changed = { ...sample, text: "Updated text" };
  const result = mergeBookmarks([sample], [changed]);
  assert.equal(result.bookmarks.length, 1);
  assert.equal(result.added, 0);
  assert.equal(result.updated, 1);
  assert.equal(result.bookmarks[0].text, "Updated text");
});

test("generates linked markdown", () => {
  const note = tweetNote(sample, "X Bookmarks");
  assert.match(note, /\[\[X Bookmarks\/Authors\/@alice\|@alice\]\]/);
  assert.match(note, /X Bookmarks\/Topics\/robotics/);
  assert.match(note, /https:\/\/x.com\/alice\/status\/1234567890/);
});

test("builds tweet, author, topic, and domain graph", () => {
  const graph = buildGraph([normalizeBookmark(sample)]);
  assert.equal(graph.nodes.length, 5);
  assert.equal(graph.edges.length, 4);
});

test("sanitizes vault path segments", () => {
  assert.equal(sanitizeSegment('bad/name:*?"<>|'), "bad-name-------");
});
