#!/usr/bin/env bash
# CI entry point. Regenerates, verifies, and diffs against the committed output
# without ever promoting — so a stale parser and a failing one are both caught,
# and neither can be papered over by the check itself rewriting the tree.
set -euo pipefail
cd "$(dirname "$0")/.."
exec node src/build.js --check-drift "$@"
