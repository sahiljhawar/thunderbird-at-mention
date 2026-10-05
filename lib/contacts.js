// SPDX-License-Identifier: GPL-3.0-or-later
// Contact lookup and address formatting, kept free of Thunderbird APIs so it can be tested.

export const MAX_RESULTS = 8;

export function contactName(p = {}) {
  return (
    p.DisplayName ||
    [p.FirstName, p.LastName].filter(Boolean).join(" ") ||
    p.NickName ||
    ""
  ).trim();
}

/**
 * Flattens address books (as returned by addressBooks.list(true)) into one entry per
 * distinct email address. The first contact seen for an address wins.
 * @returns {{ name: string, email: string, haystack: string }[]}
 */
export function buildEntries(books) {
  const seen = new Map();
  for (const book of books) {
    for (const contact of book.contacts ?? []) {
      const p = contact.properties || {};
      const name = contactName(p);
      for (const email of [p.PrimaryEmail, p.SecondEmail]) {
        if (!email) continue;
        const key = email.toLowerCase();
        if (seen.has(key)) continue;
        seen.set(key, {
          name,
          email,
          haystack: `${name} ${email} ${p.NickName || ""}`.toLowerCase(),
        });
      }
    }
  }
  return [...seen.values()];
}

// Lower is better: name starts with the query, a word of the name does, the address
// does, anything else that still contains every word of the query.
function score(entry, query, tokens) {
  if (!tokens.every((t) => entry.haystack.includes(t))) return -1;
  const name = entry.name.toLowerCase();
  const email = entry.email.toLowerCase();
  if (name.startsWith(query)) return 0;
  if (name.split(/\s+/).some((w) => w.startsWith(tokens[0] ?? ""))) return 1;
  if (email.startsWith(query)) return 2;
  return 3;
}

/** @returns {{ name: string, email: string }[]} best matches first. An empty query lists everyone. */
export function search(entries, rawQuery, limit = MAX_RESULTS) {
  const query = rawQuery.trim().toLowerCase();
  const tokens = query.split(/\s+/).filter(Boolean);

  const scored = [];
  for (const entry of entries) {
    const s = tokens.length ? score(entry, query, tokens) : 0;
    if (s >= 0) scored.push({ entry, s });
  }
  scored.sort(
    (a, b) =>
      a.s - b.s ||
      (a.entry.name || a.entry.email).localeCompare(b.entry.name || b.entry.email),
  );
  return scored.slice(0, limit).map(({ entry }) => ({ name: entry.name, email: entry.email }));
}

/**
 * "Name <email>". Thunderbird shows quoted names with single quotes on the recipient pill,
 * so the name is only quoted when it contains characters that need it.
 */
export function formatAddress(name, email) {
  if (!name) return email;
  if (!/[()<>\[\]:;@\\,"]/.test(name)) return `${name} <${email}>`;
  return `"${name.replace(/(["\\])/g, "\\$1")}" <${email}>`;
}

/** The lower-cased address of a recipient given as text ("Name <a@b>" or "a@b"), else null. */
export function emailOf(recipient) {
  if (typeof recipient !== "string") return null;
  const m = /<([^>]+)>/.exec(recipient);
  return (m ? m[1] : recipient).trim().toLowerCase();
}
