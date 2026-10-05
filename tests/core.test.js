// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCore } from "./helpers.js";

const core = loadCore();

test("@ at the start of the text or after a space opens a To mention", () => {
  assert.deepEqual({ ...core.findTrigger("@jo") }, { field: "to", query: "jo", start: 0 });
  assert.deepEqual({ ...core.findTrigger("hi @jo") }, { field: "to", query: "jo", start: 3 });
  assert.deepEqual({ ...core.findTrigger("hi @") }, { field: "to", query: "", start: 3 });
});

test("@@ opens a Cc mention and start points at the first @", () => {
  assert.deepEqual({ ...core.findTrigger("cc @@ja") }, { field: "cc", query: "ja", start: 3 });
  assert.deepEqual({ ...core.findTrigger("@@") }, { field: "cc", query: "", start: 0 });
});

test("the query can hold spaces", () => {
  assert.equal(core.findTrigger("ask @john sm").query, "john sm");
});

test("an email address does not open the dropdown", () => {
  assert.equal(core.findTrigger("mail me at foo@bar.com"), null);
  assert.equal(core.findTrigger("foo@"), null);
  assert.equal(core.findTrigger("a@@b"), null);
});

test("three @ signs do not open it, and a second @ after a space starts a new mention", () => {
  assert.equal(core.findTrigger("@@@jo"), null);
  assert.equal(core.findTrigger("@jo @").query, "", "a new mention after an unfinished one starts fresh");
});

test("only the text before the caret counts, and a newline ends the query", () => {
  assert.equal(core.findTrigger("@jo\nsmith"), null);
  assert.equal(core.findTrigger(""), null);
});

test("a query longer than 40 characters is no longer a mention", () => {
  assert.notEqual(core.findTrigger(`@${"a".repeat(40)}`), null);
  assert.equal(core.findTrigger(`@${"a".repeat(41)}`), null);
});

test("what is left in the body depends on the setting", () => {
  const item = { name: "John Smith", email: "j@x.org" };
  assert.equal(core.mentionNeedle(item, "at-name"), "@John Smith");
  assert.equal(core.mentionNeedle(item, "name"), "John Smith");
  assert.equal(core.mentionNeedle(item, "remove"), "");
  assert.equal(core.mentionNeedle({ name: "", email: "j@x.org" }), "@j@x.org");
});

test("the inserted link is escaped and followed by a non-breaking space", () => {
  assert.equal(
    core.mentionHtml("a@b.org", "@Tom & <Jerry>"),
    '<a href="mailto:a@b.org">@Tom &#38; &#60;Jerry&#62;</a>&nbsp;',
  );
  assert.match(core.mentionHtml('x"y@b.org', "@x"), /href="mailto:x&#34;y@b\.org"/);
});

test("non-breaking spaces compare equal to spaces", () => {
  assert.equal(core.normalize("@John Smith"), "@John Smith");
});

test("the same person can be tracked separately in To and Cc", () => {
  assert.notEqual(core.mentionKey("to", "A@x.org"), core.mentionKey("cc", "A@x.org"));
  assert.equal(core.mentionKey("to", "A@x.org"), core.mentionKey("to", "a@x.org"));
});
