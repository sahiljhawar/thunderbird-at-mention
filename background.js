// SPDX-License-Identifier: GPL-3.0-or-later
// Background script: owns the contact cache, answers searches from the compose script, and
// adds the chosen contact to the To or Cc field.

import { buildEntries, search, formatAddress, emailOf } from "./lib/contacts.js";

const FIELDS = new Set(["to", "cc"]);

let entries = [];
let ready = loadContacts();
let reloadTimer = null;

async function loadContacts() {
  let books = [];
  try {
    books = await messenger.addressBooks.list(true);
  } catch (err) {
    console.error("@mention: could not list address books", err);
  }
  for (const book of books) {
    if (book.contacts) continue;
    try {
      book.contacts = await messenger.contacts.list(book.id);
    } catch {
      // remote address books may not be listable
    }
  }
  entries = buildEntries(books);
}

function scheduleReload() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    ready = loadContacts();
  }, 500);
}

for (const event of [
  messenger.contacts.onCreated,
  messenger.contacts.onUpdated,
  messenger.contacts.onDeleted,
  messenger.addressBooks.onCreated,
  messenger.addressBooks.onDeleted,
]) {
  event.addListener(scheduleReload);
}

async function searchContacts(query) {
  await ready;
  return search(entries, query);
}

async function addRecipient(tabId, field, name, email) {
  if (!FIELDS.has(field)) return false;
  const details = await messenger.compose.getComposeDetails(tabId);
  const current = details[field] || [];
  const target = email.toLowerCase();
  if (current.some((r) => emailOf(r) === target)) return false;
  await messenger.compose.setComposeDetails(tabId, {
    [field]: [...current, formatAddress(name, email)],
  });
  return true;
}

async function removeRecipient(tabId, field, email) {
  if (!FIELDS.has(field)) return false;
  const details = await messenger.compose.getComposeDetails(tabId);
  const current = details[field] || [];
  const target = email.toLowerCase();
  const kept = current.filter((r) => emailOf(r) !== target);
  if (kept.length === current.length) return false;
  await messenger.compose.setComposeDetails(tabId, { [field]: kept });
  return true;
}

messenger.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === "search") return searchContacts(String(message.query ?? ""));
  if (!sender.tab) return;
  switch (message?.type) {
    case "add":
      return addRecipient(sender.tab.id, message.field, message.name, message.email);
    case "remove":
      return removeRecipient(sender.tab.id, message.field, message.email);
    case "isPlainText":
      return messenger.compose
        .getComposeDetails(sender.tab.id)
        .then((d) => d.isPlainText === true);
  }
});

// The dropdown lives inside the editor document, so make sure it is gone before the
// message is serialized and sent.
messenger.compose.onBeforeSend.addListener(async (tab) => {
  try {
    await messenger.tabs.sendMessage(tab.id, { type: "cleanup" });
  } catch {
    // compose script not running in this tab
  }
});

messenger.composeScripts.register({
  js: [{ file: "lib/core.js" }, { file: "compose.js" }],
});
