#!/usr/bin/env bash
# Runs a harness script, or its tests, with scoped Deno permissions (review finding S4):
#
#   scripts/load-proof/lp.sh load.ts --dry-run
#   scripts/load-proof/lp.sh e1.ts --prove
#   scripts/load-proof/lp.sh test                 the harness's unit tests
#
# Network: 127.0.0.1 and localhost only. Run: docker and df only. Read: the harness, the worker sources it
# imports, src/lib, the evaluation cache and the results folder, because a save renames its .tmp file (no .env,
# nothing under credentials). Write: the evaluation
# cache and eval/ingestion/results. LOAD_PROOF_DB names the database (default niyantran_ingest_load_test).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
export PATH="$HOME/.docker/bin:$PATH"
PERMS=(
  --no-lock --node-modules-dir=none
  --allow-net=127.0.0.1,localhost
  --allow-run=docker,df
  "--allow-read=$HERE,$REPO/supabase/functions,$REPO/src/lib,$HOME/niyantran-eval-cache,$REPO/eval/ingestion/results"
  "--allow-write=$HOME/niyantran-eval-cache,$REPO/eval/ingestion/results"
  --allow-env
)
if [ "${1:-}" = test ]; then
  shift
  exec deno test "${PERMS[@]}" "${@:-$HERE}"
fi
SCRIPT="$1"; shift
exec deno run "${PERMS[@]}" "$HERE/$SCRIPT" "$@"
