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
# cache and eval/ingestion/results. LOAD_PROOF_DB names the database; there is no default, and the load copy
# niyantran_ingest_load_test is refused by a script that writes unless LOAD_PROOF_ALLOW_LOAD_COPY=1 (lib.ts).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
export PATH="$HOME/.docker/bin:$PATH"
READ="$HERE,$REPO/supabase/functions,$REPO/src/lib,$HOME/niyantran-eval-cache,$REPO/eval/ingestion/results"
WRITE="$HOME/niyantran-eval-cache,$REPO/eval/ingestion/results"
# The tests make temporary folders of their own (evidence_test.ts, driver_test.ts), so tests also read and write $TMPDIR.
if [ "${1:-}" = test ]; then
  READ="$READ,${TMPDIR:-/tmp}"
  WRITE="$WRITE,${TMPDIR:-/tmp}"
fi
PERMS=(
  --no-lock --node-modules-dir=none
  --allow-net=127.0.0.1,localhost
  --allow-run=docker,df
  "--allow-read=$READ"
  "--allow-write=$WRITE"
  --allow-env
)
if [ "${1:-}" = test ]; then
  shift
  exec deno test "${PERMS[@]}" "${@:-$HERE}"
fi
SCRIPT="$1"; shift
exec deno run "${PERMS[@]}" "$HERE/$SCRIPT" "$@"
