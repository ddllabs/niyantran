#!/usr/bin/env bash
# Runs the Regulatory rehearsal proof, or its tests, with scoped Deno permissions (as lp.sh does for the other proofs,
# which cannot run it: the runner reads git for its commit and its receipts guard, so git is allowed here too).
#
#   scripts/load-proof/regulatory-proof.sh [--count 100] [--max-chunks 700] [--out DIR] [--break held-key|held-url|no-basis]
#   scripts/load-proof/regulatory-proof.sh test
#   scripts/load-proof/regulatory-proof.sh --help          the exit codes and the three breaks
#
# Exit 0 every check held; 1 a check failed (with --break: the break was confirmed by its intended reason); 2 not ready
# (nothing run); 3 an unexpected exception (with --break: the run failed for another reason). held-key and held-url are
# admission-refusal breaks; no-basis is a prepare-hold break. The proof refuses a database that is not a rehearsal one.
#
# Network: 127.0.0.1 and localhost only (the harness's own guard also refuses any other host). Run: docker, git, df.
# Read: this checkout and the main checkout it belongs to (the runner resolves both to check that its receipts folder is
# outside every checkout; deno grants a folder with everything under it) and the evaluation cache.
# Write: the rehearsal folder of the evaluation cache only. Nothing here reads a .env file or a credentials folder.
# LOAD_PROOF_DB names the database; the proof accepts only niyantran_ingest_load_*reg*_test (regulatory-setup.sh uses
# niyantran_ingest_load_reg_test, which is also this script's default).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
export PATH="$HOME/.docker/bin:$PATH"
export LOAD_PROOF_DB="${LOAD_PROOF_DB:-niyantran_ingest_load_reg_test}"
COMMON="$(git -C "$REPO" rev-parse --path-format=absolute --git-common-dir)"
PERMS=(
  --no-lock --node-modules-dir=none
  --allow-net=127.0.0.1,localhost
  --allow-run=docker,git,df
  "--allow-read=$REPO,$(dirname "$COMMON"),$HOME/niyantran-eval-cache"
  "--allow-write=$HOME/niyantran-eval-cache/reg-next/rehearsal"
  --allow-env
)
if [ "${1:-}" = test ]; then
  shift
  exec deno test "${PERMS[@]}" "${@:-$HERE/regulatory-proof_test.ts}"
fi
exec deno run "${PERMS[@]}" "$HERE/regulatory-proof.ts" "$@"
