// SPDX-License-Identifier: GPL-3.0-or-later
// Compose script: runs inside the compose editor document.
// Watches for "@name", shows a dropdown of matching contacts, and on
// Enter/Tab adds the chosen contact: "@name" goes to To, "@@name" to Cc.

(() => {
  if (window.__atMentionLoaded) return;
  window.__atMentionLoaded = true;

  const api = typeof messenger !== "undefined" ? messenger : browser;
  // Published by lib/core.js, which is registered ahead of this script.
  const { FIELD_LABEL, findTrigger, mentionNeedle, normalize, mentionHtml, mentionKey } =
    globalThis.AtMentionCore;

  // What to leave in the message body once a contact is picked:
  //   "remove" : nothing, the "@query" text is deleted
  //   "name"   : the contact's name, e.g. "John Smith"
  //   "at-name": the contact's name with the @, e.g. "@John Smith"
  const BODY_TEXT = "at-name";

  /** @type {null | {node: Text, start: number, field: "to" | "cc", query: string, results: {name: string, email: string}[], index: number}} */
  let state = null;
  let seq = 0;
  let isPlainText = false;
  /** @type {Map<string, {field: string, email: string, name: string, needle: string, active: boolean, removedByUs?: boolean, pending?: boolean}>} */
  const mentions = new Map();
  let host = null;
  let list = null;

  const STYLE = `
    :host { all: initial; }
    .menu {
      --bg: #ffffff; --fg: #1f2328; --muted: #656d76;
      --border: #d0d7de; --hover: #e8f0fe;
      position: fixed; z-index: 2147483647; min-width: 260px; max-width: 420px;
      background: var(--bg); color: var(--fg);
      border: 1px solid var(--border); border-radius: 8px;
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18);
      font: 13px/1.3 system-ui, sans-serif; padding: 4px; overflow: hidden;
    }
    @media (prefers-color-scheme: dark) {
      .menu { --bg: #2b2d31; --fg: #e6e6e6; --muted: #9aa0a6; --border: #44474d; --hover: #3a4a6b; }
    }
    .head { padding: 4px 10px 2px; font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); }
    .item { padding: 6px 10px; border-radius: 5px; cursor: pointer; }
    .item.active { background: var(--hover); }
    .name { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .email { color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  `;

  function currentTrigger() {
    const sel = document.getSelection();
    if (
      !sel ||
      !sel.isCollapsed ||
      !sel.anchorNode ||
      sel.anchorNode.nodeType !== Node.TEXT_NODE
    ) {
      return null;
    }
    const node = sel.anchorNode;
    const caret = sel.anchorOffset;
    const found = findTrigger(node.data.slice(0, caret));
    return found && { node, caret, ...found };
  }

  function caretRect() {
    const sel = document.getSelection();
    if (!sel || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0).cloneRange();
    const rects = range.getClientRects();
    if (rects.length) return rects[rects.length - 1];
    const box = range.getBoundingClientRect();
    if (box.width || box.height || box.top) return box;
    const el = range.startContainer.parentElement;
    return el ? el.getBoundingClientRect() : null;
  }

  function ensureMenu() {
    if (host && host.isConnected) return;
    host = document.createElement("div");
    host.setAttribute("contenteditable", "false");
    const shadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = STYLE;
    list = document.createElement("div");
    list.className = "menu";
    shadow.append(style, list);
    document.body.appendChild(host);
  }

  function render() {
    ensureMenu();
    const head = document.createElement("div");
    head.className = "head";
    head.textContent = `Add to ${FIELD_LABEL[state.field]}`;
    list.replaceChildren(
      head,
      ...state.results.map((item, i) => {
        const row = document.createElement("div");
        row.className = "item" + (i === state.index ? " active" : "");
        const name = document.createElement("div");
        name.className = "name";
        name.textContent = item.name || item.email;
        row.append(name);
        if (item.name) {
          const email = document.createElement("div");
          email.className = "email";
          email.textContent = item.email;
          row.append(email);
        }
        // mousedown (not click) so the editor keeps its caret.
        row.addEventListener("mousedown", (e) => {
          e.preventDefault();
          commit(item);
        });
        row.addEventListener("mousemove", () => {
          if (state && state.index !== i) {
            state.index = i;
            render();
          }
        });
        return row;
      }),
    );
    position();
  }

  function position() {
    const rect = caretRect();
    if (!rect || !list) return;
    const height = list.offsetHeight;
    const width = list.offsetWidth;
    let top = rect.bottom + 4;
    if (top + height > window.innerHeight && rect.top - height - 4 > 0) {
      top = rect.top - height - 4;
    }
    const left = Math.max(4, Math.min(rect.left, window.innerWidth - width - 4));
    list.style.top = `${top}px`;
    list.style.left = `${left}px`;
  }

  function close() {
    seq++;
    state = null;
    if (host) {
      host.remove();
      host = null;
      list = null;
    }
  }

  async function refresh() {
    const trigger = currentTrigger();
    if (!trigger) return close();

    const mine = ++seq;
    let results = [];
    try {
      results = await api.runtime.sendMessage({ type: "search", query: trigger.query });
    } catch {
      // background not reachable
    }
    if (mine !== seq) return;

    const latest = currentTrigger();
    if (!latest || latest.query !== trigger.query || !results?.length) return close();

    state = {
      node: latest.node,
      start: latest.start,
      field: latest.field,
      query: latest.query,
      results,
      index: 0,
    };
    render();
  }

  function commit(item) {
    const trigger = currentTrigger();
    if (!trigger) return close();

    const range = document.createRange();
    range.setStart(trigger.node, trigger.start);
    range.setEnd(trigger.node, trigger.caret);
    const sel = document.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    if (BODY_TEXT === "remove") {
      document.execCommand("delete");
    } else {
      const needle = mentionNeedle(item, BODY_TEXT);
      if (isPlainText) {
        document.execCommand("insertText", false, `${needle} `);
      } else {
        // Link the mention to the contact's address.
        document.execCommand("insertHTML", false, mentionHtml(item.email, needle));
      }
      const key = mentionKey(trigger.field, item.email);
      const entry = mentions.get(key) || { field: trigger.field, email: item.email, active: false };
      entry.name = item.name;
      entry.needle = normalize(needle);
      entry.range = isPlainText ? plainMentionRange(needle) : null;
      mentions.set(key, entry);
      sendMention("add", entry);
    }

    close();
    if (BODY_TEXT === "remove") {
      api.runtime.sendMessage({
        type: "add",
        field: trigger.field,
        name: item.name,
        email: item.email,
      });
    }
  }

  // Keep the To/Cc fields in step with the mentions in the body: deleting a
  // mention removes that person from the field, and undoing the deletion
  // restores them.
  function sendMention(type, entry) {
    if (entry.pending) return;
    entry.pending = true;
    api.runtime
      .sendMessage({ type, field: entry.field, name: entry.name, email: entry.email })
      .then((changed) => {
        if (type === "add") {
          entry.active = entry.active || changed === true;
          entry.removedByUs = false;
        } else {
          entry.active = false;
          entry.removedByUs = true;
        }
      })
      .catch(() => {})
      .finally(() => {
        entry.pending = false;
      });
  }

  // Plain text has no link to look for, so the inserted text is covered by a
  // live Range. It shrinks as characters are deleted and only collapses once
  // the whole mention is gone.
  function plainMentionRange(needle) {
    const sel = document.getSelection();
    const node = sel && sel.anchorNode;
    if (!node || node.nodeType !== Node.TEXT_NODE) return null;
    const end = sel.anchorOffset - 1; // before the trailing space
    const start = end - needle.length;
    if (start < 0 || node.data.slice(start, end) !== needle) return null;
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, end);
    return range;
  }

  // A mention counts as present while any part of it is left: in HTML, while its
  // link is still in the message; in plain text, while its range is not empty.
  function mentionPresent(entry, text) {
    if (!isPlainText) {
      const href = `mailto:${entry.email}`.toLowerCase();
      return [...document.body.querySelectorAll("a[href]")].some(
        (a) => a.getAttribute("href").toLowerCase() === href,
      );
    }
    // Text coming back (undo) is not tracked by the range, so look for it too.
    return (entry.range && !entry.range.collapsed) || text.includes(entry.needle);
  }

  function syncMentions() {
    if (!mentions.size) return;
    const text = normalize(document.body.textContent || "");
    for (const entry of mentions.values()) {
      const present = mentionPresent(entry, text);
      if (!present && entry.active) sendMention("remove", entry);
      else if (present && !entry.active && entry.removedByUs) sendMention("add", entry);
    }
  }

  function move(delta) {
    const n = state.results.length;
    state.index = (state.index + delta + n) % n;
    render();
  }

  document.addEventListener(
    "keydown",
    (e) => {
      if (!state || e.isComposing) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          e.stopPropagation();
          move(1);
          break;
        case "ArrowUp":
          e.preventDefault();
          e.stopPropagation();
          move(-1);
          break;
        case "Enter":
        case "Tab": {
          // If results are stale (typed faster than the lookup), don't hijack.
          const t = currentTrigger();
          if (!t || t.query !== state.query || t.field !== state.field) return close();
          e.preventDefault();
          e.stopPropagation();
          commit(state.results[state.index]);
          break;
        }
        case "Escape":
          e.preventDefault();
          e.stopPropagation();
          close();
          break;
      }
    },
    true,
  );

  document.addEventListener("input", () => {
    api.runtime
      .sendMessage({ type: "isPlainText" })
      .then((v) => {
        isPlainText = v === true;
      })
      .catch(() => {});
    syncMentions();
    refresh();
  });

  document.addEventListener("selectionchange", () => {
    if (!state) return;
    const t = currentTrigger();
    if (!t || t.node !== state.node || t.start !== state.start) close();
  });

  window.addEventListener("blur", close);
  window.addEventListener("scroll", () => state && position(), true);

  api.runtime.onMessage.addListener((message) => {
    if (message?.type === "cleanup") close();
  });
})();
