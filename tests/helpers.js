// SPDX-License-Identifier: GPL-3.0-or-later
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

/** Loads lib/core.js the way the compose script sees it: a classic script that sets a global. */
export function loadCore() {
  const sandbox = {};
  sandbox.globalThis = sandbox;
  runInNewContext(readFileSync(new URL("../lib/core.js", import.meta.url), "utf8"), sandbox);
  return sandbox.AtMentionCore;
}
