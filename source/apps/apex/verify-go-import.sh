#!/usr/bin/env bash
#
# Asserts that the deployed apex still resolves the Go module path.
#
# The Worker's source lives in this repository but its deployed form does not:
# it can be edited in the Cloudflare dashboard, the route can be detached, the
# DNS record can be un-proxied, or the domain can lapse. Any of those leaves
# `go get hatua.dev/go` broken with nothing in a diff to show for it, so the
# served bytes are checked against the module path git actually carries.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
go_mod="$repo_root/source/sdk/go/go.mod"

module="$(awk '/^module /{print $2; exit}' "$go_mod")"
if [[ -z "$module" ]]; then
  echo "no module line in $go_mod" >&2
  exit 1
fi

echo "module path: $module"

if ! served="$(curl -fsS --max-time 20 "https://${module}?go-get=1" 2>&1)"; then
  echo "https://${module}?go-get=1 did not answer: $served" >&2
  echo >&2
  echo "The script may be deployed but unrouted. A route only fires on a proxied" >&2
  echo "DNS record, and the token needs zone Workers Routes: Edit to attach one." >&2
  exit 1
fi

# The repository the tag names is not asserted here. Whether it is the mirror or
# something else is a decision recorded in an ADR; what breaks silently is the
# import path no longer being answered at all.
if ! grep -qF "content=\"${module} git " <<<"$served"; then
  echo "no go-import tag for ${module} at https://${module}?go-get=1" >&2
  echo "--- served ---" >&2
  echo "$served" >&2
  exit 1
fi

echo "go-import tag present for ${module}"
