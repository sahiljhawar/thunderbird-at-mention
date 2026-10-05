// SPDX-License-Identifier: GPL-3.0-or-later
// End-to-end check against a real (headless) Thunderbird: installs the add-on as a temporary
// add-on, fills the address book and drives compose windows. Run: npm run e2e
// Optional: E2E_SHOT=path.png saves a screenshot of a compose window with the dropdown open.

import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";
import { createProfile } from "./profile.mjs";
import { Marionette } from "../../scripts/marionette.mjs";

const root = resolve(import.meta.dirname, "../..");
const profile = createProfile(resolve(root, "tbtest/profile"));
const outbox = join(profile, "Mail", "Local Folders", "Unsent Messages");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tb = spawn(
  process.env.THUNDERBIRD || "thunderbird",
  ["--headless", "--no-remote", "--profile", profile, "--marionette", "-remote-allow-system-access"],
  { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, MOZ_HEADLESS: "1" } }
);
let log = "";
tb.stdout.on("data", (d) => (log += d));
tb.stderr.on("data", (d) => (log += d));

const WIN = `const win = Services.wm.getMostRecentWindow("msgcompose"); `;
const EDITOR_DOC = `const doc = win.document.getElementById("messageEditor").contentDocument; `;
let m;

async function waitFor(what, script, { timeout = 15000, args = [] } = {}) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await m.run(script, args).catch((e) => `error: ${e.message}`);
    if (last) return last;
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${what} (last: ${JSON.stringify(last)})`);
}

async function openCompose({ plain = false } = {}) {
  await m.run(
    `const { MailServices } = ChromeUtils.importESModule("resource:///modules/MailServices.sys.mjs");
     const params = Cc["@mozilla.org/messengercompose/composeparams;1"].createInstance(Ci.nsIMsgComposeParams);
     const fields = Cc["@mozilla.org/messengercompose/composefields;1"].createInstance(Ci.nsIMsgCompFields);
     fields.subject = "e2e";
     params.type = Ci.nsIMsgCompType.New;
     params.format = arguments[0] ? Ci.nsIMsgCompFormat.PlainText : Ci.nsIMsgCompFormat.HTML;
     params.composeFields = fields;
     params.identity = MailServices.accounts.allIdentities[0];
     MailServices.compose.OpenComposeWindowWithParams(null, params);
     return true;`,
    [plain]
  );
  await waitFor("compose editor", WIN + `return !!win?.document.getElementById("messageEditor")?.contentDocument?.body;`);
  // The compose script is injected a moment after the editor exists.
  await sleep(1500);
  await m.run(WIN + `win.document.getElementById("messageEditor").focus(); win.GetCurrentEditor().beginningOfDocument(); return true;`);
}

async function closeCompose() {
  await m.run(WIN + `win.gContentChanged = false; win.close(); return true;`);
  await sleep(600);
}

const type = (text) => m.run(WIN + `win.GetCurrentEditor().insertText(arguments[0]); return true;`, [text]);

/** The rows of the dropdown ("Name" + "email" text per row), or null when it is not shown. */
const dropdown = () =>
  m.run(
    WIN + EDITOR_DOC +
      `const host = doc.querySelector('body > div[contenteditable="false"]');
       const root = host && host.openOrClosedShadowRoot;
       return root ? { head: root.querySelector(".head").textContent,
                       rows: [...root.querySelectorAll(".item")].map((e) => e.textContent),
                       active: [...root.querySelectorAll(".item")].findIndex((e) => e.classList.contains("active")) } : null;`
  );

const waitForDropdown = (what) =>
  waitFor(what, WIN + EDITOR_DOC +
    `const host = doc.querySelector('body > div[contenteditable="false"]');
     return !!(host && host.openOrClosedShadowRoot.querySelector(".item"));`).then(dropdown);

/** Sends a key to the editor document, the way the compose script listens for it. */
const press = (key) =>
  m.run(
    WIN +
      `const w = win.document.getElementById("messageEditor").contentWindow;
       const e = new w.KeyboardEvent("keydown", { key: arguments[0], bubbles: true, cancelable: true });
       w.document.dispatchEvent(e);
       return e.defaultPrevented;`,
    [key]
  );

const pills = (container) =>
  m.run(
    WIN + `return [...win.document.querySelectorAll("#" + arguments[0] + " mail-address-pill")].map((p) => p.fullAddress);`,
    [container]
  );
const toPills = () => pills("toAddrContainer");
const ccPills = () => pills("ccAddrContainer");

const bodyHtml = () => m.run(WIN + EDITOR_DOC + `return doc.body.innerHTML;`);
const bodyText = () => m.run(WIN + EDITOR_DOC + `return doc.body.textContent;`);

/** Deletes characters [from, to) of the first text node containing `needle`. */
const deleteInText = (needle, from, to) =>
  m.run(
    WIN +
      `const ed = win.GetCurrentEditor(); const d = ed.document;
       const walker = d.createTreeWalker(d.body, NodeFilter.SHOW_TEXT); let n;
       while ((n = walker.nextNode())) {
         const i = n.data.indexOf(arguments[0]);
         if (i < 0) continue;
         const r = d.createRange(); r.setStart(n, i + arguments[1]); r.setEnd(n, i + arguments[2]);
         const s = ed.selection; s.removeAllRanges(); s.addRange(r); ed.deleteSelection(0, 0);
         return true;
       }
       return false;`,
    [needle, from, to]
  );

const removeLink = (email) =>
  m.run(
    WIN +
      `const ed = win.GetCurrentEditor();
       const a = ed.document.querySelector('a[href="mailto:' + arguments[0] + '"]');
       ed.selectElement(a); ed.deleteSelection(0, 0); return true;`,
    [email]
  );

/** Messages currently in the Unsent Messages folder, quoted-printable decoded. */
function readOutbox() {
  if (!existsSync(outbox)) return [];
  return readFileSync(outbox, "latin1")
    .split(/^From - .*$/m)
    .filter((part) => part.trim())
    .map((part) =>
      part.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    );
}

const step = (name) => console.log(`- ${name}`);

try {
  m = await Marionette.connect({ timeoutMs: 90000 });
  await m.newSession();
  await m.setContext("chrome");

  step("install temporary add-on");
  const { value: addonId } = await m.installTemporaryAddon(root);
  assert.equal(addonId, "at-mention@jhawar.local");

  await m.run(
    `const { MailServices } = ChromeUtils.importESModule("resource:///modules/MailServices.sys.mjs");
     const book = MailServices.ab.getDirectory("jsaddrbook://abook.sqlite");
     const people = [["John Smith", "john@example.org"], ["Jane Doe", "jane@example.org"], ["Smith, Joan", "joan@example.org"]];
     for (const [name, email] of people) {
       const card = Cc["@mozilla.org/addressbook/cardproperty;1"].createInstance(Ci.nsIAbCard);
       card.displayName = name; card.primaryEmail = email;
       book.addCard(card);
     }
     return true;`
  );
  await sleep(2500); // the background script loads the contacts and registers the compose script

  // ---- HTML message ---------------------------------------------------------------------
  await openCompose();

  step("an email address does not open the dropdown");
  await type("write to foo@bar.com");
  await sleep(700);
  assert.equal(await dropdown(), null);
  await type(" ");

  step("@ opens a dropdown that follows what you type");
  await type("@j");
  let dd = await waitForDropdown("dropdown after '@j'");
  assert.equal(dd.head, "Add to To");
  const expectedRows = [["Jane Doe", "jane@example.org"], ["John Smith", "john@example.org"], ["Smith, Joan", "joan@example.org"]];
  assert.equal(dd.rows.length, expectedRows.length);
  expectedRows.forEach(([name, email], i) => assert.equal(dd.rows[i], name + email));
  await type("o");
  await waitFor("narrowed list", WIN + EDITOR_DOC +
    `const h = doc.querySelector('body > div[contenteditable="false"]');
     return h && h.openOrClosedShadowRoot.querySelectorAll(".item").length === 2;`);

  step("Arrow keys move the highlight, Enter adds the contact to To and links the mention");
  assert.equal((await dropdown()).active, 0);
  assert.equal(await press("ArrowDown"), true);
  assert.equal((await dropdown()).active, 1);
  assert.equal(await press("Enter"), true, "Enter is taken by the dropdown");
  await waitFor("To pill", WIN + `return win.document.querySelectorAll("#toAddrContainer mail-address-pill").length === 1;`);
  assert.deepEqual(await toPills(), ["Smith, Joan <joan@example.org>"], "a name with a comma stays one recipient");
  assert.equal(await dropdown(), null, "the dropdown closes");
  assert.match(await bodyHtml(), /<a href="mailto:joan@example\.org">@Smith, Joan<\/a>/);

  step("@@ adds to Cc");
  await type(" and @@ja");
  dd = await waitForDropdown("dropdown after '@@ja'");
  assert.equal(dd.head, "Add to Cc");
  assert.equal(await press("Enter"), true);
  await waitFor("Cc pill", WIN + `return win.document.querySelectorAll("#ccAddrContainer mail-address-pill").length === 1;`);
  assert.deepEqual(await ccPills(), ["Jane Doe <jane@example.org>"], "a plain name is not quoted");
  assert.match(await bodyHtml(), /<a href="mailto:jane@example\.org">@Jane Doe<\/a>/);

  step("mentioning someone already in the field does not add them twice");
  await type(" and @@jane");
  await waitForDropdown("dropdown for a repeat");
  await press("Enter");
  await sleep(1200);
  assert.deepEqual(await ccPills(), ["Jane Doe <jane@example.org>"]);
  assert.deepEqual(await toPills(), ["Smith, Joan <joan@example.org>"], "@@ does not touch To");
  // Keep one mention of Jane in the body for the removal checks below.
  await m.run(WIN + EDITOR_DOC +
    `const links = [...doc.querySelectorAll('a[href="mailto:jane@example.org"]')];
     if (links.length > 1) { const ed = win.GetCurrentEditor(); ed.selectElement(links[1]); ed.deleteSelection(0, 0); }
     return true;`);
  await sleep(800);
  assert.deepEqual(await ccPills(), ["Jane Doe <jane@example.org>"], "removing the second mention keeps Jane while one is left");

  step("Escape closes the dropdown and leaves the text alone");
  await type(" @jo");
  await waitForDropdown("dropdown before Escape");
  assert.equal(await press("Escape"), true);
  assert.equal(await dropdown(), null);
  assert.match(await bodyText(), /@jo\s*$/);
  await deleteInText(" @jo", 0, 4);

  step("with no match, Enter is left to the editor");
  await type(" @zzz");
  await sleep(900);
  assert.equal(await dropdown(), null);
  assert.equal(await press("Enter"), false);
  await deleteInText(" @zzz", 0, 5);

  if (process.env.E2E_SHOT) {
    await type(" @j");
    await waitForDropdown("dropdown for the screenshot");
    const png = await m.run(
      WIN + `const w = win.innerWidth, h = win.innerHeight;
      const canvas = win.document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d").drawWindow(win, 0, 0, w, h, "white");
      return canvas.toDataURL("image/png");`
    );
    writeFileSync(process.env.E2E_SHOT, Buffer.from(png.split(",")[1], "base64"));
    console.log("  screenshot:", process.env.E2E_SHOT);
    await press("Escape");
    await deleteInText(" @j", 0, 3);
  }

  step("deleting only part of a mention keeps the person, deleting all of it removes them");
  await deleteInText("@Jane Doe", 8, 9); // "@Jane Do"
  await sleep(1000);
  await press("Escape"); // deleting back to "@Jane Do" reopens the dropdown, as typing would
  assert.deepEqual(await ccPills(), ["Jane Doe <jane@example.org>"], "partly deleted: still in Cc");
  await removeLink("jane@example.org");
  await waitFor("Cc emptied", WIN + `return win.document.querySelectorAll("#ccAddrContainer mail-address-pill").length === 0;`);
  assert.equal((await toPills()).length, 1, "the To recipient is untouched");

  step("undoing the deletion brings the person back");
  await m.run(WIN + `win.goDoCommand("cmd_undo"); return true;`);
  await waitFor("Cc restored", WIN + `return win.document.querySelectorAll("#ccAddrContainer mail-address-pill").length === 1;`);

  step("the dropdown is gone from the message that is sent");
  // Undo leaves the restored text selected: move the caret to the end so typing does not replace it.
  await m.run(WIN + `win.GetCurrentEditor().endOfDocument(); return true;`);
  await press("Escape");
  await type(" @jo"); // leave the dropdown open on purpose
  await waitForDropdown("dropdown left open");
  await m.run(WIN + `win.goDoCommand("cmd_sendLater"); return true;`);
  const end = Date.now() + 20000;
  while (readOutbox().length < 1 && Date.now() < end) await sleep(300);
  assert.equal(readOutbox().length, 1, "the message reached the outbox");
  const sent = readOutbox()[0];
  assert.match(sent, /^To: .*joan@example\.org/m);
  assert.match(sent, /^Cc: .*jane@example\.org/m);
  assert.match(sent, /<a href="mailto:jane@example\.org">@Jane Do<\/a>/, "the link survives with what was left after the undo");
  assert.doesNotMatch(sent, /contenteditable/, "no dropdown markup in the message");

  // ---- Plain-text message -----------------------------------------------------------------
  step("plain text: the mention is plain text and still tracks the field");
  await openCompose({ plain: true });
  await type("hi @jo");
  await waitForDropdown("plain-text dropdown");
  assert.equal(await press("Enter"), true);
  await waitFor("To pill", WIN + `return win.document.querySelectorAll("#toAddrContainer mail-address-pill").length === 1;`);
  assert.deepEqual(await toPills(), ["John Smith <john@example.org>"]);
  assert.equal(await dropdown(), null);
  assert.match(await bodyText(), /^hi @John Smith\s*$/);
  assert.doesNotMatch(await bodyHtml(), /<a /, "no link in a plain-text message");

  await type("@@ja");
  await waitForDropdown("plain-text Cc dropdown");
  await press("Enter");
  await waitFor("Cc pill", WIN + `return win.document.querySelectorAll("#ccAddrContainer mail-address-pill").length === 1;`);

  step("plain text: deleting part of a mention keeps the person, all of it removes them");
  await deleteInText("@Jane Doe", 5, 9); // "@Jane"
  await sleep(1000);
  await press("Escape");
  assert.deepEqual(await ccPills(), ["Jane Doe <jane@example.org>"]);
  await deleteInText("@Jane", 0, 5);
  await waitFor("Cc emptied", WIN + `return win.document.querySelectorAll("#ccAddrContainer mail-address-pill").length === 0;`);
  assert.equal((await toPills()).length, 1);

  console.log("\nAll end-to-end checks passed.");
} catch (e) {
  console.error("\nFAILED:", e.message);
  console.error("--- Thunderbird log (extension related) ---");
  console.error(log.split("\n").filter((l) => /at-mention|compose\.js|background\.js|ExtensionError/i.test(l)).slice(-20).join("\n"));
  process.exitCode = 1;
} finally {
  m?.close();
  tb.kill("SIGKILL");
}
