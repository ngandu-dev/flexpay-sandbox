#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "Usage: bash scripts/check-clients.sh /path/to/flexpay-php /path/to/flexpay-ts" >&2
  exit 2
fi

sandbox_root=$(cd "$(dirname "$0")/.." && pwd)
php_root=$(cd "$1" && pwd)
typescript_root=$(cd "$2" && pwd)

cargo build --manifest-path "$sandbox_root/backend/Cargo.toml" --locked
bun run --cwd "$typescript_root" build
node "$sandbox_root/scripts/check-clients.mjs" "$php_root" "$typescript_root"
