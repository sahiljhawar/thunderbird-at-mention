#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Builds dist/at-mention-<version>.xpi from the files the add-on needs at runtime.
set -euo pipefail
cd "$(dirname "$0")/.."

version="$(node -p "require('./manifest.json').version")"
out="dist/at-mention-$version.xpi"
mkdir -p dist
rm -f "$out"
zip -r -X "$out" manifest.json background.js compose.js lib icons README.md LICENSE >/dev/null
echo "$out ($(wc -c <"$out") bytes)"
