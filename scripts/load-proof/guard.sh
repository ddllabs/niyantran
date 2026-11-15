#!/usr/bin/env bash
# Sourced by db.sh, postgrest.sh and regulatory-setup.sh. Two rules, both about not destroying or polluting by accident:
#
#   proof_db_name VAR      the database comes from LOAD_PROOF_DB with no default (F340); the load copy
#                          niyantran_ingest_load_test is refused unless LOAD_PROOF_ALLOW_LOAD_COPY=1 (callers that only read
#                          it do not call this)
#   refuse_unless_inspected DB ACTION [--discard-evidence]
#                          F305: a proof that failed leaves ~/niyantran-eval-cache/proof-failures/DB.marker (evidence.ts);
#                          replacing or dropping DB is refused while it exists. --discard-evidence goes ahead and renames the
#                          marker; the evidence folder is never touched.
# Needs die() from the caller.
LOAD_COPY_DB=niyantran_ingest_load_test
FAILURES_DIR="$HOME/niyantran-eval-cache/proof-failures"

proof_db_name() {
  local name="${LOAD_PROOF_DB:-}"
  [ -n "$name" ] || die "LOAD_PROOF_DB is not set; name the proof database, there is no default"
  if [ "$name" = "$LOAD_COPY_DB" ] && [ "${LOAD_PROOF_ALLOW_LOAD_COPY:-}" != 1 ]; then
    die "refusing $LOAD_COPY_DB, the load copy; use a database of its own, or set LOAD_PROOF_ALLOW_LOAD_COPY=1 if that is intended"
  fi
  if [ "$name" = "$LOAD_COPY_DB" ]; then
    echo "NOTICE: LOAD_PROOF_ALLOW_LOAD_COPY=1 is set; this run uses $LOAD_COPY_DB, the load copy." >&2
  fi
  printf '%s' "$name"
}

# The command that clears the marker of a database: regulatory-setup.sh only accepts the names that contain "reg".
inspected_command() {
  case "$1" in
    *reg*) echo "scripts/load-proof/regulatory-setup.sh inspected" ;;
    *) echo "LOAD_PROOF_DB=$1 scripts/load-proof/db.sh inspected" ;;
  esac
}

refuse_unless_inspected() {
  local db="$1" action="$2" flag="${3:-}" marker="$FAILURES_DIR/$1.marker"
  [ -f "$marker" ] || return 0
  if [ "$flag" = --discard-evidence ]; then
    mv "$marker" "$marker.discarded-$(date -u +%Y%m%dT%H%M%S)"
    echo "note: a failed run left evidence for $db (kept); $action goes ahead because of --discard-evidence" >&2
    return 0
  fi
  echo "refusing to $action $db: a proof failed on it and the failure has not been inspected." >&2
  sed 's/^/  /' "$marker" >&2
  die "look at the evidence folder above, then run \`$(inspected_command "$db")\` (or pass --discard-evidence to $action anyway)"
}

# `inspected`: the failure has been looked at; the marker is renamed and the evidence stays. The stamp is the one evidence.ts
# writes (20261115T100000).
mark_inspected() {
  local marker="$FAILURES_DIR/$1.marker"
  [ -f "$marker" ] || { echo "no uninspected failure for $1"; return 0; }
  mv "$marker" "$marker.inspected-$(date -u +%Y%m%dT%H%M%S)"
  echo "marked the failure of $1 as inspected; the evidence folder is untouched"
}
