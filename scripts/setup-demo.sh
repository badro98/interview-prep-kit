#!/usr/bin/env bash
# Copy demo sample data into the project root (or TARGET dir).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${1:-$ROOT}"
DEMO="$ROOT/demo"

if [[ ! -d "$DEMO" ]]; then
  echo "demo/ folder not found at $DEMO"
  exit 1
fi

echo "Installing demo data into $TARGET"

cp "$DEMO/interview.config.js" "$TARGET/interview.config.js"
cp "$DEMO/context/"*.md "$TARGET/context/"
cp "$DEMO/generated/"* "$TARGET/generated/"

echo "Done. From $TARGET run: npm run dev"
echo "Demo persona: Jordan Lee · Staff SWE @ Northwind Analytics"
