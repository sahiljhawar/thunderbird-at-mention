// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildEntries, contactName, search, formatAddress, emailOf, MAX_RESULTS } from "../lib/contacts.js";

const card = (properties) => ({ properties });
const books = [
  {
    contacts: [
      card({ DisplayName: "John Smith", PrimaryEmail: "john@example.org" }),
      card({ FirstName: "Jane", LastName: "Doe", PrimaryEmail: "jane@example.org", SecondEmail: "jd@work.example" }),
      card({ PrimaryEmail: "only@example.org" }),
      card({ DisplayName: "Smithers", PrimaryEmail: "smithers@example.org" }),
      card({ DisplayName: "Zed", PrimaryEmail: "x@smith-corp.example" }),
    ],
  },
  { contacts: [card({ DisplayName: "John S.", PrimaryEmail: "JOHN@example.org" })] },
  {}, // an address book that could not be listed
];

test("a contact's name falls back from display name to first and last name to nickname", () => {
  assert.equal(contactName({ DisplayName: " Ann " }), "Ann");
  assert.equal(contactName({ FirstName: "Jane", LastName: "Doe" }), "Jane Doe");
  assert.equal(contactName({ FirstName: "Jane" }), "Jane");
  assert.equal(contactName({ NickName: "jd" }), "jd");
  assert.equal(contactName(), "");
});

test("entries are one per address, matched without regard to case, first contact wins", () => {
  const entries = buildEntries(books);
  assert.deepEqual(
    entries.map((e) => e.email),
    ["john@example.org", "jane@example.org", "jd@work.example", "only@example.org", "smithers@example.org", "x@smith-corp.example"],
  );
  assert.equal(entries.find((e) => e.email === "john@example.org").name, "John Smith");
});

test("a second address becomes its own entry with the same name", () => {
  const second = buildEntries(books).find((e) => e.email === "jd@work.example");
  assert.equal(second.name, "Jane Doe");
});

test("search ranks a name that starts with the query first, then words, then addresses", () => {
  const entries = buildEntries(books);
  assert.deepEqual(
    search(entries, "smith").map((r) => r.email),
    ["smithers@example.org", "john@example.org", "x@smith-corp.example"],
  );
});

test("a query with several words must match all of them", () => {
  const entries = buildEntries(books);
  assert.deepEqual(search(entries, "john sm").map((r) => r.email), ["john@example.org"]);
  assert.deepEqual(search(entries, "jane smith"), []);
});

test("search is case-insensitive and also finds addresses and contacts without a name", () => {
  const entries = buildEntries(books);
  assert.deepEqual(search(entries, "JANE").map((r) => r.email), ["jane@example.org", "jd@work.example"]);
  assert.deepEqual(search(entries, "only@"), [{ name: "", email: "only@example.org" }]);
});

test("an empty query lists contacts, limited, and nothing matches nonsense", () => {
  const many = buildEntries([
    { contacts: Array.from({ length: 20 }, (_, i) => card({ DisplayName: `P${String(i).padStart(2, "0")}`, PrimaryEmail: `p${i}@x.org` })) },
  ]);
  const all = search(many, "");
  assert.equal(all.length, MAX_RESULTS);
  assert.equal(all[0].name, "P00");
  assert.deepEqual(search(many, "zzz"), []);
});

test("an address is written as Name <email> without quotes when it can be", () => {
  assert.equal(formatAddress("John Smith", "j@x.org"), "John Smith <j@x.org>");
  assert.equal(formatAddress("John B. Smith", "j@x.org"), "John B. Smith <j@x.org>");
  assert.equal(formatAddress("", "j@x.org"), "j@x.org");
});

test("a name with special characters is quoted and escaped", () => {
  assert.equal(formatAddress("Smith, John", "j@x.org"), '"Smith, John" <j@x.org>');
  assert.equal(formatAddress('John "JJ" Smith', "j@x.org"), '"John \\"JJ\\" Smith" <j@x.org>');
});

test("the address of a recipient is found in both forms and ignored for contact objects", () => {
  assert.equal(emailOf("John Smith <John@X.org>"), "john@x.org");
  assert.equal(emailOf("john@x.org"), "john@x.org");
  assert.equal(emailOf({ id: "1", type: "contact" }), null);
});
