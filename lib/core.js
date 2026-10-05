// SPDX-License-Identifier: GPL-3.0-or-later
// Pure helpers for the compose script. Compose scripts cannot be ES modules, so this is a
// classic script that publishes one global, AtMentionCore. The unit tests load it the same
// way (see tests/helpers.js).

globalThis.AtMentionCore = (() => {
  // "@" (To) or "@@" (Cc) must be at the start of the text or after whitespace, so typing an
  // email address like foo@bar.com never opens the dropdown. The query may hold spaces, so
  // "@john sm" still matches "John Smith".
  const TRIGGER = /(^|\s)(@@?)([^@\n]{0,40})$/;

  const FIELD_LABEL = { to: "To", cc: "Cc" };

  /**
   * Looks for an unfinished mention at the end of `textBeforeCaret`.
   * @returns {{ field: "to" | "cc", query: string, start: number } | null} `start` is the
   *   offset of the first "@" within the text.
   */
  function findTrigger(textBeforeCaret) {
    const m = TRIGGER.exec(textBeforeCaret);
    if (!m) return null;
    const marker = m[2];
    const query = m[3];
    return {
      field: marker.length === 2 ? "cc" : "to",
      query,
      start: textBeforeCaret.length - query.length - marker.length,
    };
  }

  /** What stays in the message body for a contact. "remove" leaves nothing. */
  function mentionNeedle(item, bodyText = "at-name") {
    const label = item.name || item.email;
    if (bodyText === "remove") return "";
    return bodyText === "at-name" ? `@${label}` : label;
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  }

  /** Non-breaking spaces compare equal to normal ones. */
  function normalize(s) {
    return s.replace(/ /g, " ");
  }

  /** The link inserted in an HTML message. The nbsp keeps the caret outside the link. */
  function mentionHtml(email, needle) {
    return `<a href="mailto:${escapeHtml(email)}">${escapeHtml(needle)}</a>&nbsp;`;
  }

  /** Key of a tracked mention: the same person can be in To and in Cc. */
  function mentionKey(field, email) {
    return `${field}:${email.toLowerCase()}`;
  }

  return { FIELD_LABEL, findTrigger, mentionNeedle, escapeHtml, normalize, mentionHtml, mentionKey };
})();
