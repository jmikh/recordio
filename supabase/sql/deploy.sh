#!/bin/bash
# Deploys all idempotent SQL (functions, crons, triggers) to the database.
# Runs graveyard.sql first to clean up removed items.
#
# Usage:
#   sql/deploy.sh              — deploy to local Supabase
#   sql/deploy.sh --remote     — deploy to linked remote project

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

build_sql() {
    # Graveyard first — drop removed items before creating new ones
    if [[ -f "$SCRIPT_DIR/graveyard.sql" ]]; then
        cat "$SCRIPT_DIR/graveyard.sql"
        echo ""
    fi

    for dir in functions crons triggers; do
        local src="$SCRIPT_DIR/$dir"
        for f in "$src"/*.sql; do
            [[ -f "$f" ]] || continue
            echo "-- Source: $dir/$(basename "$f")"
            cat "$f"
            echo ""
        done
    done
}

TMPFILE="$(mktemp)"
build_sql > "$TMPFILE"
trap 'rm -f "$TMPFILE"' EXIT

if [[ "${1:-}" == "--remote" ]]; then
    echo "Deploying to remote..."
    supabase db query --linked -f "$TMPFILE"
else
    echo "Deploying to local..."
    psql "postgresql://postgres:postgres@localhost:54322/postgres" -f "$TMPFILE"
fi

echo "Done."
